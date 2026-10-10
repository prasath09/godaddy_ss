const el=id=>document.getElementById(id);
let busy=false,pending=[],pendingUpload=null;
const selection=()=>[...document.querySelectorAll('#tables input:checked')].map(x=>x.value);
const status=text=>el('status').textContent=text;

function oneTable(){
  const tables=selection();
  if(tables.length!==1)throw Error('Select exactly one table for CSV download/upload.');
  return tables[0];
}

function updateCount(){
  const boxes=[...document.querySelectorAll('#tables input')],n=selection().length;
  el('count').textContent=`(${n} selected)`;
  el('selectAll').checked=boxes.length>0&&n===boxes.length;
  el('selectAll').indeterminate=n>0&&n<boxes.length;
  el('editTable').textContent=n===1?selection()[0]:(n===0?'None':'Select only one table');
}

function base(){
  const raw=el('api').value.trim().replace(/\/$/,'');
  if(!raw)throw Error('Enter the backend API address.');
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol))throw Error('Use an HTTP or HTTPS API address.');
  return raw.replace(/\/api\/rpc$/,'');
}

async function request(route,body){
  const response=await fetch(base()+'/api/database-admin/'+route,{
    method:body?'POST':'GET',
    headers:{...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if(!response.ok){
    const error=await response.json().catch(()=>({message:'Request failed: '+response.status}));
    throw Error(error.message||('Request failed: '+response.status));
  }
  return response;
}

async function run(action){
  if(busy)return;
  busy=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await action();}
  catch(e){status(e.message||String(e));}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}

function saveResponse(response,fallback){
  return response.blob().then(blob=>{
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;
    a.download=(response.headers.get('content-disposition')||'').match(/filename="([^"]+)"/)?.[1]||fallback;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
}

async function load(){
  status('Loading tables…');
  const result=await(await request('tables')).json();
  el('tables').replaceChildren();
  for(const table of result.tables){
    const label=document.createElement('label'),box=document.createElement('input');
    box.type='checkbox';box.value=table.name;box.onchange=updateCount;
    label.append(box,document.createTextNode(' '+table.name+(table.primaryKey?.length?'  [PK: '+table.primaryKey.join(', ')+']':'')));
    el('tables').append(label);
  }
  updateCount();
  status('Tables loaded. Select one table to edit, or multiple tables for SQL data backup.');
}

async function download(mode){
  const tables=selection();
  if(mode==='data'&&!tables.length)throw Error('Select at least one table.');
  status('Preparing SQL download…');
  const response=await request('export',{mode,tables});
  await saveResponse(response,`textile-${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}.sql`);
  status('SQL download prepared. Check your browser downloads.');
}

async function downloadCsv(){
  const table=oneTable();
  status('Preparing CSV for '+table+'…');
  const response=await request('export-csv',{table});
  await saveResponse(response,`${table}.csv`);
  status('CSV downloaded for '+table+'. Edit it in Excel and save as CSV UTF-8 before uploading.');
}

async function uploadCsv(){
  const table=oneTable();
  const file=el('csvFile').files?.[0];
  if(!file)throw Error('Choose the edited CSV file first.');
  if(!/\.csv$/i.test(file.name))throw Error('Upload a .csv file.');
  const csv=await file.text();
  if(!csv.trim())throw Error('The CSV file is empty.');
  status('Uploading and validating '+table+'…');
  const response=await fetch(base()+'/api/database-admin/import-csv?table='+encodeURIComponent(table),{
    method:'POST',
    headers:{'Content-Type':'text/csv;charset=utf-8'},
    body:csv
  });
  const result=await response.json().catch(()=>({message:'Import failed: '+response.status}));
  if(!response.ok)throw Error(result.message||('Import failed: '+response.status));
  status(
    'Table update completed successfully.\n'+
    'Table: '+result.table+'\n'+
    'CSV rows read: '+result.rowsRead+'\n'+
    'Existing rows updated: '+result.rowsUpdated+'\n'+
    'Rows not found/skipped: '+result.rowsNotFound+'\n'+
    'Protected primary-key columns: '+(result.primaryKey||[]).join(', ')
  );
  el('csvFile').value='';
}

el('load').onclick=()=>run(load);
for(const mode of ['full','structure','data'])el(mode).onclick=()=>run(()=>download(mode));
el('csvDownload').onclick=()=>run(downloadCsv);
el('csvUpload').onclick=()=>run(async()=>{
  const table=oneTable();
  const file=el('csvFile').files?.[0];
  if(!file)throw Error('Choose the edited CSV file first.');
  pendingUpload={table,file};
  el('uploadTableName').textContent=table;
  el('confirmUpload').showModal();
});
el('cancelUpload').onclick=()=>{pendingUpload=null;el('confirmUpload').close();};
el('confirmUploadBtn').onclick=()=>{
  el('confirmUpload').close();
  pendingUpload=null;
  run(uploadCsv);
};

el('selectAll').onchange=()=>{
  document.querySelectorAll('#tables input').forEach(x=>x.checked=el('selectAll').checked);
  updateCount();
};

el('clear').onclick=()=>{
  pending=selection();
  if(!pending.length)return status('Select at least one table.');
  el('confirmTables').replaceChildren(...pending.map(name=>{const li=document.createElement('li');li.textContent=name;return li;}));
  el('confirm').showModal();
};
el('cancel').onclick=()=>el('confirm').close();
el('confirmClear').onclick=()=>{
  el('confirm').close();
  const tables=[...pending];
  run(async()=>{
    status('Clearing selected data…');
    const result=await(await request('clear',{tables,confirmation:'CLEAR SELECTED DATA'})).json();
    status('Data cleared successfully.\n'+Object.entries(result.deleted).map(([name,count])=>name+': '+count+' rows deleted').join('\n'));
  });
};

const config=window.TEXTILE_CONFIG||{};
el('api').value=config.API_BASE_URL||config.apiBaseUrl||config.API_URL||(location.protocol.startsWith('http')?location.origin:'');
