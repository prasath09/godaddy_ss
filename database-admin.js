import express from 'express';

const clean=v=>String(v??'').trim();
const qid=name=>'`'+String(name).replace(/`/g,'``')+'`';

function fileStamp(){
  return new Date().toISOString().replace(/[:.]/g,'-');
}

async function tableMeta(pool){
  const [cols]=await pool.query(`
    SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_KEY,EXTRA,DATA_TYPE,IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
    ORDER BY TABLE_NAME,ORDINAL_POSITION`);
  const map=new Map();
  for(const c of cols){
    if(!map.has(c.TABLE_NAME))map.set(c.TABLE_NAME,{name:c.TABLE_NAME,columns:[],primaryKey:[]});
    const t=map.get(c.TABLE_NAME);
    t.columns.push({
      name:c.COLUMN_NAME,
      key:c.COLUMN_KEY||'',
      extra:c.EXTRA||'',
      type:c.DATA_TYPE||'',
      nullable:String(c.IS_NULLABLE).toUpperCase()==='YES'
    });
    if(c.COLUMN_KEY==='PRI')t.primaryKey.push(c.COLUMN_NAME);
  }
  return map;
}

async function requireTable(pool,name){
  const table=clean(name);
  const meta=await tableMeta(pool);
  if(!meta.has(table))throw Error('Unknown database table: '+table);
  return meta.get(table);
}

function sqlValue(v){
  if(v===null||v===undefined)return 'NULL';
  if(Buffer.isBuffer(v))return "X'"+v.toString('hex')+"'";
  if(v instanceof Date)return "'"+v.toISOString().slice(0,19).replace('T',' ')+"'";
  if(typeof v==='number')return Number.isFinite(v)?String(v):'NULL';
  if(typeof v==='bigint')return String(v);
  if(typeof v==='boolean')return v?'1':'0';
  return "'"+String(v).replace(/\\/g,'\\\\').replace(/'/g,"''").replace(/\u0000/g,'\\0')+"'";
}

async function tableRowsSql(pool,table){
  const [rows,fields]=await pool.query('SELECT * FROM '+qid(table));
  if(!rows.length)return '-- '+table+': no rows\n';
  const cols=fields.map(f=>f.name);
  const chunks=[];
  const size=250;
  for(let i=0;i<rows.length;i+=size){
    const part=rows.slice(i,i+size);
    chunks.push(
      'INSERT INTO '+qid(table)+' ('+cols.map(qid).join(',')+') VALUES\n'+
      part.map(r=>'('+cols.map(c=>sqlValue(r[c])).join(',')+')').join(',\n')+';\n'
    );
  }
  return chunks.join('\n');
}

async function makeSqlExport(pool,mode,requested){
  const meta=await tableMeta(pool);
  const all=[...meta.keys()];
  const tables=(mode==='data'?requested:(requested?.length?requested:all));
  if(!tables.length)throw Error('No tables selected.');
  for(const t of tables)if(!meta.has(t))throw Error('Unknown database table: '+t);

  let out='-- Textile Shop MySQL export\n-- Generated '+new Date().toISOString()+'\nSET FOREIGN_KEY_CHECKS=0;\n\n';
  if(mode==='full'||mode==='structure'){
    for(const table of tables){
      const [[row]]=await pool.query('SHOW CREATE TABLE '+qid(table));
      const create=row['Create Table']||row['Create View'];
      out+='DROP TABLE IF EXISTS '+qid(table)+';\n'+create+';\n\n';
    }
  }
  if(mode==='full'||mode==='data'){
    for(const table of tables)out+='-- Data: '+table+'\n'+await tableRowsSql(pool,table)+'\n';
  }
  out+='SET FOREIGN_KEY_CHECKS=1;\n';
  return out;
}

function csvCell(v){
  if(v===null||v===undefined)v='__NULL__';
  else if(v instanceof Date)v=v.toISOString().slice(0,19).replace('T',' ');
  else if(Buffer.isBuffer(v))v=v.toString('hex');
  else v=String(v);
  return '"'+v.replace(/"/g,'""')+'"';
}

function toCsv(rows,columns){
  const lines=[columns.map(csvCell).join(',')];
  for(const row of rows)lines.push(columns.map(c=>csvCell(row[c])).join(','));
  return '\uFEFF'+lines.join('\r\n');
}

function parseCsv(text){
  const rows=[];
  let row=[],cell='',quoted=false;
  const s=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'&&s[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
      else cell+=ch;
    }
  }
  if(quoted)throw Error('CSV has an unclosed quoted value.');
  if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows.filter((r,i)=>i===0||r.some(v=>String(v).length));
}

function csvDbValue(v){
  return v==='__NULL__'?null:v;
}

export function installDatabaseAdmin(app,pool){
  app.get('/api/database-admin/tables',async(_req,res)=>{
    try{
      const meta=await tableMeta(pool);
      const tables=[];
      for(const t of meta.values()){
        const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM '+qid(t.name));
        tables.push({name:t.name,rows:Number(count.n||0),primaryKey:t.primaryKey});
      }
      res.json({ok:true,tables});
    }catch(e){res.status(400).json({ok:false,message:e.message||String(e)});}
  });

  app.post('/api/database-admin/export',async(req,res)=>{
    try{
      const mode=clean(req.body?.mode).toLowerCase();
      if(!['full','structure','data'].includes(mode))throw Error('Invalid export mode.');
      const tables=Array.isArray(req.body?.tables)?req.body.tables.map(clean).filter(Boolean):[];
      const sql=await makeSqlExport(pool,mode,tables);
      res.setHeader('Content-Type','application/sql; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="textile-${mode}-${fileStamp()}.sql"`);
      res.send(sql);
    }catch(e){res.status(400).json({ok:false,message:e.message||String(e)});}
  });

  app.post('/api/database-admin/clear',async(req,res)=>{
    const tables=Array.isArray(req.body?.tables)?req.body.tables.map(clean).filter(Boolean):[];
    if(req.body?.confirmation!=='CLEAR SELECTED DATA')return res.status(400).json({ok:false,message:'Clear confirmation was not supplied.'});
    if(!tables.length)return res.status(400).json({ok:false,message:'Select at least one table.'});
    const conn=await pool.getConnection();
    try{
      const meta=await tableMeta(pool);
      for(const t of tables)if(!meta.has(t))throw Error('Unknown database table: '+t);
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      await conn.beginTransaction();
      const deleted={};
      for(const t of tables){
        const [r]=await conn.query('DELETE FROM '+qid(t));
        deleted[t]=Number(r.affectedRows||0);
      }
      await conn.commit();
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
      res.json({ok:true,deleted});
    }catch(e){
      try{await conn.rollback();await conn.query('SET FOREIGN_KEY_CHECKS=1');}catch{}
      res.status(400).json({ok:false,message:e.message||String(e)});
    }finally{conn.release();}
  });

  app.post('/api/database-admin/export-csv',async(req,res)=>{
    try{
      const meta=await requireTable(pool,req.body?.table);
      const columns=meta.columns.map(c=>c.name);
      const [rows]=await pool.query('SELECT * FROM '+qid(meta.name));
      const csv=toCsv(rows,columns);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="${meta.name}-${fileStamp()}.csv"`);
      res.send(csv);
    }catch(e){res.status(400).json({ok:false,message:e.message||String(e)});}
  });

  app.post('/api/database-admin/import-csv',express.text({type:['text/csv','text/plain','application/csv'],limit:'25mb'}),async(req,res)=>{
    const conn=await pool.getConnection();
    try{
      const meta=await requireTable(pool,req.query?.table);
      if(!meta.primaryKey.length)throw Error('This table has no primary key, so safe update import is disabled.');
      const matrix=parseCsv(req.body);
      if(matrix.length<2)throw Error('CSV contains no data rows.');
      const headers=matrix[0].map(h=>clean(h));
      if(headers.some((h,i)=>!h||headers.indexOf(h)!==i))throw Error('CSV column headings are blank or duplicated.');
      const dbColumns=new Set(meta.columns.map(c=>c.name));
      const unknown=headers.filter(h=>!dbColumns.has(h));
      if(unknown.length)throw Error('Unknown CSV column(s): '+unknown.join(', '));
      const missingPk=meta.primaryKey.filter(k=>!headers.includes(k));
      if(missingPk.length)throw Error('CSV is missing primary-key column(s): '+missingPk.join(', '));
      const generated=new Set(meta.columns.filter(c=>/auto_increment|generated/i.test(c.extra)).map(c=>c.name));
      const editable=headers.filter(h=>!meta.primaryKey.includes(h)&&!generated.has(h));
      if(!editable.length)throw Error('CSV contains no editable columns.');

      await conn.beginTransaction();
      let rowsUpdated=0,rowsNotFound=0;
      for(let r=1;r<matrix.length;r++){
        const values=matrix[r];
        if(values.length!==headers.length)throw Error(`CSV row ${r+1} has ${values.length} values; expected ${headers.length}.`);
        const obj=Object.fromEntries(headers.map((h,i)=>[h,csvDbValue(values[i])]));
        for(const pk of meta.primaryKey)if(obj[pk]===null||clean(obj[pk])==='')throw Error(`CSV row ${r+1} has a blank primary key (${pk}).`);
        const setSql=editable.map(c=>qid(c)+'=?').join(',');
        const whereSql=meta.primaryKey.map(c=>qid(c)+' <=> ?').join(' AND ');
        const params=[...editable.map(c=>obj[c]),...meta.primaryKey.map(c=>obj[c])];
        const [result]=await conn.execute('UPDATE '+qid(meta.name)+' SET '+setSql+' WHERE '+whereSql,params);
        if(result.affectedRows>0)rowsUpdated++; else rowsNotFound++;
      }
      await conn.commit();
      res.json({ok:true,table:meta.name,rowsRead:matrix.length-1,rowsUpdated,rowsNotFound,primaryKey:meta.primaryKey,protectedColumns:[...meta.primaryKey,...generated]});
    }catch(e){
      try{await conn.rollback();}catch{}
      res.status(400).json({ok:false,message:e.message||String(e)});
    }finally{conn.release();}
  });
}
