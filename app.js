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
let DATA = {};
let PURCHASE_DRAFT = [];
let POS_CART = [];
let LAST_SALE_ID = '';
let LAST_GENERATED_PIECES = [];


/* =========================================================
   NAVIGATION
   ========================================================= */

document.querySelectorAll('.nav button').forEach(btn => {
  btn.addEventListener('click', () => {

    document
      .querySelectorAll('.nav button')
      .forEach(x => x.classList.remove('active'));

    document
      .querySelectorAll('.panel')
      .forEach(x => x.classList.remove('active'));

    btn.classList.add('active');

    const target =
      document.getElementById(
        btn.dataset.target
      );

    if (target) {
      target.classList.add('active');
    }

    if (btn.dataset.target === 'pos') {
      renderPOSCatalog();
      renderPOSCart();

      setTimeout(() => {
        document
          .getElementById('pos_search')
          .focus();
      }, 60);
    }

    if (btn.dataset.target === 'stock') {
      renderStock();
    }

    if (btn.dataset.target === 'ledger') {
      loadLedger();
    }

    if (btn.dataset.target === 'pricetiers') {
      setTimeout(() => document.getElementById('barcode_edit_search')?.focus(), 60);
    }
  });
});


window.onload = () => {
  setToday('pur_date');
  setToday('pos_date');
  loadAll();
};


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function setToday(id) {
  const el =
    document.getElementById(id);

  if (!el) return;

  const d =
    new Date();

  const local =
    new Date(
      d.getTime() -
      d.getTimezoneOffset() * 60000
    )
    .toISOString()
    .slice(0,10);

  el.value = local;
}

function val(id) {
  if(VendorEntry.ids.includes(id))return VendorEntry.key(id);
  const el =
    document.getElementById(id);

  return el
    ? String(el.value || '').trim()
    : '';
}

function clear(ids) {
  ids.forEach(id => {
    const el =
      document.getElementById(id);

    if (el) {
      el.value = '';
    }
  });
}

function normalizeTierInput(el) {
  if (!el) return;

  el.value = String(el.value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-');
}

function msg(id,text,cls) {
  const el =
    document.getElementById(
      'msg_' + id
    );

  if (!el) return;

  el.textContent = text;
  el.className =
    'msg ' + (cls || '');
}

function esc(value) {
  return String(value ?? '')
    .replace(
      /[&<>"']/g,
      c => ({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#039;'
      }[c])
    );
}

function escAttr(value) {
  return esc(value)
    .replace(/`/g,'&#096;');
}

function money(value) {
  return '₹' +
    Number(value || 0)
      .toLocaleString(
        'en-IN',
        {
          minimumFractionDigits:2,
          maximumFractionDigits:2
        }
      );
}

function fmtDate(value) {
  if (!value) return '';

  const d =
    new Date(value);

  return isNaN(d)
    ? String(value)
    : d.toLocaleDateString('en-IN');
}

function mapBy(arr,key,valueKey) {
  const map = {};

  (arr || []).forEach(x => {
    map[x[key]] = x[valueKey];
  });

  return map;
}

function indexBy(arr,key) {
  const map = {};

  (arr || []).forEach(x => {
    map[x[key]] = x;
  });

  return map;
}

function setOptions(
  id,
  arr,
  valueKey,
  labelKey,
  includeBlank = true
) {
  const el =
    document.getElementById(id);

  if (!el) return;
  if(id==='pur_vendor'){VendorEntry.fill(arr);return;}

  const current =
    el.value;

  el.innerHTML =
    (includeBlank
      ? '<option value="">-- Select --</option>'
      : ''
    ) +
    (arr || [])
      .map(x =>
        `<option value="${escAttr(x[valueKey])}">
          ${esc(x[labelKey])}
        </option>`
      )
      .join('');

  if (
    [...el.options]
      .some(
        o => o.value === current
      )
  ) {
    el.value = current;
  }
}

function renderTable(
  id,
  rows,
  cols
) {
  const el =
    document.getElementById(id);

  if (!el) return;

  if (
    !rows ||
    !rows.length
  ) {
    el.innerHTML =
      '<div class="muted">No records.</div>';

    return;
  }

  el.innerHTML =
    '<table><thead><tr>' +

    cols
      .map(
        c =>
          `<th>${esc(c)}</th>`
      )
      .join('') +

    '</tr></thead><tbody>' +

    rows
      .map(
        r =>
          '<tr>' +

          cols
            .map(
              c =>
                `<td>${esc(r[c] ?? '')}</td>`
            )
            .join('') +

          '</tr>'
      )
      .join('') +

    '</tbody></table>';
}


/* =========================================================
   LOAD DATA
   ========================================================= */

function loadAll() {
  google.script.run
    .withSuccessHandler(data => {
      DATA = data;

      fillDropdowns();
      renderAll();
      fillCategoryTierEditor();
      renderPurchaseDraft();
      renderPurchaseHistory();
      renderStock();
      renderPOSCatalog();
      renderPOSCart();
    })
    .withFailureHandler(
      e => alert(e.message || e)
    )
    .getAppData();
}


/* =========================================================
   DROPDOWNS
   ========================================================= */

function fillDropdowns() {
  setOptions(
    'vc_vendor',
    DATA.vendors,
    'VendorID',
    'VendorName'
  );

  setOptions(
    'vc_category',
    DATA.categories,
    'CategoryID',
    'CategoryName'
  );

  setOptions(
    'pt_vendor',
    DATA.vendors,
    'VendorID',
    'VendorName'
  );

  setOptions(
    'pur_vendor',
    DATA.vendors,
    'VendorID',
    'VendorName'
  );

  setOptions(
    'pur_material',
    DATA.materials,
    'MaterialName',
    'MaterialName'
  );

  fillPriceTierCategories();
  purchaseVendorChanged();
  fillBarcodeEditorMasters();
}


/* =========================================================
   VENDOR
   ========================================================= */

function saveVendor() {
  google.script.run
    .withSuccessHandler(res => {
      clear([
        'v_name',
        'v_mobile',
        'v_gstin',
        'v_address'
      ]);

      msg(
        'vendors',
        res.message,
        'ok'
      );

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'vendors',
          e.message || e,
          'err'
        )
    )
    .addVendor({
      VendorName:
        val('v_name'),

      Mobile:
        val('v_mobile'),

      GSTIN:
        val('v_gstin'),

      Address:
        val('v_address')
    });
}


/* =========================================================
   CATEGORY
   ========================================================= */

function saveCategory() {
  google.script.run
    .withSuccessHandler(res => {
      clear(['c_name']);

      msg(
        'categories',
        res.message,
        'ok'
      );

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'categories',
          e.message || e,
          'err'
        )
    )
    .addCategory({
      CategoryName:
        val('c_name')
    });
}


/* =========================================================
   VENDOR CATEGORY
   ========================================================= */

function saveVendorCategory() {
  google.script.run
    .withSuccessHandler(res => {
      msg(
        'vendorcategories',
        res.message,
        'ok'
      );

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'vendorcategories',
          e.message || e,
          'err'
        )
    )
    .assignVendorCategory({
      VendorID:
        val('vc_vendor'),

      CategoryID:
        val('vc_category')
    });
}


/* =========================================================
   MATERIAL
   ========================================================= */

function saveMaterial() {
  google.script.run
    .withSuccessHandler(res => {
      clear(['m_name']);

      msg(
        'materials',
        res.message,
        'ok'
      );

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'materials',
          e.message || e,
          'err'
        )
    )
    .addMaterial({
      MaterialName:
        val('m_name')
    });
}


/* =========================================================
   PRICE TIER
   ========================================================= */

function fillPriceTierCategories() {
  const vendorId =
    val('pt_vendor');

  const allowedIds =
    new Set(
      (DATA.vendorCategories || [])
        .filter(
          x =>
            String(x.VendorID) ===
            vendorId
        )
        .map(
          x =>
            String(x.CategoryID)
        )
    );

  const rows =
    (DATA.categories || [])
      .filter(
        c =>
          allowedIds.has(
            String(c.CategoryID)
          )
      );

  setOptions(
    'pt_category',
    rows,
    'CategoryID',
    'CategoryName'
  );
  fillCategoryTierPresets();
}

function savePriceTier() {
  const tierCode = val('pt_name').toUpperCase();

  if (!tierCode) {
    return msg(
      'pricetiers',
      'Tier Code is required. Example: JT1, JT2.',
      'err'
    );
  }

  document.getElementById('pt_name').value = tierCode;

  google.script.run
    .withSuccessHandler(res => {
      const tier =
        res.priceTier || {};

      msg(
        'pricetiers',
        res.message,
        'ok'
      );

      clear([
        'pt_name',
        'pt_purchase',
        'pt_selling',
        'pt_mrp'
      ]);

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'pricetiers',
          e.message || e,
          'err'
        )
    )
    .addOrReusePriceTier({
      VendorID:
        val('pt_vendor'),

      CategoryID:
        val('pt_category'),

      TierName:
        val('pt_name'),

      PurchasePrice:
        val('pt_purchase'),

      SellingPrice:
        val('pt_selling'),

      MRP:
        val('pt_mrp')
    });
}



/* =========================================================
   BARCODE SEARCH / EDIT / REPRINT
   Dress Code search updates the whole Dress Code group.
   Full piece barcode search updates only that exact piece.
   ========================================================= */

let BARCODE_EDIT_RESULT = null;
let BARCODE_EDIT_DIRTY = new Set();

function fillBarcodeEditorMasters(){
  const cat=document.getElementById('barcode_edit_category');
  if(cat){
    const old=cat.value;
    cat.replaceChildren(new Option('-- Select --',''));
    (DATA.categories||[]).forEach(c=>cat.add(new Option(c.CategoryName,c.CategoryID)));
    if([...cat.options].some(o=>o.value===old))cat.value=old;
  }
  const material=document.getElementById('barcode_edit_material');
  if(material){
    const old=material.value;
    material.replaceChildren(new Option('-- Select / Blank --',''));
    (DATA.materials||[]).forEach(m=>material.add(new Option(m.MaterialName,m.MaterialName)));
    if([...material.options].some(o=>o.value===old))material.value=old;
  }
  barcodeEditCategoryChanged(false);
}

function barcodeEditCategoryChanged(mark=true){
  const select=document.getElementById('barcode_edit_tier');
  if(!select)return;
  const old=select.value;
  select.replaceChildren(new Option('-- Select --',''));
  (DATA.categoryPriceTiers||[])
    .filter(t=>String(t.CategoryID)===String(val('barcode_edit_category')))
    .forEach(t=>select.add(new Option(t.TierCode+' · '+money(t.SellingPrice),t.CategoryPriceTierID)));
  if([...select.options].some(o=>o.value===old))select.value=old;
  if(mark)markBarcodeEditDirty('CategoryID');
}

function barcodeEditTierChanged(){
  const tier=(DATA.categoryPriceTiers||[]).find(t=>String(t.CategoryPriceTierID)===val('barcode_edit_tier'));
  if(tier && !BARCODE_EDIT_DIRTY.has('SellingPrice')){
    document.getElementById('barcode_edit_selling').value=Number(tier.SellingPrice||0).toFixed(2);
  }
}

function markBarcodeEditDirty(field){
  if(BARCODE_EDIT_RESULT)BARCODE_EDIT_DIRTY.add(field);
}

function barcodeEditSearchKey(e){
  if(e.key!=='Enter')return;
  e.preventDefault();
  searchBarcodeForEdit();
}

function clearBarcodeEditor(){
  BARCODE_EDIT_RESULT=null;
  BARCODE_EDIT_DIRTY=new Set();
  const search=document.getElementById('barcode_edit_search');
  if(search)search.value='';
  const card=document.getElementById('barcode_edit_card');
  if(card)card.style.display='none';
  const list=document.getElementById('barcode_edit_piece_list');
  if(list)list.innerHTML='';
  msg('barcode_edit_search','','');
  msg('barcode_edit','','');
  search?.focus();
}

function setBarcodeEditorValue(id,value,mixed=false){
  const el=document.getElementById(id);
  if(!el)return;
  el.value=value==null?'':value;
  el.placeholder=mixed?'Multiple values — type to change all':'';
}

function searchBarcodeForEdit(){
  const search=val('barcode_edit_search').toUpperCase();
  if(!search)return msg('barcode_edit_search','Enter a Dress Code or full piece barcode.','err');
  const btn=document.getElementById('barcode_edit_search_btn');
  btn.disabled=true;
  msg('barcode_edit_search','Searching...','');
  google.script.run.withSuccessHandler(result=>{
    btn.disabled=false;
    BARCODE_EDIT_RESULT=result;
    BARCODE_EDIT_DIRTY=new Set();
    fillBarcodeEditorMasters();
    const d=result.details||{},mixed=new Set(result.mixedFields||[]);
    document.getElementById('barcode_edit_card').style.display='block';
    document.getElementById('barcode_edit_title').textContent=result.mode==='PIECE'?'Edit Piece Barcode '+result.search:'Edit Dress Code '+result.search;
    document.getElementById('barcode_edit_scope').innerHTML=result.mode==='PIECE'
      ? 'Only <strong>'+esc(result.search)+'</strong> will be updated.'
      : 'Changes will apply to <strong>'+Number(result.quantity||0)+'</strong> product(s) under Dress Code <strong>'+esc(result.search)+'</strong>.';
    document.getElementById('barcode_edit_category').value=String(d.CategoryID||'');
    barcodeEditCategoryChanged(false);
    document.getElementById('barcode_edit_tier').value=String(d.CategoryPriceTierID||'');
    document.getElementById('barcode_edit_qty').value=Number(result.quantity||0);
    setBarcodeEditorValue('barcode_edit_material',d.Material||'',mixed.has('Material'));
    setBarcodeEditorValue('barcode_edit_design',d.Design||'',mixed.has('Design'));
    setBarcodeEditorValue('barcode_edit_colour',d.Colour||'',mixed.has('Colour'));
    setBarcodeEditorValue('barcode_edit_size',d.Size||'',mixed.has('Size'));
    setBarcodeEditorValue('barcode_edit_remarks',d.Remarks||'',mixed.has('Remarks'));
    setBarcodeEditorValue('barcode_edit_purchase',d.PurchasePrice,mixed.has('PurchasePrice'));
    setBarcodeEditorValue('barcode_edit_selling',d.SellingPrice,mixed.has('SellingPrice'));
    setBarcodeEditorValue('barcode_edit_mrp',d.MRP,mixed.has('MRP'));
    renderBarcodeEditPieces(result.pieces||[]);
    msg('barcode_edit_search',result.mode==='PIECE'?'Specific piece barcode loaded.':'Dress Code loaded. All pieces in this Dress Code are shown below.','ok');
    msg('barcode_edit','','');
  }).withFailureHandler(error=>{
    btn.disabled=false;
    BARCODE_EDIT_RESULT=null;
    document.getElementById('barcode_edit_card').style.display='none';
    msg('barcode_edit_search',error.message||String(error),'err');
  }).getBarcodeEditInfo(search);
}

function renderBarcodeEditPieces(pieces){
  const el=document.getElementById('barcode_edit_piece_list');
  if(!el)return;
  if(!pieces.length){el.innerHTML='';return;}
  el.innerHTML='<table><thead><tr><th>Piece Barcode</th><th>Status</th><th>Category</th><th>Tier Code</th><th>Selling</th></tr></thead><tbody>'+
    pieces.map(p=>'<tr><td><strong>'+esc(p.PieceBarcode)+'</strong></td><td>'+esc(p.Status)+'</td><td>'+esc(p.CategoryName||'')+'</td><td>'+esc(p.TierCode||'')+'</td><td>'+money(p.SellingPrice)+'</td></tr>').join('')+
    '</tbody></table>';
}

function updateBarcodeDetails(){
  if(!BARCODE_EDIT_RESULT)return msg('barcode_edit','Search a barcode first.','err');
  if(!BARCODE_EDIT_DIRTY.size)return msg('barcode_edit','No fields were changed.','warn');
  const categoryId=Number(val('barcode_edit_category'));
  const tierId=Number(val('barcode_edit_tier'));
  if(!categoryId||!tierId)return msg('barcode_edit','Select Category and Tier Code.','err');
  const payload={Search:BARCODE_EDIT_RESULT.search,Mode:BARCODE_EDIT_RESULT.mode,CategoryID:categoryId,CategoryPriceTierID:tierId,ChangedFields:[...BARCODE_EDIT_DIRTY]};
  const values={
    PurchasePrice:val('barcode_edit_purchase'),SellingPrice:val('barcode_edit_selling'),MRP:val('barcode_edit_mrp'),
    Material:val('barcode_edit_material'),Design:val('barcode_edit_design'),Colour:val('barcode_edit_colour'),Size:val('barcode_edit_size'),Remarks:val('barcode_edit_remarks')
  };
  Object.assign(payload,values);
  const btn=document.getElementById('barcode_edit_update_btn');btn.disabled=true;
  msg('barcode_edit','Updating...','');
  google.script.run.withSuccessHandler(res=>{
    btn.disabled=false;
    msg('barcode_edit',res.message,'ok');
    BARCODE_EDIT_DIRTY=new Set();
    loadAll();
    setTimeout(searchBarcodeForEdit,150);
  }).withFailureHandler(error=>{
    btn.disabled=false;
    msg('barcode_edit',error.message||String(error),'err');
  }).updateBarcodeDetails(payload);
}

function reprintBarcodeEditor(){
  if(!BARCODE_EDIT_RESULT||!(BARCODE_EDIT_RESULT.pieces||[]).length)return msg('barcode_edit','Search a barcode first.','err');
  printNovajetLabels(BARCODE_EDIT_RESULT.pieces.map(piece=>({
    price:piece.SellingPrice,
    barcode:piece.PieceBarcode,
    tierCode:piece.PieceBarcode
  })));
}


/* =========================================================
   STICKER PRINTING - MANUAL QUANTITY
   Prints unique AVAILABLE physical-piece barcodes.
   ========================================================= */

function fillPrintBarcodes() {
  const rows =
    (DATA.priceTiers || [])
      .map(x => ({
        ...x,
        Display:
          `${x.Barcode} · ${x.VendorName} · ${x.CategoryName} · ${x.TierName} · ${money(x.SellingPrice)}`
      }));

  setOptions(
    'print_barcode',
    rows,
    'Barcode',
    'Display'
  );
}


function printStickers() {
  const barcode =
    val('print_barcode');

  const qty =
    Number(
      val('print_qty') || 0
    );

  if (!barcode) {
    alert(
      'Select a barcode.'
    );
    return;
  }

  if (
    !Number.isInteger(qty) ||
    qty <= 0
  ) {
    alert(
      'Enter a valid sticker quantity.'
    );
    return;
  }

  const tier =
    (DATA.priceTiers || [])
      .find(
        x =>
          String(x.Barcode) ===
          String(barcode)
      );

  if (!tier) {
    alert(
      'Barcode not found.'
    );
    return;
  }

  printNovajetLabels(Array.from({length:qty},()=>({
    vendor:tier.VendorName||'',
    meta:[tier.CategoryName,tier.TierName].filter(Boolean).join(' · '),
    price:tier.SellingPrice,mrp:tier.MRP,barcode:barcode,tierCode:tier.TierCode||tier.TierName||barcode
  })));
}


/* =========================================================
   INDIVIDUAL PIECE STICKER PRINTING
   ========================================================= */

function setLastGeneratedPieces(pieces) {
  LAST_GENERATED_PIECES = Array.isArray(pieces)
    ? pieces
    : [];

  const summary =
    document.getElementById('last_piece_summary');

  const btn =
    document.getElementById('print_last_stickers');

  if (!LAST_GENERATED_PIECES.length) {
    if (summary) {
      summary.textContent =
        'No newly generated piece barcodes yet.';
      summary.className = 'msg';
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent =
        'Print Last Generated Piece Stickers';
    }

    return;
  }

  const first =
    LAST_GENERATED_PIECES[0];

  const last =
    LAST_GENERATED_PIECES[
      LAST_GENERATED_PIECES.length - 1
    ];

  if (summary) {
    summary.innerHTML = `
      <strong>${LAST_GENERATED_PIECES.length}</strong>
      individual piece barcode(s) generated.
      <br>
      Tier: <strong>${esc(first.TierCode)}</strong>
      · Batch: <strong>${esc(first.BatchNo)}</strong>
      <br>
      ${esc(first.PieceBarcode)}
      →
      ${esc(last.PieceBarcode)}
    `;
    summary.className = 'msg ok';
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent =
      'Print ' +
      LAST_GENERATED_PIECES.length +
      ' Piece Stickers';
  }
}

function printLastGeneratedStickers() {
  if (!LAST_GENERATED_PIECES.length) {
    alert('No newly generated piece barcodes to print.');
    return;
  }
  printNovajetLabels(LAST_GENERATED_PIECES.map(piece=>({
    vendor:piece.VendorName||'',
    meta:[piece.CategoryName,piece.TierCode,piece.BatchNo].filter(Boolean).join(' · '),
    price:piece.SellingPrice,mrp:piece.MRP,barcode:piece.PieceBarcode,tierCode:piece.PieceBarcode
  })));
}

function printNovajetLabels(labels){
  if(typeof JsBarcode!=='function'){
    alert('Barcode library has not loaded. Reload the page and retry.');
    return;
  }
  const area=document.getElementById('printArea');
  area.innerHTML='';
  document.body.appendChild(area);
  let sheet;
  labels.forEach((label,index)=>{
    if(index % 24 === 0){
      sheet=document.createElement('div');sheet.className='sticker-sheet';
      area.appendChild(sheet);
    }
    const div=document.createElement('div');div.className='barcode-label';
    const price='₹'+Number(label.price||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
    div.innerHTML=`<div class="label-heading"><span>SS</span><strong>${esc(price)}</strong></div>
      <svg class="barcode-svg" data-barcode="${escAttr(label.barcode)}"></svg>
      <div class="label-tier">${esc(label.tierCode||label.barcode)}</div>`;
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
    alert('Could not generate barcode labels: '+error.message);
    return;
  }
  area.style.display='none';
  window.addEventListener('afterprint',()=>{area.innerHTML='';},{once:true});
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
}


/* =========================================================
   PURCHASE
   ========================================================= */

function purchaseVendorChanged() {
  const vendorId =
    val('pur_vendor');

  const allowedIds =
    new Set(
      (DATA.vendorCategories || [])
        .filter(
          x =>
            String(x.VendorID) ===
            vendorId
        )
        .map(
          x =>
            String(x.CategoryID)
        )
    );

  const cats =
    (DATA.categories || [])
      .filter(
        c =>
          allowedIds.has(
            String(c.CategoryID)
          )
      );

  setOptions(
    'pur_category',
    cats,
    'CategoryID',
    'CategoryName'
  );

  fillPurchasePriceTiers();
}

function fillPurchasePriceTiers() {
  const vendorId =
    val('pur_vendor');

  const categoryId =
    val('pur_category');

  const rows =
    (DATA.priceTiers || [])
      .filter(
        x =>
          (!vendorId ||
            String(x.VendorID) ===
            vendorId
          ) &&
          (!categoryId ||
            String(x.CategoryID) ===
            categoryId
          )
      )
      .map(x => ({
        ...x,
        Display:
          `${x.TierName} · Buy ${money(x.PurchasePrice)} · Sell ${money(x.SellingPrice)} · MRP ${money(x.MRP)}`
      }));

  setOptions(
    'pur_tier',
    rows,
    'PriceTierID',
    'Display'
  );

  showSelectedPurchaseTier();
}

function purchaseBarcodeKey(e) {
  if (e.key !== 'Enter') {
    return;
  }

  e.preventDefault();

  const barcode =
    val('pur_barcode');

  if (!barcode) return;

  const tier =
    (DATA.priceTiers || [])
      .find(
        x =>
          String(x.TierName || x.Barcode || '')
            .toLowerCase() ===
          barcode.toLowerCase()
      );

  if (!tier) {
    msg(
      'purchase_line',
      'Tier Code not found.',
      'err'
    );

    return;
  }

  document
    .getElementById(
      'pur_vendor'
    )
    .value =
    tier.VendorID;

  purchaseVendorChanged();

  document
    .getElementById(
      'pur_category'
    )
    .value =
    tier.CategoryID;

  fillPurchasePriceTiers();

  document
    .getElementById(
      'pur_tier'
    )
    .value =
    tier.PriceTierID;

  showSelectedPurchaseTier();

  msg(
    'purchase_line',
    'Tier Code loaded.',
    'ok'
  );
}

function showSelectedPurchaseTier() {
  const tierId =
    val('pur_tier');

  const tier =
    (DATA.priceTiers || [])
      .find(
        x =>
          String(x.PriceTierID) ===
          tierId
      );

  const el =
    document.getElementById(
      'pur_tier_info'
    );

  if (!tier) {
    el.innerHTML =
      'Select a Price Tier or enter the Tier Code.';
    return;
  }

  document
    .getElementById(
      'pur_barcode'
    )
    .value =
    tier.Barcode;

  el.innerHTML = `
    <strong>${esc(tier.VendorName)}</strong>
    ·
    ${esc(tier.CategoryName)}
    ·
    ${esc(tier.TierName)}
    <br>
    Purchase ${money(tier.PurchasePrice)}
    · Selling ${money(tier.SellingPrice)}
    · MRP ${money(tier.MRP)}
    · Tier Code <strong>${esc(tier.TierName)}</strong>
  `;
}

function addPurchaseLine() {
  const tierId =
    val('pur_tier');

  const qty =
    Number(
      val('pur_qty') || 0
    );

  const tier =
    (DATA.priceTiers || [])
      .find(
        x =>
          String(x.PriceTierID) ===
          tierId
      );

  if (!tier) {
    return msg(
      'purchase_line',
      'Select a Price Tier or enter the Tier Code.',
      'err'
    );
  }

  if (
    !Number.isInteger(qty) ||
    qty <= 0
  ) {
    return msg(
      'purchase_line',
      'Quantity must be a whole number greater than zero.',
      'err'
    );
  }

  const existing =
    PURCHASE_DRAFT.find(
      x =>
        String(x.PriceTierID) ===
        String(tier.PriceTierID)
    );

  if (existing) {
    existing.Qty += qty;

    if (!existing.Material && val('pur_material')) {
      existing.Material = val('pur_material');
    }

    if (!existing.Design && val('pur_design')) {
      existing.Design = val('pur_design');
    }

    if (!existing.Colour && val('pur_colour')) {
      existing.Colour = val('pur_colour');
    }

    if (!existing.Size && val('pur_size')) {
      existing.Size = val('pur_size');
    }

    if (!existing.Remarks && val('pur_line_remarks')) {
      existing.Remarks = val('pur_line_remarks');
    }

  } else {
    PURCHASE_DRAFT.push({
      PriceTierID:
        tier.PriceTierID,

      Barcode:
        tier.Barcode,

      VendorName:
        tier.VendorName,

      CategoryName:
        tier.CategoryName,

      TierName:
        tier.TierName,

      PurchasePrice:
        Number(tier.PurchasePrice || 0),

      SellingPrice:
        Number(tier.SellingPrice || 0),

      MRP:
        Number(tier.MRP || 0),

      Qty:
        qty,

      Material:
        val('pur_material'),

      Design:
        val('pur_design'),

      Colour:
        val('pur_colour'),

      Size:
        val('pur_size'),

      Remarks:
        val('pur_line_remarks')
    });
  }

  clear([
    'pur_design',
    'pur_colour',
    'pur_size',
    'pur_line_remarks'
  ]);

  document
    .getElementById(
      'pur_material'
    )
    .value = '';

  document
    .getElementById(
      'pur_qty'
    )
    .value = '1';

  renderPurchaseDraft();

  msg(
    'purchase_line',
    'Stock line added to draft.',
    'ok'
  );
}

function renderPurchaseDraft() {
  const el =
    document.getElementById(
      'purchase_draft'
    );

  const totals =
    document.getElementById(
      'purchase_totals'
    );

  if (!PURCHASE_DRAFT.length) {
    el.innerHTML =
      '<div class="muted">No items added.</div>';

    totals.innerHTML = '';

    return;
  }

  let totalQty = 0;
  let totalValue = 0;

  el.innerHTML =
    '<table><thead><tr>' +

    [
      'Vendor',
      'Category',
      'Tier / Auto Dress Code',
      'Qty',
      'Purchase',
      'Selling',
      'MRP',
      'Optional Details',
      'Value',
      ''
    ]
    .map(
      x => `<th>${esc(x)}</th>`
    )
    .join('') +

    '</tr></thead><tbody>' +

    PURCHASE_DRAFT
      .map((x,index) => {

        const value =
          Number(x.Qty) *
          Number(x.PurchasePrice);

        totalQty +=
          Number(x.Qty);

        totalValue +=
          value;

        const details =
          [
            x.Material,
            x.Design,
            x.Colour,
            x.Size
          ]
          .filter(Boolean)
          .join(' / ') || '-';

        return `
          <tr>
            <td>${esc(x.VendorName)}</td>
            <td>${esc(x.CategoryName)}</td>
            <td>${esc(x.TierName)} / Automatic on save</td>
            <td>${x.Qty}</td>
            <td>${money(x.PurchasePrice)}</td>
            <td>${money(x.SellingPrice)}</td>
            <td>${money(x.MRP)}</td>
            <td>${esc(details)}</td>
            <td>${money(value)}</td>
            <td>
              <button
                class="btn danger"
                style="padding:5px 8px"
                onclick="removePurchaseLine(${index})">
                ×
              </button>
            </td>
          </tr>
        `;
      })
      .join('') +

    '</tbody></table>';

  totals.innerHTML = `
    <div>
      Total Qty:
      <strong>${totalQty}</strong>
    </div>

    <div>
      Purchase Value:
      <strong>${money(totalValue)}</strong>
    </div>
  `;
}

function removePurchaseLine(index) {
  PURCHASE_DRAFT.splice(
    index,
    1
  );

  renderPurchaseDraft();
}

function clearPurchaseDraft() {
  PURCHASE_DRAFT = [];

  renderPurchaseDraft();

  msg(
    'purchase',
    '',
    ''
  );
}

function postPurchase() {
  const vendorId =
    val('pur_vendor');

  const invoiceNo =
    val('pur_invoice');

  const invoiceDate =
    val('pur_date');

  if (!vendorId) {
    return msg(
      'purchase',
      'Select Vendor.',
      'err'
    );
  }

  if (!invoiceNo) {
    return msg(
      'purchase',
      'Enter Supplier Invoice No.',
      'err'
    );
  }

  if (!invoiceDate) {
    return msg(
      'purchase',
      'Select Invoice Date.',
      'err'
    );
  }

  if (!PURCHASE_DRAFT.length) {
    return msg(
      'purchase',
      'Add at least one stock line.',
      'err'
    );
  }

  msg(
    'purchase',
    'Posting purchase and updating stock...',
    ''
  );

  if(PURCHASE_DRAFT.some(x=>x.DraftVendorID&&String(x.DraftVendorID)!==vendorId))return msg('purchase','Draft vendor differs from selected vendor.','err');
  google.script.run
    .withSuccessHandler(res => {

      msg(
        'purchase',
        res.message,
        'ok'
      );

      setLastGeneratedPieces(
        res.generatedPieces || []
      );

      document.getElementById('reprint_vendor').value=PURCHASE_DRAFT[0].VendorName;
      document.getElementById('reprint_invoice').value=invoiceNo;
      PURCHASE_DRAFT = [];

      clear([
        'pur_invoice',
        'pur_remarks'
      ]);

      renderPurchaseDraft();

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'purchase',
          e.message || e,
          'err'
        )
    )
    .createPurchase({
      VendorID:
        vendorId,
      VendorName: PURCHASE_DRAFT[0].VendorName,

      InvoiceNo:
        invoiceNo,

      InvoiceDate:
        invoiceDate,

      Remarks:
        val('pur_remarks'),

      Items:
        PURCHASE_DRAFT
    });
}

function renderPurchaseHistory() {
  const vendorMap =
    mapBy(
      DATA.vendors,
      'VendorID',
      'VendorName'
    );

  const rows =
    (DATA.purchases || [])
      .slice()
      .reverse()
      .map(p => ({
        PurchaseID:
          p.PurchaseID,

        Date:
          fmtDate(
            p.InvoiceDate
          ),

        Invoice:
          p.InvoiceNo,

        Vendor:
          p.VendorName ||
          vendorMap[p.VendorID] ||
          '',

        Qty:
          Number(
            p.TotalQty || 0
          ),

        Value:
          money(
            p.PurchaseValue
          ),

        Status:
          p.Status || ''
      }));

  renderTable(
    'purchase_history',
    rows,
    [
      'PurchaseID',
      'Date',
      'Invoice',
      'Vendor',
      'Qty',
      'Value',
      'Status'
    ]
  );
}


/* =========================================================
   STOCK
   ========================================================= */

function renderStock() {
  const q =
    val('stock_search')
      .toLowerCase();

  let rows =
    (DATA.stockSummary || [])
      .slice();

  if (q) {
    rows =
      rows.filter(r =>
        [
          r.VendorName,
          r.CategoryName,
          r.TierName,
          r.Barcode
        ]
        .some(
          v =>
            String(v || '')
              .toLowerCase()
              .includes(q)
        )
      );
  }

  const totalQty =
    rows.reduce(
      (sum,r) =>
        sum +
        Number(r.Qty || 0),
      0
    );

  const activeBarcodes =
    rows.filter(
      r => Number(r.Qty || 0) > 0
    ).length;

  const retailValue =
    rows.reduce(
      (sum,r) =>
        sum +
        Number(r.Qty || 0) *
        Number(r.SellingPrice || 0),
      0
    );

  const costValue =
    rows.reduce(
      (sum,r) =>
        sum +
        Number(r.Qty || 0) *
        Number(r.PurchasePrice || 0),
      0
    );

  document
    .getElementById(
      'stock_kpis'
    )
    .innerHTML = [
      ['Total Qty',totalQty],
      ['Active Tiers',activeBarcodes],
      ['Stock Cost',money(costValue)],
      ['Retail Value',money(retailValue)]
    ]
    .map(
      x => `
        <div class="kpi">
          <div class="n">${esc(x[1])}</div>
          <div class="l">${esc(x[0])}</div>
        </div>
      `
    )
    .join('');

  renderTable(
    'stock_table',
    rows.map(r => ({
      TierCode:
        r.TierName,

      Vendor:
        r.VendorName,

      Category:
        r.CategoryName,

      Tier:
        r.TierName,

      Purchase:
        money(
          r.PurchasePrice
        ),

      Selling:
        money(
          r.SellingPrice
        ),

      MRP:
        money(
          r.MRP
        ),

      Qty:
        r.Qty
    })),
    [
      'TierCode',
      'Vendor',
      'Category',
      'Tier',
      'Purchase',
      'Selling',
      'MRP',
      'Qty'
    ]
  );
}


/* =========================================================
   STOCK LEDGER
   ========================================================= */

function loadLedger() {
  google.script.run
    .withSuccessHandler(rows => {

      renderTable(
        'ledger_table',
        rows
          .slice()
          .reverse()
          .map(r => ({
            Date:
              fmtDate(
                r.TxnDate
              ),

            Type:
              r.TxnType,

            Barcode:
              r.Barcode,

            Vendor:
              r.VendorName,

            Category:
              r.CategoryName,

            Tier:
              r.TierName,

            QtyIn:
              Number(
                r.QtyIn || 0
              ),

            QtyOut:
              Number(
                r.QtyOut || 0
              ),

            Reference:
              r.ReferenceID,

            Remarks:
              r.Remarks
          })),
        [
          'Date',
          'Type',
          'Barcode',
          'Vendor',
          'Category',
          'Tier',
          'QtyIn',
          'QtyOut',
          'Reference',
          'Remarks'
        ]
      );

    })
    .withFailureHandler(
      e =>
        alert(
          e.message || e
        )
    )
    .getStockLedger();
}


/* =========================================================
   POS
   ========================================================= */

function getPOSRows() {
  const q =
    val('pos_search')
      .toLowerCase();

  let rows =
    (DATA.billingCatalog || [])
      .filter(
        x =>
          Number(x.Available || 0) > 0
      );

  if (q) {
    rows =
      rows.filter(r =>
        [
          r.Barcode,
          r.TierCode,
          r.BatchNo,
          r.VendorName,
          r.CategoryName,
          r.TierName
        ]
        .some(
          v =>
            String(v || '')
              .toLowerCase()
              .includes(q)
        )
      );
  }

  return rows.slice(0,100);
}

function renderPOSCatalog() {
  const el =
    document.getElementById(
      'pos_catalog'
    );

  if (!el) return;

  const rows =
    getPOSRows();

  if (!rows.length) {
    el.innerHTML =
      '<div class="muted" style="padding:12px">No matching in-stock items.</div>';

    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Piece Barcode</th>
          <th>Vendor</th>
          <th>Category</th>
          <th>Tier Code</th>
          <th>Batch</th>
          <th>Price</th>
          <th>MRP</th>
          <th></th>
        </tr>
      </thead>

      <tbody>
        ${
          rows
            .map(
              r => `
                <tr>
                  <td>
                    <strong>${esc(r.Barcode)}</strong>
                  </td>

                  <td>${esc(r.VendorName)}</td>
                  <td>${esc(r.CategoryName)}</td>
                  <td>${esc(r.TierName)}</td>
                  <td>${esc(r.BatchNo || '')}</td>
                  <td>${money(r.SellingPrice)}</td>
                  <td>${money(r.MRP)}</td>

                  <td>
                    <button
                      class="btn secondary"
                      style="padding:6px 9px"
                      onclick="addToPOSCart('${escAttr(r.Barcode)}')">
                      Add
                    </button>
                  </td>
                </tr>
              `
            )
            .join('')
        }
      </tbody>
    </table>
  `;
}

function posSearchKey(e) {
  if (e.key !== 'Enter') {
    return;
  }

  e.preventDefault();

  const raw =
    val('pos_search');

  if (!raw) return;

  const exact =
    (DATA.billingCatalog || [])
      .find(
        r =>
          String(r.Barcode)
            .toLowerCase() ===
          raw.toLowerCase()
      );

  if (exact) {
    addToPOSCart(
      exact.Barcode
    );

    document
      .getElementById(
        'pos_search'
      )
      .value = '';

    renderPOSCatalog();

  } else {
    msg(
      'pos',
      'Individual piece barcode not found. Search available pieces by Vendor / Category / Tier Code.',
      'err'
    );
  }
}

function addToPOSCart(barcode) {
  const info =
    (DATA.billingCatalog || [])
      .find(
        x =>
          String(x.Barcode) ===
          String(barcode)
      );

  if (
    !info ||
    Number(info.Available || 0) <= 0
  ) {
    return msg(
      'pos',
      'No stock available for this barcode.',
      'err'
    );
  }

  const existing =
    POS_CART.find(
      x =>
        String(x.Barcode) ===
        String(barcode)
    );

  if (existing) {
    return msg(
      'pos',
      'This exact piece is already in the bill: ' + barcode,
      'err'
    );

  } else {
    POS_CART.push({
      Barcode:
        barcode,

      Qty:
        1,

      Rate:
        Number(
          info.SellingPrice || 0
        ),

      DiscountPct:
        0
    });
  }

  msg(
    'pos',
    '',
    ''
  );

  renderPOSCart();

  document
    .getElementById(
      'pos_search'
    )
    .focus();
}

function getPOSTotals() {
  let subTotal = 0;
  let lineDiscount = 0;

  POS_CART.forEach(x => {
    const gross =
      Number(x.Qty || 0) *
      Number(x.Rate || 0);

    const discount =
      gross *
      Number(x.DiscountPct || 0) /
      100;

    subTotal += gross;
    lineDiscount += discount;
  });

  const billDiscount =
    Math.max(
      0,
      Number(
        val('pos_bill_discount') || 0
      )
    );

  const net =
    Math.max(
      0,
      subTotal -
      lineDiscount -
      billDiscount
    );

  return {
    subTotal,
    lineDiscount,
    billDiscount,
    net
  };
}

function renderPOSCart() {
  const el =
    document.getElementById(
      'pos_cart'
    );

  const totals =
    document.getElementById(
      'pos_totals'
    );

  if (!POS_CART.length) {
    el.innerHTML =
      '<div class="muted">No items in the bill.</div>';

    totals.innerHTML = '';

    renderPaymentBalance();

    return;
  }

  const catalog =
    indexBy(
      DATA.billingCatalog,
      'Barcode'
    );

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Disc %</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>

      <tbody>
        ${
          POS_CART
            .map(
              (x,index) => {
                const info =
                  catalog[x.Barcode] || {};

                const gross =
                  Number(x.Qty) *
                  Number(x.Rate);

                const total =
                  gross *
                  (
                    1 -
                    Number(x.DiscountPct || 0) /
                    100
                  );

                return `
                  <tr>
                    <td>
                      <strong>${esc(x.Barcode)}</strong>
                      <br>
                      <span class="muted">
                        ${esc(info.VendorName || '')}
                        ·
                        ${esc(info.CategoryName || '')}
                        ·
                        ${esc(info.TierName || '')}
                        · Batch ${esc(info.BatchNo || '')}
                      </span>
                    </td>

                    <td>
                      <strong>1</strong>
                    </td>

                    <td>
                      <input
                        style="width:100px"
                        type="number"
                        min="0"
                        step="0.01"
                        value="${x.Rate}"
                        onchange="updatePOSItem(${index},'Rate',this.value)">
                    </td>

                    <td>
                      <input
                        style="width:70px"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value="${x.DiscountPct}"
                        onchange="updatePOSItem(${index},'DiscountPct',this.value)">
                    </td>

                    <td>
                      ${money(total)}
                    </td>

                    <td>
                      <button
                        class="btn danger"
                        style="padding:5px 8px"
                        onclick="removePOSItem(${index})">
                        ×
                      </button>
                    </td>
                  </tr>
                `;
              }
            )
            .join('')
        }
      </tbody>
    </table>
  `;

  const t =
    getPOSTotals();

  totals.innerHTML = `
    <div>
      Subtotal:
      <strong>${money(t.subTotal)}</strong>
    </div>

    <div>
      Item Discount:
      <strong>${money(t.lineDiscount)}</strong>
    </div>

    <div>
      Bill Discount:
      <strong>${money(t.billDiscount)}</strong>
    </div>

    <div>
      Net Amount:
      <strong>${money(t.net)}</strong>
    </div>
  `;

  renderPaymentBalance();
}

function updatePOSItem(
  index,
  field,
  value
) {
  const row =
    POS_CART[index];

  if (!row) return;

  const catalog =
    indexBy(
      DATA.billingCatalog,
      'Barcode'
    );

  const info =
    catalog[row.Barcode] || {};

  let n =
    Number(value || 0);

  if (field === 'Rate') {
    n =
      Math.max(
        0,
        n
      );
  }

  if (field === 'DiscountPct') {
    n =
      Math.min(
        100,
        Math.max(
          0,
          n
        )
      );
  }

  row[field] = n;

  renderPOSCart();
}

function removePOSItem(index) {
  POS_CART.splice(
    index,
    1
  );

  renderPOSCart();
}

function renderPaymentBalance() {
  const t =
    getPOSTotals();

  const cash =
    Number(
      val('pay_cash') || 0
    );

  const upi =
    Number(
      val('pay_upi') || 0
    );

  const card =
    Number(
      val('pay_card') || 0
    );

  const paid =
    cash +
    upi +
    card;

  const balance =
    t.net -
    paid;

  document
    .getElementById(
      'payment_balance'
    )
    .innerHTML = `
      <div>
        Bill Amount:
        <strong>${money(t.net)}</strong>
      </div>

      <div>
        Payment Total:
        <strong>${money(paid)}</strong>
      </div>

      <div>
        Balance:
        <strong>${money(balance)}</strong>
      </div>
    `;
}

function fillCashBalance() {
  const t =
    getPOSTotals();

  const upi =
    Number(
      val('pay_upi') || 0
    );

  const card =
    Number(
      val('pay_card') || 0
    );

  document
    .getElementById(
      'pay_cash'
    )
    .value =
    Math.max(
      0,
      t.net -
      upi -
      card
    )
    .toFixed(2);

  renderPaymentBalance();
}

function clearPaymentFields() {
  [
    'pay_cash',
    'pay_upi',
    'pay_card'
  ]
  .forEach(id => {
    const el =
      document.getElementById(id);

    if (el) {
      el.value = '0';
    }
  });

  [
    'pay_upi_ref',
    'pay_card_ref'
  ]
  .forEach(id => {
    const el =
      document.getElementById(id);

    if (el) {
      el.value = '';
    }
  });

  renderPaymentBalance();
}

function clearPOS() {
  POS_CART = [];

  document
    .getElementById(
      'pos_bill_discount'
    )
    .value = '0';

  clearPaymentFields();

  renderPOSCart();

  msg(
    'pos',
    '',
    ''
  );
}

function completeSale() {
  if (!POS_CART.length) {
    return msg(
      'pos',
      'Add at least one item.',
      'err'
    );
  }

  const t =
    getPOSTotals();

  const payments = [];

  const cash =
    Number(
      val('pay_cash') || 0
    );

  const upi =
    Number(
      val('pay_upi') || 0
    );

  const card =
    Number(
      val('pay_card') || 0
    );

  if (cash > 0) {
    payments.push({
      PaymentMode:'CASH',
      Amount:cash,
      ReferenceNo:''
    });
  }

  if (upi > 0) {
    payments.push({
      PaymentMode:'UPI',
      Amount:upi,
      ReferenceNo:
        val('pay_upi_ref')
    });
  }

  if (card > 0) {
    payments.push({
      PaymentMode:'CARD',
      Amount:card,
      ReferenceNo:
        val('pay_card_ref')
    });
  }

  const paid =
    payments.reduce(
      (sum,p) =>
        sum +
        Number(p.Amount || 0),
      0
    );

  if (
    Math.abs(
      paid -
      t.net
    ) > 0.01
  ) {
    return msg(
      'pos',
      'Payment total must exactly match the bill amount.',
      'err'
    );
  }

  msg(
    'pos',
    'Completing sale...',
    ''
  );

  google.script.run
    .withSuccessHandler(res => {

      LAST_SALE_ID =
        res.saleId;

      const btn =
        document.getElementById(
          'print_last_bill'
        );

      btn.disabled = false;
      btn.textContent =
        'Print ' +
        res.billNo;

      POS_CART = [];

      clear([
        'pos_customer',
        'pos_mobile'
      ]);

      document
        .getElementById(
          'pos_bill_discount'
        )
        .value = '0';

      clearPaymentFields();

      renderPOSCart();

      msg(
        'pos',
        res.message,
        'ok'
      );

      loadAll();
    })
    .withFailureHandler(
      e =>
        msg(
          'pos',
          e.message || e,
          'err'
        )
    )
    .createSale({
      SaleDate:
        val('pos_date'),

      CustomerName:
        val('pos_customer'),

      CustomerMobile:
        val('pos_mobile'),

      BillDiscount:
        Number(
          val('pos_bill_discount') || 0
        ),

      Items:
        POS_CART,

      Payments:
        payments
    });
}


/* =========================================================
   RECEIPT
   ========================================================= */

function printLastBill() {
  if (!LAST_SALE_ID) return;

  printSale(
    LAST_SALE_ID
  );
}

function printSale(saleId) {
  google.script.run
    .withSuccessHandler(data => {

      const sale =
        data.sale || {};

      const items =
        data.items || [];

      const payments =
        data.payments || [];

      const w =
        window.open(
          '',
          '_blank',
          'width=520,height=760'
        );

      if (!w) {
        msg(
          'pos',
          'Popup blocked. Allow popups to print the bill.',
          'err'
        );

        return;
      }

      const itemRows =
        items
          .map(i => `
            <tr>
              <td>
                ${esc(i.CategoryName)}
                /
                ${esc(i.TierName)}
                <br>
                <small>
                  ${esc(i.Barcode)}
                </small>
              </td>

              <td style="text-align:right">
                ${i.Qty}
              </td>

              <td style="text-align:right">
                ${Number(i.Rate || 0).toFixed(2)}
              </td>

              <td style="text-align:right">
                ${Number(i.LineTotal || 0).toFixed(2)}
              </td>
            </tr>
          `)
          .join('');

      const paymentRows =
        payments
          .map(p => `
            <div>
              ${esc(p.PaymentMode)}:
              ₹${Number(p.Amount || 0).toFixed(2)}
              ${
                p.ReferenceNo
                  ? '(' + esc(p.ReferenceNo) + ')'
                  : ''
              }
            </div>
          `)
          .join('');

      w.document.write(`
        <!doctype html>
        <html>

        <head>
          <title>${esc(sale.BillNo || 'Bill')}</title>

          <style>
            body{
              font-family:Arial,sans-serif;
              padding:18px;
              color:#111;
              font-size:13px;
            }

            h2{
              text-align:center;
              margin:0 0 4px;
            }

            .center{
              text-align:center;
            }

            table{
              width:100%;
              border-collapse:collapse;
              margin-top:12px;
            }

            th,
            td{
              border-bottom:1px solid #ddd;
              padding:7px 3px;
              text-align:left;
            }

            .totals{
              margin-top:14px;
              text-align:right;
              line-height:1.8;
            }

            @media print{
              button{display:none}
            }
          </style>
        </head>

        <body>

          <h2>TEXTILE SHOP</h2>

          <div class="center">
            ${esc(data.locationName || '')}
          </div>

          <div class="center">
            Sales Bill
          </div>

          <hr>

          <div>
            <strong>Bill:</strong>
            ${esc(sale.BillNo || '')}
          </div>

          <div>
            <strong>Date:</strong>
            ${esc(fmtDate(sale.SaleDate))}
          </div>

          <div>
            <strong>Customer:</strong>
            ${esc(sale.CustomerName || 'Walk-in')}
          </div>

          ${
            sale.CustomerMobile
              ? `
                <div>
                  <strong>Mobile:</strong>
                  ${esc(sale.CustomerMobile)}
                </div>
              `
              : ''
          }

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:right">Qty</th>
                <th style="text-align:right">Rate</th>
                <th style="text-align:right">Amount</th>
              </tr>
            </thead>

            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <div class="totals">
            <div>
              Subtotal:
              ₹${Number(sale.SubTotal || 0).toFixed(2)}
            </div>

            <div>
              Item Discount:
              ₹${Number(sale.LineDiscount || 0).toFixed(2)}
            </div>

            <div>
              Bill Discount:
              ₹${Number(sale.BillDiscount || 0).toFixed(2)}
            </div>

            <div style="font-size:17px">
              <strong>
                Net Amount:
                ₹${Number(sale.NetAmount || 0).toFixed(2)}
              </strong>
            </div>
          </div>

          <div style="margin-top:12px">
            <strong>Payment</strong>
            ${paymentRows}
          </div>

          <p class="center" style="margin-top:22px">
            Thank you
          </p>

          <div class="center">
            <button onclick="window.print()">
              Print
            </button>
          </div>

        </body>
        </html>
      `);

      w.document.close();
    })
    .withFailureHandler(
      e =>
        msg(
          'pos',
          e.message || e,
          'err'
        )
    )
    .getSaleReceipt(
      saleId
    );
}


/* =========================================================
   RENDER MASTER LISTS
   ========================================================= */

function renderAll() {
  renderTable(
    'list_vendors',
    DATA.vendors,
    [
      'VendorID',
      'VendorName',
      'Mobile',
      'GSTIN'
    ]
  );

  renderCategoryTierList();

  renderTable(
    'list_materials',
    DATA.materials,
    [
      'MaterialID',
      'MaterialName'
    ]
  );

  renderTable(
    'list_vendorcategories',
    (DATA.vendorCategories || [])
      .map(x => ({
        Vendor:
          x.VendorName,

        Category:
          x.CategoryName
      })),
    [
      'Vendor',
      'Category'
    ]
  );

  renderPriceTierList();
}

function renderPriceTierList() {
  const el =
    document.getElementById(
      'list_pricetiers'
    );

  const rows =
    (DATA.priceTiers || []);

  if (!rows.length) {
    el.innerHTML =
      '<div class="muted">No Price Tiers yet.</div>';

    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Vendor</th>
          <th>Category</th>
          <th>Tier</th>
          <th>Purchase</th>
          <th>Selling</th>
          <th>MRP</th>
          <th>Tier Barcode</th>
        </tr>
      </thead>

      <tbody>
        ${
          rows
            .map(r => `
              <tr>
                <td>${esc(r.VendorName)}</td>
                <td>${esc(r.CategoryName)}</td>
                <td>${esc(r.TierName)}</td>
                <td>${money(r.PurchasePrice)}</td>
                <td>${money(r.SellingPrice)}</td>
                <td>${money(r.MRP)}</td>
                <td><strong>${esc(r.Barcode)}</strong></td>
              </tr>
            `)
            .join('')
        }
      </tbody>
    </table>
  `;
}

// Category-level selling-price presets, independent of vendor purchase tiers.
function fillCategoryTierEditor(){
  const select=document.getElementById('cpt_category'),old=select.value;
  select.replaceChildren(new Option('Select Category',''));
  (DATA.categories||[]).forEach(c=>select.add(new Option(c.CategoryName,c.CategoryID)));
  if([...select.options].some(o=>o.value===old))select.value=old;
  showCategoryTierRows();
  fillCategoryTierPresets();
}
function addCategoryTierRow(code='',price=''){
  const row=document.createElement('div');row.className='form-grid';row.style.margin='10px 0';
  row.innerHTML='<div><label>Tier Code *</label><input class="cpt_code" placeholder="T1" maxlength="50"></div><div><label>Selling Price *</label><input class="cpt_price" type="number" min="0.01" step="0.01" placeholder="249"></div><div><label>&nbsp;</label><button type="button" class="btn secondary">Remove Row</button></div>';
  row.querySelector('.cpt_code').value=code;row.querySelector('.cpt_price').value=price;
  row.querySelector('button').onclick=()=>row.remove();document.getElementById('cpt_rows').appendChild(row);
}
function showCategoryTierRows(){
  document.getElementById('cpt_rows').replaceChildren();msg('categorytiers','');
  const rows=(DATA.categoryPriceTiers||[]).filter(r=>String(r.CategoryID)===val('cpt_category'));
  if(rows.length)rows.forEach(r=>addCategoryTierRow(r.TierCode,r.SellingPrice));else addCategoryTierRow();
}
function saveCategoryTierRows(){
  const CategoryID=val('cpt_category');
  const Rows=[...document.querySelectorAll('#cpt_rows > div')].map(row=>({TierCode:row.querySelector('.cpt_code').value.trim().toUpperCase(),SellingPrice:row.querySelector('.cpt_price').value}));
  if(!CategoryID)return msg('categorytiers','Select a category.','err');
  if(!Rows.length||Rows.some(r=>!r.TierCode||!r.SellingPrice||Number(r.SellingPrice)<=0))return msg('categorytiers','Complete the code and selling price in every row.','err');
  if(new Set(Rows.map(r=>r.TierCode)).size!==Rows.length)return msg('categorytiers','Use a different code for each row.','err');
  const button=document.getElementById('cpt_save');button.disabled=true;
  google.script.run.withSuccessHandler(res=>{
    button.disabled=false;msg('categorytiers',res.message,'ok');
    DATA.categoryPriceTiers=(DATA.categoryPriceTiers||[]).filter(r=>String(r.CategoryID)!==CategoryID).concat(Rows.map(r=>({...r,CategoryID})));
    fillCategoryTierPresets();
    renderCategoryTierList();
    loadAll();
  }).withFailureHandler(e=>{button.disabled=false;msg('categorytiers',e.message||String(e),'err');}).saveCategoryPriceTiers({CategoryID,Rows});
}

function fillCategoryTierPresets(){
  const select=document.getElementById('pt_preset');
  select.replaceChildren(new Option('Select saved category tier',''));
  (DATA.categoryPriceTiers||[]).filter(r=>String(r.CategoryID)===val('pt_category')).forEach(r=>select.add(new Option(r.TierCode+' · '+money(r.SellingPrice),r.TierCode)));
}
function applyCategoryTierPreset(){
  const row=(DATA.categoryPriceTiers||[]).find(r=>String(r.CategoryID)===val('pt_category')&&r.TierCode===val('pt_preset'));
  if(!row)return;
  document.getElementById('pt_name').value=row.TierCode;
  document.getElementById('pt_selling').value=row.SellingPrice;
  document.getElementById('pt_mrp').value=row.SellingPrice;
}

function renderCategoryTierList(){
  const rows=DATA.categories||[];
  document.getElementById('list_categories').innerHTML='<table><thead><tr><th>Category ID</th><th>Category Name</th><th>Price Tiers</th></tr></thead><tbody>'+rows.map(category=>{
    const tiers=(DATA.categoryPriceTiers||[]).filter(t=>String(t.CategoryID)===String(category.CategoryID)).sort((a,b)=>Number(a.SellingPrice)-Number(b.SellingPrice));
    const text=tiers.length?tiers.map(t=>esc(t.TierCode)+' — '+esc('₹'+Number(t.SellingPrice).toLocaleString('en-IN',{maximumFractionDigits:2}))).join(' · '):'No tiers added';
    return '<tr><td>'+esc(category.CategoryID)+'</td><td>'+esc(category.CategoryName)+'</td><td style="white-space:normal;line-height:1.8">'+text+'</td></tr>';
  }).join('')+'</tbody></table>';
}

function purchaseVendorChanged(){
  setOptions('pur_category',DATA.categories||[],'CategoryID','CategoryName');
  fillPurchasePriceTiers();
}
function fillPurchasePriceTiers(){
  const rows=(DATA.categoryPriceTiers||[]).filter(r=>String(r.CategoryID)===val('pur_category')).map(r=>({...r,Display:r.TierCode+' — '+money(r.SellingPrice)}));
  setOptions('pur_tier',rows,'CategoryPriceTierID','Display');showSelectedPurchaseTier();
}
function showSelectedPurchaseTier(){
  const tier=(DATA.categoryPriceTiers||[]).find(r=>String(r.CategoryPriceTierID)===val('pur_tier'));
  document.getElementById('pur_selling').value=tier?money(tier.SellingPrice):'';
  document.getElementById('pur_mrp').value=tier?tier.SellingPrice:'';
  document.getElementById('pur_tier_info').textContent=tier?'Selected '+tier.TierCode+'. Enter purchase price and quantity. The system assigns a new Dress Code when saved. Dress codes are saved when the purchase is posted.':'Select a category and its Tier Code.';
}
function purchaseBarcodeKey(e){
  if(e.key!=='Enter')return;e.preventDefault();
  const tier=(DATA.categoryPriceTiers||[]).find(r=>r.TierCode.toUpperCase()===val('pur_barcode').trim().toUpperCase());
  if(!tier)return msg('purchase_line','Tier Code not found in category masters.','err');
  document.getElementById('pur_category').value=tier.CategoryID;fillPurchasePriceTiers();document.getElementById('pur_tier').value=tier.CategoryPriceTierID;showSelectedPurchaseTier();
}
function addPurchaseLine(){
  const tier=(DATA.categoryPriceTiers||[]).find(r=>String(r.CategoryPriceTierID)===val('pur_tier'));
  const qty=Number(val('pur_qty')),cost=Number(val('pur_cost')),mrp=Number(val('pur_mrp')),prefix='' ;
  if(!val('pur_vendor'))return msg('purchase_line','Select Vendor.','err');
  if(!tier)return msg('purchase_line','Select Category and Tier Code.','err');
  if(!Number.isSafeInteger(qty)||qty<=0)return msg('purchase_line','Enter a whole quantity greater than zero.','err');
  if(!Number.isFinite(cost)||cost<=0||!Number.isFinite(mrp)||mrp<=0)return msg('purchase_line','Enter valid purchase price and MRP.','err');

  const category=(DATA.categories||[]).find(c=>String(c.CategoryID)===String(tier.CategoryID));
  const vendor=(DATA.vendors||[]).find(v=>String(v.VendorID)===val('pur_vendor'));
  if(PURCHASE_DRAFT.length&&String(PURCHASE_DRAFT[0].DraftVendorID)!==val('pur_vendor'))return msg('purchase_line','Finish or clear the existing vendor draft before changing vendor.','err');
  PURCHASE_DRAFT.push({CategoryPriceTierID:tier.CategoryPriceTierID,CategoryID:tier.CategoryID,PriceTierID:'category-'+tier.CategoryPriceTierID,Barcode:'Automatic on save',TierName:tier.TierCode,DressPrefix:prefix,DraftVendorID:val('pur_vendor'),VendorName:vendor?.VendorName||VendorEntry.name('pur_vendor'),CategoryName:category?.CategoryName||'',PurchasePrice:cost,SellingPrice:Number(tier.SellingPrice),MRP:mrp,Qty:qty,Material:val('pur_material'),Design:val('pur_design'),Colour:val('pur_colour'),Size:val('pur_size'),Remarks:val('pur_line_remarks')});
  renderPurchaseDraft();msg('purchase_line','Stock line added. Codes will be generated when you save the purchase.','ok');
}
let SAVED_DRESS_BARCODES=[];

let INVOICE_SAVED_PIECES=[];
function loadInvoiceSavedBarcodes(){
  const vendor=VendorEntry.key('reprint_vendor'),invoice=String(document.getElementById('reprint_invoice').value||'').trim();
  if(!vendor||!invoice)return msg('invoice_saved','Select or type Vendor and enter Invoice No.','err');
  INVOICE_SAVED_PIECES=[];document.getElementById('print_saved_btn').disabled=true;
  document.getElementById('invoice_saved_list').innerHTML='';document.getElementById('load_saved_btn').disabled=true;
  google.script.run.withSuccessHandler(result=>{
    INVOICE_SAVED_PIECES=result.pieces||[];
    document.getElementById('invoice_saved_list').innerHTML='<table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll(\'.invoice-piece-check\').forEach(c=>c.checked=this.checked)"></th><th>Dress Code</th><th>Selling Price</th><th>Status</th></tr></thead><tbody>'+INVOICE_SAVED_PIECES.map((piece,index)=>'<tr><td><input class="invoice-piece-check" type="checkbox" checked data-index="'+index+'"></td><td>'+esc(piece.PieceBarcode)+'</td><td>'+money(piece.SellingPrice)+'</td><td>'+esc(piece.Status)+'</td></tr>').join('')+'</tbody></table>';
    document.getElementById('print_saved_btn').disabled=!INVOICE_SAVED_PIECES.length;
    document.getElementById('load_saved_btn').disabled=false;
    msg('invoice_saved','Purchase '+result.purchaseId+' — '+INVOICE_SAVED_PIECES.length+' original saved barcode(s) loaded.','ok');
  }).withFailureHandler(error=>{document.getElementById('load_saved_btn').disabled=false;msg('invoice_saved',error.message||String(error),'err');}).getPurchaseBarcodesByInvoice(vendor,invoice);
}
function printInvoiceSelectedBarcodes(){
 const pieces=Array.from(document.querySelectorAll('.invoice-piece-check:checked')).map(el=>INVOICE_SAVED_PIECES[Number(el.dataset.index)]);
 if(!pieces.length)return msg('invoice_saved','Select at least one sticker.','err');
 printNovajetLabels(pieces.map(piece=>({price:piece.SellingPrice,barcode:piece.PieceBarcode,tierCode:piece.PieceBarcode}))); 
}
