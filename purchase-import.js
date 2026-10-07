let IMPORT_ROWS = [];
let GENERATED_PIECES = [];
let VENDOR_FROM_EXCEL = false;
let PURCHASE_SAVED = false;
let SAVING = false;
let ROW_PIECES = [];

window.onload = () => setToday();

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

async function handleFileUpload(event){
  if(SAVING || PURCHASE_SAVED)return;
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
  
  setTopVendorFromExcel(excelVendorName); renderTable(); validateReady();
}

function setTopVendorFromExcel(excelVendorName){
  const el=document.getElementById("vendor_name");
  el.value=excelVendorName||"";
  el.readOnly=!!excelVendorName;
  el.title=excelVendorName
    ? "Vendor Name loaded from Excel"
    : "Vendor Name not found in Excel. Enter it here.";
}

function vendorNameChanged(){
  validateReady();
}
function addBlankRow(){
  if(SAVING || PURCHASE_SAVED)return;
  IMPORT_ROWS.push({RowNo:IMPORT_ROWS.length+1,Particulars:"",Qty:1,PurchasePrice:0,Code:"",SellingPrice:0,MRP:0,Category:"",Material:"",Design:"",Colour:"",Size:"",Remarks:""});
  renderTable(); validateReady();
}

function updateRow(i,field,value){
  if(SAVING || PURCHASE_SAVED)return;
  const r=IMPORT_ROWS[i]; if(!r)return;
  if(["Qty","PurchasePrice","SellingPrice","MRP"].includes(field)) r[field]=Number(value||0); else { r[field]=clean(value); if(field==="Code") r[field]=upper(r[field]).replace(/[^A-Z0-9-]/g,""); }
  renderTotals(); validateReady(); refreshMasterButton(i);
}

function removeRow(i){ if(SAVING || PURCHASE_SAVED)return; IMPORT_ROWS.splice(i,1); IMPORT_ROWS.forEach((r,n)=>r.RowNo=n+1); renderTable(); validateReady(); }

function applyCodeToAll(){
  if(SAVING || PURCHASE_SAVED)return;
  const code=upper(document.getElementById("apply_code").value).replace(/[^A-Z0-9-]/g,"");
  if(!code) return msg("review","Enter a valid Tier Code first. Example: JT1.","err");
  IMPORT_ROWS.forEach(r=>r.Code=code);
  renderTable(); validateReady();
  msg("review",`Tier Code ${code} applied to all rows.`,"ok");
}

function applySellingToAll(){
  if(SAVING || PURCHASE_SAVED)return;
  const price=Number(document.getElementById("apply_selling").value||0);
  if(!Number.isFinite(price)||price<=0) return msg("review","Enter a valid selling price first.","err");
  IMPORT_ROWS.forEach(r=>r.SellingPrice=price); renderTable(); validateReady(); msg("review",`Selling price ${money(price)} applied to all rows.`,"ok");
}

function renderTable(){
  if(PURCHASE_SAVED){renderSavedTable(); return;}
  const el=document.getElementById("import_table");
  if(!IMPORT_ROWS.length){ el.innerHTML='<div class="muted" style="padding:12px">No imported rows.</div>'; renderTotals(); return; }
  el.innerHTML=`<table><thead><tr><th>#</th><th>Particulars</th><th>Qty</th><th>Purchase</th><th>Tier Code *</th><th>Selling *</th><th>MRP</th><th>Category</th><th>Material</th><th>Design</th><th>Colour</th><th>Size</th><th>Remarks</th><th>Tier / Master Barcode</th><th></th></tr></thead><tbody>${IMPORT_ROWS.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><input class="wide" value="${escAttr(r.Particulars)}" onchange="updateRow(${i},'Particulars',this.value)"></td>
      <td><input class="small" type="number" min="1" step="1" value="${r.Qty||""}" onchange="updateRow(${i},'Qty',this.value)"></td>
      <td><input class="small" type="number" min="0" step=".01" value="${r.PurchasePrice||""}" onchange="updateRow(${i},'PurchasePrice',this.value)"></td>
      <td><input class="small required" type="text" maxlength="20" value="${escAttr(r.Code||"")}" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'');updateRow(${i},'Code',this.value)"></td>
      <td><input class="small required" type="number" min="0" step=".01" value="${r.SellingPrice||""}" oninput="updateRow(${i},'SellingPrice',this.value)"></td>
      <td><input class="small" type="number" min="0" step=".01" value="${r.MRP||""}" onchange="updateRow(${i},'MRP',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Category)}" onchange="updateRow(${i},'Category',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Material)}" onchange="updateRow(${i},'Material',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Design)}" onchange="updateRow(${i},'Design',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Colour)}" onchange="updateRow(${i},'Colour',this.value)"></td>
      <td><input class="small" value="${escAttr(r.Size)}" onchange="updateRow(${i},'Size',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Remarks)}" onchange="updateRow(${i},'Remarks',this.value)"></td>
      <td id="master_action_${i}">${masterButtonHtml(r,i)}</td>
      <td><button class="btn danger" style="padding:5px 8px" onclick="removeRow(${i})">×</button></td>
    </tr>`).join("")}</tbody></table>`;
  renderTotals();
}

function renderTotals(){
  const qty=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0),0);
  const purchase=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0)*Number(r.PurchasePrice||0),0);
  const retail=IMPORT_ROWS.reduce((s,r)=>s+Number(r.Qty||0)*Number(r.SellingPrice||0),0);
  document.getElementById("import_totals").innerHTML=`<div>Lines: <strong>${IMPORT_ROWS.length}</strong></div><div>Total Qty: <strong>${qty}</strong></div><div>Purchase Value: <strong>${money(purchase)}</strong></div><div>Selling Value: <strong>${money(retail)}</strong></div>`;
}

function validateReady(){
  if(SAVING || PURCHASE_SAVED){document.getElementById("generate_btn").disabled=true; return false;}
  let error="";
  if(!IMPORT_ROWS.length) error="Upload purchase items first.";
  const vendorName=clean(document.getElementById("vendor_name").value);
  if(!error&&!vendorName) error="Enter Vendor Name at the top.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isInteger(Number(r.Qty))||Number(r.Qty)<=0)) error="Every row needs a valid whole-number Qty.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isFinite(Number(r.PurchasePrice))||Number(r.PurchasePrice)<=0)) error="Every row needs Purchase Price.";
  if(!error&&IMPORT_ROWS.some(r=>!clean(r.Code))) error="Enter Tier Code for every row.";
  if(!error&&IMPORT_ROWS.some(r=>!/^[A-Z0-9-]+$/.test(upper(r.Code)))) error="Tier Code can contain only A-Z, 0-9 and hyphen.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isFinite(Number(r.SellingPrice))||Number(r.SellingPrice)<=0)) error="Enter Selling Price for every row.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isFinite(Number(r.MRP))||Number(r.MRP)<0)) error="MRP must be zero or a valid positive amount.";
  if(!error&&IMPORT_ROWS.some(r=>Number(r.MRP||0)>0&&Number(r.SellingPrice)>Number(r.MRP))) error="Selling Price cannot be greater than MRP.";
  document.getElementById("generate_btn").disabled=!!error;
  if(error){ msg("review",error,"warn"); return false; }
  msg("review","Ready. Click Add Purchase.","ok"); return true;
}

function callGas(method,...args){ return new Promise((resolve,reject)=>{ google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args); }); }

async function addPurchase(){
  if(!validateReady())return;
  const btn=document.getElementById("generate_btn"); btn.disabled=true;
  SAVING=true; setFormLocked(true);
  try{
    msg("generate","Adding purchase to the database...");
    const res=await callGas("createImportedPurchase",{
      InvoiceNo:clean(document.getElementById("invoice_no").value),
      InvoiceDate:clean(document.getElementById("invoice_date").value),
      Remarks:clean(document.getElementById("purchase_remarks").value),
      Items:IMPORT_ROWS.map(r=>({VendorName:clean(document.getElementById("vendor_name").value),Particulars:r.Particulars,Code:r.Code,Qty:Number(r.Qty),PurchasePrice:Number(r.PurchasePrice),SellingPrice:Number(r.SellingPrice),MRP:Number(r.MRP||0),Category:r.Category,Material:r.Material,Design:r.Design,Colour:r.Colour,Size:r.Size,Remarks:r.Remarks}))
    });
    if(res?.ok===false || res?.success===false || res?.error) throw new Error(res.message||res.error||"Purchase was not saved.");
    PURCHASE_SAVED=true; SAVING=false;
    GENERATED_PIECES=Array.isArray(res?.generatedPieces)?res.generatedPieces:[];
    msg("generate",res?.message||"Purchase added successfully. Use Generate Barcode on the required row.","ok");
    document.getElementById("generated_summary").innerHTML=`<strong>Purchase ID:</strong> ${esc(res?.purchaseId||"")} &nbsp; <strong>Invoice:</strong> ${esc(res?.invoiceNo||"")}<br><strong>Total Qty:</strong> ${Number(res?.totalQty||0)} &nbsp; <strong>Purchase Value:</strong> ${money(res?.purchaseValue||0)}<br><strong>Individual Barcodes:</strong> ${GENERATED_PIECES.length}`;
    ROW_PIECES=groupSavedPieces(); renderTable();
    msg("review","Purchase saved. Items are now read-only.","ok");
  }catch(e){ console.error(e); msg("generate",e.message||String(e),"err"); SAVING=false; if(!PURCHASE_SAVED){setFormLocked(false);validateReady();} else {renderTable();} }
}

function printGeneratedStickers(pieces){
  if(!Array.isArray(pieces)||!pieces.length)return alert("No saved piece barcodes for this row.");
  if(typeof JsBarcode!=="function")return alert("Barcode library has not loaded. Check your internet connection and retry.");
  const area=document.getElementById("printArea"); area.innerHTML="";
  pieces.forEach(piece=>{
    const div=document.createElement("div"); div.className="barcode-label";
    div.innerHTML=`<div class="label-category">${esc(piece.CategoryName||"")}</div><div class="label-description">${esc(piece.Particulars||"")}</div><div class="price">${money(piece.SellingPrice)}</div><svg class="barcode-svg" data-barcode="${escAttr(piece.PieceBarcode)}"></svg><div class="label-code">${esc(piece.PieceBarcode)}</div><div class="label-mrp">MRP ${money(piece.MRP)}</div>`;
    area.appendChild(div);
  });
  area.style.display="none";
  area.querySelectorAll(".barcode-svg").forEach(svg=>{
    JsBarcode(svg,svg.dataset.barcode,{format:"CODE128",displayValue:false,width:1.15,height:30,margin:0,marginLeft:12,marginRight:12});
    // Scale the complete symbol, including quiet zones, inside the label.
    const width=Number(svg.getAttribute('width'));
    const height=Number(svg.getAttribute('height'));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    svg.removeAttribute('width'); svg.removeAttribute('height');
  });
  setTimeout(()=>window.print(),120);
}

function clearImport(){
  if(SAVING)return;
  PURCHASE_SAVED=false; ROW_PIECES=[]; VENDOR_FROM_EXCEL=false; setFormLocked(false);
  IMPORT_ROWS=[]; GENERATED_PIECES=[];
  document.getElementById("excel_file").value=""; document.getElementById("vendor_name").value=""; document.getElementById("invoice_no").value=""; document.getElementById("purchase_remarks").value=""; document.getElementById("apply_code").value=""; document.getElementById("apply_selling").value="";
  document.getElementById("generate_btn").disabled=true;  document.getElementById("generated_summary").textContent="No purchase added yet.";
  msg("upload",""); msg("review",""); msg("generate",""); setToday(); renderTable();
}

function setFormLocked(locked){
  document.querySelectorAll('#excel_file, .form-grid input, #review_actions input, #review_actions button, #import_table input, #import_table button').forEach(el=>el.disabled=locked);
  document.getElementById('review_actions').hidden=locked;
  document.getElementById('vendor_name').readOnly=locked||VENDOR_FROM_EXCEL;
}

function groupSavedPieces(){
  // Never guess row ownership from tier code: different rows may share a tier.
  // Legacy createImportedPurchase returns pieces in input-row order.
  const all=GENERATED_PIECES;
  if(all.length!==IMPORT_ROWS.reduce((n,r)=>n+r.Qty,0) ||
     all.some(p=>!clean(p.PieceBarcode)) ||
     new Set(all.map(p=>p.PieceBarcode)).size!==all.length)return [];
  let offset=0;
  return IMPORT_ROWS.map(r=>{
    const pieces=all.slice(offset,offset+r.Qty); offset+=r.Qty;
    // Reject a mismatched legacy response rather than print another row's labels.
    return pieces.every(p=>upper(p.TierCode)===r.Code &&
      clean(p.Particulars)===r.Particulars && Number(p.SellingPrice)===r.SellingPrice)
      ? pieces : [];
  });
}

function renderSavedTable(){
  const fields=['Particulars','Qty','PurchasePrice','Code','SellingPrice','MRP','Category','Material','Design','Colour','Size','Remarks'];
  const headings=['Particulars','Qty','Purchase','Tier Code','Selling','MRP','Category','Material','Design','Colour','Size','Remarks'];
  document.getElementById('import_table').innerHTML='<table><thead><tr><th>#</th>'+headings.map(h=>'<th>'+h+'</th>').join('')+'<th>Barcode</th></tr></thead><tbody>'+IMPORT_ROWS.map((r,i)=>'<tr><td>'+(i+1)+'</td>'+fields.map(f=>'<td>'+esc(['PurchasePrice','SellingPrice','MRP'].includes(f)?money(f==='MRP'?(r.MRP||r.SellingPrice):r[f]):f==='Category'?(r[f]||'GENERAL'):r[f])+'</td>').join('')+'<td><button class="btn secondary" onclick="printRowBarcodes('+i+')" '+(ROW_PIECES[i]?.length===r.Qty?'':'disabled')+'>Print Piece Barcodes ('+r.Qty+')</button></td></tr>').join('')+'</tbody></table>';
  renderTotals();
  if(IMPORT_ROWS.some((r,i)=>ROW_PIECES[i]?.length!==r.Qty))msg('generate','Purchase saved, but barcode row ownership could not be verified. Do not add this purchase again. The backend must return generatedPieces in input-row order with Particulars, TierCode and SellingPrice.', 'warn');
}

function printRowBarcodes(index){
  if(!PURCHASE_SAVED || ROW_PIECES[index]?.length!==IMPORT_ROWS[index]?.Qty)return;
  printGeneratedStickers(ROW_PIECES[index]);
}
window.addEventListener('afterprint',()=>{document.getElementById('printArea').innerHTML='';});

function masterRowReady(row){
  return !!row && /^[A-Z0-9-]+$/.test(row.Code) &&
    Number.isFinite(Number(row.SellingPrice)) && Number(row.SellingPrice)>0;
}
function masterButtonHtml(row,index){
  return masterRowReady(row)
    ? `<button class="btn secondary" onclick="printMasterBarcode(${index})">Generate Barcode</button>`
    : '<span class="muted">Enter Tier Code &amp; Selling Price</span>';
}
function refreshMasterButton(index){
  const cell=document.getElementById('master_action_'+index);
  if(cell)cell.innerHTML=masterButtonHtml(IMPORT_ROWS[index],index);
}
function printMasterBarcode(index){
  const row=IMPORT_ROWS[index];
  if(SAVING || !masterRowReady(row))return;
  const mrp=Number(row.MRP)||Number(row.SellingPrice);
  if(!Number.isFinite(mrp)||mrp<row.SellingPrice){alert('MRP must be at least the Selling Price.');return;}
  const qty=Number.isInteger(row.Qty)&&row.Qty>0?row.Qty:1;
  // Master labels all encode the tier code only, without batch/serial.
  printGeneratedStickers(Array.from({length:qty},()=>({
    PieceBarcode:row.Code,
    CategoryName:row.Category||'GENERAL',
    Particulars:row.Particulars,
    SellingPrice:Number(row.SellingPrice),
    MRP:mrp
  })));
}
