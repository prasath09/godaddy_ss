let POS_CART = [];

let LAST_SALE_ID = '';

let AUTO_PRINT_WINDOW = null;

let SCAN_BUSY = false;



window.onload = () => {

  setToday('pos_date');

  renderPOSCart();

  renderPaymentBalance();

  loadLatestBillForPrint();

  focusScanner();

};



function loadLatestBillForPrint() {
  const printBtn = document.getElementById('print_last_bill');
  if (!printBtn) return;

  google.script.run
    .withSuccessHandler(res => {
      if (res && res.SaleID) {
        LAST_SALE_ID = Number(res.SaleID);
        printBtn.disabled = false;
        printBtn.textContent = res.BillNo ? ('Print Last Bill - ' + res.BillNo) : 'Print Last Bill';
      } else {
        LAST_SALE_ID = '';
        printBtn.disabled = true;
        printBtn.textContent = 'Print Last Bill';
      }
    })
    .withFailureHandler(() => {
      // Billing must remain usable even if the last-bill lookup fails.
      LAST_SALE_ID = '';
      printBtn.disabled = true;
      printBtn.textContent = 'Print Last Bill';
    })
    .getLatestSaleForPrint();
}


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



function fmtBarcodeDate(value) {
  if (!value) return '';
  const raw=String(value).slice(0,10);
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtDate(value);
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
  const input = document.getElementById('pos_search');
  input.disabled = true;
  const status = document.getElementById('catalog_status');
  status.textContent = 'Finding ' + raw + '...';
  msg('Checking barcode / dress-code availability...', '');

  google.script.run
    .withSuccessHandler(res => {
      SCAN_BUSY = false;
      input.disabled = false;
      input.value = '';

      if (!res || !res.ok || !res.item) {
        status.textContent = 'Ready to scan';
        msg((res && res.message) || 'Barcode / Dress Code not found.', 'err');
        focusScanner();
        return;
      }

      addToPOSCart(res.item, res.scannedBarcode);

      if (res.lookupType === 'DRESS_CODE_QTY') {
        msg(
          'Code ' + res.scannedBarcode + ' · Available Qty ' +
          Number(res.item.AvailableQty || 0) +
          '. Enter the required quantity in Current Bill.',
          'ok'
        );
      } else if (res.lookupType === 'PRICE_BARCODE') {
        msg('Price ' + money(res.item.SellingPrice) + ' · Size ' + (res.item.Size || '-') + ' · Date ' + fmtBarcodeDate(res.item.BarcodeDate) + ' added.','ok');
      } else if (res.lookupType === 'TIER') {
        msg(
          res.scannedBarcode + ' matched. Allocated piece ' +
          res.allocatedPieceBarcode + '.',
          'ok'
        );
      }

      status.textContent = 'Ready to scan';
    })
    .withFailureHandler(e => {
      SCAN_BUSY = false;
      input.disabled = false;
      input.value = '';
      status.textContent = 'Ready to scan';
      msg(e.message || e, 'err');
      focusScanner();
    })
    .getBillingItemByBarcode(raw, getAllocatedPieceBarcodes());
}





function addToPOSCart(info, scannedBarcode) {
  if (!info || !info.Barcode || Number(info.Available || 0) <= 0) {
    return msg('No stock available for this barcode.', 'err');
  }

  const sourceType = info.SourceType || 'STOCK';

  // Missing-sticker / code-only billing never chooses an individual serial.
  if (sourceType === 'DRESS_CODE_QTY') {
    const dressCode = String(info.DisplayCode || info.Barcode || scannedBarcode || '').toUpperCase();
    const availableQty = Number(info.AvailableQty || info.Available || 0);
    let line = POS_CART.find(x => x.SourceType === 'DRESS_CODE_QTY' && String(x.DressCode || '') === dressCode);

    if (line) {
      if (Number(line.Qty || 0) + 1 > availableQty) {
        return msg('Code ' + dressCode + ' has only ' + availableQty + ' effective item(s) available.', 'err');
      }
      line.Qty = Number(line.Qty || 0) + 1;
      line.AvailableQty = availableQty;
    } else {
      line = {
        GroupKey: 'DC|' + dressCode,
        SourceType: 'DRESS_CODE_QTY',
        DressCode: dressCode,
        DisplayCode: dressCode,
        SourceBarcode: dressCode,
        PriceTierID: info.PriceTierID || '',
        TierCode: info.TierCode || '',
        TierName: info.TierName || '',
        VendorName: info.VendorName || '',
        CategoryName: info.CategoryName || '',
        MRP: Number(info.MRP || 0),
        Pieces: [],
        Qty: 1,
        AvailableQty: availableQty,
        Rate: Number(info.SellingPrice || 0),
        DiscountPct: 0
      };
      POS_CART.push(line);
    }

    msg('Code ' + dressCode + ' added. Effective available Qty: ' + availableQty + '.', 'ok');
    renderPOSCart();
    focusScanner();
    return;
  }

  const pieceBarcode = String(info.Barcode);
  if (getAllocatedPieceBarcodes().some(x => String(x) === pieceBarcode)) {
    return msg('This exact physical piece is already in the bill: ' + pieceBarcode, 'err');
  }

  const groupKey = sourceType === 'PRICE_BARCODE'
    ? ['PB', Number(info.SellingPrice||0), String(info.Size||''), String(info.BarcodeDate||'')].join('|')
    : String(info.PriceTierID || '');

  let line = POS_CART.find(x => String(x.GroupKey || x.PriceTierID || '') === groupKey && x.SourceType !== 'DRESS_CODE_QTY');

  if (line) {
    line.Pieces.push(pieceBarcode);
    line.Qty = line.Pieces.length;
  } else {
    line = {
      GroupKey: groupKey,
      SourceType: sourceType,
      DisplayCode: info.DisplayCode || info.TierCode || '',
      Size: info.Size || '',
      BarcodeDate: info.BarcodeDate || '',
      SourceBarcode: info.DisplayCode || info.TierCode || scannedBarcode || info.Barcode,
      PriceTierID: info.PriceTierID || '',
      TierCode: info.TierCode || '',
      TierName: info.TierName || '',
      VendorName: info.VendorName || '',
      CategoryName: info.CategoryName || '',
      MRP: Number(info.MRP || 0),
      Pieces: [pieceBarcode],
      Qty: 1,
      Rate: Number(info.SellingPrice || 0),
      DiscountPct: 0
    };
    POS_CART.push(line);
  }

  msg(pieceBarcode + ' added.', 'ok');
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
              const isPriceBarcode = x.SourceType === 'PRICE_BARCODE';
              const isDressCodeQty = x.SourceType === 'DRESS_CODE_QTY';
              const displayCode = isDressCodeQty
                ? (x.DressCode || x.DisplayCode || x.SourceBarcode || '')
                : (isPriceBarcode
                  ? (x.DisplayCode || x.SourceBarcode || '')
                  : ((x.Pieces || []).join(', ') || x.SourceBarcode || x.TierCode || ''));
              const detailHtml = isDressCodeQty
                ? `<span class="muted"><strong>Missing sticker billing</strong> · Available Qty: ${Number(x.AvailableQty || 0)} · ${esc(x.CategoryName || '')}</span>`
                : (isPriceBarcode
                  ? `<span class="muted"><strong>Price:</strong> ${esc(money(x.Rate))} · <strong>Size:</strong> ${esc(x.Size || '-')} · <strong>Barcode Date:</strong> ${esc(fmtBarcodeDate(x.BarcodeDate))}</span>`
                  : `<span class="muted">${esc(x.VendorName || '')} · ${esc(x.CategoryName || '')} · ${esc(x.TierName || '')}</span><br><span class="muted" style="font-size:10px">Pieces: ${esc(compactPieceList(x.Pieces))}</span>`);


              return `
                <tr>
                  <td>
                    <strong>${esc(displayCode)}</strong>
                    <br>
                    ${detailHtml}
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
  const row = POS_CART[index];
  if (!row) return;

  const target = Number(value);
  if (!Number.isInteger(target) || target <= 0) {
    msg('Quantity must be a whole number greater than zero.', 'err');
    renderPOSCart();
    return;
  }

  if (row.SourceType === 'DRESS_CODE_QTY') {
    const available = Number(row.AvailableQty || 0);
    if (target > available) {
      msg('Insufficient stock for Code ' + (row.DressCode || row.DisplayCode || '') + '. Available Qty: ' + available + '.', 'err');
      renderPOSCart();
      return;
    }
    row.Qty = target;
    msg('Code ' + (row.DressCode || row.DisplayCode || '') + ' quantity set to ' + target + ' of ' + available + ' available.', 'ok');
    renderPOSCart();
    focusScanner();
    return;
  }

  const current = Array.isArray(row.Pieces) ? row.Pieces.length : 0;
  if (target === current) {
    row.Qty = target;
    renderPOSCart();
    return;
  }

  if (row.SourceType === 'PRICE_BARCODE' && target > current) {
    msg('Scan each unique price barcode to increase quantity.','err');
    row.Qty = current;
    renderPOSCart();
    return;
  }

  if (target < current) {
    row.Pieces = row.Pieces.slice(0, target);
    row.Qty = target;
    msg('Quantity updated to ' + target + '.', 'ok');
    renderPOSCart();
    focusScanner();
    return;
  }

  const needed = target - current;
  const lookupCode = row.PriceTierID ? 'PRICE_TIER_ID:'+row.PriceTierID : (row.TierCode || row.SourceBarcode);
  if (!lookupCode) {
    msg('Cannot increase quantity because the Tier Code is unavailable.', 'err');
    renderPOSCart();
    return;
  }

  msg('Adding ' + needed + ' more piece(s)...', '');
  allocateMorePieces(index, lookupCode, needed);
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
        POS_CART.flatMap(line => {
          if (line.SourceType === 'DRESS_CODE_QTY') {
            return [{
              SourceType: 'DRESS_CODE_QTY',
              DressCode: line.DressCode || line.DisplayCode || line.SourceBarcode,
              Barcode: line.DressCode || line.DisplayCode || line.SourceBarcode,
              Qty: Number(line.Qty || 0),
              Rate: Number(line.Rate || 0),
              DiscountPct: Number(line.DiscountPct || 0)
            }];
          }
          return (line.Pieces || []).map(pieceBarcode => ({
            Barcode: pieceBarcode,
            Qty: 1,
            Rate: Number(line.Rate || 0),
            DiscountPct: Number(line.DiscountPct || 0)
          }));
        }),

      Payments:

        payments

    });

}





function downloadReceiptPDF(data) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF library not loaded.');

  const sale = data.sale || {};
  const items = data.items || [];
  const payments = data.payments || [];
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 14;
  const right = pageWidth - 14;
  const customerX = 111;
  const qtyX = 118;
  const rateX = 150;
  const totalLabelX = 145;
  let y = 16;

  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  doc.text('SS BRANDED OUTLET', pageWidth / 2, y, {align:'center'});

  y += 6;
  doc.setFont('helvetica','normal');
  doc.setFontSize(10);
  doc.text('GSTIN: 33NGTPS6785L1ZX', pageWidth / 2, y, {align:'center'});

  y += 10;
  doc.line(left, y, right, y);
  y += 7;

  doc.text('Date: ' + fmtDate(sale.SaleDate), left, y);
  doc.text('Customer Name: ' + String(sale.CustomerName || 'Walk-in'), customerX, y);
  y += 6;
  doc.text('Bill No: ' + String(sale.BillNo || ''), left, y);
  doc.text('Mobile: ' + String(sale.CustomerMobile || ''), customerX, y);

  y += 9;
  doc.setFont('helvetica','bold');
  doc.text('Item', left, y);
  doc.text('Qty', qtyX, y, {align:'right'});
  doc.text('Rate', rateX, y, {align:'right'});
  doc.text('Amount', right, y, {align:'right'});
  y += 3;
  doc.line(left, y, right, y);
  y += 6;
  doc.setFont('helvetica','normal');

  items.forEach(i => {
    if (y > 260) { doc.addPage(); y = 18; }
    const code = String(i.DisplayCode || i.Barcode || '').trim();
    const category = String(i.CategoryName || '').trim();
    const itemName = category && code ? category + '/' + code : (code || category || 'ITEM');
    const itemLines = doc.splitTextToSize(itemName, 82);
    doc.text(itemLines, left, y);
    doc.text(String(i.Qty || 1), qtyX, y, {align:'right'});
    doc.text(Number(i.Rate || 0).toFixed(2), rateX, y, {align:'right'});
    doc.text(Number(i.LineTotal || 0).toFixed(2), right, y, {align:'right'});
    y += Math.max(itemLines.length * 5, 5) + 2;
  });

  y += 2;
  doc.line(left, y, right, y);
  y += 7;
  doc.text('Subtotal:', totalLabelX, y, {align:'right'});
  doc.text(Number(sale.SubTotal || 0).toFixed(2), right, y, {align:'right'});
  y += 5;
  doc.text('Item Discount:', totalLabelX, y, {align:'right'});
  doc.text(Number(sale.LineDiscount || 0).toFixed(2), right, y, {align:'right'});
  y += 5;
  doc.text('Bill Discount:', totalLabelX, y, {align:'right'});
  doc.text(Number(sale.BillDiscount || 0).toFixed(2), right, y, {align:'right'});

  y += 7;
  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text('Net Amount:', totalLabelX, y, {align:'right'});
  doc.text('Rs. ' + Number(sale.NetAmount || 0).toFixed(2), right, y, {align:'right'});
  y += 6;
  doc.setFontSize(10);
  doc.text('Inclusive of GST', right, y, {align:'right'});

  y += 11;
  doc.setFont('helvetica','normal');
  doc.setFontSize(10);
  doc.text('Payment:', left, y);
  y += 5;
  payments.forEach(p => {
    let line = String(p.PaymentMode || '') + ': Rs. ' + Number(p.Amount || 0).toFixed(2);
    if (p.ReferenceNo) line += ' (' + String(p.ReferenceNo) + ')';
    doc.text(line, left, y);
    y += 5;
  });

  y += 7;
  doc.text('Thank you', pageWidth / 2, y, {align:'center'});
  const safeBillNo = String(sale.BillNo || 'Bill').replace(/[^A-Za-z0-9_-]/g,'_');
  doc.save(safeBillNo + '.pdf');
}


function buildReceiptHtml(data) {
  const sale = data.sale || {};
  const items = data.items || [];
  const payments = data.payments || [];

  const itemRows = items.map(i => {
    const code = String(i.DisplayCode || i.Barcode || '').trim();
    const category = String(i.CategoryName || '').trim();
    const itemName = category && code ? category + '/' + code : (code || category || 'ITEM');
    return `
      <tr>
        <td>${esc(itemName)}</td>
        <td class="num">${Number(i.Qty || 1)}</td>
        <td class="num">${Number(i.Rate || 0).toFixed(2)}</td>
        <td class="num">${Number(i.LineTotal || 0).toFixed(2)}</td>
      </tr>`;
  }).join('');

  const paymentRows = payments.map(p => `
    <div>${esc(p.PaymentMode)}: Rs. ${Number(p.Amount || 0).toFixed(2)}${p.ReferenceNo ? ' (' + esc(p.ReferenceNo) + ')' : ''}</div>
  `).join('');

  return `
    <!doctype html>
    <html>
    <head>
      <title>${esc(sale.BillNo || 'Bill')}</title>
      <style>
        @page{size:A4 portrait;margin:14mm}
        *{box-sizing:border-box}
        body{font-family:Arial,sans-serif;margin:0;color:#111;font-size:13px}
        .header{text-align:center}
        .header h2{margin:0 0 5px;font-size:20px}
        .gstin{font-size:13px}
        .divider{border:0;border-top:1px solid #111;margin:14px 0 11px}
        .details{display:grid;grid-template-columns:1fr 1fr;column-gap:55px;row-gap:8px;margin-bottom:18px}
        table{width:100%;border-collapse:collapse}
        th,td{padding:7px 0;text-align:left;vertical-align:top}
        thead tr{border-bottom:1px solid #111}
        tbody tr:last-child{border-bottom:1px solid #111}
        th.num,td.num{text-align:right}
        .totals{margin-top:10px;margin-left:auto;width:48%;line-height:1.75}
        .total-row{display:flex;justify-content:space-between;gap:20px}
        .net{font-size:16px;font-weight:700;margin-top:2px}
        .gst-note{text-align:right;font-weight:700;margin-top:1px}
        .payment{margin-top:16px;line-height:1.6}
        .thanks{text-align:center;margin-top:24px}
        @media print{button{display:none!important}}
      </style>
    </head>
    <body>
      <div class="header">
        <h2>SS BRANDED OUTLET</h2>
        <div class="gstin">GSTIN: 33NGTPS6785L1ZX</div>
      </div>
      <hr class="divider">
      <div class="details">
        <div>Date: ${esc(fmtDate(sale.SaleDate))}</div>
        <div>Customer Name: ${esc(sale.CustomerName || 'Walk-in')}</div>
        <div>Bill No: ${esc(sale.BillNo || '')}</div>
        <div>Mobile: ${esc(sale.CustomerMobile || '')}</div>
      </div>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="totals">
        <div class="total-row"><span>Subtotal:</span><span>${Number(sale.SubTotal || 0).toFixed(2)}</span></div>
        <div class="total-row"><span>Item Discount:</span><span>${Number(sale.LineDiscount || 0).toFixed(2)}</span></div>
        <div class="total-row"><span>Bill Discount:</span><span>${Number(sale.BillDiscount || 0).toFixed(2)}</span></div>
        <div class="total-row net"><span>Net Amount:</span><span>Rs. ${Number(sale.NetAmount || 0).toFixed(2)}</span></div>
        <div class="gst-note">Inclusive of GST</div>
      </div>
      <div class="payment"><div>Payment:</div>${paymentRows}</div>
      <div class="thanks">Thank you</div>
    </body>
    </html>`;
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
  if (LAST_SALE_ID) {
    printSale(LAST_SALE_ID);
    return;
  }

  msg('Finding the latest completed bill...', '');
  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.SaleID) {
        msg('No completed bill is available to print.', 'err');
        return;
      }
      LAST_SALE_ID = Number(res.SaleID);
      const printBtn = document.getElementById('print_last_bill');
      if (printBtn) {
        printBtn.disabled = false;
        printBtn.textContent = res.BillNo ? ('Print Last Bill - ' + res.BillNo) : 'Print Last Bill';
      }
      printSale(LAST_SALE_ID);
    })
    .withFailureHandler(e => msg(e.message || e, 'err'))
    .getLatestSaleForPrint();
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
