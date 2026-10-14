let CURRENT_RETURN_BILL=null;
let RETURN_SEARCH_ROWS=[];
let SELECTED_EXCHANGE=null;

function rVal(id){return String(document.getElementById(id)?.value||'').trim();}
function rEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function rMoney(v){return '₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function rDate(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-IN');}
function rMsg(text,cls=''){const e=document.getElementById('msg_returns');if(e){e.textContent=text;e.className='msg '+cls;}}
function setBusy(on){document.querySelectorAll('button.action-btn').forEach(b=>b.disabled=!!on);}

window.onload=()=>document.getElementById('return_search')?.focus();

function searchReturnBills(){
  const q=rVal('return_search');
  if(!q)return rMsg('Enter Bill No. or Customer Mobile Number.','err');
  setBusy(true);rMsg('Searching...','');
  google.script.run.withSuccessHandler(res=>{
    setBusy(false);RETURN_SEARCH_ROWS=res?.rows||[];renderSearchRows();
    if(RETURN_SEARCH_ROWS.length===1)loadReturnBill(RETURN_SEARCH_ROWS[0].SaleID);
    else rMsg(RETURN_SEARCH_ROWS.length?RETURN_SEARCH_ROWS.length+' bill(s) found. Select one.':'No matching bill found.',RETURN_SEARCH_ROWS.length?'ok':'err');
  }).withFailureHandler(e=>{setBusy(false);rMsg(e.message||e,'err');}).searchSalesForDuplicate(q);
}
function returnSearchKey(e){if(e.key==='Enter'){e.preventDefault();searchReturnBills();}}

function renderSearchRows(){
  const el=document.getElementById('search_results');
  if(!RETURN_SEARCH_ROWS.length){el.innerHTML='';return;}
  el.innerHTML='<table><thead><tr><th>Bill No.</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Net</th><th>Status</th><th></th></tr></thead><tbody>'+RETURN_SEARCH_ROWS.map(r=>`<tr><td><strong>${rEsc(r.BillNo)}</strong></td><td>${rEsc(rDate(r.SaleDate))}</td><td>${rEsc(r.CustomerName||'Walk-in')}</td><td>${rEsc(r.CustomerMobile||'')}</td><td>${rMoney(r.NetAmount)}</td><td>${rEsc(r.Status)}</td><td><button class="btn secondary" onclick="loadReturnBill(${Number(r.SaleID)})">Open</button></td></tr>`).join('')+'</tbody></table>';
}

function loadReturnBill(saleId){
  setBusy(true);rMsg('Loading bill...','');
  google.script.run.withSuccessHandler(data=>{
    setBusy(false);CURRENT_RETURN_BILL=data;SELECTED_EXCHANGE=null;renderReturnBill();rMsg('Bill loaded.','ok');
  }).withFailureHandler(e=>{setBusy(false);rMsg(e.message||e,'err');}).getReturnBill(Number(saleId));
}

function renderReturnBill(){
  const wrap=document.getElementById('bill_panel');
  if(!CURRENT_RETURN_BILL){wrap.style.display='none';return;}
  wrap.style.display='block';
  const s=CURRENT_RETURN_BILL.sale||{};
  document.getElementById('bill_summary').innerHTML=`
    <div><span>Bill No.</span><strong>${rEsc(s.BillNo)}</strong></div>
    <div><span>Date</span><strong>${rEsc(rDate(s.SaleDate))}</strong></div>
    <div><span>Customer</span><strong>${rEsc(s.CustomerName||'Walk-in')}</strong></div>
    <div><span>Mobile</span><strong>${rEsc(s.CustomerMobile||'-')}</strong></div>
    <div><span>Net Amount</span><strong>${rMoney(s.NetAmount)}</strong></div>
    <div><span>Status</span><strong class="${s.Status==='CANCELLED'?'danger-text':''}">${rEsc(s.Status)}</strong></div>`;

  const items=CURRENT_RETURN_BILL.items||[];
  document.getElementById('return_items').innerHTML=items.length?`<table><thead><tr><th>Return</th><th>Exchange</th><th>Item</th><th>Type</th><th>Sold Qty</th><th>Already Returned</th><th>Returnable</th><th>Paid Value / Unit</th><th>Return Qty</th></tr></thead><tbody>${items.map((i,idx)=>{
    const can=Number(i.ReturnableQty||0)>0 && s.Status!=='CANCELLED';
    return `<tr>
      <td><input class="ret-check" type="checkbox" data-index="${idx}" ${can?'':'disabled'}></td>
      <td><input type="radio" name="exchange_item" onchange="selectExchange(${idx})" ${can?'':'disabled'}></td>
      <td><strong>${rEsc(i.DisplayCode||i.Barcode)}</strong><div class="small">${rEsc(i.CategoryName||'')} ${i.Size?'· Size '+rEsc(i.Size):''}</div></td>
      <td>${rEsc(i.SourceType)}</td><td>${Number(i.Qty||0)}</td><td>${Number(i.ReturnedQty||0)}</td><td>${Number(i.ReturnableQty||0)}</td>
      <td>${rMoney(i.RefundUnitAmount)}</td>
      <td><input id="ret_qty_${idx}" class="qty" type="number" min="1" max="${Number(i.ReturnableQty||0)}" value="${can?1:0}" ${can?'':'disabled'}></td>
    </tr>`}).join('')}</tbody></table>`:'<div class="muted">No bill items.</div>';

  renderAdjustments();
  document.getElementById('cancel_btn').disabled=s.Status==='CANCELLED';
  document.getElementById('exchange_box').style.display='none';
}

function renderAdjustments(){
  const rows=CURRENT_RETURN_BILL?.adjustments||[];
  const el=document.getElementById('adjustment_history');
  if(!rows.length){el.innerHTML='<div class="muted">No previous returns, exchanges or cancellations.</div>';return;}
  el.innerHTML='<table><thead><tr><th>Date</th><th>Type</th><th>Reason</th><th>Amount</th><th>Difference</th><th>Settlement</th><th>New Barcode</th></tr></thead><tbody>'+rows.map(a=>`<tr><td>${rEsc(rDate(a.CreatedAt))}</td><td><strong>${rEsc(a.Type)}</strong></td><td>${rEsc(a.Reason)}</td><td>${rMoney(a.Amount)}</td><td>${rMoney(a.DifferenceAmount)}</td><td>${rEsc([a.SettlementType,a.SettlementMode].filter(Boolean).join(' / '))}</td><td>${rEsc(a.NewBarcode||'')}</td></tr>`).join('')+'</tbody></table>';
}

function saveReturn(){
  if(!CURRENT_RETURN_BILL)return rMsg('Load a bill first.','err');
  const reason=rVal('return_reason'),refundMode=rVal('refund_mode');
  const items=[];
  document.querySelectorAll('.ret-check:checked').forEach(ch=>{
    const idx=Number(ch.dataset.index),item=CURRENT_RETURN_BILL.items[idx];
    items.push({SourceType:item.SourceType,SaleItemID:item.SaleItemID,Qty:Number(document.getElementById('ret_qty_'+idx)?.value||0)});
  });
  if(!reason)return rMsg('Enter the return reason.','err');
  if(!items.length)return rMsg('Tick at least one item to return.','err');
  if(!confirm('Save this return and restore the selected stock?'))return;
  setBusy(true);rMsg('Saving return...','');
  google.script.run.withSuccessHandler(res=>{setBusy(false);rMsg(res.message,'ok');loadReturnBill(CURRENT_RETURN_BILL.sale.SaleID);}).withFailureHandler(e=>{setBusy(false);rMsg(e.message||e,'err');}).recordSaleReturn({SaleID:CURRENT_RETURN_BILL.sale.SaleID,Reason:reason,RefundMode:refundMode,Items:items});
}

function selectExchange(idx){
  const i=CURRENT_RETURN_BILL.items[idx];SELECTED_EXCHANGE=i;
  const box=document.getElementById('exchange_box');box.style.display='block';
  document.getElementById('exchange_old').innerHTML=`Returning: <strong>${rEsc(i.DisplayCode||i.Barcode)}</strong> · Credit ${rMoney(i.RefundUnitAmount)}`;
  document.getElementById('exchange_new_barcode').value='';
  setTimeout(()=>document.getElementById('exchange_new_barcode').focus(),50);
}

function saveExchange(){
  if(!CURRENT_RETURN_BILL||!SELECTED_EXCHANGE)return rMsg('Choose one sold item under Exchange.','err');
  const reason=rVal('exchange_reason'),newBarcode=rVal('exchange_new_barcode'),mode=rVal('exchange_mode');
  if(!reason)return rMsg('Enter the exchange reason.','err');
  if(!newBarcode)return rMsg('Scan or enter the replacement item barcode.','err');
  if(!confirm('Exchange '+(SELECTED_EXCHANGE.DisplayCode||SELECTED_EXCHANGE.Barcode)+' with '+newBarcode+'?'))return;
  setBusy(true);rMsg('Saving exchange...','');
  google.script.run.withSuccessHandler(res=>{setBusy(false);rMsg(res.message,'ok');loadReturnBill(CURRENT_RETURN_BILL.sale.SaleID);}).withFailureHandler(e=>{setBusy(false);rMsg(e.message||e,'err');}).recordSaleExchange({SaleID:CURRENT_RETURN_BILL.sale.SaleID,SourceType:SELECTED_EXCHANGE.SourceType,SaleItemID:SELECTED_EXCHANGE.SaleItemID,Reason:reason,NewBarcode:newBarcode,SettlementMode:mode});
}

function cancelBill(){
  if(!CURRENT_RETURN_BILL)return rMsg('Load a bill first.','err');
  const reason=rVal('cancel_reason');
  if(!reason)return rMsg('Enter the cancellation reason.','err');
  const bill=CURRENT_RETURN_BILL.sale.BillNo;
  if(!confirm('CANCEL ENTIRE BILL '+bill+'?\n\nAll eligible stock will be restored. The bill number will remain in history as CANCELLED.'))return;
  setBusy(true);rMsg('Cancelling bill...','');
  google.script.run.withSuccessHandler(res=>{setBusy(false);rMsg(res.message,'ok');loadReturnBill(CURRENT_RETURN_BILL.sale.SaleID);}).withFailureHandler(e=>{setBusy(false);rMsg(e.message||e,'err');}).cancelSaleBill({SaleID:CURRENT_RETURN_BILL.sale.SaleID,Reason:reason});
}
