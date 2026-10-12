(function(){
  const amountEl=document.getElementById('price_amount');
  const qtyEl=document.getElementById('price_qty');
  const generateBtn=document.getElementById('generate_btn');
  const printBtn=document.getElementById('print_btn');
  const msgEl=document.getElementById('msg');
  const previewPrice=document.getElementById('preview_price');
  const previewCode=document.getElementById('preview_code');
  const previewBarcode=document.getElementById('preview_barcode');
  const printArea=document.getElementById('printArea');

  let current=null;

  function esc(value){
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function escAttr(value){return esc(value).replace(/`/g,'&#096;');}
  function showMsg(text,cls=''){msgEl.textContent=text;msgEl.className='msg '+cls;}

  function normalizeAmount(){
    const n=Number(amountEl.value);
    if(!Number.isFinite(n)||n<=0||n>9999999.99)throw new Error('Enter a valid amount greater than zero.');
    return Math.round((n+Number.EPSILON)*100)/100;
  }
  function normalizeQty(){
    const n=Number(qtyEl.value);
    if(!Number.isSafeInteger(n)||n<1||n>500)throw new Error('Sticker quantity must be a whole number from 1 to 500.');
    return n;
  }
  function amountText(n){
    return Number.isInteger(n)
      ? n.toLocaleString('en-IN',{maximumFractionDigits:0})
      : n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function barcodeValue(n){
    return 'P'+(Number.isInteger(n)?String(n):n.toFixed(2));
  }
  function renderSvg(svg,value,width=2,height=48){
    JsBarcode(svg,value,{
      format:'CODE128',displayValue:false,width,height,
      margin:0,marginLeft:12,marginRight:12,marginTop:2,marginBottom:2,
      background:'#ffffff',lineColor:'#000000'
    });
    const w=Number(svg.getAttribute('width'));
    const h=Number(svg.getAttribute('height'));
    if(Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0){
      svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio','xMidYMid meet');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
    }
  }
  function generate(){
    try{
      if(typeof JsBarcode!=='function')throw new Error('Barcode library has not loaded. Reload the page and retry.');
      const amount=normalizeAmount();
      const qty=normalizeQty();
      const code=barcodeValue(amount);
      const display='₹'+amountText(amount);
      current={amount,qty,code,display};
      previewPrice.textContent=display;
      previewCode.textContent=code;
      renderSvg(previewBarcode,code);
      printBtn.disabled=false;
      showMsg(`${qty} sticker(s) ready. Barcode: ${code}`,'ok');
      return current;
    }catch(e){
      current=null;
      printBtn.disabled=true;
      showMsg(e.message||String(e),'err');
      return null;
    }
  }
  function printLabels(){
    const data=generate();
    if(!data)return;
    printArea.innerHTML='';
    let sheet=null;
    for(let index=0;index<data.qty;index++){
      if(index%21===0){
        sheet=document.createElement('div');
        sheet.className='sticker-sheet';
        printArea.appendChild(sheet);
      }
      const div=document.createElement('div');
      div.className='barcode-label';
      div.innerHTML=`<div class="label-heading"><span>SS</span><strong>${esc(data.display)}</strong></div><svg class="barcode-svg" data-code="${escAttr(data.code)}"></svg><div class="label-bottom"><span class="label-code">${esc(data.code)}</span></div>`;
      sheet.appendChild(div);
    }
    try{
      printArea.querySelectorAll('.barcode-svg').forEach(svg=>renderSvg(svg,svg.dataset.code));
    }catch(e){
      printArea.innerHTML='';
      showMsg('Could not generate barcode labels: '+(e.message||e),'err');
      return;
    }
    printArea.style.display='none';
    window.addEventListener('afterprint',()=>{printArea.innerHTML='';},{once:true});
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
  }

  generateBtn.addEventListener('click',generate);
  printBtn.addEventListener('click',printLabels);
  amountEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();generate();}});
  qtyEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();generate();}});

  amountEl.value='499';
  generate();
  amountEl.focus();
  amountEl.select();
})();
