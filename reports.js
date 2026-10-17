let REPORT_DATA=null;let CURRENT_PANEL='dashboard';
window.onload=()=>{applyQuickPeriod('MONTH');loadReports();};
function localDate(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function applyQuickPeriod(v){const now=new Date(),to=localDate(now),fromDate=new Date(now);if(v==='TODAY'){}else if(v==='30')fromDate.setDate(fromDate.getDate()-29);else if(v==='FY'){const y=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1;fromDate.setFullYear(y,3,1);}else fromDate.setDate(1);document.getElementById('from_date').value=v==='TODAY'?to:localDate(fromDate);document.getElementById('to_date').value=to;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function money(v){return '₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtDate(v){if(!v)return'';const s=String(v).slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:s;}
function setMsg(t,c=''){const e=document.getElementById('msg');e.textContent=t;e.className='msg '+c;}
function openTab(btn){document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));btn.classList.add('active');CURRENT_PANEL=btn.dataset.panel;document.getElementById(CURRENT_PANEL).classList.add('active');}
function fillSelect(id,rows,valueKey,labelKey,label){const el=document.getElementById(id),old=el.value;el.innerHTML='<option value="">'+label+'</option>'+rows.map(r=>'<option value="'+esc(r[valueKey])+'">'+esc(r[labelKey])+'</option>').join('');if([...el.options].some(o=>o.value===old))el.value=old;}
function renderTable(id,rows,cols,formats={}){const el=document.getElementById(id);if(!rows||!rows.length){el.innerHTML='<div class="muted">No records for this selection.</div>';return;}el.innerHTML='<table><thead><tr>'+cols.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+cols.map(c=>{let v=r[c.key];if(formats[c.key])v=formats[c.key](v,r);return'<td'+(c.right?' class="right"':'')+'>'+esc(v)+'</td>';}).join('')+'</tr>').join('')+'</tbody></table>';el.dataset.csv=JSON.stringify({rows,cols:cols.map(c=>({key:c.key,label:c.label})),formats:Object.keys(formats)});}
const perfCols=[{key:'Label',label:'Name'},{key:'Qty',label:'Qty',right:1},{key:'NetSales',label:'Net Sales',right:1},{key:'COGS',label:'Cost',right:1},{key:'Profit',label:'Gross Profit',right:1},{key:'MarginPct',label:'Margin %',right:1}];
const perfFmt={NetSales:money,COGS:money,Profit:money,MarginPct:v=>Number(v||0).toFixed(2)+'%'};
function render(){const d=REPORT_DATA,s=d.summary;document.getElementById('dashboard_kpis').innerHTML=kpis([['Bills',s.BillCount],['Qty Sold',s.QtySold],['Net Sales',money(s.NetSales),'good'],['Gross Profit',money(s.GrossProfit),s.GrossProfit>=0?'good':'bad'],['Margin',Number(s.MarginPct).toFixed(2)+'%'],['Returns',money(s.ReturnAmount),'bad'],['Cancelled Bills',s.CancelledBills,'bad'],['Current Stock',s.StockQty],['Stock Cost',money(s.StockCost)],['Stock Retail',money(s.StockRetail)],['Purchase Qty',s.PurchaseQty],['Purchase Value',money(s.PurchaseValue)]]);
  const daily=d.sales.byDate.map(x=>({...x,Date:x.Label}));renderTable('daily_table',daily,[{key:'Date',label:'Date'},{key:'Qty',label:'Qty',right:1},{key:'NetSales',label:'Net Sales',right:1},{key:'Profit',label:'Profit',right:1},{key:'MarginPct',label:'Margin %',right:1}],{Date:fmtDate,NetSales:money,Profit:money,MarginPct:v=>Number(v).toFixed(2)+'%'});
  renderTable('category_table',d.sales.byCategory,perfCols,perfFmt);renderTable('payment_table',d.sales.paymentSummary,[{key:'PaymentMode',label:'Payment Mode'},{key:'NetAmount',label:'Net Collection',right:1}],{NetAmount:money});renderTable('stock_snapshot',d.stock.byCategory,[{key:'Category',label:'Category'},{key:'Qty',label:'Qty',right:1},{key:'CostValue',label:'Cost Value',right:1},{key:'RetailValue',label:'Retail Value',right:1}],{CostValue:money,RetailValue:money});
  renderTable('sales_category',d.sales.byCategory,perfCols,perfFmt);renderTable('sales_vendor',d.sales.byVendor,perfCols,perfFmt);renderTable('sales_price',d.sales.byPrice,perfCols,perfFmt);renderTable('sales_payment',d.sales.paymentSummary,[{key:'PaymentMode',label:'Payment Mode'},{key:'NetAmount',label:'Net Collection',right:1}],{NetAmount:money});renderTable('sales_daily',daily,[{key:'Date',label:'Date'},{key:'Qty',label:'Qty',right:1},{key:'NetSales',label:'Net Sales',right:1},{key:'COGS',label:'Cost',right:1},{key:'Profit',label:'Gross Profit',right:1},{key:'MarginPct',label:'Margin %',right:1}],{Date:fmtDate,NetSales:money,COGS:money,Profit:money,MarginPct:v=>Number(v).toFixed(2)+'%'});
  document.getElementById('stock_kpis').innerHTML=kpis([['Current Qty',s.StockQty],['Stock Cost',money(s.StockCost)],['Retail Value',money(s.StockRetail)],['Potential Margin',money(s.StockRetail-s.StockCost),'good']]);renderTable('stock_ageing',d.stock.ageing,[{key:'Bucket',label:'Age'},{key:'Qty',label:'Qty',right:1},{key:'CostValue',label:'Cost Value',right:1},{key:'RetailValue',label:'Retail Value',right:1}],{CostValue:money,RetailValue:money});renderTable('stock_category',d.stock.byCategory,[{key:'Category',label:'Category'},{key:'Qty',label:'Qty',right:1},{key:'CostValue',label:'Cost Value',right:1},{key:'RetailValue',label:'Retail Value',right:1}],{CostValue:money,RetailValue:money});renderTable('movement_table',d.stock.movement,[{key:'Code',label:'Dress Code'},{key:'SoldQty',label:'Sold Qty',right:1},{key:'AvailableQty',label:'Available Qty',right:1},{key:'NetSales',label:'Net Sales',right:1}],{NetSales:money});
  setupProductFilters();applyProductFilters();
  document.getElementById('purchase_kpis').innerHTML=kpis([['Purchase Qty',s.PurchaseQty],['Purchase Value',money(s.PurchaseValue)],['Current Stock Qty',s.StockQty],['Current Stock Cost',money(s.StockCost)]]);renderTable('purchase_table',d.purchases.rows,[{key:'PurchaseID',label:'Purchase ID'},{key:'Date',label:'Date'},{key:'InvoiceNo',label:'Invoice No.'},{key:'VendorName',label:'Vendor'},{key:'Qty',label:'Qty',right:1},{key:'PurchaseValue',label:'Value',right:1},{key:'Status',label:'Status'}],{Date:fmtDate,PurchaseValue:money});
  renderTable('adjustment_table',d.sales.adjustments,[{key:'CreatedAt',label:'Date'},{key:'BillNo',label:'Bill No.'},{key:'Type',label:'Type'},{key:'Reason',label:'Reason'},{key:'Amount',label:'Return Credit',right:1},{key:'DifferenceAmount',label:'Difference',right:1},{key:'SettlementType',label:'Settlement'},{key:'SettlementMode',label:'Mode'},{key:'NewBarcode',label:'New Barcode'}],{CreatedAt:fmtDate,Amount:money,DifferenceAmount:money});renderTable('cancel_table',d.sales.cancelledBills,[{key:'SaleDate',label:'Sale Date'},{key:'BillNo',label:'Bill No.'},{key:'CustomerName',label:'Customer'},{key:'Mobile',label:'Mobile'},{key:'NetAmount',label:'Original Amount',right:1}],{SaleDate:fmtDate,NetAmount:money});
}
function kpis(rows){return rows.map(x=>'<div class="kpi '+(x[2]||'')+'"><div class="n">'+esc(x[1])+'</div><div class="l">'+esc(x[0])+'</div></div>').join('');}
function loadReports(){const btn=document.getElementById('load_btn');btn.disabled=true;setMsg('Loading report data...');google.script.run.withSuccessHandler(d=>{btn.disabled=false;REPORT_DATA=d;fillSelect('vendor',d.masters.vendors,'VendorID','VendorName','All Vendors');fillSelect('category',d.masters.categories,'CategoryID','CategoryName','All Categories');fillSelect('product_category',d.masters.categories,'CategoryID','CategoryName','All Categories');fillSelect('product_vendor',d.masters.vendors,'VendorID','VendorName','All Vendors');render();setMsg('Reports loaded. Returns/exchanges are adjusted against the original bill date.','ok');}).withFailureHandler(e=>{btn.disabled=false;setMsg(e.message||String(e),'err');}).getReportsData({FromDate:document.getElementById('from_date').value,ToDate:document.getElementById('to_date').value,VendorID:document.getElementById('vendor').value,CategoryID:document.getElementById('category').value});}
function exportCurrentCSV(){const panel=document.getElementById(CURRENT_PANEL),wrap=[...panel.querySelectorAll('.table-wrap')].find(x=>x.querySelector('table'));if(!wrap){setMsg('No table is available to export in this section.','err');return;}const table=wrap.querySelector('table'),rows=[...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>'"'+td.innerText.replace(/"/g,'""')+'"').join(','));const blob=new Blob(['\ufeff'+rows.join('\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='SS_'+CURRENT_PANEL+'_report_'+document.getElementById('from_date').value+'_to_'+document.getElementById('to_date').value+'.csv';a.click();URL.revokeObjectURL(a.href);}


function setupProductFilters(){
  const d=REPORT_DATA?.productCategory;if(!d)return;
  const design=document.getElementById('product_design'),price=document.getElementById('product_price');
  const oldD=design.value,oldP=price.value;
  design.innerHTML='<option value="">All Designs</option>'+d.designs.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
  price.innerHTML='<option value="">All</option>'+d.sellingPrices.map(x=>'<option value="'+esc(x)+'">'+money(x)+'</option>').join('');
  if([...design.options].some(o=>o.value===oldD))design.value=oldD;if([...price.options].some(o=>o.value===oldP))price.value=oldP;
}
function syncProductCategory(){
  const c=document.getElementById('product_category').value;document.getElementById('category').value=c;loadReports();
}
function productFilteredRows(){
  const d=REPORT_DATA?.productCategory;if(!d)return[];
  const c=Number(document.getElementById('product_category').value||0),v=Number(document.getElementById('product_vendor').value||0),des=document.getElementById('product_design').value,p=Number(document.getElementById('product_price').value||0);
  return d.rows.filter(r=>(!c||r.CategoryID===c)&&(!v||r.VendorID===v)&&(!des||r.Design===des)&&(!p||Number(r.SellingPrice)===p));
}
function summarizeProductRows(rows,type){
  const m=new Map();
  for(const r of rows){let key,label,extra={};if(type==='price'){key=[r.Tier,r.SellingPrice].join('|');label=(r.Tier||'NO TIER')+' · '+money(r.SellingPrice);extra={Tier:r.Tier,SellingPrice:r.SellingPrice};}else if(type==='vendor'){key=String(r.VendorID);label=r.VendorName;extra={VendorName:r.VendorName};}else{key=r.Design||r.Remarks||'Unspecified';label=key;extra={Design:key};}if(!m.has(key))m.set(key,{Label:label,PurchasedQty:0,SoldQty:0,StockQty:0,NetSales:0,...extra});const g=m.get(key);g.PurchasedQty+=Number(r.Qty||0);g.SoldQty+=Number(r.SoldQty||0);g.StockQty+=Number(r.AvailableQty||0);g.NetSales+=Number(r.NetSales||0);}
  return [...m.values()].map(g=>({...g,SellThroughPct:(g.SoldQty+g.StockQty)?g.SoldQty/(g.SoldQty+g.StockQty)*100:0})).sort((a,b)=>b.SellThroughPct-a.SellThroughPct||b.SoldQty-a.SoldQty);
}
function applyProductFilters(){
  if(!REPORT_DATA?.productCategory)return;const rows=productFilteredRows();
  const sold=rows.reduce((a,r)=>a+Number(r.SoldQty||0),0),stock=rows.reduce((a,r)=>a+Number(r.AvailableQty||0),0),purchased=rows.reduce((a,r)=>a+Number(r.Qty||0),0),sales=rows.reduce((a,r)=>a+Number(r.NetSales||0),0),sell=(sold+stock)?sold/(sold+stock)*100:0;
  document.getElementById('product_kpis').innerHTML=kpis([['Product Groups',rows.length],['Purchased Qty',purchased],['Sold Qty',sold],['Current Stock',stock],['Sell-through',sell.toFixed(2)+'%',sell>=70?'good':''],['Net Sales',money(sales),'good']]);
  renderTable('product_table',rows,[{key:'Category',label:'Category'},{key:'VendorName',label:'Vendor Name'},{key:'BarcodeSeries',label:'Barcode Series'},{key:'Tier',label:'Tier'},{key:'Design',label:'Design'},{key:'Remarks',label:'Remarks'},{key:'Sizes',label:'Size(s)'},{key:'Qty',label:'Total Qty',right:1},{key:'SoldQty',label:'Sold Qty',right:1},{key:'AvailableQty',label:'Stock Qty',right:1},{key:'SellThroughPct',label:'Sell %',right:1},{key:'PurchasePrice',label:'Purchase Price',right:1},{key:'SellingPrice',label:'Selling Price',right:1},{key:'Movement',label:'Movement'}],{SellThroughPct:v=>Number(v||0).toFixed(2)+'%',PurchasePrice:money,SellingPrice:money});
  const pc=summarizeProductRows(rows,'price'),vc=summarizeProductRows(rows,'vendor'),dc=summarizeProductRows(rows,'design');
  const cols=[{key:'Label',label:'Name'},{key:'PurchasedQty',label:'Purchased',right:1},{key:'SoldQty',label:'Sold',right:1},{key:'StockQty',label:'Stock',right:1},{key:'SellThroughPct',label:'Sell %',right:1},{key:'NetSales',label:'Net Sales',right:1}];const fmt={SellThroughPct:v=>Number(v||0).toFixed(2)+'%',NetSales:money};
  renderTable('product_price_movement',pc,cols,fmt);renderTable('product_vendor_movement',vc,cols,fmt);renderTable('product_design_movement',dc,cols,fmt);
  renderTable('product_slow',rows.filter(r=>r.Movement==='SLOW'||r.Movement==='NO SALES').sort((a,b)=>a.SellThroughPct-b.SellThroughPct||b.AvailableQty-a.AvailableQty),[{key:'Category',label:'Category'},{key:'VendorName',label:'Vendor'},{key:'BarcodeSeries',label:'Series'},{key:'Design',label:'Design'},{key:'SellingPrice',label:'Selling',right:1},{key:'SoldQty',label:'Sold',right:1},{key:'AvailableQty',label:'Stock',right:1},{key:'SellThroughPct',label:'Sell %',right:1},{key:'Movement',label:'Status'}],{SellingPrice:money,SellThroughPct:v=>Number(v||0).toFixed(2)+'%'});
}
function printProductReport(){const btn=document.querySelector('#product_detail_card .report-print-btn');if(btn)printReportCard(btn,'Product Category Report');}

function printReportCard(btn,title){
  const card=btn.closest('.card');
  if(!card)return;

  const clone=card.cloneNode(true);
  clone.querySelectorAll('.report-print-btn').forEach(x=>x.remove());
  const clonedHead=clone.querySelector('.report-card-head');
  if(clonedHead){
    const h3=clonedHead.querySelector('h3');
    clonedHead.replaceWith(h3||document.createTextNode(title));
  }

  const from=document.getElementById('from_date')?.value||'';
  const to=document.getElementById('to_date')?.value||'';
  const period=(from||to)?('Period: '+(from?fmtDate(from):'')+(from&&to?' to ':'')+(to?fmtDate(to):'')):'';
  const generated=new Date().toLocaleString('en-IN');

  const w=window.open('','_blank','width=1100,height=800');
  if(!w){
    setMsg('Please allow pop-ups for this site to print the selected report.','err');
    return;
  }

  w.document.open();
  w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)} - SS BRANDED OUTLET</title>
<style>
  *{box-sizing:border-box}
  @page{size:A4 portrait;margin:12mm}
  body{font-family:Arial,sans-serif;color:#111827;margin:0;background:#fff}
  .print-head{text-align:center;border-bottom:1px solid #d1d5db;padding-bottom:10px;margin-bottom:16px}
  .print-head h1{font-size:18px;margin:0 0 5px}
  .print-head h2{font-size:16px;margin:0 0 6px}
  .meta{font-size:11px;color:#4b5563;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .card{border:0!important;padding:0!important;margin:0!important}
  .card>h3{display:none}
  .table-wrap{max-height:none!important;overflow:visible!important}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th,td{padding:7px 6px;border-bottom:1px solid #d1d5db;text-align:left;white-space:nowrap}
  th{font-size:9px;text-transform:uppercase;color:#4b5563;background:#f9fafb}
  .right{text-align:right}
  .note{padding:8px 10px;border:1px solid #e5e7eb;background:#f9fafb;border-radius:6px;font-size:10px;color:#4b5563}
  .muted{color:#6b7280}
  @media print{
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
  <div class="print-head">
    <h1>SS BRANDED OUTLET</h1>
    <h2>${esc(title)}</h2>
    <div class="meta"><span>${esc(period)}</span><span>Printed: ${esc(generated)}</span></div>
  </div>
  ${clone.outerHTML}
  <script>
    window.onload=function(){window.focus();window.print();};
    window.onafterprint=function(){window.close();};
  <\/script>
</body>
</html>`);
  w.document.close();
}

