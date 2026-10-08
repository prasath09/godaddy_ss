let CURRENT_TIER = null;

let PURCHASE_DRAFT = [];

let LAST_GENERATED_PIECES = [];

let TIER_LOOKUP_BUSY = false;



window.onload = () => {

  setToday('pur_date');

  renderPurchaseDraft();

  focusTierScanner();
  loadStandalonePurchaseSetup();

};



function val(id){

  const el=document.getElementById(id);

  return el ? String(el.value || '').trim() : '';

}



function setToday(id){

  const el=document.getElementById(id);

  if(!el) return;

  const d=new Date();

  el.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);

}



function normalizeTierInput(el){

  if(!el) return;

  el.value=String(el.value||'').toUpperCase()

    .replace(/[^A-Z0-9_-]/g,'')

    .replace(/-+/g,'-');

}



function esc(value){

  return String(value ?? '').replace(/[&<>"']/g,c=>({

    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'

  }[c]));

}



function escAttr(value){return esc(value).replace(/`/g,'&#096;')}



function money(value){

  return '₹'+Number(value||0).toLocaleString('en-IN',{

    minimumFractionDigits:2,maximumFractionDigits:2

  });

}



function fmtDate(value){

  if(!value) return '';

  const d=new Date(value);

  return isNaN(d) ? String(value) : d.toLocaleDateString('en-IN');

}



function msg(id,text,cls){

  const el=document.getElementById('msg_'+id);

  if(!el) return;

  el.textContent=text;

  el.className='msg '+(cls||'');

}



function focusTierScanner(){

  setTimeout(()=>{

    const el=document.getElementById('pur_barcode');

    if(el) el.focus();

  },40);

}



function purchaseBarcodeKey(e){

  if(e.key!=='Enter') return;

  e.preventDefault();



  const code=val('pur_barcode');

  if(!code || TIER_LOOKUP_BUSY) return;



  lookupTier(code);

}



function lookupTier(code){

  TIER_LOOKUP_BUSY=true;

  CURRENT_TIER=null;



  document.getElementById('page_status').textContent='Finding '+code+'...';

  msg('purchase_line','Looking up Tier Code...','');



  google.script.run

    .withSuccessHandler(res=>{

      TIER_LOOKUP_BUSY=false;



      if(!res || !res.ok || !res.tier){

        document.getElementById('page_status').textContent='Ready to scan';

        document.getElementById('tier_result').style.display='none';

        msg('purchase_line',(res && res.message) || 'Tier Code not found.','err');

        focusTierScanner();

        return;

      }



      CURRENT_TIER=res.tier;

      showTier(CURRENT_TIER);

      document.getElementById('page_status').textContent='Tier loaded';

      msg('purchase_line','Tier Code loaded. Enter quantity and add to draft.','ok');



      setTimeout(()=>{

        const q=document.getElementById('pur_qty');

        if(q){q.focus();q.select();}

      },40);

    })

    .withFailureHandler(e=>{

      TIER_LOOKUP_BUSY=false;

      document.getElementById('page_status').textContent='Ready to scan';

      msg('purchase_line',e.message || e,'err');

      focusTierScanner();

    })

    .getPurchaseTierByCode(code);

}



function showTier(t){

  document.getElementById('tier_result').style.display='grid';

  document.getElementById('tier_vendor').textContent=t.VendorName || '';

  document.getElementById('tier_category').textContent=t.CategoryName || '';

  document.getElementById('tier_code').textContent=t.TierName || t.Barcode || '';

  document.getElementById('tier_purchase').textContent=money(t.PurchasePrice);

  document.getElementById('tier_selling').textContent=money(t.SellingPrice);

  document.getElementById('tier_mrp').textContent=money(t.MRP);



  if(!PURCHASE_DRAFT.length){

    document.getElementById('purchase_vendor_display').value=t.VendorName || '';

  }

}



function addPurchaseLine(){

  const t=CURRENT_TIER;

  const qty=Number(val('pur_qty')||0);



  if(!t){

    return msg('purchase_line','Scan a Tier Code first.','err');

  }



  if(!Number.isInteger(qty) || qty<=0){

    return msg('purchase_line','Quantity must be a whole number greater than zero.','err');

  }



  if(

    PURCHASE_DRAFT.length &&

    String(PURCHASE_DRAFT[0].VendorID)!==String(t.VendorID)

  ){

    return msg(

      'purchase_line',

      'One purchase invoice can contain only one vendor. Post or clear the current draft before scanning another vendor.',

      'err'

    );

  }



  const material=val('pur_material');
  const design=val('pur_design');
  const colour=val('pur_colour');
  const size=val('pur_size');
  const lineRemarks=val('pur_line_remarks');

  const existing=PURCHASE_DRAFT.find(
    x=>
      String(x.PriceTierID)===String(t.PriceTierID) &&
      String(x.Material || '')===material &&
      String(x.Design || '')===design &&
      String(x.Colour || '')===colour &&
      String(x.Size || '')===size &&
      String(x.Remarks || '')===lineRemarks
  );

  if(existing){
    existing.Qty+=qty;
  }else{
    PURCHASE_DRAFT.push({

      PriceTierID:t.PriceTierID,

      VendorID:t.VendorID,

      VendorName:t.VendorName,

      CategoryName:t.CategoryName,

      TierName:t.TierName,

      Barcode:t.Barcode,

      PurchasePrice:Number(t.PurchasePrice||0),

      SellingPrice:Number(t.SellingPrice||0),

      MRP:Number(t.MRP||0),

      Qty:qty,

      Material:material,

      Design:design,

      Colour:colour,

      Size:size,

      Remarks:lineRemarks

    });

  }



  document.getElementById('purchase_vendor_display').value=t.VendorName || '';

  renderPurchaseDraft();



  ['pur_material','pur_design','pur_colour','pur_size','pur_line_remarks']

    .forEach(id=>document.getElementById(id).value='');



  document.getElementById('pur_qty').value='1';

  document.getElementById('pur_barcode').value='';

  CURRENT_TIER=null;

  document.getElementById('tier_result').style.display='none';



  msg('purchase_line','Stock line added. Scan the next Tier Code.','ok');

  focusTierScanner();

}



function renderPurchaseDraft(){

  const el=document.getElementById('purchase_draft');

  const totals=document.getElementById('purchase_totals');



  if(!PURCHASE_DRAFT.length){

    el.innerHTML='<div class="muted">No items added.</div>';

    totals.innerHTML='';

    document.getElementById('purchase_vendor_display').value='';

    return;

  }



  let totalQty=0,totalValue=0;



  el.innerHTML=`

    <table>

      <thead>

        <tr>

          <th>Vendor</th><th>Category</th><th>Tier</th><th>Qty</th>

          <th>Purchase</th><th>Selling</th><th>MRP</th><th>Details</th><th>Value</th><th></th>

        </tr>

      </thead>

      <tbody>

        ${PURCHASE_DRAFT.map((x,i)=>{

          const value=Number(x.Qty)*Number(x.PurchasePrice);

          totalQty+=Number(x.Qty);

          totalValue+=value;

          const details=[x.Material,x.Design,x.Colour,x.Size].filter(Boolean).join(' / ') || '-';

          return `

            <tr>

              <td>${esc(x.VendorName)}</td>

              <td>${esc(x.CategoryName)}</td>

              <td><strong>${esc(x.TierName)}</strong></td>

              <td>${x.Qty}</td>

              <td>${money(x.PurchasePrice)}</td>

              <td>${money(x.SellingPrice)}</td>

              <td>${money(x.MRP)}</td>

              <td>${esc(details)}</td>

              <td>${money(value)}</td>

              <td><button class="btn danger" style="padding:5px 8px" onclick="removePurchaseLine(${i})">×</button></td>

            </tr>`;

        }).join('')}

      </tbody>

    </table>`;



  totals.innerHTML=`

    <div>Total Qty: <strong>${totalQty}</strong></div>

    <div>Purchase Value: <strong>${money(totalValue)}</strong></div>`;

}



function removePurchaseLine(i){

  PURCHASE_DRAFT.splice(i,1);

  renderPurchaseDraft();

  if(PURCHASE_DRAFT.length){

    document.getElementById('purchase_vendor_display').value=PURCHASE_DRAFT[0].VendorID || '';

  }

}



function clearPurchaseDraft(){

  PURCHASE_DRAFT=[];

  CURRENT_TIER=null;

  renderPurchaseDraft();

  document.getElementById('tier_result').style.display='none';

  document.getElementById('pur_barcode').value='';

  msg('purchase','','');

  msg('purchase_line','','');

  focusTierScanner();

}



function postPurchase(){

  const invoiceNo=val('pur_invoice');

  const invoiceDate=val('pur_date');



  if(!invoiceNo) return msg('purchase','Enter Supplier Invoice No.','err');

  if(!invoiceDate) return msg('purchase','Select Invoice Date.','err');

  if(!PURCHASE_DRAFT.length) return msg('purchase','Add at least one stock line.','err');



  const vendorId=PURCHASE_DRAFT[0].VendorID;

  const items=PURCHASE_DRAFT.map(x=>({

    CategoryPriceTierID:x.CategoryPriceTierID,
    CategoryID:x.CategoryID,
    DressPrefix:x.DressPrefix,
    PurchasePrice:x.PurchasePrice,
    MRP:x.MRP,
    PriceTierID:x.PriceTierID,

    Qty:x.Qty,

    Material:x.Material,

    Design:x.Design,

    Colour:x.Colour,

    Size:x.Size,

    Remarks:x.Remarks

  }));



  const btn=document.getElementById('post_purchase_btn');

  btn.disabled=true;

  msg('purchase','Posting purchase and creating individual piece barcodes...','');



  google.script.run

    .withSuccessHandler(res=>{

      btn.disabled=false;

      msg('purchase',res.message,'ok');

      setLastGeneratedPieces(res.generatedPieces || []);



      PURCHASE_DRAFT=[];

      selectStandaloneTier();

      document.getElementById('pur_invoice').value='';

      document.getElementById('pur_remarks').value='';

      document.getElementById('pur_barcode').value='';

      document.getElementById('tier_result').style.display='none';

      renderPurchaseDraft();



      document.getElementById('page_status').textContent='Ready to scan';

      focusTierScanner();

    })

    .withFailureHandler(e=>{

      btn.disabled=false;

      msg('purchase',e.message || e,'err');

      focusTierScanner();

    })

    .createPurchase({

      VendorID:vendorId,

      InvoiceNo:invoiceNo,

      InvoiceDate:invoiceDate,

      Remarks:val('pur_remarks'),

      Items:items

    });

}



function setLastGeneratedPieces(pieces){

  LAST_GENERATED_PIECES=Array.isArray(pieces)?pieces:[];

  const summary=document.getElementById('last_piece_summary');

  const btn=document.getElementById('print_last_stickers');



  if(!LAST_GENERATED_PIECES.length){

    summary.textContent='No newly generated piece barcodes yet.';

    summary.className='msg';

    btn.disabled=true;

    btn.textContent='Print Last Generated Piece Stickers';

    return;

  }



  const first=LAST_GENERATED_PIECES[0];

  const last=LAST_GENERATED_PIECES[LAST_GENERATED_PIECES.length-1];



  summary.innerHTML=`

    <strong>${LAST_GENERATED_PIECES.length}</strong> piece barcode(s) generated.<br>

    Tier: <strong>${esc(first.TierCode)}</strong> · Batch: <strong>${esc(first.BatchNo)}</strong><br>

    ${esc(first.PieceBarcode)} → ${esc(last.PieceBarcode)}`;

  summary.className='msg ok';



  btn.disabled=false;

  btn.textContent='Print '+LAST_GENERATED_PIECES.length+' Piece Stickers';

}



function printLastGeneratedStickers(){
  if(!LAST_GENERATED_PIECES.length){
    alert('No newly generated piece barcodes to print.');
    return;
  }
  if(typeof JsBarcode !== 'function'){
    alert('Barcode library has not loaded. Check your connection and reload the page.');
    return;
  }
  const area=document.getElementById('printArea');
  area.innerHTML='';
  // A direct body child lets print CSS remove the application completely.
  document.body.appendChild(area);
  let sheet;
  LAST_GENERATED_PIECES.forEach((piece,index)=>{
    if(index % 24 === 0){
      sheet=document.createElement('div');
      sheet.className='sticker-sheet';
      area.appendChild(sheet);
    }
    const div=document.createElement('div');
    div.className='barcode-label';
    const price='₹'+Number(piece.SellingPrice||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
    const tierCode=piece.PieceBarcode;
    div.innerHTML=`<div class="label-heading"><span>SS</span><strong>${esc(price)}</strong></div>
      <svg class="barcode-svg" data-barcode="${escAttr(piece.PieceBarcode)}"></svg>
      <div class="label-tier">${esc(tierCode)}</div>`;
    sheet.appendChild(div);
  });
  try{
    area.querySelectorAll('.barcode-svg').forEach(svg=>{
      JsBarcode(svg,svg.dataset.barcode,{
        format:'CODE128',displayValue:false,width:2,height:48,
        font:'Arial',fontSize:14,textMargin:3,
        margin:0,marginLeft:12,marginRight:12,marginTop:2,marginBottom:2,
        background:'#ffffff',lineColor:'#000000'
      });
    });
  }catch(error){
    area.innerHTML='';
    alert('Could not generate the barcode labels: '+error.message);
    return;
  }
  window.addEventListener('afterprint',()=>{area.style.display='none';},{once:true});
  // Printing is visible only under @media print; keep the purchase page clean.
  area.style.display='none';
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
}


function loadRecentPurchases(){

  const el=document.getElementById('purchase_history');

  el.innerHTML='<div class="muted">Loading...</div>';



  google.script.run

    .withSuccessHandler(rows=>{

      const data=(rows||[]).slice().reverse();



      if(!data.length){

        el.innerHTML='<div class="muted">No purchases found.</div>';

        return;

      }



      el.innerHTML=`

        <table>

          <thead><tr>

            <th>Purchase ID</th><th>Date</th><th>Invoice</th><th>Vendor</th><th>Qty</th><th>Value</th><th>Status</th>

          </tr></thead>

          <tbody>

            ${data.map(p=>`

              <tr>

                <td>${esc(p.PurchaseID)}</td>

                <td>${esc(fmtDate(p.InvoiceDate))}</td>

                <td>${esc(p.InvoiceNo)}</td>

                <td>${esc(p.VendorName)}</td>

                <td>${Number(p.TotalQty||0)}</td>

                <td>${money(p.PurchaseValue)}</td>

                <td>${esc(p.Status||'')}</td>

              </tr>`).join('')}

          </tbody>

        </table>`;

    })

    .withFailureHandler(e=>{

      el.innerHTML='<div class="err">'+esc(e.message || e)+'</div>';

    })

    .getRecentPurchasesFast(20);

}

let PURCHASE_SETUP={vendors:[],categories:[],categoryPriceTiers:[]};
function setStandaloneOptions(id,rows,key,label){
  const select=document.getElementById(id);select.replaceChildren(new Option('-- Select --',''));
  rows.forEach(r=>select.add(new Option(r[label],r[key])));
}
function loadStandalonePurchaseSetup(){
  google.script.run.withSuccessHandler(data=>{
    PURCHASE_SETUP=data;setStandaloneOptions('purchase_vendor_display',data.vendors,'VendorID','VendorName');
    setStandaloneOptions('pur_category',data.categories,'CategoryID','CategoryName');fillStandaloneTiers();
  }).withFailureHandler(e=>msg('purchase',e.message||String(e),'err')).getPurchaseSetup();
}
function fillStandaloneTiers(){
  const rows=(PURCHASE_SETUP.categoryPriceTiers||[]).filter(r=>String(r.CategoryID)===val('pur_category')).map(r=>({...r,Display:r.TierCode+' — '+money(r.SellingPrice)}));
  setStandaloneOptions('pur_tier',rows,'CategoryPriceTierID','Display');selectStandaloneTier();
}
function selectStandaloneTier(){
  CURRENT_TIER=(PURCHASE_SETUP.categoryPriceTiers||[]).find(r=>String(r.CategoryPriceTierID)===val('pur_tier'))||null;
  document.getElementById('pur_selling').value=CURRENT_TIER?money(CURRENT_TIER.SellingPrice):'';
  document.getElementById('pur_mrp').value=CURRENT_TIER?CURRENT_TIER.SellingPrice:'';
  document.getElementById('tier_result').style.display='none';
}
function lookupTier(code){
  const row=(PURCHASE_SETUP.categoryPriceTiers||[]).find(r=>r.TierCode.toUpperCase()===String(code).trim().toUpperCase());
  if(!row)return msg('purchase_line','Tier Code not found in category masters.','err');
  document.getElementById('pur_category').value=row.CategoryID;fillStandaloneTiers();document.getElementById('pur_tier').value=row.CategoryPriceTierID;selectStandaloneTier();
}
function addPurchaseLine(){
  const t=CURRENT_TIER,vendorId=val('purchase_vendor_display');
  const qty=Number(val('pur_qty')),cost=Number(val('pur_cost')),mrp=Number(val('pur_mrp')),prefix=val('pur_dress_prefix').trim().toUpperCase();
  if(!vendorId||!t)return msg('purchase_line','Select Vendor, Category and Tier Code.','err');
  if(!Number.isSafeInteger(qty)||qty<=0)return msg('purchase_line','Enter a whole quantity greater than zero.','err');
  if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(mrp)||mrp<=0)return msg('purchase_line','Enter valid purchase price and MRP.','err');
  if(!/^[A-Z0-9]{1,20}$/.test(prefix))return msg('purchase_line','Enter a dress prefix using letters/numbers, e.g. B.','err');
  if(PURCHASE_DRAFT.some(r=>String(r.VendorID)!==vendorId))return msg('purchase_line','Finish or clear the current vendor draft first.','err');
  const vendor=PURCHASE_SETUP.vendors.find(v=>String(v.VendorID)===vendorId),category=PURCHASE_SETUP.categories.find(c=>String(c.CategoryID)===String(t.CategoryID));
  PURCHASE_DRAFT.push({CategoryPriceTierID:t.CategoryPriceTierID,CategoryID:t.CategoryID,DressPrefix:prefix,VendorID:vendorId,VendorName:vendor.VendorName,CategoryName:category.CategoryName,TierName:t.TierCode,Barcode:prefix+t.TierCode,PurchasePrice:cost,SellingPrice:Number(t.SellingPrice),MRP:mrp,Qty:qty,Material:val('pur_material'),Design:val('pur_design'),Colour:val('pur_colour'),Size:val('pur_size'),Remarks:val('pur_line_remarks')});
  renderPurchaseDraft();msg('purchase_line','Stock line added. Save Purchase to generate Dress Codes.','ok');
}
function loadStandaloneSavedBarcodes(){
  document.getElementById('saved_barcode_print').disabled=true;setLastGeneratedPieces([]);
  google.script.run.withSuccessHandler(rows=>{
    setLastGeneratedPieces(rows||[]);document.getElementById('saved_barcode_print').disabled=!rows.length;
    const area=document.getElementById('saved_barcode_list');area.innerHTML='<table><thead><tr><th>Dress Code</th><th>Tier</th><th>Selling Price</th><th>Status</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.PieceBarcode)+'</td><td>'+esc(r.TierCode)+'</td><td>'+money(r.SellingPrice)+'</td><td>'+esc(r.Status)+'</td></tr>').join('')+'</tbody></table>';
    msg('savedbarcodes',rows.length+' saved barcode(s) loaded.','ok');
  }).withFailureHandler(e=>msg('savedbarcodes',e.message||String(e),'err')).getSavedPurchaseBarcodes(Number(val('saved_barcode_purchase')));
}
