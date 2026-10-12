let CURRENT_DUPLICATE=null;
window.onload=()=>document.getElementById('duplicate_search')?.focus();
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmtDate(v){if(!v)return'';const d=new Date(v);return isNaN(d)?String(v):d.toLocaleDateString('en-IN');}
function money(v){return '₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function msg(t,c=''){const e=document.getElementById('msg_search');e.textContent=t;e.className='msg '+c;}
function duplicateSearchKey(e){if(e.key==='Enter'){e.preventDefault();searchDuplicateBills();}}
function searchDuplicateBills(){const q=String(document.getElementById('duplicate_search').value||'').trim();if(!q)return msg('Enter Customer Mobile Number or Bill / Invoice Number.','err');const b=document.getElementById('search_btn');b.disabled=true;msg('Searching...');document.getElementById('results_card').style.display='none';document.getElementById('preview_card').style.display='none';CURRENT_DUPLICATE=null;google.script.run.withSuccessHandler(res=>{b.disabled=false;const rows=res?.rows||[];if(!rows.length)return msg('No matching bill found.','err');renderResults(rows);document.getElementById('results_card').style.display='block';msg(rows.length+' matching bill'+(rows.length===1?'':'s')+' found.','ok');if(rows.length===1)loadDuplicateBill(rows[0].SaleID);}).withFailureHandler(e=>{b.disabled=false;msg(e.message||e,'err');}).searchSalesForDuplicate(q);}
function renderResults(rows){document.getElementById('duplicate_results').innerHTML=`<table><thead><tr><th>Bill No.</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Amount</th><th>Payment</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.BillNo)}</strong></td><td>${esc(fmtDate(r.SaleDate))}</td><td>${esc(r.CustomerName||'Walk-in')}</td><td>${esc(r.CustomerMobile||'')}</td><td>${money(r.NetAmount)}</td><td>${esc(r.PaymentMode||'')}</td><td><button class="btn secondary" onclick="loadDuplicateBill(${Number(r.SaleID)})">View / Print</button></td></tr>`).join('')}</tbody></table>`;}
function loadDuplicateBill(id){msg('Loading bill...');google.script.run.withSuccessHandler(data=>{CURRENT_DUPLICATE=data;document.getElementById('duplicate_preview').innerHTML=buildReceiptBody(data);document.getElementById('preview_card').style.display='block';document.getElementById('preview_card').scrollIntoView({behavior:'smooth',block:'start'});msg('Bill loaded.','ok');}).withFailureHandler(e=>msg(e.message||e,'err')).getSaleReceipt(id);}
function itemRows(items){return(items||[]).map(i=>`<tr><td>${esc(i.CategoryName||'')} / ${esc(i.TierName||'')}<br><small>${esc(i.Barcode||'')}</small></td><td style="text-align:right">${Number(i.Qty||1)}</td><td style="text-align:right">${Number(i.Rate||0).toFixed(2)}</td><td style="text-align:right">${Number(i.LineTotal||0).toFixed(2)}</td></tr>`).join('');}
function paymentRows(ps){return(ps||[]).map(p=>`<div>${esc(p.PaymentMode||'')}: ₹${Number(p.Amount||0).toFixed(2)} ${p.ReferenceNo?'('+esc(p.ReferenceNo)+')':''}</div>`).join('');}
function buildReceiptBody(data){const s=data.sale||{};return `<div><h2 style="text-align:center;margin:0 0 4px">SS TEXTILE</h2><div style="text-align:center">${esc(data.locationName||'')}</div><div style="text-align:center">Sales Bill</div><div style="text-align:center;font-weight:700;margin-top:5px">DUPLICATE BILL</div><hr><div><strong>Bill:</strong> ${esc(s.BillNo||'')}</div><div><strong>Date:</strong> ${esc(fmtDate(s.SaleDate))}</div><div><strong>Customer:</strong> ${esc(s.CustomerName||'Walk-in')}</div>${s.CustomerMobile?`<div><strong>Mobile:</strong> ${esc(s.CustomerMobile)}</div>`:''}<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px"><thead><tr><th style="text-align:left;border-bottom:1px solid #ddd;padding:7px 3px">Item</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:7px 3px">Qty</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:7px 3px">Rate</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:7px 3px">Amount</th></tr></thead><tbody>${itemRows(data.items)}</tbody></table><div style="margin-top:14px;text-align:right;line-height:1.8"><div>Subtotal: ₹${Number(s.SubTotal||0).toFixed(2)}</div><div>Item Discount: ₹${Number(s.LineDiscount||0).toFixed(2)}</div><div>Bill Discount: ₹${Number(s.BillDiscount||0).toFixed(2)}</div><div style="font-size:17px"><strong>Net Amount: ₹${Number(s.NetAmount||0).toFixed(2)}</strong></div><div style="font-size:11px">(Inclusive of GST)</div></div><div style="margin-top:12px"><strong>Payment</strong>${paymentRows(data.payments)}</div><p style="text-align:center;margin-top:22px">Thank you</p></div>`;}
function buildPrintableHtml(data){return `<!doctype html><html><head><title>Duplicate ${esc(data.sale?.BillNo||'Bill')}</title><style>@page{size:A4 portrait;margin:14mm}body{font-family:Arial,sans-serif;color:#111;font-size:13px}table td{border-bottom:1px solid #ddd;padding:7px 3px}</style></head><body>${buildReceiptBody(data)}</body></html>`;}
function printCurrentDuplicate(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');const w=window.open('','_blank','width=720,height=850');if(!w)return msg('Popup blocked. Allow popups and retry.','err');w.document.open();w.document.write(buildPrintableHtml(CURRENT_DUPLICATE));w.document.close();w.focus();setTimeout(()=>w.print(),300);}
function downloadCurrentDuplicate(){if(!CURRENT_DUPLICATE)return msg('Load a bill first.','err');if(!window.jspdf?.jsPDF)return msg('PDF library not loaded. Reload and retry.','err');const data=CURRENT_DUPLICATE,s=data.sale||{},items=data.items||[],payments=data.payments||[];const{jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});const pw=doc.internal.pageSize.getWidth(),left=14,right=pw-14;let y=16;doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('SS TEXTILE',pw/2,y,{align:'center'});y+=6;doc.setFont('helvetica','normal');doc.setFontSize(10);if(data.locationName){doc.text(String(data.locationName),pw/2,y,{align:'center'});y+=5;}doc.text('Sales Bill',pw/2,y,{align:'center'});y+=5;doc.setFont('helvetica','bold');doc.text('DUPLICATE BILL',pw/2,y,{align:'center'});doc.setFont('helvetica','normal');y+=7;doc.line(left,y,right,y);y+=6;doc.text('Bill: '+String(s.BillNo||''),left,y);doc.text('Date: '+fmtDate(s.SaleDate),right,y,{align:'right'});y+=6;doc.text('Customer: '+String(s.CustomerName||'Walk-in'),left,y);if(s.CustomerMobile){y+=5;doc.text('Mobile: '+String(s.CustomerMobile),left,y);}y+=8;doc.setFont('helvetica','bold');doc.text('Item',left,y);doc.text('Qty',118,y,{align:'right'});doc.text('Rate',150,y,{align:'right'});doc.text('Amount',right,y,{align:'right'});y+=3;doc.line(left,y,right,y);y+=5;doc.setFont('helvetica','normal');items.forEach(i=>{if(y>265){doc.addPage();y=18;}const name=String((i.CategoryName||'')+' / '+(i.TierName||''));const lines=doc.splitTextToSize(name,82);doc.text(lines,left,y);doc.text(String(i.Qty||1),118,y,{align:'right'});doc.text(Number(i.Rate||0).toFixed(2),150,y,{align:'right'});doc.text(Number(i.LineTotal||0).toFixed(2),right,y,{align:'right'});y+=Math.max(lines.length*4,4);doc.setFontSize(8);doc.text(String(i.Barcode||''),left,y);doc.setFontSize(10);y+=6;});y+=2;doc.line(left,y,right,y);y+=7;const lx=145;for(const [label,val]of[['Subtotal:',s.SubTotal],['Item Discount:',s.LineDiscount],['Bill Discount:',s.BillDiscount]]){doc.text(label,lx,y,{align:'right'});doc.text(Number(val||0).toFixed(2),right,y,{align:'right'});y+=5;}y+=1;doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text('Net Amount:',lx,y,{align:'right'});doc.text('Rs. '+Number(s.NetAmount||0).toFixed(2),right,y,{align:'right'});y+=5;doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('(Inclusive of GST)',right,y,{align:'right'});y+=9;doc.setFontSize(10);doc.text('Payment:',left,y);y+=5;payments.forEach(p=>{let line=String(p.PaymentMode||'')+': Rs. '+Number(p.Amount||0).toFixed(2);if(p.ReferenceNo)line+=' ('+String(p.ReferenceNo)+')';doc.text(line,left,y);y+=5;});y+=6;doc.text('Thank you',pw/2,y,{align:'center'});const safe=String(s.BillNo||'Bill').replace(/[^A-Za-z0-9_-]/g,'_');doc.save(safe+'-DUPLICATE.pdf');}


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
        <div class="title">Sales Bill</div>
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
