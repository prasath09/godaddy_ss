import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = n => String(process.env[n] ?? '').trim();
const digits = v => String(v ?? '').replace(/\D/g, '');
const secureEq = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const sessions = new Map();
const failed = new Map();
const SESSION_MS=8*60*60*1000;
const directory=path.dirname(fileURLToPath(import.meta.url));
const isTest=()=>env('WHATSAPP_MODE').toLowerCase()==='test';

let setup;
async function schema(pool){
  if(!setup) setup=pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    mobile VARCHAR(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
    state VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    assigned_to VARCHAR(100) NULL,
    last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_wa_conv_state (state)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch(e=>{setup=null;throw e;});
  return setup;
}
function cookies(req){ return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>{const i=x.indexOf('=');return i<0?['','']:[x.slice(0,i).trim(),x.slice(i+1).trim()];})); }
function tokenSession(req){const raw=cookies(req).sswa_session;if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;const s=sessions.get(crypto.createHash('sha256').update(raw).digest('hex'));return s&&s.expires>Date.now()?s:null;}
function auth(req,res,next){if(!tokenSession(req))return res.status(401).json({ok:false,message:'Please sign in.'});next();}
function sameOrigin(req){const origin=req.get('origin');if(!origin)return false;try{const url=new URL(origin);return url.protocol==='https:' && url.host===req.get('host');}catch{return false;}}
function jsonPost(req,res,next){if(!sameOrigin(req))return res.status(403).json({ok:false,message:'Invalid request origin.'});next();}
function error(res,e,label){console.error('[WhatsApp Inbox]',label,e?.message);return res.status(500).json({ok:false,message:label});}
const jsResponse=(req,res,filename,type)=>fs.readFile(path.join(directory,filename),'utf8').then(s=>{res.set('Cache-Control','no-store').type(type).send(s);}).catch(()=>res.sendStatus(404));
const onlyTest=(req,res,next)=>isTest()?next():res.status(403).json({ok:false,message:'Phase 2 pilot is restricted to WHATSAPP_MODE=test.'});

export function installWhatsAppInbox(app,pool){
  app.get('/api/whatsapp/inbox',(req,res)=>jsResponse(req,res,'whatsapp-inbox.html','html'));
  app.get('/api/whatsapp/inbox/client.js',(req,res)=>jsResponse(req,res,'whatsapp-inbox-client.js','application/javascript'));
  app.get('/api/whatsapp/inbox/session',(req,res)=>res.json({ok:true,authenticated:!!tokenSession(req),testMode:isTest()}));
  app.post('/api/whatsapp/inbox/login',jsonPost,(req,res)=>{
    const ip=String(req.ip||'unknown');const entry=failed.get(ip);
    if(entry&&entry.until>Date.now())return res.status(429).json({ok:false,message:'Too many attempts. Try again later.'});
    const secret=env('WHATSAPP_ADMIN_KEY');const supplied=String(req.body?.adminKey||'');
    if(secret.length<32)return res.status(503).json({ok:false,message:'Set a strong WHATSAPP_ADMIN_KEY of at least 32 characters in GoDaddy.'});
    if(!secureEq(secret,supplied)){
      const attempts=(entry&&Date.now()-entry.start<15*60*1000?entry.count:0)+1;
      failed.set(ip,{count:attempts,start:entry?.start&&Date.now()-entry.start<15*60*1000?entry.start:Date.now(),until:attempts>=5?Date.now()+15*60*1000:0});
      return res.status(401).json({ok:false,message:'Invalid login key.'});
    }
    failed.delete(ip);
    const token=crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'),{expires:Date.now()+SESSION_MS});
    for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);
    res.setHeader('Set-Cookie',`sswa_session=${token}; Path=/api/whatsapp/inbox; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS/1000}`);
    return res.json({ok:true});
  });
  app.post('/api/whatsapp/inbox/logout',jsonPost,auth,(req,res)=>{
    const raw=cookies(req).sswa_session;if(raw)sessions.delete(crypto.createHash('sha256').update(raw).digest('hex'));
    res.setHeader('Set-Cookie','sswa_session=; Path=/api/whatsapp/inbox; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    res.json({ok:true});
  });
  app.get('/api/whatsapp/inbox/conversations',auth,onlyTest,async(req,res)=>{
    try{
      await schema(pool);
      const [rows]=await pool.query(`SELECT m.mobile,MAX(m.id) latest_id,MAX(m.created_at) last_at,
        (SELECT x.body_text FROM whatsapp_messages x WHERE x.mobile=m.mobile ORDER BY x.id DESC LIMIT 1) last_text,
        (SELECT x.direction FROM whatsapp_messages x WHERE x.mobile=m.mobile ORDER BY x.id DESC LIMIT 1) last_direction,
        COALESCE(c.state,'OPEN') state,COALESCE(c.last_read_id,0) last_read_id,
        SUM(CASE WHEN m.direction='inbound' AND m.id>COALESCE(c.last_read_id,0) THEN 1 ELSE 0 END) unread
        FROM whatsapp_messages m LEFT JOIN whatsapp_conversations c ON c.mobile=m.mobile
        GROUP BY m.mobile,c.state,c.last_read_id ORDER BY latest_id DESC LIMIT 200`);
      res.json({ok:true,rows});
    }catch(e){error(res,e,'Could not list conversations.');}
  });
  app.get('/api/whatsapp/inbox/thread/:mobile',auth,onlyTest,async(req,res)=>{
    const mobile=digits(req.params.mobile);if(!/^\d{8,15}$/.test(mobile))return res.status(400).json({ok:false,message:'Invalid mobile.'});
    try{
      const [rows]=await pool.execute('SELECT id,wa_message_id,direction,mobile,message_type,body_text,delivery_status,created_at FROM whatsapp_messages WHERE mobile=? ORDER BY id DESC LIMIT 150',[mobile]);
      const [[inbound]]=await pool.execute("SELECT MAX(created_at) last_at FROM whatsapp_messages WHERE mobile=? AND direction='inbound'",[mobile]);
      res.json({ok:true,rows:rows.reverse(),canReply:!!inbound?.last_at&&(Date.now()-new Date(inbound.last_at).getTime())<23*60*60*1000});
    }catch(e){error(res,e,'Could not load messages.');}
  });
  app.post('/api/whatsapp/inbox/read',jsonPost,auth,onlyTest,async(req,res)=>{
    const mobile=digits(req.body?.mobile);if(!/^\d{8,15}$/.test(mobile))return res.status(400).json({ok:false,message:'Invalid mobile.'});
    try{
      await schema(pool);
      await pool.execute(`INSERT INTO whatsapp_conversations(mobile,last_read_id) VALUES (?,(SELECT COALESCE(MAX(id),0) FROM whatsapp_messages WHERE mobile=?)) ON DUPLICATE KEY UPDATE last_read_id=GREATEST(last_read_id,VALUES(last_read_id))`,[mobile,mobile]);
      res.json({ok:true});
    }catch(e){error(res,e,'Could not mark conversation read.');}
  });
  app.post('/api/whatsapp/inbox/state',jsonPost,auth,onlyTest,async(req,res)=>{
    const mobile=digits(req.body?.mobile),state=String(req.body?.state||'').toUpperCase();
    if(!/^\d{8,15}$/.test(mobile)||!['OPEN','CLOSED'].includes(state))return res.status(400).json({ok:false,message:'Invalid conversation update.'});
    try{await schema(pool);await pool.execute('INSERT INTO whatsapp_conversations(mobile,state) VALUES (?,?) ON DUPLICATE KEY UPDATE state=VALUES(state)',[mobile,state]);res.json({ok:true});}
    catch(e){error(res,e,'Could not update conversation.');}
  });
  app.post('/api/whatsapp/inbox/reply',jsonPost,auth,onlyTest,async(req,res)=>{
    const mobile=digits(req.body?.mobile),text=String(req.body?.text||'').trim();
    if(!/^\d{8,15}$/.test(mobile)||!text||text.length>4096)return res.status(400).json({ok:false,message:'Enter a valid recipient and message (1–4096 characters).'});
    const recipients=env('WHATSAPP_TEST_RECIPIENTS').split(',').map(digits);
    if(!recipients.includes(mobile))return res.status(403).json({ok:false,message:'Only verified recipients in WHATSAPP_TEST_RECIPIENTS are allowed.'});
    const token=env('WHATSAPP_ACCESS_TOKEN'),phone=env('WHATSAPP_PHONE_NUMBER_ID'),version=env('WHATSAPP_GRAPH_VERSION')||'v25.0';
    if(!token||!/^\d+$/.test(phone)||!/^v\d+\.\d+$/.test(version))return res.status(503).json({ok:false,message:'Meta API credentials not configured.'});
    try{
      const [[inbound]]=await pool.execute("SELECT MAX(created_at) last_at FROM whatsapp_messages WHERE mobile=? AND direction='inbound'",[mobile]);
      if(!inbound?.last_at||(Date.now()-new Date(inbound.last_at).getTime())>=23*60*60*1000)
        return res.status(409).json({ok:false,message:'No recent real customer message within the customer-service window. Use an approved template instead (not yet included).'});
      const result=await fetch(`https://graph.facebook.com/${version}/${phone}/messages`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:mobile,type:'text',text:{preview_url:false,body:text}}),
        signal:AbortSignal.timeout(15000)
      });
      const data=await result.json();
      if(!result.ok){console.error('[WhatsApp Inbox] Meta reply failed:',data?.error?.code,data?.error?.message);return res.status(502).json({ok:false,message:'Meta rejected reply.',metaError:data?.error?.message||'Unknown Meta error'});}
      const id=data?.messages?.[0]?.id;
      if(!id)return res.status(502).json({ok:false,message:'Meta did not return a message ID.'});
      await pool.execute(`INSERT INTO whatsapp_messages(wa_message_id,direction,mobile,message_type,body_text,delivery_status)
        VALUES (?,'outbound',?,'text',?,'accepted') ON DUPLICATE KEY UPDATE wa_message_id=wa_message_id`,[id,mobile,text]);
      console.info('[WhatsApp OUTGOING]',{to:'***'+mobile.slice(-4),type:'text',messageId:id});
      res.json({ok:true,messageId:id});
    }catch(e){error(res,e,'Could not send reply.');}
  });
}
