function receiptDisplayCode(item) {
  const code = String(item.DressCode || item.Barcode || '').trim();
  // Remove only the generated piece suffix; retain the vendor + tier prefix.
  return code.replace(/-B\d+-\d+$/i, '').replace(/-\d+$/, '') ||
    String(item.TierCode || item.SourceBarcode || '').trim();
}

function groupReceiptItems(items) {
  const groups = new Map();
  (items || []).forEach(item => {
    const code = receiptDisplayCode(item);
    const qty = Number(item.Qty ?? 1);
    const rate = Number(item.Rate || 0);
    const discount = Number(item.DiscountPct || 0);
    const amount = Number(item.LineTotal ?? (qty * rate * (1 - discount / 100)));
    // Include effective discount in case older receipts omit DiscountPct.
    const effectiveDiscount = qty * rate ? Number((1 - amount / (qty * rate)).toFixed(8)) : 0;
    const key = JSON.stringify([code, rate, discount, effectiveDiscount]);
    if (!groups.has(key)) groups.set(key, {...item, Barcode: code, Qty: 0, LineTotal: 0});
    const group = groups.get(key);
    group.Qty += qty;
    group.LineTotal += amount;
  });
  return Array.from(groups.values());
}

let POS_CART = [];

let LAST_SALE_ID = '';

let AUTO_PRINT_WINDOW = null;

let SCAN_BUSY = false;



window.onload = () => {

  setToday('pos_date');

  renderPOSCart();

  renderPaymentBalance();

  focusScanner();

};



function setToday(id) {

  const el = document.getElementById(id);

  if (!el) return;



  const d = new Date();



  el.value = new Date(

    d.getTime() - d.getTimezoneOffset() * 60000

  )

  .toISOString()

  .slice(0,10);

}



function val(id) {

  const el = document.getElementById(id);

  return el ? String(el.value || '').trim() : '';

}



function msg(text, cls) {

  const el = document.getElementById('msg_pos');

  if (!el) return;



  el.textContent = text;

  el.className = 'msg ' + (cls || '');

}



function esc(value) {

  return String(value ?? '')

    .replace(/[&<>"']/g, c => ({

      '&':'&amp;',

      '<':'&lt;',

      '>':'&gt;',

      '"':'&quot;',

      "'":'&#039;'

    }[c]));

}



function escAttr(value) {

  return esc(value).replace(/`/g,'&#096;');

}



function money(value) {

  return '₹' +

    Number(value || 0)

      .toLocaleString('en-IN',{

        minimumFractionDigits:2,

        maximumFractionDigits:2

      });

}



function fmtDate(value) {

  if (!value) return '';



  const d = new Date(value);



  return isNaN(d)

    ? String(value)

    : d.toLocaleDateString('en-IN');

}



function indexBy(arr,key) {

  const map = {};



  (arr || []).forEach(x => {

    map[x[key]] = x;

  });



  return map;

}



function focusScanner() {

  setTimeout(() => {

    const el = document.getElementById('pos_search');

    if (el) el.focus();

  }, 60);

}





function getAllocatedPieceBarcodes() {

  return POS_CART.flatMap(

    line => Array.isArray(line.Pieces) ? line.Pieces : []

  );

}



function compactPieceList(pieces) {

  const rows = Array.isArray(pieces) ? pieces : [];



  if (!rows.length) return '';



  if (rows.length <= 3) {

    return rows.join(', ');

  }



  return (

    rows.slice(0,3).join(', ') +

    ' +' +

    (rows.length - 3) +

    ' more'

  );

}





function posSearchKey(e) {

  if (e.key !== 'Enter') return;



  e.preventDefault();



  const raw = val('pos_search').toUpperCase();



  if (!raw || SCAN_BUSY) return;



  SCAN_BUSY = true;



  const input =

    document.getElementById('pos_search');



  input.disabled = true;



  const status =

    document.getElementById('catalog_status');



  status.textContent =

    'Finding ' + raw + '...';



  msg(

    'Looking up exact piece...',

    ''

  );



  google.script.run

    .withSuccessHandler(res => {

      SCAN_BUSY = false;

      input.disabled = false;

      input.value = '';



      if (

        !res ||

        !res.ok ||

        !res.item

      ) {

        status.textContent =

          'Ready to scan';



        msg(

          (res && res.message) ||

          'Piece barcode not found.',

          'err'

        );



        focusScanner();

        return;

      }



      addToPOSCart(

        res.item,

        res.scannedBarcode

      );



      if (res.lookupType === 'TIER') {

        msg(

          res.scannedBarcode +

          ' matched. Allocated piece ' +

          res.allocatedPieceBarcode +

          '.',

          'ok'

        );

      }



      status.textContent =

        'Ready to scan';

    })

    .withFailureHandler(e => {

      SCAN_BUSY = false;

      input.disabled = false;

      input.value = '';



      status.textContent =

        'Ready to scan';



      msg(

        e.message || e,

        'err'

      );



      focusScanner();

    })

    .getBillingItemByBarcode(

      raw,

      getAllocatedPieceBarcodes()

    );

}





function addToPOSCart(info, scannedBarcode) {

  if (

    !info ||

    !info.Barcode ||

    Number(info.Available || 0) <= 0

  ) {

    return msg(

      'No stock available for this barcode.',

      'err'

    );

  }



  const pieceBarcode =

    String(info.Barcode);



  if (

    getAllocatedPieceBarcodes()

      .some(

        x =>

          String(x) ===

          pieceBarcode

      )

  ) {

    return msg(

      'This exact physical piece is already in the bill: ' +

      pieceBarcode,

      'err'

    );

  }



  let line =

    POS_CART.find(

      x =>

        String(x.PriceTierID || '') ===

        String(info.PriceTierID || '')

    );



  if (line) {

    line.Pieces.push(

      pieceBarcode

    );



    line.Qty =

      line.Pieces.length;



  } else {

    line = {

      SourceBarcode:

        info.TierCode ||

        scannedBarcode ||

        info.Barcode,



      PriceTierID:

        info.PriceTierID || '',



      TierCode:

        info.TierCode || '',



      TierName:

        info.TierName || '',



      VendorName:

        info.VendorName || '',



      CategoryName:

        info.CategoryName || '',



      MRP:

        Number(info.MRP || 0),



      Pieces:

        [pieceBarcode],



      Qty:

        1,



      Rate:

        Number(info.SellingPrice || 0),



      DiscountPct:

        0

    };



    POS_CART.push(

      line

    );

  }



  msg(

    pieceBarcode +

    ' added.',

    'ok'

  );



  renderPOSCart();

  focusScanner();

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

    document.getElementById('pos_cart');



  const totals =

    document.getElementById('pos_totals');



  if (!POS_CART.length) {

    el.innerHTML =

      '<div class="muted">No items in the bill.</div>';



    totals.innerHTML = '';

    renderPaymentBalance();

    return;

  }



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

            .map((x,index) => {

              const gross =

                Number(x.Qty || 0) *

                Number(x.Rate || 0);



              const total =

                gross *

                (

                  1 -

                  Number(x.DiscountPct || 0) /

                  100

                );



              const displayCode = (x.Pieces || []).join(', ') || x.SourceBarcode || x.TierCode || ''; 



              return `

                <tr>

                  <td>

                    <strong>${esc(displayCode)}</strong>

                    <br>

                    <span class="muted">

                      ${esc(x.VendorName || '')}

                      ·

                      ${esc(x.CategoryName || '')}

                      ·

                      ${esc(x.TierName || '')}

                    </span>



                    <br>



                    <span

                      class="muted"

                      style="font-size:10px">

                      Pieces:

                      ${esc(compactPieceList(x.Pieces))}

                    </span>

                  </td>



                  <td>

                    <input

                      style="width:70px"

                      type="number"

                      min="1"

                      step="1"

                      value="${x.Qty}"

                      onchange="updatePOSQty(${index},this.value)">

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



                  <td>${money(total)}</td>



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

            })

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





function updatePOSQty(index, value) {

  const row =

    POS_CART[index];



  if (!row) return;



  const target =

    Number(value);



  if (

    !Number.isInteger(target) ||

    target <= 0

  ) {

    msg(

      'Quantity must be a whole number greater than zero.',

      'err'

    );



    renderPOSCart();

    return;

  }



  const current =

    Array.isArray(row.Pieces)

      ? row.Pieces.length

      : 0;



  if (target === current) {

    row.Qty = target;

    renderPOSCart();

    return;

  }



  // Reducing qty only releases pieces from the current unsaved cart.

  if (target < current) {

    row.Pieces =

      row.Pieces.slice(

        0,

        target

      );



    row.Qty =

      target;



    msg(

      'Quantity updated to ' +

      target +

      '.',

      'ok'

    );



    renderPOSCart();

    focusScanner();

    return;

  }



  // Increasing qty allocates additional AVAILABLE physical pieces.

  const needed =

    target -

    current;



  const lookupCode = row.PriceTierID ? 'PRICE_TIER_ID:'+row.PriceTierID : (row.TierCode || row.SourceBarcode);



  if (!lookupCode) {

    msg(

      'Cannot increase quantity because the Tier Code is unavailable.',

      'err'

    );



    renderPOSCart();

    return;

  }



  msg(

    'Adding ' +

    needed +

    ' more piece(s)...',

    ''

  );



  allocateMorePieces(

    index,

    lookupCode,

    needed

  );

}





function allocateMorePieces(

  index,

  lookupCode,

  remaining

) {

  const row =

    POS_CART[index];



  if (!row) return;



  if (remaining <= 0) {

    row.Qty =

      row.Pieces.length;



    msg(

      'Quantity updated to ' +

      row.Qty +

      '.',

      'ok'

    );



    renderPOSCart();

    focusScanner();

    return;

  }



  google.script.run

    .withSuccessHandler(res => {

      if (

        !res ||

        !res.ok ||

        !res.item

      ) {

        row.Qty =

          row.Pieces.length;



        msg(

          (res && res.message) ||

          'No more stock available.',

          'err'

        );



        renderPOSCart();

        focusScanner();

        return;

      }



      const piece =

        String(

          res.item.Barcode || ''

        );



      if (

        piece &&

        !getAllocatedPieceBarcodes()

          .includes(piece)

      ) {

        row.Pieces.push(

          piece

        );

      }



      row.Qty =

        row.Pieces.length;



      allocateMorePieces(

        index,

        lookupCode,

        remaining - 1

      );

    })

    .withFailureHandler(e => {

      row.Qty =

        row.Pieces.length;



      msg(

        e.message || e,

        'err'

      );



      renderPOSCart();

      focusScanner();

    })

    .getBillingItemByBarcode(

      lookupCode,

      getAllocatedPieceBarcodes()

    );

}





function updatePOSItem(

  index,

  field,

  value

) {

  const row = POS_CART[index];



  if (!row) return;



  let n = Number(value || 0);



  if (field === 'Rate') {

    n = Math.max(0,n);

  }



  if (field === 'DiscountPct') {

    n =

      Math.min(

        100,

        Math.max(0,n)

      );

  }



  row[field] = n;

  renderPOSCart();

}



function removePOSItem(index) {

  POS_CART.splice(index,1);

  renderPOSCart();

  focusScanner();

}



function renderPaymentBalance() {

  const t = getPOSTotals();



  const el =

    document.getElementById(

      'payment_total_display'

    );



  if (el) {

    el.value = money(t.net);

  }

}



function fillCashBalance() {

  renderPaymentBalance();

}



function clearPaymentFields() {

  renderPaymentBalance();

}



function clearPOS() {

  POS_CART = [];



  document

    .getElementById('pos_bill_discount')

    .value = '0';



  const mode =

    document.getElementById('payment_mode');



  if (mode) {

    mode.value = 'CASH';

  }



  clearPaymentFields();

  renderPOSCart();



  msg('', '');

  focusScanner();

}



function completeSale() {

  if (!POS_CART.length) {

    return msg(

      'Add at least one item.',

      'err'

    );

  }



  const t = getPOSTotals();



  const paymentMode =

    val('payment_mode').toUpperCase();



  if (

    !['CASH','UPI'].includes(paymentMode)

  ) {

    return msg(

      'Select Mode of Payment.',

      'err'

    );

  }



  const payments =

    t.net > 0

      ? [{

          PaymentMode: paymentMode,

          Amount: t.net,

          ReferenceNo: ''

        }]

      : [];



  /*

    Open the print window immediately from the user's click.

    This avoids most browser popup-blocker issues after the

    asynchronous API calls finish.

  */

  AUTO_PRINT_WINDOW =

    window.open(

      '',

      '_blank',

      'width=520,height=760'

    );



  if (AUTO_PRINT_WINDOW) {

    AUTO_PRINT_WINDOW.document.write(`

      <!doctype html>

      <html>

      <head>

        <title>Preparing Bill...</title>

        <style>

          body{

            font-family:Arial,sans-serif;

            padding:24px;

            text-align:center;

          }

        </style>

      </head>

      <body>

        <h3>Preparing bill...</h3>

        <p>Please wait.</p>

      </body>

      </html>

    `);



    AUTO_PRINT_WINDOW.document.close();

  }



  msg(

    'Completing sale...',

    ''

  );



  const btn =

    document.getElementById(

      'complete_sale_btn'

    );



  btn.disabled = true;



  google.script.run

    .withSuccessHandler(res => {

      LAST_SALE_ID =

        res.saleId;



      const printBtn =

        document.getElementById(

          'print_last_bill'

        );



      printBtn.disabled = false;

      printBtn.textContent =

        'Print ' +

        res.billNo;



      /*
        The sale is already committed successfully at this point.
        Clear the completed bill immediately so sold items do not
        remain on screen if receipt generation or printing fails.
      */
      POS_CART = [];

      document
        .getElementById('pos_customer')
        .value = '';

      document
        .getElementById('pos_mobile')
        .value = '';

      document
        .getElementById('pos_bill_discount')
        .value = '0';

      clearPaymentFields();
      renderPOSCart();

      document.getElementById('catalog_status').textContent =
        'Sale completed. Preparing receipt...';

      msg(
        res.message + ' Preparing PDF and print output...',
        'ok'
      );

      /*
        Fetch the completed receipt separately. From the same
        Complete Sale click we then:
        1. download the PDF
        2. open the browser print dialog
      */
      google.script.run
        .withSuccessHandler(data => {
          try {
            downloadReceiptPDF(data);
          } catch (pdfErr) {
            console.error(pdfErr);
          }

          try {
            printReceiptData(
              data,
              AUTO_PRINT_WINDOW
            );
          } catch (printErr) {
            console.error(printErr);

            if (
              AUTO_PRINT_WINDOW &&
              !AUTO_PRINT_WINDOW.closed
            ) {
              AUTO_PRINT_WINDOW.close();
            }
          }

          AUTO_PRINT_WINDOW = null;

          msg(
            res.message +
            ' PDF downloaded and print dialog opened.',
            'ok'
          );

          btn.disabled = false;

          document.getElementById('catalog_status').textContent =
            'Ready to scan';

          focusScanner();
        })
        .withFailureHandler(e => {
          btn.disabled = false;

          if (
            AUTO_PRINT_WINDOW &&
            !AUTO_PRINT_WINDOW.closed
          ) {
            AUTO_PRINT_WINDOW.close();
          }

          AUTO_PRINT_WINDOW = null;

          msg(
            res.message +
            ' Sale completed, but receipt output failed: ' +
            (e.message || e),
            'err'
          );

          document.getElementById('catalog_status').textContent =
            'Ready to scan';

          focusScanner();
        })
        .getSaleReceipt(
          res.saleId
        );

    })

    .withFailureHandler(e => {

      btn.disabled = false;



      if (

        AUTO_PRINT_WINDOW &&

        !AUTO_PRINT_WINDOW.closed

      ) {

        AUTO_PRINT_WINDOW.close();

      }



      AUTO_PRINT_WINDOW = null;



      msg(

        e.message || e,

        'err'

      );



      focusScanner();

    })

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

        POS_CART.flatMap(

          line =>

            (line.Pieces || [])

              .map(

                pieceBarcode => ({

                  Barcode: pieceBarcode,

                  Qty: 1,

                  Rate: Number(line.Rate || 0),

                  DiscountPct:

                    Number(line.DiscountPct || 0)

                })

              )

        ),



      Payments:

        payments

    });

}





function downloadReceiptPDF(data) {
  if (!window.jspdf?.jsPDF) throw new Error('PDF library not loaded.');
  const sale=data.sale||{}, items=groupReceiptItems(data.items||[]);
  const doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const width=doc.internal.pageSize.getWidth(), height=doc.internal.pageSize.getHeight();
  const left=10,right=width-10,customerX=width/2+2;
  let y=15;
  function text(value,x,yy,bold=false,size=10,align='left') {
    doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);
    doc.text(String(value),x,yy,{align});
  }
  text('SS BRANDED OUTLET',width/2,y,true,15,'center');y+=12;
  const customerLines=doc.splitTextToSize('Customer Name: '+(sale.CustomerName||'Walk-in'),right-customerX);
  const dateLines=doc.splitTextToSize('Date: '+fmtDate(sale.SaleDate),customerX-left-4);
  doc.setFontSize(9);
  text(dateLines.join('\n'),left,y,false,9);text(customerLines.join('\n'),customerX,y,false,9);
  y+=Math.max(customerLines.length,dateLines.length)*4+3;
  const billLines=doc.splitTextToSize('Bill No: '+(sale.BillNo||''),customerX-left-4);
  text(billLines.join('\n'),left,y,false,9);text('Mobile: '+(sale.CustomerMobile||'-'),customerX,y,false,9);
  y+=billLines.length*4+7;
  const qtyX=width*.47,rateX=width*.69;
  function tableHeader(){
    doc.line(left,y,right,y);y+=6;
    text('Code',left,y,true);text('Qty',qtyX,y,true,10,'right');
    text('Rate (Rs.)',rateX,y,true,9,'right');text('Amount (Rs.)',right,y,true,9,'right');
    y+=3;doc.line(left,y,right,y);y+=6;
  }
  tableHeader();
  items.forEach(item=>{
    doc.setFontSize(10);
    const codes=doc.splitTextToSize(item.Barcode||'',qtyX-left-8);
    const rowHeight=Math.max(7,codes.length*4+3);
    if(y+rowHeight>height-15){doc.addPage();y=15;text('SS BRANDED OUTLET',width/2,y,true,13,'center');y+=10;tableHeader();}
    text(codes.join('\n'),left,y);text(item.Qty,qtyX,y,false,10,'right');
    text(Number(item.Rate||0).toFixed(2),rateX,y,false,10,'right');
    text(Number(item.LineTotal||0).toFixed(2),right,y,false,10,'right');
    y+=rowHeight;doc.line(left,y-3,right,y-3);
  });
  const payments=data.payments||[];
  const paymentLines=payments.flatMap(payment=>doc.splitTextToSize('Payment Mode: '+String(payment.PaymentMode||''),right-left));
  const summaryHeight=48+paymentLines.length*5;
  if(y+summaryHeight>height-10){doc.addPage();y=18;}
  y+=5;
  const labelX=right-36;
  function total(label,value,bold=false){text(label,labelX,y,bold,10,'right');text(Number(value||0).toFixed(2),right,y,bold,10,'right');y+=6;}
  total('Subtotal:',sale.SubTotal);
  if(Number(sale.LineDiscount||0))total('Item Discount:',sale.LineDiscount);
  total('Bill Discount:',sale.BillDiscount);
  doc.line(left,y-2,right,y-2);y+=4;
  total('NET AMOUNT:',sale.NetAmount,true);
  doc.line(left,y-2,right,y-2);y+=4;
  text('Amount is inclusive of GST.',right,y,false,8,'right');y+=9;
  paymentLines.forEach(line=>{text(line,left,y,false,9);y+=5;});
  y+=8;text('Thank you! Visit again.',width/2,y,false,10,'center');
  doc.save(String(sale.BillNo||'Bill').replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf');
}

function buildReceiptHtml(data) {
  const sale=data.sale||{},items=groupReceiptItems(data.items||[]);
  const itemRows=items.map(item=>`<tr><td>${esc(item.Barcode)}</td><td class="num">${esc(item.Qty)}</td><td class="num">${Number(item.Rate||0).toFixed(2)}</td><td class="num">${Number(item.LineTotal||0).toFixed(2)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.BillNo||'Bill')}</title><style>
  @page {size:A4 portrait;margin:10mm;}
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:10pt;}
  .receipt{max-width:190mm;margin:auto}h1{text-align:center;font-size:17pt;margin:3mm 0 9mm;}
  .details{display:grid;grid-template-columns:1fr 1fr;column-gap:6mm;row-gap:3mm;margin-bottom:7mm;font-size:9pt;}
  .details>div{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;}
  th,td{padding:3mm 1mm;border-bottom:1px solid #ccc;text-align:left;overflow-wrap:anywhere;}
  th{border-top:1px solid #111;border-bottom:1px solid #111;font-size:9pt;}
  th:first-child{width:35%}th:nth-child(2){width:12%}th:nth-child(3){width:24%}th:nth-child(4){width:29%}
  .num{text-align:right}thead{display:table-header-group}tr{break-inside:avoid;}
  .summary{break-inside:avoid;margin-top:5mm}.total{display:flex;justify-content:flex-end;gap:4mm;margin:2.5mm 0}.total span:last-child{width:30mm;text-align:right;}
  .net{font-size:12pt;font-weight:bold;border-top:1px solid #111;border-bottom:1px solid #111;padding:3mm 0;}
  .gst{text-align:right;font-size:8pt;margin:2mm 0 6mm}.payment{font-size:9pt;margin-top:2mm}.thanks{text-align:center;margin-top:12mm;}
  @media screen{body{background:#eee;padding:10mm}.receipt{background:white;padding:0;min-height:277mm}}
  </style></head><body><main class="receipt"><h1>SS BRANDED OUTLET</h1>
  <div class="details"><div><strong>Date:</strong> ${esc(fmtDate(sale.SaleDate))}</div><div><strong>Customer Name:</strong> ${esc(sale.CustomerName||'Walk-in')}</div><div><strong>Bill No:</strong> ${esc(sale.BillNo||'')}</div><div><strong>Mobile:</strong> ${esc(sale.CustomerMobile||'-')}</div></div>
  <table><thead><tr><th>Code</th><th class="num">Qty</th><th class="num">Rate (Rs.)</th><th class="num">Amount (Rs.)</th></tr></thead><tbody>${itemRows}</tbody></table>
  <section class="summary"><div class="total"><span>Subtotal:</span><span>${money(sale.SubTotal)}</span></div>
  ${Number(sale.LineDiscount||0)?`<div class="total"><span>Item Discount:</span><span>${money(sale.LineDiscount)}</span></div>`:''}
  <div class="total"><span>Bill Discount:</span><span>${money(sale.BillDiscount)}</span></div>
  <div class="total net"><span>NET AMOUNT:</span><span>${money(sale.NetAmount)}</span></div>
  <div class="gst">Amount is inclusive of GST.</div>
  ${(data.payments||[]).map(payment=>`<div class="payment"><strong>Payment Mode:</strong> ${esc(payment.PaymentMode)}</div>`).join('')}
  <div class="thanks">Thank you! Visit again.</div></section></main></body></html>`;
}

function printReceiptData(

  data,

  existingWindow

) {

  const w =

    existingWindow ||

    window.open(

      '',

      '_blank',

      'width=520,height=760'

    );



  if (!w) {

    msg(

      'Popup blocked. Allow popups for automatic printing.',

      'err'

    );



    return;

  }



  w.document.open();



  w.document.write(

    buildReceiptHtml(data)

  );



  w.document.close();



  w.focus();



  /*

    The browser's normal print dialog opens automatically.

    Web pages cannot safely bypass the operating-system

    print dialog and force a physical printer silently.

  */

  setTimeout(() => {

    w.print();

  }, 350);

}





function printLastBill() {

  if (!LAST_SALE_ID) return;



  printSale(

    LAST_SALE_ID

  );

}





function printSale(saleId) {

  const w =

    window.open(

      '',

      '_blank',

      'width=520,height=760'

    );



  if (w) {

    w.document.write(`

      <!doctype html>

      <html>

      <body style="font-family:Arial,sans-serif;padding:24px;text-align:center">

        <h3>Preparing bill...</h3>

      </body>

      </html>

    `);



    w.document.close();

  }



  google.script.run

    .withSuccessHandler(data => {

      printReceiptData(

        data,

        w

      );

    })

    .withFailureHandler(

      e => {

        if (

          w &&

          !w.closed

        ) {

          w.close();

        }



        msg(

          e.message || e,

          'err'

        );

      }

    )

    .getSaleReceipt(

      saleId

    );

}
