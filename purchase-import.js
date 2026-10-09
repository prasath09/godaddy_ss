const VendorEntry = {
  rows: [],
  ids: ['pur_vendor','purchase_vendor_display','vendor_name','reprint_vendor'],
  fill(rows){
    this.rows=rows||[];
    this.ids.forEach(id=>{
      const input=document.getElementById(id);if(!input||input.tagName!=='INPUT')return;
      let list=document.getElementById(id+'_options');
      if(!list){list=document.createElement('datalist');list.id=id+'_options';input.after(list);input.setAttribute('list',list.id);}
      list.replaceChildren(...this.rows.map(row=>{const option=document.createElement('option');option.value=row.VendorName;return option;}));
      const existing=this.rows.find(row=>String(row.VendorID)===input.value);
      if(existing)input.value=existing.VendorName;
    });
  },
  key(id){
    const raw=String(document.getElementById(id)?.value||'').trim();
    const row=this.rows.find(row=>String(row.VendorName).trim().toLowerCase()===raw.toLowerCase());
    return row?String(row.VendorID):raw;
  },
  name(id){return String(document.getElementById(id)?.value||'').trim();}
};
let IMPORT_ROWS=[],GENERATED_PIECES=[],SAVED_PIECES=[],PURCHASE_SAVED=false,SAVING=false,VENDOR_FROM_EXCEL=false;
let SETUP={vendors:[],categories:[],categoryPriceTiers:[]},SETUP_READY=false;
window.onload=async()=>{setToday();document.getElementById('excel_file').disabled=true;try{SETUP=await callGas('getPurchaseSetup');SETUP_READY=true;VendorEntry.fill(SETUP.vendors);document.getElementById('excel_file').disabled=false;renderTable();}catch(e){msg('upload','Unable to load masters: '+e.message,'err');}};
function clean(v){ return String(v ?? "").trim(); }
function upper(v){ return clean(v).toUpperCase(); }
function esc(v){ return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function escAttr(v){ return esc(v).replace(/`/g,"&#096;"); }
function money(v){ return "₹" + Number(v || 0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function msg(name,text,cls=""){ const el=document.getElementById("msg_"+name); if(!el)return; el.textContent=text; el.className="msg "+cls; }

function setToday(){
  const d=new Date();
  document.getElementById("invoice_date").value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}

function normalizeHeader(v){ return clean(v).toLowerCase().replace(/[^a-z0-9]+/g," "); }
function getField(obj,names){
  const map={}; Object.keys(obj||{}).forEach(k=>map[normalizeHeader(k)]=obj[k]);
  for(const name of names){ const key=normalizeHeader(name); if(Object.prototype.hasOwnProperty.call(map,key)) return map[key]; }
  return "";
}


function callGas(method,...args){return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args));}
function options(rows,key,label,selected){return '<option value="">-- Select --</option>'+rows.map(r=>'<option value="'+escAttr(r[key])+'" '+(String(r[key])===String(selected)?'selected':'')+'>'+esc(r[label])+'</option>').join('');}
async function handleFileUpload(event){
  if(!SETUP_READY || SAVING || PURCHASE_SAVED)return;
  const file=event.target.files?.[0]; if(!file)return;
  try{
    msg("upload","Reading Excel file...");
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:"array",cellDates:true});
    loadWorkbook(wb);
    msg("upload",`${IMPORT_ROWS.length} purchase line(s) loaded.`,"ok");
  }catch(e){ console.error(e); msg("upload",e.message||String(e),"err"); }
}

function loadWorkbook(wb){
  const sheetName=wb.SheetNames.find(x=>String(x).toLowerCase()==="import format")||wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:"",raw:false});
  const excelVendors = rows
    .map(r => clean(getField(r,["Vendor Name","Vendor","Supplier Name","Supplier"])))
    .filter(Boolean);

  const uniqueExcelVendors = [...new Map(
    excelVendors.map(v => [v.toLowerCase(), v])
  ).values()];

  if (uniqueExcelVendors.length > 1) {
    throw new Error(
      "More than one Vendor Name was found in the Excel. One purchase bill must contain only one vendor."
    );
  }

  VENDOR_FROM_EXCEL = uniqueExcelVendors.length === 1;
  const excelVendorName = VENDOR_FROM_EXCEL ? uniqueExcelVendors[0] : "";

  IMPORT_ROWS=rows.map((r,index)=>{
    return {
      RowNo:index+1,
      DressPrefix:upper(getField(r,["Dress Prefix","Vendor Prefix","Prefix"])),
      Particulars:clean(getField(r,["Particulars","Description","Item","Product"])),
      Qty:Number(getField(r,["Qty","Quantity","Pcs","No of Pcs"])||0),
      PurchasePrice:Number(getField(r,["Purchase Price","Purchase Rate","Rate","Cost"])||0),
      Code:upper(getField(r,["Tier Code","Code","Tier","Price Code"])||""),
      SellingPrice:Number(getField(r,["Selling Price","Selling","Sale Price"])||0),
      MRP:Number(getField(r,["MRP"])||0),
      Category:clean(getField(r,["Category"])),
      Material:clean(getField(r,["Material"])),
      Design:clean(getField(r,["Design","Style","Design / Style"])),
      Colour:clean(getField(r,["Colour","Color"])),
      Size:clean(getField(r,["Size"])),
      Remarks:clean(getField(r,["Remarks","Remark"]))
    };
  }).filter(r=>r.Particulars||r.Qty||r.PurchasePrice||r.SellingPrice);

  GENERATED_PIECES=[];
  
  setTopVendorFromExcel(excelVendorName); IMPORT_ROWS.forEach(resolveExcelTier); renderTable(); validateReady();
}


function setTopVendorFromExcel(name){if(!name)return;const v=SETUP.vendors.find(v=>upper(v.VendorName)===upper(name));document.getElementById('vendor_name').value=v?v.VendorName:name;if(!v)msg('review','New vendor will be added to Vendor Master when the purchase is saved.','warn');}
function resolveExcelTier(r){const c=SETUP.categories.find(c=>upper(c.CategoryName)===upper(r.Category));const t=SETUP.categoryPriceTiers.find(t=>upper(t.TierCode)===upper(r.Code)&&(!c||String(t.CategoryID)===String(c.CategoryID)));r.CategoryID=c?.CategoryID||t?.CategoryID||'';r.CategoryPriceTierID=t?.CategoryPriceTierID||'';syncTier(r);}
function syncTier(r){const t=SETUP.categoryPriceTiers.find(t=>String(t.CategoryPriceTierID)===String(r.CategoryPriceTierID)&&String(t.CategoryID)===String(r.CategoryID));r.Code=t?.TierCode||'';r.SellingPrice=Number(t?.SellingPrice||0);r.Category=SETUP.categories.find(c=>String(c.CategoryID)===String(r.CategoryID))?.CategoryName||'';if(!r.MRP&&t)r.MRP=r.SellingPrice;}
function vendorNameChanged(){validateReady();}
function addBlankRow(){if(!SETUP_READY||SAVING||PURCHASE_SAVED)return;IMPORT_ROWS.push({Qty:1,PurchasePrice:0,MRP:0,CategoryID:'',CategoryPriceTierID:'',DressPrefix:'',Particulars:'',Material:'',Design:'',Colour:'',Size:'',Remarks:''});renderTable();validateReady();}
function updateRow(i,f,v){if(SAVING||PURCHASE_SAVED)return;const r=IMPORT_ROWS[i];if(!r)return;r[f]=['Qty','PurchasePrice','MRP'].includes(f)?Number(v):clean(v);if(f==='DressPrefix')r[f]=upper(v);if(f==='CategoryID'){r.CategoryPriceTierID='';syncTier(r);renderTable();}if(f==='CategoryPriceTierID'){r.MRP=0;syncTier(r);renderTable();}renderTotals();validateReady();}
function removeRow(i){if(SAVING||PURCHASE_SAVED)return;IMPORT_ROWS.splice(i,1);renderTable();validateReady();}
function renderTable(){const fields=['Particulars','PurchasePrice','MRP','Material','Design','Colour','Size','Qty','Remarks'];
const headings=['Particulars','Purchase Price','MRP','Material','Design','Colour','Size','Qty','Remarks'];
if(!IMPORT_ROWS.length){document.getElementById('import_table').innerHTML='<div class="muted" style="padding:12px">Upload Excel or click Add Row.</div>';renderTotals();return;}
document.getElementById('import_table').innerHTML='<table><thead><tr><th>#</th><th>Category</th><th>Tier Code</th><th>Selling Price</th>'+headings.map(h=>'<th>'+h+'</th>').join('')+'<th></th></tr></thead><tbody>'+IMPORT_ROWS.map((r,i)=>{
const tiers=SETUP.categoryPriceTiers.filter(t=>String(t.CategoryID)===String(r.CategoryID)).map(t=>({...t,Display:t.TierCode+' — '+money(t.SellingPrice)}));
return '<tr><td>'+(i+1)+'</td><td>'+(PURCHASE_SAVED?esc(r.Category):'<select onchange="updateRow('+i+',&quot;CategoryID&quot;,this.value)">'+options(SETUP.categories,'CategoryID','CategoryName',r.CategoryID)+'</select>')+'</td><td>'+(PURCHASE_SAVED?esc(r.Code):'<select onchange="updateRow('+i+',&quot;CategoryPriceTierID&quot;,this.value)">'+options(tiers,'CategoryPriceTierID','Display',r.CategoryPriceTierID)+'</select>')+'</td><td><strong>'+money(r.SellingPrice)+'</strong></td>'+fields.map(f=>'<td>'+(PURCHASE_SAVED?esc(['PurchasePrice','MRP'].includes(f)?money(r[f]):r[f]):'<input '+(['PurchasePrice','MRP','Qty'].includes(f)?'type="number" min="0" step="'+(f==='Qty'?'1':'.01')+'"':'type="text"')+' value="'+escAttr(r[f]??'')+'" onchange="updateRow('+i+',&quot;'+f+'&quot;,this.value)">')+'</td>').join('')+'<td>'+(PURCHASE_SAVED?'Saved':'<button class="btn danger" onclick="removeRow('+i+')">×</button>')+'</td></tr>';}).join('')+'</tbody></table>';renderTotals();}
function renderTotals(){
  const qty=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0),0);
  const purchase=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0)*Number(r.PurchasePrice||0),0);
  const retail=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0)*Number(r.SellingPrice||0),0);
  document.getElementById("import_totals").innerHTML=`<div>Lines: <strong>${IMPORT_ROWS.length}</strong></div><div>Total Qty: <strong>${qty}</strong></div><div>Purchase Value: <strong>${money(purchase)}</strong></div><div>Selling Value: <strong>${money(retail)}</strong></div>`;
}


function validateReady(){let error='';if(!SETUP_READY)error='Masters are still loading.';else if(!IMPORT_ROWS.length)error='Upload Excel or add a stock row.';else if(!document.getElementById('vendor_name').value)error='Select Vendor.';else if(!document.getElementById('invoice_date').value)error='Select Invoice Date.';else for(const r of IMPORT_ROWS){syncTier(r);if(!r.CategoryPriceTierID||!r.Code||r.SellingPrice<=0){error='Select Category and Tier Code for every row.';break;}if(!Number.isSafeInteger(r.Qty)||r.Qty<=0){error='Quantity must be a positive whole number.';break;}if(!Number.isFinite(r.PurchasePrice)||r.PurchasePrice<=0){error='Enter positive Purchase Price.';break;}if(!Number.isFinite(r.MRP)||r.MRP<r.SellingPrice){error='MRP must be at least Selling Price.';break;}}
document.getElementById('generate_btn').disabled=!!error||SAVING||PURCHASE_SAVED;if(!PURCHASE_SAVED)msg('review',error||'Ready to save purchase.',error?'warn':'ok');return !error&&!SAVING&&!PURCHASE_SAVED;}
function setFormLocked(locked){document.querySelectorAll('#excel_file,#vendor_name,#invoice_no,#invoice_date,#purchase_remarks,#review_actions button,#import_table input,#import_table select,#import_table button').forEach(el=>el.disabled=locked);}
async function addPurchase(){if(!validateReady())return;SAVING=true;setFormLocked(true);document.getElementById('generate_btn').disabled=true;try{
const vendorId=VendorEntry.key('vendor_name'),invoice=document.getElementById('invoice_no').value.trim()||'IMP-'+Date.now();
const res=await callGas('createPurchase',{VendorID:vendorId,VendorName:VendorEntry.name('vendor_name'),InvoiceNo:invoice,InvoiceDate:document.getElementById('invoice_date').value,Remarks:document.getElementById('purchase_remarks').value,Items:IMPORT_ROWS.map(r=>({CategoryID:r.CategoryID,CategoryPriceTierID:r.CategoryPriceTierID,Qty:r.Qty,PurchasePrice:r.PurchasePrice,MRP:r.MRP,Material:r.Material,Design:r.Design,Colour:r.Colour,Size:r.Size,Remarks:[r.Particulars,r.Remarks].filter(Boolean).join(' | ')}))});
if(res?.error||res?.ok===false||res?.success===false)throw Error(res.message||res.error||'Purchase failed.');
PURCHASE_SAVED=true;SAVING=false;GENERATED_PIECES=res.generatedPieces||[];renderTable();document.getElementById('invoice_no').value=invoice;document.getElementById('reprint_vendor').value=VendorEntry.name('vendor_name');callGas('getPurchaseSetup').then(setup=>{SETUP=setup;VendorEntry.fill(SETUP.vendors);}).catch(()=>{});document.getElementById('reprint_invoice').value=invoice;showSavedPieces(GENERATED_PIECES);document.getElementById('generated_summary').textContent='Purchase ID: '+res.purchaseId+' | Invoice: '+invoice+' | Saved Dress Codes: '+GENERATED_PIECES.length;msg('generate','Purchase saved. Items are read-only. Print from Saved Barcodes below.','ok');msg('review','Purchase saved.','ok');
}catch(e){SAVING=false;setFormLocked(false);validateReady();msg('generate',e.message||String(e),'err');}}
function clearImport(){if(SAVING)return;PURCHASE_SAVED=false;IMPORT_ROWS=[];GENERATED_PIECES=[];setFormLocked(false);for(const id of ['excel_file','vendor_name','invoice_no','purchase_remarks'])document.getElementById(id).value='';document.getElementById('generated_summary').textContent='No purchase added yet.';setToday();renderTable();validateReady();msg('generate','');}
async function loadInvoiceBarcodes(){const vendorId=VendorEntry.key('reprint_vendor'),invoice=document.getElementById('reprint_invoice').value.trim();if(!vendorId||!invoice)return msg('reprint','Select Vendor and enter Invoice No.','err');showSavedPieces([]);document.getElementById('load_saved_btn').disabled=true;try{const res=await callGas('getPurchaseBarcodesByInvoice',vendorId,invoice);showSavedPieces(res.pieces||[]);msg('reprint','Purchase ID: '+res.purchaseId+' | '+SAVED_PIECES.length+' saved barcode(s) loaded.','ok');}catch(e){msg('reprint',e.message||String(e),'err');}finally{document.getElementById('load_saved_btn').disabled=false;}}
function showSavedPieces(pieces){SAVED_PIECES=pieces;document.getElementById('print_saved_btn').disabled=!pieces.length;document.getElementById('saved_barcode_list').innerHTML=pieces.length?'<table style="min-width:650px"><thead><tr><th><input type="checkbox" checked onchange="selectAllSaved(this.checked)"></th><th>Dress Code</th><th>Category</th><th>Tier</th><th>Selling Price</th><th>Status</th></tr></thead><tbody>'+pieces.map((p,i)=>'<tr><td><input class="saved-check" type="checkbox" checked data-index="'+i+'"></td><td>'+esc(p.PieceBarcode)+'</td><td>'+esc(p.CategoryName)+'</td><td>'+esc(p.TierCode)+'</td><td>'+money(p.SellingPrice)+'</td><td>'+esc(p.Status)+'</td></tr>').join('')+'</tbody></table>':'';}
function selectAllSaved(checked){document.querySelectorAll('.saved-check').forEach(el=>el.checked=checked);}
function printSelectedBarcodes(){const pieces=[...document.querySelectorAll('.saved-check:checked')].map(el=>SAVED_PIECES[Number(el.dataset.index)]);if(!pieces.length)return msg('reprint','Select at least one sticker.','warn');printGeneratedStickers(pieces);}
function printGeneratedStickers(pieces){
  if(!Array.isArray(pieces)||!pieces.length)return alert("No saved piece barcodes for this row.");
  if(typeof JsBarcode!=="function")return alert("Barcode library has not loaded. Check your internet connection and retry.");
  const area=document.getElementById("printArea"); area.innerHTML="";
  let sheet;
  pieces.forEach((piece,index)=>{
    if(index % 24 === 0){
      sheet=document.createElement("div"); sheet.className="sticker-sheet";
      area.appendChild(sheet);
    }
    const div=document.createElement("div"); div.className="barcode-label";
    const price='₹'+Number(piece.SellingPrice||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
    const tierCode=piece.PieceBarcode;
    div.innerHTML=`<div class="label-heading"><span>SS</span><strong>${esc(price)}</strong></div>
      <svg class="barcode-svg" data-barcode="${escAttr(piece.PieceBarcode)}"></svg>
      <div class="label-tier">${esc(tierCode)}</div>`;
    sheet.appendChild(div);
  });
  area.style.display="none";
  try{
  area.querySelectorAll(".barcode-svg").forEach(svg=>{
    JsBarcode(svg,svg.dataset.barcode,{format:"CODE128",displayValue:false,width:1.5,height:42,margin:0,marginLeft:12,marginRight:12});
    // Scale the complete symbol, including quiet zones, inside the label.
    const width=Number(svg.getAttribute('width'));
    const height=Number(svg.getAttribute('height'));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    svg.removeAttribute('width'); svg.removeAttribute('height');
  });
  }catch(error){
    area.innerHTML="";
    return alert("Could not generate barcode labels: "+error.message);
  }
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
}


window.addEventListener('afterprint',()=>{document.getElementById('printArea').innerHTML='';});
