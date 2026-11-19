'use strict';
const el=id=>document.getElementById(id);
let TABLES=[], CURRENT=null, OFFSET=0, CONNECTED=false, ROW_MODE='', ROW_SOURCE=null;
const status=t=>el('status').textContent=t;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=()=>el('api').value.trim().replace(/\/$/,'').replace(/\/api\/rpc$/,'');
const selectedTables=()=>[...document.querySelectorAll('#tables input:checked')].map(x=>x.value);
const currentMeta=()=>TABLES.find(t=>t.name===el('tableSelect').value);
async function api(path,{method='GET',body,download=false}={}){
  const url=base();if(!/^https?:\/\//.test(url))throw Error('Enter a valid API address');
  const key=el('adminKey').value;if(!key)throw Error('Enter database administrator key');
  const res=await fetch(url+'/api/database-admin/'+path,{method,headers:{'x-db-admin-key':key,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(!res.ok){const e=await res.json().catch(()=>({message:'HTTP '+res.status}));throw Error(e.message||'Request failed');}
  return download?res:res.json();
}
async function run(fn){try{await fn();}catch(e){status('Error: '+(e.message||e));}}
async function loadTables(){
  const d=await api('tables');TABLES=d.tables||[];CONNECTED=true;
  const previous=el('tableSelect').value,select=el('tableSelect');select.replaceChildren(new Option('Select table',''));
  TABLES.forEach(t=>select.add(new Option(t.name+' ('+t.rows+' rows)',t.name)));
  if(TABLES.some(t=>t.name===previous))select.value=previous;
  el('tables').replaceChildren(...TABLES.map(t=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=t.name;c.style.width='auto';l.append(c,document.createTextNode(' '+t.name));return l;}));
  el('connectionStatus').textContent='Connected: '+TABLES.length+' tables. '+(d.readOnly?'Read-only mode.':'Writes restricted to allowlisted tables.');
  el('addRow').disabled=!currentMeta()?.editable;
  status('Select a table to browse');
}
async function loadRows(reset=false){
  if(!CONNECTED)throw Error('Connect database first');
  const t=el('tableSelect').value;if(!t){CURRENT=null;el('rowTable').textContent='Select a table';return;}
  if(reset)OFFSET=0;
  CURRENT=await api('rows?table='+encodeURIComponent(t)+'&limit='+Number(el('pageSize').value)+'&offset='+OFFSET);renderRows();
}
function renderRows(){
  const d=CURRENT;if(!d)return;
  el('tableInfo').textContent=d.table+' · '+d.total+' records · PK: '+(d.primaryKey.join(', ')||'None');
  const names=d.columns.map(c=>c.name),editable=!!currentMeta()?.editable;
  el('rowTable').innerHTML=d.rows.length?'<table><thead><tr>'+names.map(c=>'<th>'+esc(c)+'</th>').join('')+'<th>Action</th></tr></thead><tbody>'+d.rows.map((r,i)=>'<tr>'+names.map(c=>'<td>'+esc(r[c]===null?'NULL':typeof r[c]==='object'?JSON.stringify(r[c]):r[c])+'</td>').join('')+'<td>'+(editable?'<button data-edit="'+i+'">Edit</button>':'View only')+'</td></tr>').join('')+'</tbody></table>':'No records';
  el('rowTable').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRow('edit',d.rows[Number(b.dataset.edit)]));
  el('pageText').textContent=(d.total?d.offset+1:0)+'–'+Math.min(d.offset+d.rows.length,d.total)+' of '+d.total;
  el('prev').disabled=d.offset===0;el('next').disabled=d.offset+d.limit>=d.total;
  el('addRow').disabled=!editable;
  status('Loaded '+d.rows.length+' records');
}
function openRow(mode,row={}){
  const meta=currentMeta();if(!meta?.editable)return status('Write access disabled for this table');
  ROW_MODE=mode;ROW_SOURCE=row;el('rowDialogTitle').textContent=(mode==='edit'?'Edit':'Add')+' row · '+meta.name;
  const root=el('rowFields');root.replaceChildren();
  for(const col of meta.columns){
    if(/auto_increment|generated/i.test(col.extra||'')&&mode==='add')continue;
    const field=document.createElement('div');field.className='field';
    const label=document.createElement('label');label.textContent=col.name+' ('+col.columnType+')';
    const input=document.createElement(['text','mediumtext','longtext','json'].includes(col.type)?'textarea':'input');
    input.dataset.col=col.name;input.value=row[col.name]===null?'__NULL__':String(row[col.name]??col.defaultValue??'');
    input.readOnly=mode==='edit'&&(meta.primaryKey.includes(col.name)||/generated|auto_increment/i.test(col.extra||''));
    field.append(label,input);root.append(field);
  }
  el('rowDialog').showModal();
}
async function saveRow(){
  const meta=currentMeta(),values={};
  el('rowFields').querySelectorAll('[data-col]').forEach(i=>values[i.dataset.col]=i.value);
  if(ROW_MODE==='edit'){
    const key=Object.fromEntries(meta.primaryKey.map(k=>[k,ROW_SOURCE[k]]));
    meta.primaryKey.forEach(k=>delete values[k]);
    for(const c of meta.columns)if(/generated|auto_increment/i.test(c.extra||''))delete values[c.name];
    await api('row/update',{method:'POST',body:{table:meta.name,key,values}});
  }else await api('row/insert',{method:'POST',body:{table:meta.name,values}});
  el('rowDialog').close();await loadTables();el('tableSelect').value=meta.name;await loadRows();status('Saved successfully');
}
async function download(path,body,fallback){
  const response=await api(path,{method:'POST',body,download:true}),blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||fallback;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status('Download complete');
}
el('connectDb').onclick=()=>run(loadTables);
el('tableSelect').onchange=()=>run(()=>loadRows(true));
el('refreshTable').onclick=()=>run(()=>loadRows(false));
el('pageSize').onchange=()=>run(()=>loadRows(true));
el('prev').onclick=()=>run(()=>{OFFSET=Math.max(0,OFFSET-Number(el('pageSize').value));return loadRows();});
el('next').onclick=()=>run(()=>{OFFSET+=Number(el('pageSize').value);return loadRows();});
el('addRow').onclick=()=>openRow('add');
el('saveRow').onclick=()=>run(saveRow);
el('cancelRow').onclick=()=>el('rowDialog').close();
el('full').onclick=()=>run(()=>download('export',{mode:'full',tables:[]},'full.sql'));
el('structure').onclick=()=>run(()=>download('export',{mode:'structure',tables:[]},'structure.sql'));
el('data').onclick=()=>run(()=>download('export',{mode:'data',tables:selectedTables()},'data.sql'));
el('csvDownload').onclick=()=>run(()=>download('export-csv',{table:el('tableSelect').value},'table.csv'));
el('selectAll').onchange=()=>document.querySelectorAll('#tables input').forEach(c=>c.checked=el('selectAll').checked);
el('api').value=window.TEXTILE_API_BASE||location.origin;
el('refreshTable').disabled=true;el('addRow').disabled=true;
