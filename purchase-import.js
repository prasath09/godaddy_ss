let IMPORT_ROWS = [];
let GENERATED_PIECES = [];
let VENDOR_FROM_EXCEL = false;

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
      Code:upper(getField(r,["Code","Tier Code","Tier","Price Code"])||""),
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
  document.getElementById("print_btn").disabled=true;
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
  IMPORT_ROWS.push({RowNo:IMPORT_ROWS.length+1,Particulars:"",Qty:1,PurchasePrice:0,Code:"",SellingPrice:0,MRP:0,Category:"",Material:"",Design:"",Colour:"",Size:"",Remarks:""});
  renderTable(); validateReady();
}

function updateRow(i,field,value){
  const r=IMPORT_ROWS[i]; if(!r)return;
  if(["Qty","PurchasePrice","SellingPrice","MRP"].includes(field)) r[field]=Number(value||0); else { r[field]=clean(value); if(field==="Code") r[field]=upper(r[field]).replace(/[^A-Z0-9-]/g,""); }
  renderTotals(); validateReady();
}

function removeRow(i){ IMPORT_ROWS.splice(i,1); IMPORT_ROWS.forEach((r,n)=>r.RowNo=n+1); renderTable(); validateReady(); }

function applyCodeToAll(){
  const code=upper(document.getElementById("apply_code").value).replace(/[^A-Z0-9-]/g,"");
  if(!code) return msg("review","Enter a valid Code first. Example: JT1.","err");
  IMPORT_ROWS.forEach(r=>r.Code=code);
  renderTable(); validateReady();
  msg("review",`Code ${code} applied to all rows.`,"ok");
}

function applySellingToAll(){
  const price=Number(document.getElementById("apply_selling").value||0);
  if(!Number.isFinite(price)||price<=0) return msg("review","Enter a valid selling price first.","err");
  IMPORT_ROWS.forEach(r=>r.SellingPrice=price); renderTable(); validateReady(); msg("review",`Selling price ${money(price)} applied to all rows.`,"ok");
}

function renderTable(){
  const el=document.getElementById("import_table");
  if(!IMPORT_ROWS.length){ el.innerHTML='<div class="muted" style="padding:12px">No imported rows.</div>'; renderTotals(); return; }
  el.innerHTML=`<table><thead><tr><th>#</th><th>Particulars</th><th>Qty</th><th>Purchase</th><th>Code *</th><th>Selling *</th><th>MRP</th><th>Category</th><th>Material</th><th>Design</th><th>Colour</th><th>Size</th><th>Remarks</th><th></th></tr></thead><tbody>${IMPORT_ROWS.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><input class="wide" value="${escAttr(r.Particulars)}" onchange="updateRow(${i},'Particulars',this.value)"></td>
      <td><input class="small" type="number" min="1" step="1" value="${r.Qty||""}" onchange="updateRow(${i},'Qty',this.value)"></td>
      <td><input class="small" type="number" min="0" step=".01" value="${r.PurchasePrice||""}" onchange="updateRow(${i},'PurchasePrice',this.value)"></td>
      <td><input class="small required" type="text" maxlength="20" value="${escAttr(r.Code||"")}" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')" onchange="updateRow(${i},'Code',this.value)"></td>
      <td><input class="small required" type="number" min="0" step=".01" value="${r.SellingPrice||""}" onchange="updateRow(${i},'SellingPrice',this.value)"></td>
      <td><input class="small" type="number" min="0" step=".01" value="${r.MRP||""}" onchange="updateRow(${i},'MRP',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Category)}" onchange="updateRow(${i},'Category',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Material)}" onchange="updateRow(${i},'Material',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Design)}" onchange="updateRow(${i},'Design',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Colour)}" onchange="updateRow(${i},'Colour',this.value)"></td>
      <td><input class="small" value="${escAttr(r.Size)}" onchange="updateRow(${i},'Size',this.value)"></td>
      <td><input class="mid" value="${escAttr(r.Remarks)}" onchange="updateRow(${i},'Remarks',this.value)"></td>
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
  let error="";
  if(!IMPORT_ROWS.length) error="Upload purchase items first.";
  const vendorName=clean(document.getElementById("vendor_name").value);
  if(!error&&!vendorName) error="Enter Vendor Name at the top.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isInteger(Number(r.Qty))||Number(r.Qty)<=0)) error="Every row needs a valid whole-number Qty.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isFinite(Number(r.PurchasePrice))||Number(r.PurchasePrice)<=0)) error="Every row needs Purchase Price.";
  if(!error&&IMPORT_ROWS.some(r=>!clean(r.Code))) error="Enter Code for every row.";
  if(!error&&IMPORT_ROWS.some(r=>!/^[A-Z0-9-]+$/.test(upper(r.Code)))) error="Code can contain only A-Z, 0-9 and hyphen.";
  if(!error&&IMPORT_ROWS.some(r=>!Number.isFinite(Number(r.SellingPrice))||Number(r.SellingPrice)<=0)) error="Enter Selling Price for every row.";
  if(!error&&IMPORT_ROWS.some(r=>Number(r.MRP||0)>0&&Number(r.SellingPrice)>Number(r.MRP))) error="Selling Price cannot be greater than MRP.";
  document.getElementById("generate_btn").disabled=!!error;
  if(error){ msg("review",error,"warn"); return false; }
  msg("review","Ready. Click Generate Barcodes.","ok"); return true;
}

function callGas(method,...args){ return new Promise((resolve,reject)=>{ google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args); }); }

async function generateBarcodes(){
  if(!validateReady())return;
  const btn=document.getElementById("generate_btn"); btn.disabled=true;
  try{
    msg("generate","Posting purchase and generating individual barcodes...");
    const res=await callGas("createImportedPurchase",{
      InvoiceNo:clean(document.getElementById("invoice_no").value),
      InvoiceDate:clean(document.getElementById("invoice_date").value),
      Remarks:clean(document.getElementById("purchase_remarks").value),
      Items:IMPORT_ROWS.map(r=>({VendorName:clean(document.getElementById("vendor_name").value),Particulars:r.Particulars,Code:r.Code,Qty:Number(r.Qty),PurchasePrice:Number(r.PurchasePrice),SellingPrice:Number(r.SellingPrice),MRP:Number(r.MRP||0),Category:r.Category,Material:r.Material,Design:r.Design,Colour:r.Colour,Size:r.Size,Remarks:r.Remarks}))
    });
    GENERATED_PIECES=Array.isArray(res?.generatedPieces)?res.generatedPieces:[];
    msg("generate",res?.message||"Barcodes generated successfully.","ok");
    document.getElementById("generated_summary").innerHTML=`<strong>Purchase ID:</strong> ${esc(res?.purchaseId||"")} &nbsp; <strong>Invoice:</strong> ${esc(res?.invoiceNo||"")}<br><strong>Total Qty:</strong> ${Number(res?.totalQty||0)} &nbsp; <strong>Purchase Value:</strong> ${money(res?.purchaseValue||0)}<br><strong>Individual Barcodes:</strong> ${GENERATED_PIECES.length}`;
    document.getElementById("print_btn").disabled=!GENERATED_PIECES.length;
  }catch(e){ console.error(e); msg("generate",e.message||String(e),"err"); btn.disabled=false; }
}

function printGeneratedStickers(){
  if(!GENERATED_PIECES.length)return alert("No generated piece barcodes to print.");
  const area=document.getElementById("printArea"); area.innerHTML="";
  GENERATED_PIECES.forEach(piece=>{
    const div=document.createElement("div"); div.className="barcode-label";
    div.innerHTML=`<div style="font-weight:700">${esc(piece.CategoryName||"")}</div><div>${esc(piece.Particulars||"")} · ${esc(piece.TierCode||"")} · ${esc(piece.BatchNo||"")}</div><div class="price">${money(piece.SellingPrice)}</div><svg class="barcode-svg" data-barcode="${escAttr(piece.PieceBarcode)}"></svg><div style="font-size:6.5px">MRP ${money(piece.MRP)}</div>`;
    area.appendChild(div);
  });
  area.style.display="grid";
  area.querySelectorAll(".barcode-svg").forEach(svg=>{
    const code=String(svg.dataset.barcode||"").trim();

    // 48 mm sticker: keep the complete Code 128 barcode inside the label.
    // A wider module value clips the right side and scanners cannot decode it.
    let moduleWidth=0.85;
    if(code.length>13) moduleWidth=0.75;
    if(code.length>16) moduleWidth=0.65;

    JsBarcode(svg,code,{
      format:"CODE128",
      displayValue:true,
      fontSize:8,
      width:moduleWidth,
      height:34,
      margin:6,
      textMargin:2,
      background:"#ffffff",
      lineColor:"#000000"
    });

    svg.style.maxWidth="44mm";
    svg.style.width="auto";
    svg.style.height="auto";
  });
  setTimeout(()=>window.print(),120);
}

function clearImport(){
  IMPORT_ROWS=[]; GENERATED_PIECES=[];
  document.getElementById("excel_file").value=""; document.getElementById("vendor_name").value=""; document.getElementById("invoice_no").value=""; document.getElementById("purchase_remarks").value=""; document.getElementById("apply_code").value=""; document.getElementById("apply_selling").value="";
  document.getElementById("generate_btn").disabled=true; document.getElementById("print_btn").disabled=true; document.getElementById("generated_summary").textContent="No barcodes generated yet.";
  msg("upload",""); msg("review",""); msg("generate",""); setToday(); renderTable();
}
