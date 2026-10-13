(function(){
  const amountEl=document.getElementById('price_amount');
  const sizeEl=document.getElementById('price_size');
  const qtyEl=document.getElementById('price_qty');
  const dateEl=document.getElementById('barcode_date');
  const generateBtn=document.getElementById('generate_btn');
  const printBtn=document.getElementById('print_btn');
  const msgEl=document.getElementById('msg');
  const previewPrice=document.getElementById('preview_price');
  const previewCode=document.getElementById('preview_code');
  const previewSize=document.getElementById('preview_size');
  const previewBarcode=document.getElementById('preview_barcode');
  const printArea=document.getElementById('printArea');
  let current=null,saving=false;

  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function escAttr(value){return esc(value).replace(/`/g,'&#096;');}
  function showMsg(text,cls=''){msgEl.textContent=text;msgEl.className='msg '+cls;}
  function todayLocal(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
  function normalizeAmount(){const n=Number(amountEl.value);if(!Number.isFinite(n)||n<=0||n>9999999.99)throw Error('Enter a valid amount greater than zero.');return Math.round((n+Number.EPSILON)*100)/100;}
  function normalizeQty(){const n=Number(qtyEl.value);if(!Number.isSafeInteger(n)||n<1||n>500)throw Error('Sticker quantity must be a whole number from 1 to 500.');return n;}
  function normalizeSize(){const v=String(sizeEl.value||'').trim().toUpperCase();if(!v)throw Error('Enter Size.');return v;}
  function amountText(n){return Number.isInteger(n)?n.toLocaleString('en-IN',{maximumFractionDigits:0}):n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function renderSvg(svg,value,width=2,height=48){
    JsBarcode(svg,value,{format:'CODE128',displayValue:false,width,height,margin:0,marginLeft:12,marginRight:12,marginTop:2,marginBottom:2,background:'#ffffff',lineColor:'#000000'});
    const w=Number(svg.getAttribute('width')),h=Number(svg.getAttribute('height'));
    if(w>0&&h>0){svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.removeAttribute('width');svg.removeAttribute('height');}
  }
  function callGas(method,...args){return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args));}

  async function generate(){
    if(saving)return null;
    try{
      if(typeof JsBarcode!=='function')throw Error('Barcode library has not loaded. Reload the page and retry.');
      const amount=normalizeAmount(),size=normalizeSize(),qty=normalizeQty(),barcodeDate=todayLocal();
      dateEl.value=barcodeDate;saving=true;generateBtn.disabled=true;printBtn.disabled=true;showMsg('Saving price barcodes...');
      const res=await callGas('createPriceBarcodes',{Price:amount,Size:size,Qty:qty,BarcodeDate:barcodeDate});
      const rows=res?.rows||[];if(!rows.length)throw Error('No barcodes were generated.');
      current={amount,size,qty,barcodeDate,rows,display:'₹'+amountText(amount),code:rows[0].Code};
      previewPrice.textContent=current.display;previewCode.textContent=current.code;previewSize.textContent=size;
      renderSvg(previewBarcode,rows[0].Barcode);
      printBtn.disabled=false;
      showMsg(`${rows.length} barcode(s) saved. Visible code: ${current.code} · Size: ${size} · Date: ${barcodeDate}`,'ok');
      return current;
    }catch(e){current=null;printBtn.disabled=true;showMsg(e.message||String(e),'err');return null;}
    finally{saving=false;generateBtn.disabled=false;}
  }

  function printLabels(){
    if(!current||!current.rows?.length){showMsg('Generate & save the barcodes first.','err');return;}
    printArea.innerHTML='';let sheet=null;
    current.rows.forEach((row,index)=>{
      if(index%21===0){sheet=document.createElement('div');sheet.className='sticker-sheet';printArea.appendChild(sheet);}
      const div=document.createElement('div');div.className='barcode-label';
      div.innerHTML=`<div class="label-heading"><span>SS</span><strong>${esc(current.display)}</strong></div><svg class="barcode-svg" data-code="${escAttr(row.Barcode)}"></svg><div class="label-bottom" style="gap:4mm"><span class="label-code">${esc(row.Code)}</span><strong style="font-size:14px">${esc(row.Size)}</strong></div>`;
      sheet.appendChild(div);
    });
    try{printArea.querySelectorAll('.barcode-svg').forEach(svg=>renderSvg(svg,svg.dataset.code));}
    catch(e){printArea.innerHTML='';showMsg('Could not generate barcode labels: '+(e.message||e),'err');return;}
    printArea.style.display='none';window.addEventListener('afterprint',()=>{printArea.innerHTML='';},{once:true});requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
  }

  generateBtn.addEventListener('click',generate);printBtn.addEventListener('click',printLabels);
  [amountEl,sizeEl,qtyEl].forEach(el=>el.addEventListener('input',()=>{current=null;printBtn.disabled=true;}));
  [amountEl,sizeEl,qtyEl].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();generate();}}));
  dateEl.value=todayLocal();amountEl.value='499';sizeEl.value='M';
  previewPrice.textContent='₹499';previewCode.textContent='499';previewSize.textContent='M';
  amountEl.focus();amountEl.select();
})();
