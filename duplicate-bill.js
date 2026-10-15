let CURRENT_DUPLICATE = null;
const ORIGINAL_MODE = new URLSearchParams(window.location.search).get('mode') === 'original';

window.onload = () => {
  const input = document.getElementById('duplicate_search');
  if (ORIGINAL_MODE) {
    const title = document.getElementById('page_title');
    const sub = document.getElementById('page_subtitle');
    if (title) title.textContent = 'Reprint Original Bill';
    if (sub) sub.textContent = 'Search the saved bill and print it again in the original A4 bill format.';
  }
  input?.focus();
};

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmtDate(v){if(!v)return'';const raw=String(v).slice(0,10);const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return `${m[3]}/${m[2]}/${m[1]}`;const d=new Date(v);return isNaN(d)?String(v):d.toLocaleDateString('en-IN');}
function money(v){return '₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function msg(t,c=''){const e=document.getElementById('msg_search');if(!e)return;e.textContent=t;e.className='msg '+c;}
function duplicateSearchKey(e){if(e.key==='Enter'){e.preventDefault();searchDuplicateBills();}}

function searchDuplicateBills(){
  const q=String(document.getElementById('duplicate_search').value||'').trim();
  if(!q)return msg('Enter Customer Mobile Number or Bill / Invoice Number.','err');
  const b=document.getElementById('search_btn');
  b.disabled=true;
  msg('Searching...');
  document.getElementById('results_card').style.display='none';
  document.getElementById('preview_card').style.display='none';
  CURRENT_DUPLICATE=null;
  google.script.run
    .withSuccessHandler(res=>{
      b.disabled=false;
      const rows=res?.rows||[];
      if(!rows.length)return msg('No matching bill found.','err');
      renderResults(rows);
      document.getElementById('results_card').style.display='block';
      msg(rows.length+' matching bill'+(rows.length===1?'':'s')+' found.','ok');
      if(rows.length===1)loadDuplicateBill(rows[0].SaleID);
    })
    .withFailureHandler(e=>{b.disabled=false;msg(e.message||e,'err');})
    .searchSalesForDuplicate(q);
}

function renderResults(rows){
  document.getElementById('duplicate_results').innerHTML=`<table><thead><tr><th>Bill No.</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Amount</th><th>Payment</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.BillNo)}</strong></td><td>${esc(fmtDate(r.SaleDate))}</td><td>${esc(r.CustomerName||'Walk-in')}</td><td>${esc(r.CustomerMobile||'')}</td><td>${money(r.NetAmount)}</td><td>${esc(r.PaymentMode||'')}</td><td><button class="btn secondary" onclick="loadDuplicateBill(${Number(r.SaleID)})">View / Print</button></td></tr>`).join('')}</tbody></table>`;
}

function loadDuplicateBill(id){
  msg('Loading bill...');
  google.script.run
    .withSuccessHandler(data=>{
      CURRENT_DUPLICATE=data;
      document.getElementById('duplicate_preview').innerHTML=ORIGINAL_MODE?buildOriginalReceiptBody(data):buildDuplicateReceiptBody(data);
      const title=document.getElementById('preview_title');
      if(title)title.textContent=ORIGINAL_MODE?'Original Bill Preview':'Bill Preview';
      document.getElementById('preview_card').style.display='block';
      document.getElementById('preview_card').scrollIntoView({behavior:'smooth',block:'start'});
      msg('Bill loaded.','ok');
    })
    .withFailureHandler(e=>msg(e.message||e,'err'))
    .getSaleReceipt(id);
}

function compactItemName(i){
  const code=String(i.DisplayCode||i.Barcode||'').trim();
  const category=String(i.CategoryName||'').trim();
  return category&&code?category+'/'+code:(code||category||'ITEM');
}

function itemRows(items){
  return (items||[]).map(i=>`<tr><td>${esc(compactItemName(i))}</td><td class="num">${Number(i.Qty||1)}</td><td class="num">${Number(i.Rate||0).toFixed(2)}</td><td class="num">${Number(i.LineTotal||0).toFixed(2)}</td></tr>`).join('');
}

function paymentRows(ps){
  return (ps||[]).map(p=>`<div>${esc(p.PaymentMode||'')}: Rs. ${Number(p.Amount||0).toFixed(2)}${p.ReferenceNo?' ('+esc(p.ReferenceNo)+')':''}</div>`).join('');
}

function receiptCss(){return `
  @page{size:A4 portrait;margin:14mm}
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;margin:0;color:#111;font-size:13px}
  .header{text-align:center}.header h2{margin:0 0 5px;font-size:20px}.gstin{font-size:13px}
  .duplicate-label{text-align:center;font-weight:700;margin-top:5px}
  .divider{border:0;border-top:1px solid #111;margin:14px 0 11px}
  .details{display:grid;grid-template-columns:1fr 1fr;column-gap:55px;row-gap:8px;margin-bottom:18px}
  table{width:100%;border-collapse:collapse}th,td{padding:7px 0;text-align:left;vertical-align:top}
  thead tr{border-bottom:1px solid #111}tbody tr:last-child{border-bottom:1px solid #111}th.num,td.num{text-align:right}
  .totals{margin-top:10px;margin-left:auto;width:48%;line-height:1.75}.total-row{display:flex;justify-content:space-between;gap:20px}
  .net{font-size:16px;font-weight:700;margin-top:2px}.gst-note{text-align:right;font-weight:700;margin-top:1px}
  .payment{margin-top:16px;line-height:1.6}.thanks{text-align:center;margin-top:24px}`;}

function buildOriginalReceiptBody(data){
  const s=data.sale||{};
  return `<div class="bill"><div class="header"><h2>SS BRANDED OUTLET</h2><div class="gstin">GSTIN: 33NGTPS6785L1ZX</div></div><hr class="divider"><div class="details"><div>Date: ${esc(fmtDate(s.SaleDate))}</div><div>Customer Name: ${esc(s.CustomerName||'Walk-in')}</div><div>Bill No: ${esc(s.BillNo||'')}</div><div>Mobile: ${esc(s.CustomerMobile||'')}</div></div><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${itemRows(data.items)}</tbody></table><div class="totals"><div class="total-row"><span>Subtotal:</span><span>${Number(s.SubTotal||0).toFixed(2)}</span></div><div class="total-row"><span>Item Discount:</span><span>${Number(s.LineDiscount||0).toFixed(2)}</span></div><div class="total-row"><span>Bill Discount:</span><span>${Number(s.BillDiscount||0).toFixed(2)}</span></div><div class="total-row net"><span>Net Amount:</span><span>Rs. ${Number(s.NetAmount||0).toFixed(2)}</span></div><div class="gst-note">Inclusive of GST</div></div><div class="payment"><div>Payment:</div>${paymentRows(data.payments)}</div><div class="thanks">Thank you</div></div>`;
}

function buildDuplicateReceiptBody(data){
  const body=buildOriginalReceiptBody(data);
  return body.replace('<div class="gstin">GSTIN: 33NGTPS6785L1ZX</div>','<div class="gstin">GSTIN: 33NGTPS6785L1ZX</div><div class="duplicate-label">DUPLICATE BILL</div>');
}

function buildPrintableHtml(data,isDuplicate=false){
  const title=(isDuplicate?'Duplicate ':'')+String(data.sale?.BillNo||'Bill');
  return `<!doctype html><html><head><title>${esc(title)}</title><style>${receiptCss()}</style></head><body>${isDuplicate?buildDuplicateReceiptBody(data):buildOriginalReceiptBody(data)}</body></html>`;
}

function printReceipt(data,isDuplicate){
  const w=window.open('','_blank','width=720,height=850');
  if(!w)return msg('Popup blocked. Allow popups and retry.','err');
  w.document.open();w.document.write(buildPrintableHtml(data,isDuplicate));w.document.close();w.focus();setTimeout(()=>w.print(),300);
}

function printCurrentOriginal(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');printReceipt(CURRENT_DUPLICATE,false);}
function printCurrentDuplicate(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');printReceipt(CURRENT_DUPLICATE,true);}

function drawReceiptPdf(data,isDuplicate){
  if(!window.jspdf?.jsPDF)throw new Error('PDF library not loaded. Reload and retry.');
  const s=data.sale||{},items=data.items||[],payments=data.payments||[];
  const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pw=doc.internal.pageSize.getWidth(),left=14,right=pw-14,customerX=111,qtyX=118,rateX=150,lx=145;let y=16;
  doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('SS BRANDED OUTLET',pw/2,y,{align:'center'});
  y+=6;doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text('GSTIN: 33NGTPS6785L1ZX',pw/2,y,{align:'center'});
  if(isDuplicate){y+=5;doc.setFont('helvetica','bold');doc.text('DUPLICATE BILL',pw/2,y,{align:'center'});doc.setFont('helvetica','normal');}
  y+=10;doc.line(left,y,right,y);y+=7;
  doc.text('Date: '+fmtDate(s.SaleDate),left,y);doc.text('Customer Name: '+String(s.CustomerName||'Walk-in'),customerX,y);
  y+=6;doc.text('Bill No: '+String(s.BillNo||''),left,y);doc.text('Mobile: '+String(s.CustomerMobile||''),customerX,y);
  y+=9;doc.setFont('helvetica','bold');doc.text('Item',left,y);doc.text('Qty',qtyX,y,{align:'right'});doc.text('Rate',rateX,y,{align:'right'});doc.text('Amount',right,y,{align:'right'});y+=3;doc.line(left,y,right,y);y+=6;doc.setFont('helvetica','normal');
  items.forEach(i=>{if(y>260){doc.addPage();y=18;}const lines=doc.splitTextToSize(compactItemName(i),82);doc.text(lines,left,y);doc.text(String(i.Qty||1),qtyX,y,{align:'right'});doc.text(Number(i.Rate||0).toFixed(2),rateX,y,{align:'right'});doc.text(Number(i.LineTotal||0).toFixed(2),right,y,{align:'right'});y+=Math.max(lines.length*5,5)+2;});
  y+=2;doc.line(left,y,right,y);y+=7;doc.text('Subtotal:',lx,y,{align:'right'});doc.text(Number(s.SubTotal||0).toFixed(2),right,y,{align:'right'});y+=5;doc.text('Item Discount:',lx,y,{align:'right'});doc.text(Number(s.LineDiscount||0).toFixed(2),right,y,{align:'right'});y+=5;doc.text('Bill Discount:',lx,y,{align:'right'});doc.text(Number(s.BillDiscount||0).toFixed(2),right,y,{align:'right'});y+=7;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('Net Amount:',lx,y,{align:'right'});doc.text('Rs. '+Number(s.NetAmount||0).toFixed(2),right,y,{align:'right'});y+=6;doc.setFontSize(10);doc.text('Inclusive of GST',right,y,{align:'right'});y+=11;doc.setFont('helvetica','normal');doc.text('Payment:',left,y);y+=5;payments.forEach(p=>{let line=String(p.PaymentMode||'')+': Rs. '+Number(p.Amount||0).toFixed(2);if(p.ReferenceNo)line+=' ('+String(p.ReferenceNo)+')';doc.text(line,left,y);y+=5;});y+=7;doc.text('Thank you',pw/2,y,{align:'center'});
  const safe=String(s.BillNo||'Bill').replace(/[^A-Za-z0-9_-]/g,'_');doc.save(safe+(isDuplicate?'-DUPLICATE':'')+'.pdf');
}

function downloadCurrentOriginal(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');try{drawReceiptPdf(CURRENT_DUPLICATE,false);}catch(e){msg(e.message||e,'err');}}
function downloadCurrentDuplicate(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');try{drawReceiptPdf(CURRENT_DUPLICATE,true);}catch(e){msg(e.message||e,'err');}}

function buildEmptyBillHtml(){
  const blankRows=Array.from({length:12},()=>`<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>`).join('');
  return `<!doctype html>
  <html>
  <head>
    <title>Empty Manual Bill</title>
    <style>
      @page{size:A4 portrait;margin:14mm}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0}
      body{font-family:Arial,sans-serif;color:#111;font-size:13px}
      .page{min-height:269mm;display:flex;flex-direction:column}
      .center{text-align:center}
      h2{margin:0 0 4px;font-size:20px}
      .gst{margin-top:2px}
      .title{margin-top:4px;font-weight:700}
      .manual{margin-top:3px;font-size:12px;font-weight:700}
      .rule{border:0;border-top:1px solid #111;margin:8px 0 10px}
      .details{display:grid;grid-template-columns:1fr 1fr;column-gap:24px;row-gap:10px;margin-bottom:10px}
      .line{display:inline-block;min-width:145px;border-bottom:1px solid #111;height:16px;vertical-align:bottom}
      table{width:100%;border-collapse:collapse;margin-top:5px;table-layout:fixed}
      th,td{border:1px solid #777;padding:6px 5px;height:12mm}
      th{height:auto;text-align:left;font-size:12px}
      th:nth-child(1),td:nth-child(1){width:56%}
      th:nth-child(2),td:nth-child(2){width:10%;text-align:center}
      th:nth-child(3),td:nth-child(3){width:16%;text-align:right}
      th:nth-child(4),td:nth-child(4){width:18%;text-align:right}
      .totals{margin-top:10px;margin-left:auto;width:68mm;line-height:2}
      .total-line{display:flex;justify-content:space-between;gap:10px}
      .fill{display:inline-block;width:30mm;border-bottom:1px solid #111}
      .gst-note{text-align:right;font-size:10px;margin-top:-3px}
      .payment{margin-top:10px}
      .footer{margin-top:auto;text-align:center;padding-top:12px;font-size:14px}
    </style>
  </head>
  <body>
    <div class="page">
      <div class="center">
        <h2>SS BRANDED OUTLET</h2>
        <div class="gst">GSTIN: 33NGTPS6785L1ZX</div>
        <div class="manual">MANUAL BILL</div>
      </div>
      <hr class="rule">
      <div class="details">
        <div><strong>Date:</strong> <span class="line"></span></div>
        <div><strong>Customer Name:</strong> <span class="line"></span></div>
        <div><strong>Bill No:</strong> <span class="line"></span></div>
        <div><strong>Mobile:</strong> <span class="line"></span></div>
      </div>
      <table>
        <thead><tr><th>Item / Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${blankRows}</tbody>
      </table>
      <div class="totals">
        <div class="total-line"><span>Subtotal:</span><span class="fill"></span></div>
        <div class="total-line"><span>Discount:</span><span class="fill"></span></div>
        <div class="total-line"><strong>Net Amount:</strong><span class="fill"></span></div>
        <div class="gst-note">(Inclusive of GST)</div>
      </div>
      <div class="payment"><strong>Payment Mode:</strong>&nbsp;&nbsp; CASH / UPI</div>
      <div class="footer">Thank you</div>
    </div>
  </body>
  </html>`;
}

function printEmptyBill(){
  const w=window.open('','_blank','width=720,height=850');
  if(!w)return msg('Popup blocked. Allow popups and retry.','err');
  w.document.open();
  w.document.write(buildEmptyBillHtml());
  w.document.close();
  w.focus();
  setTimeout(()=>w.print(),300);
}
