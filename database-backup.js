const el=id=>document.getElementById(id);
let TABLES=[],CURRENT=null,OFFSET=0,ROW_MODE='',ROW_SOURCE=null,PENDING_DELETE=null;
const status=t=>el('status').textContent=t;

function base(){
  const raw=el('api').value.trim().replace(/\/$/,'');
  if(!raw)throw Error('Enter the backend API address.');
  const u=new URL(raw);if(!['http:','https:'].includes(u.protocol))throw Error('Use an HTTP or HTTPS API address.');
  return raw.replace(/\/api\/rpc$/,'');
}
function headers(json=true){return json?{'Content-Type':'application/json'}:{};}
async function api(route,{method='GET',body=null,raw=false}={}){
  const r=await fetch(base()+'/api/database-admin/'+route,{method,headers:headers(!raw),...(body!==null?{body:raw?body:JSON.stringify(body)}:{})});
  if(!r.ok){const x=await r.json().catch(()=>({message:'Request failed: '+r.status}));throw Error(x.message||('Request failed: '+r.status));}
  return r;
}
function busy(on){document.querySelectorAll('#admin button').forEach(b=>b.disabled=on);}
async function run(fn){try{busy(true);await fn();}catch(e){status(e.message||String(e));}finally{busy(false);}}
function saveResponse(response,fallback){return response.blob().then(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(response.headers.get('content-disposition')||'').match(/filename="([^"]+)"/)?.[1]||fallback;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function selectedTables(){return [...document.querySelectorAll('#tables input:checked')].map(x=>x.value);}
function currentMeta(){return TABLES.find(t=>t.name===el('tableSelect').value)||null;}
function keyOf(row,meta){return Object.fromEntries((meta.primaryKey||[]).map(k=>[k,row[k]]));}


async function loadRows(reset=false){
  const table=el('tableSelect').value;if(!table){CURRENT=null;el('rowTable').textContent='Select a table.';return;}
  if(reset)OFFSET=0;
  const limit=Number(el('pageSize').value||50);
  status('Loading '+table+'...');
  CURRENT=await (await api('rows?table='+encodeURIComponent(table)+'&limit='+limit+'&offset='+OFFSET)).json();
  renderRows();
  status('Loaded '+CURRENT.rows.length+' row(s) from '+table+'.');
}
function renderRows(){
  const d=CURRENT;if(!d)return;
  el('tableInfo').innerHTML=`<strong>${esc(d.table)}</strong> · ${d.total} total row(s) · Primary key: ${d.primaryKey.length?esc(d.primaryKey.join(', ')):'None (view only)'}`;
  if(!d.rows.length){el('rowTable').innerHTML='<div style="padding:16px">No rows on this page.</div>';}
  else{
    const cols=d.columns.map(c=>c.name);
    el('rowTable').innerHTML='<table><thead><tr>'+cols.map(c=>`<th class="${d.primaryKey.includes(c)?'pk':''}">${esc(c)}</th>`).join('')+'<th class="actions-cell">Actions</th></tr></thead><tbody>'+d.rows.map((r,i)=>'<tr>'+cols.map(c=>`<td class="${d.primaryKey.includes(c)?'pk':''}">${esc(r[c]===null?'NULL':r[c])}</td>`).join('')+`<td class="actions-cell"><button data-edit="${i}">Edit</button><button class="danger" data-delete="${i}">Delete</button></td></tr>`).join('')+'</tbody></table>';
    el('rowTable').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openRow('edit',d.rows[Number(b.dataset.edit)]));
    el('rowTable').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>askDelete(d.rows[Number(b.dataset.delete)]));
  }
  const from=d.total?d.offset+1:0,to=Math.min(d.offset+d.rows.length,d.total);el('pageText').textContent=`${from}-${to} of ${d.total}`;
  el('prev').disabled=d.offset<=0;el('next').disabled=d.offset+d.limit>=d.total;
  el('addRow').disabled=false;
}
function inputFor(col,value,readonly=false){
  const wrap=document.createElement('div');wrap.className='field';
  const label=document.createElement('label');label.textContent=col.name+(col.key==='PRI'?' (PK)':'');
  const input=document.createElement(['text','mediumtext','longtext','json'].includes(col.type)?'textarea':'input');
  input.dataset.col=col.name;input.value=value===null?'__NULL__':String(value??'');input.readOnly=readonly;
  if(['int','bigint','smallint','tinyint','decimal','double','float'].includes(col.type))input.type='text';
  const small=document.createElement('small');small.textContent=`${col.columnType||col.type}${col.nullable?' · NULL allowed':''}${col.extra?' · '+col.extra:''}`;
  wrap.append(label,input,small);return wrap;
}
function openRow(mode,row={}){
  const meta=currentMeta();if(!meta)return;
  if(mode==='edit'&&!meta.primaryKey.length)return status('This table has no primary key, so safe direct editing is disabled.');
  ROW_MODE=mode;ROW_SOURCE=row;el('rowDialogTitle').textContent=mode==='edit'?'Edit Row — '+meta.name:'Add Row — '+meta.name;el('rowFields').replaceChildren();
  for(const col of meta.columns){
    const generated=/auto_increment|generated/i.test(col.extra||'');
    if(mode==='add'&&generated)continue;
    el('rowFields').appendChild(inputFor(col,row[col.name]??(col.defaultValue??''),mode==='edit'&&(meta.primaryKey.includes(col.name)||generated)));
  }
  el('rowDialog').showModal();
}
function formValues(){const o={};el('rowFields').querySelectorAll('[data-col]').forEach(i=>o[i.dataset.col]=i.value);return o;}
async function saveRow(){
  const meta=currentMeta(),values=formValues();
  if(ROW_MODE==='edit'){
    const key=keyOf(ROW_SOURCE,meta);for(const k of meta.primaryKey)delete values[k];
    await (await api('row/update',{method:'POST',body:{table:meta.name,key,values}})).json();status('Row updated successfully.');
  }else{
    await (await api('row/insert',{method:'POST',body:{table:meta.name,values}})).json();status('Row added successfully.');
  }
  el('rowDialog').close();await loadTables();el('tableSelect').value=meta.name;await loadRows();
}
function askDelete(row){
  const meta=currentMeta();if(!meta?.primaryKey.length)return status('This table has no primary key, so safe direct deletion is disabled.');
  PENDING_DELETE={table:meta.name,key:keyOf(row,meta)};el('deleteText').textContent='Delete '+meta.name+' row '+JSON.stringify(PENDING_DELETE.key)+' ?';el('deleteDialog').showModal();
}
async function deleteRow(){const p=PENDING_DELETE;if(!p)return;await (await api('row/delete',{method:'POST',body:{...p,confirmation:'DELETE ROW'}})).json();el('deleteDialog').close();PENDING_DELETE=null;status('Row deleted.');await loadTables();el('tableSelect').value=p.table;await loadRows();}

function renderSimpleTable(target,rows,cols){
  if(!rows?.length){target.innerHTML='<div style="padding:12px">No rows.</div>';return;}
  const columns=cols?.length?cols:Object.keys(rows[0]);target.innerHTML='<table><thead><tr>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+columns.map(c=>'<td>'+esc(r[c]===null?'NULL':r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
async function runSql(){const sql=el('sql').value;const x=await (await api('sql',{method:'POST',body:{sql}})).json();renderSimpleTable(el('sqlResult'),x.rows,x.columns);status('SQL query completed.'+(x.truncated?' Showing first 500 rows.':''));}
async function download(mode){const tables=mode==='data'?selectedTables():[];if(mode==='data'&&!tables.length)throw Error('Select at least one table.');const r=await api('export',{method:'POST',body:{mode,tables}});await saveResponse(r,'textile-'+mode+'.sql');status('SQL backup downloaded.');}
async function downloadCsv(){const t=el('tableSelect').value;if(!t)throw Error('Select a table first.');const r=await api('export-csv',{method:'POST',body:{table:t}});await saveResponse(r,t+'.csv');status('CSV downloaded for '+t+'.');}
async function uploadCsv(){const t=el('tableSelect').value,f=el('csvFile').files?.[0];if(!t)throw Error('Select a table first.');if(!f)throw Error('Choose a CSV file.');if(!confirm('Update existing rows in '+t+' from this CSV?'))return;const csv=await f.text();const r=await fetch(base()+'/api/database-admin/import-csv?table='+encodeURIComponent(t),{method:'POST',headers:{'Content-Type':'text/csv;charset=utf-8'},body:csv});const x=await r.json().catch(()=>({message:'Import failed: '+r.status}));if(!r.ok)throw Error(x.message);status(`CSV update completed. Rows read: ${x.rowsRead}; updated: ${x.rowsUpdated}; not found: ${x.rowsNotFound}`);await loadRows();}
function askClear(){const t=selectedTables();if(!t.length)return status('Select at least one table to clear.');el('clearList').innerHTML=t.map(x=>'<li>'+esc(x)+'</li>').join('');el('clearDialog').showModal();}
async function clearTables(){const tables=selectedTables();const x=await (await api('clear',{method:'POST',body:{tables,confirmation:'CLEAR SELECTED DATA'}})).json();el('clearDialog').close();status('Tables cleared:\n'+Object.entries(x.deleted).map(([k,v])=>k+': '+v).join('\n'));await loadTables();}

el('tableSelect').onchange=()=>run(()=>loadRows(true));el('refreshTable').onclick=()=>run(()=>loadRows(false));el('pageSize').onchange=()=>run(()=>loadRows(true));el('addRow').onclick=()=>openRow('add',{});el('saveRow').onclick=()=>run(saveRow);el('cancelRow').onclick=()=>el('rowDialog').close();el('confirmDelete').onclick=()=>run(deleteRow);el('cancelDelete').onclick=()=>el('deleteDialog').close();
el('prev').onclick=()=>run(()=>{OFFSET=Math.max(0,OFFSET-Number(el('pageSize').value));return loadRows(false);});el('next').onclick=()=>run(()=>{OFFSET+=Number(el('pageSize').value);return loadRows(false);});
el('runSql').onclick=()=>run(runSql);el('full').onclick=()=>run(()=>download('full'));el('structure').onclick=()=>run(()=>download('structure'));el('data').onclick=()=>run(()=>download('data'));el('csvDownload').onclick=()=>run(downloadCsv);el('csvUpload').onclick=()=>run(uploadCsv);el('clear').onclick=askClear;el('confirmClear').onclick=()=>run(clearTables);el('cancelClear').onclick=()=>el('clearDialog').close();el('selectAll').onchange=()=>document.querySelectorAll('#tables input').forEach(x=>x.checked=el('selectAll').checked);

const cfg=window.TEXTILE_CONFIG||{};el('api').value=sessionStorage.getItem('dbAdminApi')||cfg.API_BASE_URL||cfg.apiBaseUrl||cfg.API_URL||(location.protocol.startsWith('http')?location.origin:'');
loadTables().catch(e=>status(e.message||String(e)));
