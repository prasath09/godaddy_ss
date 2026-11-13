'use strict';
const $=id=>document.getElementById(id);
let active='',list=[],state='OPEN',busy=false,loadedSignature='';
async function api(path,method='GET',payload){
  const res=await fetch('/api/whatsapp/inbox/'+path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
  let data;try{data=await res.json();}catch{throw new Error('Unexpected backend response ('+res.status+').');}
  if(!res.ok||!data.ok){if(res.status===401){showLogin();}throw new Error(data.message||'Request failed.');}
  return data;
}
function showLogin(){ $('loginView').style.display='block';$('app').style.display='none';$('signout').style.display='none';}
function showApp(){ $('loginView').style.display='none';$('app').style.display='grid';$('signout').style.display='block';}
function notice(text){$('alert').style.display=text?'block':'none';$('alert').textContent=text||'';}
function time(t){try{return new Date(t).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'});}catch{return '';}}
function drawList(){const search=$('search').value.toLowerCase().trim();const target=$('chatlist');target.replaceChildren();const filtered=list.filter(x=>String(x.mobile).includes(search)||String(x.last_text||'').toLowerCase().includes(search));if(!filtered.length){const e=document.createElement('div');e.className='empty';e.textContent='No conversations yet.';target.append(e);return;}
  filtered.forEach(item=>{const b=document.createElement('button');b.className='chat'+(active===item.mobile?' active':'');const name=document.createElement('strong');name.textContent='+'+item.mobile;const badge=document.createElement('span');badge.style.display='inline';badge.textContent=item.state==='CLOSED'?' · Closed':'';name.append(badge);if(Number(item.unread)>0){const unread=document.createElement('i');unread.className='pill';unread.textContent=item.unread;name.append(unread);}const latest=document.createElement('span');latest.textContent=(item.last_direction==='outbound'?'You: ':'')+(item.last_text||'(Media or attachment)');b.append(name,latest);b.onclick=()=>select(item.mobile);target.append(b);});
}
async function getConversations(){if($('app').style.display!=='grid')return;try{const data=await api('conversations');list=data.rows||[];drawList();if(active){const item=list.find(x=>x.mobile===active);if(item){state=item.state||'OPEN';$('stateButton').textContent=state==='OPEN'?'Close conversation':'Reopen conversation';}}}catch(e){notice(e.message);}}
function renderThread(rows){const container=$('messages');const stick=container.scrollHeight-container.scrollTop-container.clientHeight<100;container.replaceChildren();if(!rows.length){const p=document.createElement('div');p.className='empty';p.textContent='No messages.';container.append(p);return;}
  rows.forEach(m=>{const el=document.createElement('div');el.className='bubble '+(m.direction==='outbound'?'outbound':'inbound');el.textContent=m.body_text||'('+m.message_type+' message)';const small=document.createElement('small');small.textContent=time(m.created_at)+' · '+(m.delivery_status||'');el.append(small);container.append(el);});if(stick)container.scrollTop=container.scrollHeight;
}
async function getThread(){if(!active||busy)return;const mobile=active;try{const data=await api('thread/'+encodeURIComponent(mobile));if(mobile!==active)return;const signature=data.rows.map(x=>x.id+':'+x.delivery_status).join('|');if(signature!==loadedSignature){renderThread(data.rows);loadedSignature=signature;}
   $('replyText').disabled=!data.canReply;$('send').disabled=!data.canReply;notice(data.canReply?'':'Free-form replies require a recent inbound WhatsApp message (within the customer-service window).');
 }catch(e){notice(e.message);}}
async function select(mobile){active=mobile;loadedSignature='';$('current').textContent='+'+mobile;$('details').textContent='Staff conversation · Test mode';$('stateButton').disabled=false;drawList();await getThread();try{await api('read','POST',{mobile});}catch(e){notice(e.message);}getConversations();}
$('loginForm').onsubmit=async(e)=>{e.preventDefault();$('error').textContent='';try{await api('login','POST',{adminKey:$('loginKey').value});$('loginKey').value='';showApp();await getConversations();}catch(err){$('error').textContent=err.message;}};
$('signout').onclick=async()=>{try{await api('logout','POST',{});}catch{}showLogin();};
$('search').oninput=drawList;
$('stateButton').onclick=async()=>{if(!active)return;try{await api('state','POST',{mobile:active,state:state==='OPEN'?'CLOSED':'OPEN'});await getConversations();}catch(e){notice(e.message);}};
$('replyForm').onsubmit=async(e)=>{e.preventDefault();const text=$('replyText').value.trim();if(!active||!text)return;busy=true;$('send').disabled=true;try{await api('reply','POST',{mobile:active,text});$('replyText').value='';loadedSignature='';await getThread();await getConversations();}catch(err){notice(err.message);}finally{busy=false;await getThread();}};
(async()=>{try{const status=await api('session');if(status.authenticated){showApp();await getConversations();}else showLogin();}catch{showLogin();}})();
setInterval(async()=>{if($('app').style.display!=='grid')return;await getConversations();await getThread();},5000);
