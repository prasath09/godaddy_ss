import "dotenv/config";

import express from "express";

import cors from "cors";

import { pool } from "./db.js";

import { installDatabaseAdmin } from "./database-admin.js";

const app = express();

const PORT = Number(process.env.PORT || 3000);

const LOCATION_ID = String(process.env.LOCATION_ID || "LOC001").trim() || "LOC001";

const LOCATION_NAME = String(process.env.LOCATION_NAME || "Main Outlet").trim() || "Main Outlet";

app.disable("x-powered-by");

app.use(cors());

app.use(express.json({ limit: "2mb" }));

const clean = (v) => String(v ?? "").trim();

const upper = (v) => clean(v).toUpperCase();

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

function positive(v, label) {
  const n = Number(v);

  if (!Number.isFinite(n) || n <= 0)
    throw new Error(label + " must be greater than zero.");

  return round2(n);
}

function nonNegative(v, label) {
  const n = Number(v || 0);

  if (!Number.isFinite(n) || n < 0)
    throw new Error(label + " cannot be negative.");

  return round2(n);
}

function active(v) {
  return Number(v) === 1;
}

function vendorObj(r) {
  return {
    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    Mobile: r.mobile || "",

    GSTIN: r.gstin || "",

    Address: r.address || "",

    Active: !!r.active,

    CreatedAt: r.created_at,

    UpdatedAt: r.updated_at,
  };
}

function categoryObj(r) {
  return {
    CategoryID: r.category_id,

    CategoryName: r.category_name,

    Active: !!r.active,

    CreatedAt: r.created_at,

    UpdatedAt: r.updated_at,
  };
}

function materialObj(r) {
  return {
    MaterialID: r.material_id,

    MaterialName: r.material_name,

    Active: !!r.active,

    CreatedAt: r.created_at,

    UpdatedAt: r.updated_at,
  };
}

function tierObj(r) {
  return {
    PriceTierID: r.price_tier_id,

    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    CategoryID: r.category_id,

    CategoryName: r.category_name,

    TierName: r.tier_code,

    PurchasePrice: Number(r.purchase_price || 0),

    SellingPrice: Number(r.selling_price || 0),

    MRP: Number(r.mrp || 0),

    Barcode: r.barcode,

    Active: !!r.active,

    CreatedAt: r.created_at,

    UpdatedAt: r.updated_at,
  };
}

function inventoryObj(r) {
  return {
    PieceBarcode: r.piece_barcode,

    TierCode: r.tier_code,

    BatchNo: r.batch_no,

    PieceSerial: r.piece_serial,

    PurchaseID: r.purchase_id,

    PurchaseItemID: r.purchase_item_id,

    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    CategoryID: r.category_id,

    CategoryName: r.category_name,

    PriceTierID: r.price_tier_id,

    TierName: r.tier_code,

    PurchasePrice: Number(r.purchase_price || 0),

    SellingPrice: Number(r.selling_price || 0),

    MRP: Number(r.mrp || 0),

    Material: r.material || "",

    Design: r.design || "",

    Colour: r.colour || "",

    Size: r.size || "",

    Remarks: r.remarks || "",

    LocationID: r.location_id,

    LocationName: LOCATION_NAME,

    Status: r.status,

    SoldSaleID: r.sold_sale_id || "",

    SoldBillNo: r.sold_bill_no || "",

    SoldAt: r.sold_at || "",

    CreatedAt: r.created_at,
  };
}

function billingItem(r) {
  return {
    Barcode: r.piece_barcode,

    PieceBarcode: r.piece_barcode,

    TierCode: r.tier_code,

    BatchNo: r.batch_no,

    PieceSerial: r.piece_serial,

    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    CategoryID: r.category_id,

    CategoryName: r.category_name,

    PriceTierID: r.price_tier_id,

    TierName: r.tier_code,

    SellingPrice: Number(r.selling_price || 0),

    MRP: Number(r.mrp || 0),

    Available: 1,
  };
}

async function joinedTierById(conn, id) {
  const [rows] = await conn.execute(
    `

    SELECT t.*,v.vendor_name,c.category_name

    FROM price_tiers t

    JOIN vendors v ON v.vendor_id=t.vendor_id

    JOIN categories c ON c.category_id=t.category_id

    WHERE t.price_tier_id=? LIMIT 1`,

    [id],
  );

  return rows[0] || null;
}

async function joinedUnitByBarcode(conn, barcode, lock = false) {
  const [rows] = await conn.execute(
    `

    SELECT u.*,v.vendor_name,c.category_name

    FROM inventory_units u

    JOIN vendors v ON v.vendor_id=u.vendor_id

    JOIN categories c ON c.category_id=u.category_id

    WHERE UPPER(u.piece_barcode)=?

    ${lock ? "FOR UPDATE" : ""}

  `,

    [upper(barcode)],
  );

  return rows[0] || null;
}

async function nextBatchNo(conn, priceTierId) {
  const [rows] = await conn.execute(
    `

    SELECT batch_no FROM purchase_batches

    WHERE price_tier_id=?

    ORDER BY batch_id DESC LIMIT 1`,

    [priceTierId],
  );

  let n = 0;

  if (rows.length) {
    const m = String(rows[0].batch_no || "").match(/^B(\d+)$/i);

    if (m) n = Number(m[1] || 0);
  }

  return "B" + String(n + 1).padStart(3, "0");
}

function makePieceBarcode(tierCode, batchNo, serial) {
  return `${upper(tierCode)}-${upper(batchNo)}-${String(serial).padStart(3, "0")}`;
}

async function addVendor(data) {
  const name = clean(data?.VendorName);

  if (!name) throw new Error("Vendor Name is required.");

  const [old] = await pool.execute(
    `SELECT * FROM vendors WHERE LOWER(vendor_name)=LOWER(?) LIMIT 1`,

    [name],
  );

  if (old.length)
    return {
      ok: true,

      existed: true,

      id: old[0].vendor_id,

      message: "Vendor already exists.",
    };

  const [r] = await pool.execute(
    `INSERT INTO vendors(vendor_name,mobile,gstin,address,active) VALUES (?,?,?,?,1)`,

    [
      name,

      clean(data?.Mobile) || null,

      upper(data?.GSTIN) || null,

      clean(data?.Address) || null,
    ],
  );

  return { ok: true, existed: false, id: r.insertId, message: "Vendor saved." };
}

async function addCategory(data) {
  const name = clean(data?.CategoryName);

  if (!name) throw new Error("Category Name is required.");

  const [old] = await pool.execute(
    `SELECT * FROM categories WHERE LOWER(category_name)=LOWER(?) LIMIT 1`,

    [name],
  );

  if (old.length)
    return {
      ok: true,

      existed: true,

      id: old[0].category_id,

      message: "Category already exists.",
    };

  const [r] = await pool.execute(
    `INSERT INTO categories(category_name,active) VALUES (?,1)`,

    [name],
  );

  return {
    ok: true,

    existed: false,

    id: r.insertId,

    message: "Category saved.",
  };
}

async function assignVendorCategory(data) {
  const vendorId = Number(data?.VendorID),
    categoryId = Number(data?.CategoryID);

  if (!vendorId) throw new Error("Vendor is required.");

  if (!categoryId) throw new Error("Category is required.");

  const [[v]] = await pool.execute(
    `SELECT vendor_id FROM vendors WHERE vendor_id=?`,

    [vendorId],
  );

  const [[c]] = await pool.execute(
    `SELECT category_id FROM categories WHERE category_id=?`,

    [categoryId],
  );

  if (!v) throw new Error("Vendor not found.");

  if (!c) throw new Error("Category not found.");

  const [old] = await pool.execute(
    `SELECT vendor_category_id FROM vendor_categories WHERE vendor_id=? AND category_id=? LIMIT 1`,

    [vendorId, categoryId],
  );

  if (old.length)
    return {
      ok: true,

      existed: true,

      id: old[0].vendor_category_id,

      message: "This category is already assigned to the vendor.",
    };

  const [r] = await pool.execute(
    `INSERT INTO vendor_categories(vendor_id,category_id,active) VALUES (?,?,1)`,

    [vendorId, categoryId],
  );

  return {
    ok: true,

    existed: false,

    id: r.insertId,

    message: "Category assigned to vendor.",
  };
}

async function addMaterial(data) {
  const name = clean(data?.MaterialName);

  if (!name) throw new Error("Material Name is required.");

  const [old] = await pool.execute(
    `SELECT material_id FROM materials WHERE LOWER(material_name)=LOWER(?) LIMIT 1`,

    [name],
  );

  if (old.length)
    return {
      ok: true,

      existed: true,

      id: old[0].material_id,

      message: "Material already exists.",
    };

  const [r] = await pool.execute(
    `INSERT INTO materials(material_name,active) VALUES (?,1)`,

    [name],
  );

  return {
    ok: true,

    existed: false,

    id: r.insertId,

    message: "Material saved.",
  };
}

async function addOrReusePriceTier(data) {
  const vendorId = Number(data?.VendorID),
    categoryId = Number(data?.CategoryID);

  if (!vendorId) throw new Error("Vendor is required.");

  if (!categoryId) throw new Error("Category is required.");

  const purchasePrice = positive(data?.PurchasePrice, "Purchase Price");

  const sellingPrice = positive(data?.SellingPrice, "Selling Price");

  const mrp = clean(data?.MRP) === "" ? 0 : nonNegative(data?.MRP, "MRP");

  const tierCode = upper(data?.TierName);

  if (!tierCode) throw new Error("Tier Code is required. Example: JT1, JT2.");

  if (!/^[A-Z0-9-]+$/.test(tierCode))
    throw new Error("Tier Code can contain only A-Z, 0-9 and hyphen.");

  if (mrp > 0 && sellingPrice > mrp) throw new Error("Selling Price cannot exceed MRP.");

  const [[v]] = await pool.execute(
    `SELECT * FROM vendors WHERE vendor_id=? AND active=1`,

    [vendorId],
  );

  const [[c]] = await pool.execute(
    `SELECT * FROM categories WHERE category_id=? AND active=1`,

    [categoryId],
  );

  if (!v) throw new Error("Vendor not found.");

  if (!c) throw new Error("Category not found.");

  const [map] = await pool.execute(
    `SELECT 1 FROM vendor_categories WHERE vendor_id=? AND category_id=? AND active=1 LIMIT 1`,

    [vendorId, categoryId],
  );

  if (!map.length)
    throw new Error("This category is not assigned to the selected vendor.");

  const [same] = await pool.execute(
    `SELECT t.*,v.vendor_name,c.category_name FROM price_tiers t JOIN vendors v ON v.vendor_id=t.vendor_id JOIN categories c ON c.category_id=t.category_id WHERE UPPER(t.tier_code)=? OR UPPER(t.barcode)=? LIMIT 1`,

    [tierCode, tierCode],
  );

  if (same.length) {
    const r = same[0];

    const exact =
      Number(r.vendor_id) === vendorId &&
      Number(r.category_id) === categoryId &&
      Number(r.purchase_price) === purchasePrice &&
      Number(r.selling_price) === sellingPrice &&
      Number(r.mrp) === mrp;

    if (!exact)
      throw new Error(
        `Tier Code ${tierCode} is already used for another price tier. Use a unique Tier Code.`,
      );

    return {
      ok: true,

      reused: true,

      priceTier: tierObj(r),

      message: "Existing Price Tier reused. Tier Code: " + tierCode,
    };
  }

  const [r] = await pool.execute(
    `

    INSERT INTO price_tiers(vendor_id,category_id,tier_code,purchase_price,selling_price,mrp,barcode,active)

    VALUES (?,?,?,?,?,?,?,1)`,

    [
      vendorId,

      categoryId,

      tierCode,

      purchasePrice,

      sellingPrice,

      mrp,

      tierCode,
    ],
  );

  const row = await joinedTierById(pool, r.insertId);

  return {
    ok: true,

    reused: false,

    priceTier: tierObj(row),

    message: "New Price Tier created. Tier Code: " + tierCode,
  };
}


let categoryTierSetup;
async function ensureCategoryPriceTiers(){
  if(!categoryTierSetup) categoryTierSetup=pool.query(`CREATE TABLE IF NOT EXISTS category_price_tiers (
  category_price_tier_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  tier_code VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  selling_price DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (category_price_tier_id),
  UNIQUE KEY uq_category_tier_code (tier_code),
  KEY idx_category_price_tiers_category (category_id),
  CONSTRAINT fk_category_price_tiers_category FOREIGN KEY (category_id) REFERENCES categories(category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`).catch(e=>{categoryTierSetup=null;throw e;});
  await categoryTierSetup;
}
async function getCategoryPriceTiers(){
  await ensureCategoryPriceTiers();
  const [rows]=await pool.query('SELECT category_price_tier_id AS CategoryPriceTierID,category_id AS CategoryID,tier_code AS TierCode,selling_price AS SellingPrice FROM category_price_tiers ORDER BY category_id,selling_price,tier_code');
  return rows;
}
async function saveCategoryPriceTiers(data){
  const categoryId=Number(data?.CategoryID);
  if(!Number.isSafeInteger(categoryId)||categoryId<=0)throw Error('Select a category.');
  if(!Array.isArray(data?.Rows)||!data.Rows.length||data.Rows.length>100)throw Error('Enter between 1 and 100 price tiers.');
  const rows=data.Rows.map(r=>{
    const code=upper(r.TierCode),price=Number(r.SellingPrice);
    if(!/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(code))throw Error('Tier Code must use letters, numbers, hyphens or underscores (maximum 50 characters).');
    if(!Number.isFinite(price)||price<=0||price>9999999999.99)throw Error('Enter a valid selling price greater than zero.');
    return {code,price:round2(price)};
  });
  if(new Set(rows.map(r=>r.code)).size!==rows.length)throw Error('Each row needs a different Tier Code.');
  await ensureCategoryPriceTiers();const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [cat]=await conn.execute('SELECT category_id FROM categories WHERE category_id=? AND active=1 FOR UPDATE',[categoryId]);
    if(!cat.length)throw Error('Category not found.');
    for(const row of rows){
      const [old]=await conn.execute('SELECT category_id FROM category_price_tiers WHERE tier_code=? AND category_id<>?',[row.code,categoryId]);
      if(old.length)throw Error('Tier Code '+row.code+' belongs to another category. Use a unique code.');
      const [legacy]=await conn.execute('SELECT category_id,selling_price FROM price_tiers WHERE UPPER(tier_code)=? OR UPPER(barcode)=?',[row.code,row.code]);
      if(legacy.some(r=>Number(r.category_id)!==categoryId||Number(r.selling_price)!==row.price))throw Error('Tier Code '+row.code+' conflicts with an existing stock price tier. Use another code.');
    }
    await conn.execute('DELETE FROM category_price_tiers WHERE category_id=?',[categoryId]);
    for(const row of rows)await conn.execute('INSERT INTO category_price_tiers(category_id,tier_code,selling_price) VALUES (?,?,?)',[categoryId,row.code,row.price]);
    await conn.commit();return {ok:true,message:'Category price tiers saved.'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function getAppData() {
  const categoryPriceTiers=await getCategoryPriceTiers();
  const [vendors] = await pool.query(
    `SELECT * FROM vendors WHERE active=1 ORDER BY vendor_name`,
  );

  const [categories] = await pool.query(
    `SELECT * FROM categories WHERE active=1 ORDER BY category_name`,
  );

  const [materials] = await pool.query(
    `SELECT * FROM materials WHERE active=1 ORDER BY material_name`,
  );

  const [vc] = await pool.query(`

    SELECT vc.*,v.vendor_name,c.category_name

    FROM vendor_categories vc

    JOIN vendors v ON v.vendor_id=vc.vendor_id

    JOIN categories c ON c.category_id=vc.category_id

    WHERE vc.active=1 ORDER BY v.vendor_name,c.category_name`);

  const [tiers] = await pool.query(`

    SELECT t.*,v.vendor_name,c.category_name

    FROM price_tiers t

    JOIN vendors v ON v.vendor_id=t.vendor_id

    JOIN categories c ON c.category_id=t.category_id

    WHERE t.active=1 ORDER BY t.tier_code`);

  const [purchases] = await pool.query(`

    SELECT p.*,v.vendor_name

    FROM purchases p JOIN vendors v ON v.vendor_id=p.vendor_id

    ORDER BY p.purchase_id DESC LIMIT 100`);

  const [sales] = await pool.query(
    `SELECT * FROM sales ORDER BY sale_id DESC LIMIT 100`,
  );

  const [stock] = await pool.query(`

    SELECT t.*,v.vendor_name,c.category_name,

      SUM(CASE WHEN u.status='AVAILABLE' THEN 1 ELSE 0 END) Qty

    FROM price_tiers t

    JOIN vendors v ON v.vendor_id=t.vendor_id

    JOIN categories c ON c.category_id=t.category_id

    LEFT JOIN inventory_units u ON u.price_tier_id=t.price_tier_id

    WHERE t.active=1

    GROUP BY t.price_tier_id

    ORDER BY t.tier_code`);

  const [units] = await pool.query(`

    SELECT u.*,v.vendor_name,c.category_name

    FROM inventory_units u

    JOIN vendors v ON v.vendor_id=u.vendor_id

    JOIN categories c ON c.category_id=u.category_id

    WHERE u.status='AVAILABLE'

    ORDER BY u.inventory_unit_id DESC LIMIT 1000`);

  return {
    location: { LocationID: LOCATION_ID, LocationName: LOCATION_NAME },

    vendors: vendors.map(vendorObj),

    categories: categories.map(categoryObj),

    categoryPriceTiers,

    vendorCategories: vc.map((r) => ({
      VendorCategoryID: r.vendor_category_id,

      VendorID: r.vendor_id,

      VendorName: r.vendor_name,

      CategoryID: r.category_id,

      CategoryName: r.category_name,

      Active: !!r.active,

      CreatedAt: r.created_at,

      UpdatedAt: r.updated_at,
    })),

    materials: materials.map(materialObj),

    priceTiers: tiers.map(tierObj),

    purchases: purchases

      .map((r) => ({
        PurchaseID: r.purchase_id,

        InvoiceNo: r.invoice_no,

        InvoiceDate: r.invoice_date,

        VendorID: r.vendor_id,

        VendorName: r.vendor_name,

        LocationID: r.location_id,

        LocationName: LOCATION_NAME,

        TotalQty: r.total_qty,

        PurchaseValue: Number(r.purchase_value || 0),

        Remarks: r.remarks || "",

        Status: r.status,

        CreatedAt: r.created_at,
      }))

      .reverse(),

    sales: sales

      .map((r) => ({
        SaleID: r.sale_id,

        BillNo: r.bill_no,

        SaleDate: r.sale_date,

        LocationID: r.location_id,

        LocationName: LOCATION_NAME,

        CustomerName: r.customer_name || "",

        CustomerMobile: r.customer_mobile || "",

        SubTotal: Number(r.subtotal || 0),

        LineDiscount: Number(r.line_discount || 0),

        BillDiscount: Number(r.bill_discount || 0),

        NetAmount: Number(r.net_amount || 0),

        PaymentMode: r.payment_mode,

        PaidAmount: Number(r.paid_amount || 0),

        Status: r.status,

        CreatedAt: r.created_at,
      }))

      .reverse(),

    stockSummary: stock.map((r) => ({
      Barcode: r.barcode,

      VendorID: r.vendor_id,

      VendorName: r.vendor_name,

      CategoryID: r.category_id,

      CategoryName: r.category_name,

      PriceTierID: r.price_tier_id,

      TierName: r.tier_code,

      PurchasePrice: Number(r.purchase_price || 0),

      SellingPrice: Number(r.selling_price || 0),

      MRP: Number(r.mrp || 0),

      Qty: Number(r.Qty || 0),
    })),

    billingCatalog: units.map(billingItem),

    availableUnits: units.map(inventoryObj),
  };
}

async function getPurchaseTierByCode(code) {
  code = upper(code);

  if (!code) return { ok: false, message: "Scan or enter a Tier Code." };

  const [rows] = await pool.execute(
    `

    SELECT t.*,v.vendor_name,c.category_name

    FROM price_tiers t

    JOIN vendors v ON v.vendor_id=t.vendor_id

    JOIN categories c ON c.category_id=t.category_id

    WHERE t.active=1 AND (UPPER(t.tier_code)=? OR UPPER(t.barcode)=?)

    LIMIT 1`,

    [code, code],
  );

  if (!rows.length)
    return { ok: false, message: "Tier Code not found or inactive: " + code };

  return { ok: true, tier: tierObj(rows[0]) };
}

async function getRecentPurchasesFast(limit = 20) {
  limit = Math.max(1, Math.min(Number(limit || 20), 100));

  const [rows] = await pool.query(`

    SELECT p.*,v.vendor_name

    FROM purchases p JOIN vendors v ON v.vendor_id=p.vendor_id

    ORDER BY p.purchase_id DESC LIMIT ${limit}`);

  return rows.map((r) => ({
    PurchaseID: r.purchase_id,

    InvoiceNo: r.invoice_no,

    InvoiceDate: r.invoice_date,

    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    LocationID: r.location_id,

    LocationName: LOCATION_NAME,

    TotalQty: r.total_qty,

    PurchaseValue: Number(r.purchase_value || 0),

    Remarks: r.remarks || "",

    Status: r.status,

    CreatedAt: r.created_at,
  }));
}


async function ensureDressSchema(){
  await ensureCategoryPriceTiers();
  await pool.query(`CREATE TABLE IF NOT EXISTS dress_code_sequences (
    dress_base VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
    vendor_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NOT NULL,
    tier_code VARCHAR(50) NOT NULL,
    last_number BIGINT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS automatic_dress_counter (
    counter_id INT NOT NULL PRIMARY KEY,last_number BIGINT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS automatic_purchase_codes (
    code_number BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    dress_code VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
    vendor_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NOT NULL,
    category_price_tier_id BIGINT UNSIGNED NOT NULL,
    price_tier_id BIGINT UNSIGNED NOT NULL,
    purchase_id BIGINT UNSIGNED NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    selling_price DECIMAL(12,2) NOT NULL,
    mrp DECIMAL(12,2) NOT NULL,
    tier_code VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // Existing MySQL 8 tables may have been created with utf8mb4_0900_ai_ci.
  // Normalize this helper table so joins against inventory_units do not fail.
  await pool.query(`ALTER TABLE automatic_purchase_codes
    MODIFY dress_code VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    MODIFY tier_code VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`);
}
async function allocateAutomaticDressCode(conn, vendorId, preset, purchasePrice, mrp, priceTierId){
  // One locked global counter across both counters/outlets; allocation is transactional.
  await conn.execute("INSERT IGNORE INTO automatic_dress_counter(counter_id,last_number) VALUES (1,0)");
  const [[counter]]=await conn.execute('SELECT last_number FROM automatic_dress_counter WHERE counter_id=1 FOR UPDATE');
  const [[existing]]=await conn.execute("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(piece_barcode,'-',1) AS UNSIGNED)),0) AS n FROM inventory_units WHERE piece_barcode REGEXP '^[0-9]+-[0-9]+$'");
  const [[mapped]]=await conn.execute('SELECT COALESCE(MAX(code_number),0) AS n FROM automatic_purchase_codes');
  const number=Math.max(Number(counter.last_number),Number(existing.n),Number(mapped.n))+1;
  if(!Number.isSafeInteger(number))throw Error('Automatic dress code limit exceeded.');
  const code=String(number).padStart(2,'0');
  await conn.execute('UPDATE automatic_dress_counter SET last_number=? WHERE counter_id=1',[number]);
  await conn.execute('INSERT INTO automatic_purchase_codes(code_number,dress_code,vendor_id,category_id,category_price_tier_id,price_tier_id,purchase_price,selling_price,mrp,tier_code) VALUES (?,?,?,?,?,?,?,?,?,?)',[number,code,vendorId,preset.category_id,preset.category_price_tier_id,priceTierId,purchasePrice,preset.selling_price,mrp,preset.tier_code]);
  return code;
}
async function categoryPurchaseTier(conn,vendorId,x){
  const [rows]=await conn.execute('SELECT * FROM category_price_tiers WHERE category_price_tier_id=? AND category_id=?',[Number(x.CategoryPriceTierID),Number(x.CategoryID)]);
  if(!rows.length)throw Error('Selected category tier no longer exists. Reload the page.');
  const preset=rows[0];
  const purchasePrice=positive(x.PurchasePrice,'Purchase Price'),mrp=clean(x.MRP)===''?0:nonNegative(x.MRP,'MRP');
  if(mrp>0 && Number(preset.selling_price)>mrp)throw Error('Selling Price cannot exceed MRP.');
  await conn.execute('INSERT IGNORE INTO automatic_dress_counter(counter_id,last_number) VALUES (1,0)');
  await conn.execute('SELECT last_number FROM automatic_dress_counter WHERE counter_id=1 FOR UPDATE');
  const code=await nextAutoTierCode(conn);
  const t=await findOrCreateImportTier(conn,vendorId,preset.category_id,code,purchasePrice,preset.selling_price,mrp);
  await ensureVendorCategory(conn,vendorId,preset.category_id);
  const dressBase=await allocateAutomaticDressCode(conn,vendorId,preset,purchasePrice,mrp,t.price_tier_id);
  return {...t,tier_code:preset.tier_code,dressBase};
}
async function reserveDressCodes(conn,t,qty){
  await conn.execute('INSERT INTO dress_code_sequences(dress_base,vendor_id,category_id,tier_code,last_number) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE dress_base=VALUES(dress_base)',[t.dressBase,t.vendor_id,t.category_id,t.tier_code]);
  const [[seq]]=await conn.execute('SELECT * FROM dress_code_sequences WHERE dress_base=? FOR UPDATE',[t.dressBase]);
  if(Number(seq.vendor_id)!==Number(t.vendor_id)||Number(seq.category_id)!==Number(t.category_id)||upper(seq.tier_code)!==upper(t.tier_code))throw Error('This dress prefix + tier belongs to another vendor or category. Use another prefix.');
  // Also respect codes already present if a sequence record was removed.
  const [[found]]=await conn.execute("SELECT COALESCE(MAX(CAST(SUBSTRING(piece_barcode,?) AS UNSIGNED)),0) AS n FROM inventory_units WHERE LEFT(piece_barcode,?)=? AND SUBSTRING(piece_barcode,?) REGEXP '^[0-9]+$'",[t.dressBase.length+2,t.dressBase.length+1,t.dressBase+'-',t.dressBase.length+2]);
  const last=Math.max(Number(seq.last_number),Number(found.n));
  if(!Number.isSafeInteger(last+qty))throw Error('Dress-code sequence limit exceeded.');
  await conn.execute('UPDATE dress_code_sequences SET last_number=? WHERE dress_base=?',[last+qty,t.dressBase]);
  return last;
}
async function getPurchaseBarcodesByInvoice(vendorId,invoiceNo){
  let id=Number(vendorId);const invoice=clean(invoiceNo);
  if(!id){const [vendors]=await pool.execute("SELECT vendor_id FROM vendors WHERE LOWER(vendor_name)=LOWER(?) LIMIT 1",[clean(vendorId)]);id=Number(vendors[0]?.vendor_id||0);}
  if(!Number.isSafeInteger(id)||id<=0||!invoice)throw Error('Select Vendor and enter Invoice No.');
  const [rows]=await pool.execute('SELECT purchase_id FROM purchases WHERE vendor_id=? AND LOWER(invoice_no)=LOWER(?) ORDER BY purchase_id DESC LIMIT 2',[id,invoice]);
  if(!rows.length)throw Error('No purchase found for this vendor and invoice.');
  if(rows.length>1)throw Error('Multiple purchases share this invoice. Use Purchase ID on the Purchase page.');
  return {purchaseId:rows[0].purchase_id,pieces:await getSavedPurchaseBarcodes(rows[0].purchase_id)};
}

async function getSavedPurchaseBarcodes(purchaseId){
  const id=Number(purchaseId);if(!Number.isSafeInteger(id)||id<=0)throw Error('Select a purchase.');
  const [rows]=await pool.execute(`SELECT u.*,v.vendor_name,c.category_name FROM inventory_units u JOIN vendors v ON v.vendor_id=u.vendor_id JOIN categories c ON c.category_id=u.category_id WHERE u.purchase_id=? ORDER BY u.inventory_unit_id`,[id]);
  return rows.map(inventoryObj);
}

// Restore the configured outlet after a data clear, without changing existing outlets.
async function ensureConfiguredLocation(conn) {
  if (LOCATION_ID.length > 20 || LOCATION_NAME.length > 100)
    throw new Error("LOCATION_ID or LOCATION_NAME exceeds the database field length.");
  const [existing] = await conn.execute(
    "SELECT location_id,active FROM locations WHERE location_id=? LIMIT 1", [LOCATION_ID]
  );
  if (existing.length) {
    if (!active(existing[0].active)) throw new Error("The configured outlet is inactive. Activate it before saving stock or sales.");
    return;
  }
  // Use columns shared by both supplied database schemas. Preserve any existing row.
  await conn.execute(
    "INSERT INTO locations(location_id,location_name,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE location_id=location_id",
    [LOCATION_ID, LOCATION_NAME]
  );
  const [restored] = await conn.execute(
    "SELECT location_id,active FROM locations WHERE location_id=? LIMIT 1", [LOCATION_ID]
  );
  if (!restored.length) throw new Error("An outlet with this name already uses another ID. Set LOCATION_ID to that existing outlet ID in the backend settings.");
  if (!active(restored[0].active)) throw new Error("The configured outlet is inactive. Activate it before saving stock or sales.");
}

async function createPurchase(data) {
  await ensureBarcodeEditSchema();
  if((data?.Items||[]).some(x=>x.CategoryPriceTierID))await ensureDressSchema();
  const invoiceNo = clean(data?.InvoiceNo);

  const invoiceDate =
    clean(data?.InvoiceDate) || new Date().toISOString().slice(0, 10);

  let vendorId = Number(data?.VendorID);
  const vendorName = clean(data?.VendorName) || (!vendorId ? clean(data?.VendorID) : "");

  const items = Array.isArray(data?.Items) ? data.Items : [];

  if (!invoiceNo) throw new Error("Supplier Invoice No. is required.");

  if (!vendorId && !vendorName) throw new Error("Vendor is required.");

  if (!items.length) throw new Error("Add at least one purchase item.");

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await ensureConfiguredLocation(conn);
    if (vendorName) vendorId = Number((await findOrCreateVendorByName(conn, vendorName)).vendor_id);

    const [[vendor]] = await conn.execute(
      `SELECT * FROM vendors WHERE vendor_id=? AND active=1 FOR UPDATE`,

      [vendorId],
    );

    if (!vendor) throw new Error("Vendor not found.");

    const [dup] = await conn.execute(
      `SELECT 1 FROM purchases WHERE vendor_id=? AND LOWER(invoice_no)=LOWER(?) LIMIT 1`,

      [vendorId, invoiceNo],
    );

    if (dup.length)
      throw new Error(
        "This Supplier Invoice No. is already recorded for the selected vendor.",
      );

    const merged = new Map();
    const purchaseTierCache = new Map();
    // Serialize purchase posting per vendor, including internal tier creation.
    await conn.execute("SELECT vendor_id FROM vendors WHERE vendor_id=? FOR UPDATE",[vendorId]);

    for (let i = 0; i < items.length; i++) {
      const x = items[i];

      const classificationKey=JSON.stringify([Number(x.CategoryID),Number(x.CategoryPriceTierID),Number(x.PurchasePrice),Number(x.MRP)]);
      let t;
      if(x.CategoryPriceTierID){
        if(!purchaseTierCache.has(classificationKey))purchaseTierCache.set(classificationKey,await categoryPurchaseTier(conn,vendorId,x));
        t=purchaseTierCache.get(classificationKey);
      }else t=await joinedTierById(conn,Number(x.PriceTierID));

      if (!t || !active(t.active))
        throw new Error(`Line ${i + 1}: Price Tier not found.`);

      if (Number(t.vendor_id) !== vendorId)
        throw new Error(
          `Line ${i + 1}: Price Tier does not belong to the selected vendor.`,
        );

      const qty = Number(x.Qty || 0);

      if (!Number.isInteger(qty) || qty <= 0)
        throw new Error(
          `Line ${i + 1}: Quantity must be a whole number greater than zero.`,
        );

      const key = JSON.stringify([t.price_tier_id,t.dressBase||"",clean(x.Material),clean(x.Design),clean(x.Colour),clean(x.Size),clean(x.Remarks)]);

      if (!merged.has(key))
        merged.set(key, {
          tier: t,

          qty: 0,

          Material: clean(x.Material),

          Design: clean(x.Design),

          Colour: clean(x.Colour),

          Size: clean(x.Size),

          Remarks: clean(x.Remarks),
        });

      const m = merged.get(key);

      m.qty += qty;

      for (const f of ["Material", "Design", "Colour", "Size", "Remarks"])
        if (!m[f] && clean(x[f])) m[f] = clean(x[f]);
    }

    const cleanItems = [...merged.values()];

    const totalQty = cleanItems.reduce((s, x) => s + x.qty, 0);

    const purchaseValue = round2(
      cleanItems.reduce(
        (s, x) => s + x.qty * Number(x.tier.purchase_price || 0),

        0,
      ),
    );

    const [pr] = await conn.execute(
      `

      INSERT INTO purchases(invoice_no,invoice_date,vendor_id,location_id,total_qty,purchase_value,remarks,status)

      VALUES (?,?,?,?,?,?,?,'POSTED')`,

      [
        invoiceNo,

        invoiceDate,

        vendorId,

        LOCATION_ID,

        totalQty,

        purchaseValue,

        clean(data?.Remarks) || null,
      ],
    );

    const purchaseId = pr.insertId;
    for(const tier of purchaseTierCache.values())await conn.execute('UPDATE automatic_purchase_codes SET purchase_id=? WHERE dress_code=?',[purchaseId,tier.dressBase]);

    const generatedPieces = [];

    for (const x of cleanItems) {
      const t = x.tier;

      const lineValue = round2(x.qty * Number(t.purchase_price || 0));

      const [pir] = await conn.execute(
        `

        INSERT INTO purchase_items

        (purchase_id,invoice_date,vendor_id,location_id,category_id,price_tier_id,barcode,qty,

         purchase_price,selling_price,mrp,line_value,material,design,colour,size,remarks)

        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

        [
          purchaseId,

          invoiceDate,

          vendorId,

          LOCATION_ID,

          t.category_id,

          t.price_tier_id,

          t.barcode,

          x.qty,

          t.purchase_price,

          t.selling_price,

          t.mrp,

          lineValue,

          x.Material || null,

          x.Design || null,

          x.Colour || null,

          x.Size || null,

          x.Remarks || null,
        ],
      );

      const purchaseItemId = pir.insertId;

      const batchNo = await nextBatchNo(conn, t.price_tier_id);
      const dressStart=t.dressBase?await reserveDressCodes(conn,t,x.qty):0;

      const [br] = await conn.execute(
        `

        INSERT INTO purchase_batches(batch_no,purchase_id,purchase_item_id,vendor_id,category_id,price_tier_id,qty)

        VALUES (?,?,?,?,?,?,?)`,

        [
          batchNo,

          purchaseId,

          purchaseItemId,

          vendorId,

          t.category_id,

          t.price_tier_id,

          x.qty,
        ],
      );

      for (let serial = 1; serial <= x.qty; serial++) {
        const piece = t.dressBase ? `${t.dressBase}-${String(dressStart+serial).padStart(3,"0")}` : makePieceBarcode(t.tier_code, batchNo, serial);

        await conn.execute(
          `

          INSERT INTO inventory_units

          (piece_barcode,tier_code,batch_no,piece_serial,purchase_id,purchase_item_id,vendor_id,category_id,

           price_tier_id,purchase_price,selling_price,mrp,material,design,colour,size,remarks,location_id,status)

          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'AVAILABLE')`,

          [
            piece,

            t.tier_code,

            batchNo,

            serial,

            purchaseId,

            purchaseItemId,

            vendorId,

            t.category_id,

            t.price_tier_id,

            t.purchase_price,

            t.selling_price,

            t.mrp,

            x.Material || null,

            x.Design || null,

            x.Colour || null,

            x.Size || null,

            x.Remarks || null,

            LOCATION_ID,
          ],
        );

        generatedPieces.push({
          PieceBarcode: piece,

          TierCode: t.tier_code,

          BatchNo: batchNo,

          PieceSerial: serial,

          VendorName: vendor.vendor_name,

          CategoryName: t.category_name,

          SellingPrice: Number(t.selling_price || 0),

          MRP: Number(t.mrp || 0),

          Size: x.Size || "",
        });
      }

      await conn.execute(
        `

        INSERT INTO stock_ledger

        (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,

         reference_type,reference_id,purchase_price,selling_price,mrp,material,design,colour,size,remarks)

        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,

        [
          invoiceDate,

          "PURCHASE_IN",

          LOCATION_ID,

          t.tier_code,

          vendorId,

          t.category_id,

          t.price_tier_id,

          x.qty,

          0,

          "PURCHASE",

          String(purchaseId),

          t.purchase_price,

          t.selling_price,

          t.mrp,

          x.Material || null,

          x.Design || null,

          x.Colour || null,

          x.Size || null,

          (x.Remarks ? x.Remarks + " | " : "") +
            `Batch ${batchNo} | ${x.qty} individual piece barcode(s) created`,
        ],
      );
    }

    await conn.commit();

    return {
      ok: true,

      purchaseId,

      totalQty,

      purchaseValue,

      generatedPieces,

      message: `Purchase ${purchaseId} posted. ${totalQty} individual piece barcode(s) created.`,
    };
  } catch (e) {
    await conn.rollback();

    throw e;
  } finally {
    conn.release();
  }
}

async function findOrCreateVendorByName(conn, vendorName) {
  const name = clean(vendorName);
  if (!name) throw new Error("Vendor Name is required.");

  const [rows] = await conn.execute(
    `SELECT * FROM vendors WHERE LOWER(vendor_name)=LOWER(?) LIMIT 1`,
    [name],
  );

  if (rows.length) {
    if (!active(rows[0].active)) throw new Error(`Vendor is inactive: ${name}`);
    return rows[0];
  }

  const [r] = await conn.execute(
    `INSERT INTO vendors(vendor_name,active) VALUES (?,1)`,
    [name],
  );

  const [[created]] = await conn.execute(
    `SELECT * FROM vendors WHERE vendor_id=? LIMIT 1`,
    [r.insertId],
  );

  return created;
}

async function findOrCreateCategoryByName(conn, categoryName) {
  const name = clean(categoryName) || "GENERAL";

  const [rows] = await conn.execute(
    `SELECT * FROM categories WHERE LOWER(category_name)=LOWER(?) LIMIT 1`,
    [name],
  );

  if (rows.length) {
    if (!active(rows[0].active))
      throw new Error(`Category is inactive: ${name}`);
    return rows[0];
  }

  const [r] = await conn.execute(
    `INSERT INTO categories(category_name,active) VALUES (?,1)`,
    [name],
  );

  const [[created]] = await conn.execute(
    `SELECT * FROM categories WHERE category_id=? LIMIT 1`,
    [r.insertId],
  );

  return created;
}

async function ensureVendorCategory(conn, vendorId, categoryId) {
  const [rows] = await conn.execute(
    `SELECT vendor_category_id,active
     FROM vendor_categories
     WHERE vendor_id=? AND category_id=?
     LIMIT 1`,
    [vendorId, categoryId],
  );

  if (rows.length) {
    if (!active(rows[0].active)) {
      await conn.execute(
        `UPDATE vendor_categories SET active=1 WHERE vendor_category_id=?`,
        [rows[0].vendor_category_id],
      );
    }
    return;
  }

  await conn.execute(
    `INSERT INTO vendor_categories(vendor_id,category_id,active) VALUES (?,?,1)`,
    [vendorId, categoryId],
  );
}

async function nextAutoTierCode(conn) {
  const [[r]] = await conn.query(
    `SELECT COALESCE(MAX(price_tier_id),0) + 1 AS next_id FROM price_tiers`,
  );

  let n = Number(r?.next_id || 1);
  for (let tries = 0; tries < 10000; tries++, n++) {
    const code = "AT" + String(n).padStart(6, "0");
    const [exists] = await conn.execute(
      `SELECT 1 FROM price_tiers WHERE UPPER(tier_code)=? OR UPPER(barcode)=? LIMIT 1`,
      [code, code],
    );
    if (!exists.length) return code;
  }

  throw new Error("Unable to generate a unique automatic Tier Code.");
}

async function findOrCreateImportTier(
  conn,
  vendorId,
  categoryId,
  code,
  purchasePrice,
  sellingPrice,
  mrp,
) {
  const tierCode = upper(code);

  const [existing] = await conn.execute(
    `SELECT t.*,v.vendor_name,c.category_name
     FROM price_tiers t
     JOIN vendors v ON v.vendor_id=t.vendor_id
     JOIN categories c ON c.category_id=t.category_id
     WHERE UPPER(t.tier_code)=? OR UPPER(t.barcode)=?
     LIMIT 1`,
    [tierCode, tierCode],
  );

  if (existing.length) {
    const t = existing[0];

    if (!active(t.active)) throw new Error(`Code ${tierCode} is inactive.`);

    if (Number(t.vendor_id) !== Number(vendorId))
      throw new Error(`Code ${tierCode} already belongs to another vendor.`);

    if (Number(t.category_id) !== Number(categoryId))
      throw new Error(
        `Code ${tierCode} is already linked to category ${t.category_name}. Use another Code for a different category.`,
      );

    if (
      Number(t.selling_price) !== Number(sellingPrice) ||
      Number(t.mrp) !== Number(mrp)
    )
      throw new Error(
        `Code ${tierCode} already exists with Selling ₹${Number(t.selling_price)} and MRP ₹${Number(t.mrp)}. Use the same prices or enter another Code.`,
      );

    return t;
  }

  const [r] = await conn.execute(
    `INSERT INTO price_tiers
     (vendor_id,category_id,tier_code,purchase_price,selling_price,mrp,barcode,active)
     VALUES (?,?,?,?,?,?,?,1)`,
    [
      vendorId,
      categoryId,
      tierCode,
      purchasePrice,
      sellingPrice,
      mrp,
      tierCode,
    ],
  );

  return await joinedTierById(conn, r.insertId);
}

async function createImportedPurchase(data) {
  await ensureBarcodeEditSchema();
  const rawItems = Array.isArray(data?.Items) ? data.Items : [];
  if (!rawItems.length) throw new Error("Upload at least one purchase item.");

  const invoiceDate =
    clean(data?.InvoiceDate) || new Date().toISOString().slice(0, 10);

  const invoiceNo =
    clean(data?.InvoiceNo) ||
    `IMPORT-${invoiceDate.replaceAll("-", "")}-${Date.now().toString().slice(-6)}`;

  const prepared = rawItems.map((x, i) => {
    const vendorName = clean(x?.VendorName);
    if (!vendorName) throw new Error(`Line ${i + 1}: Vendor Name is required.`);

    const code = upper(x?.Code);
    if (!code) throw new Error(`Line ${i + 1}: Code is required.`);
    if (!/^[A-Z0-9-]+$/.test(code))
      throw new Error(
        `Line ${i + 1}: Code can contain only A-Z, 0-9 and hyphen.`,
      );

    const qty = Number(x?.Qty || 0);
    if (!Number.isInteger(qty) || qty <= 0)
      throw new Error(
        `Line ${i + 1}: Quantity must be a whole number greater than zero.`,
      );

    const purchasePrice = positive(
      x?.PurchasePrice,
      `Line ${i + 1}: Purchase Price`,
    );
    const sellingPrice = positive(
      x?.SellingPrice,
      `Line ${i + 1}: Selling Price`,
    );

    const mrpInput = clean(x?.MRP);
    const mrpRaw = mrpInput === "" ? 0 : Number(mrpInput);
    if (!Number.isFinite(mrpRaw) || mrpRaw < 0)
      throw new Error(`Line ${i + 1}: MRP cannot be negative.`);
    const mrp = round2(mrpRaw);

    if (mrp > 0 && sellingPrice > mrp)
      throw new Error(`Line ${i + 1}: Selling Price cannot exceed MRP.`);

    return {
      VendorName: vendorName,
      Code: code,
      Particulars: clean(x?.Particulars),
      Qty: qty,
      PurchasePrice: purchasePrice,
      SellingPrice: sellingPrice,
      MRP: mrp,
      Category: clean(x?.Category),
      Material: clean(x?.Material),
      Design: clean(x?.Design),
      Colour: clean(x?.Colour),
      Size: clean(x?.Size),
      Remarks: clean(x?.Remarks),
    };
  });

  const vendorNames = [
    ...new Set(prepared.map((x) => x.VendorName.toLowerCase())),
  ];
  if (vendorNames.length !== 1)
    throw new Error(
      "One purchase bill can contain only one Vendor Name. Split different vendors into separate Excel files.",
    );

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await ensureConfiguredLocation(conn);

    const vendor = await findOrCreateVendorByName(conn, prepared[0].VendorName);

    const [dup] = await conn.execute(
      `SELECT 1 FROM purchases
       WHERE vendor_id=? AND LOWER(invoice_no)=LOWER(?) LIMIT 1`,
      [vendor.vendor_id, invoiceNo],
    );

    if (dup.length)
      throw new Error(
        "This Supplier Invoice No. is already recorded for this vendor.",
      );

    const cleanItems = [];

    for (const x of prepared) {
      const category = await findOrCreateCategoryByName(conn, x.Category);
      await ensureVendorCategory(conn, vendor.vendor_id, category.category_id);

      const tier = await findOrCreateImportTier(
        conn,
        vendor.vendor_id,
        category.category_id,
        x.Code,
        x.PurchasePrice,
        x.SellingPrice,
        x.MRP,
      );

      cleanItems.push({ ...x, category, tier });
    }

    const totalQty = cleanItems.reduce((s, x) => s + x.Qty, 0);
    const purchaseValue = round2(
      cleanItems.reduce((s, x) => s + x.Qty * x.PurchasePrice, 0),
    );

    const [pr] = await conn.execute(
      `INSERT INTO purchases
       (invoice_no,invoice_date,vendor_id,location_id,total_qty,purchase_value,remarks,status)
       VALUES (?,?,?,?,?,?,?,'POSTED')`,
      [
        invoiceNo,
        invoiceDate,
        vendor.vendor_id,
        LOCATION_ID,
        totalQty,
        purchaseValue,
        clean(data?.Remarks) || null,
      ],
    );

    const purchaseId = pr.insertId;
    const generatedPieces = [];

    for (const x of cleanItems) {
      const t = x.tier;
      const description = x.Design || x.Particulars || null;
      const detailRemarks = [
        x.Remarks || "",
        x.Particulars && x.Design ? `Supplier item: ${x.Particulars}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const lineValue = round2(x.Qty * x.PurchasePrice);

      const [pir] = await conn.execute(
        `INSERT INTO purchase_items
         (purchase_id,invoice_date,vendor_id,location_id,category_id,price_tier_id,barcode,qty,
          purchase_price,selling_price,mrp,line_value,material,design,colour,size,remarks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          purchaseId,
          invoiceDate,
          vendor.vendor_id,
          LOCATION_ID,
          x.category.category_id,
          t.price_tier_id,
          t.barcode,
          x.Qty,
          x.PurchasePrice,
          x.SellingPrice,
          x.MRP,
          lineValue,
          x.Material || null,
          description,
          x.Colour || null,
          x.Size || null,
          detailRemarks || null,
        ],
      );

      const purchaseItemId = pir.insertId;
      const batchNo = await nextBatchNo(conn, t.price_tier_id);

      await conn.execute(
        `INSERT INTO purchase_batches
         (batch_no,purchase_id,purchase_item_id,vendor_id,category_id,price_tier_id,qty)
         VALUES (?,?,?,?,?,?,?)`,
        [
          batchNo,
          purchaseId,
          purchaseItemId,
          vendor.vendor_id,
          x.category.category_id,
          t.price_tier_id,
          x.Qty,
        ],
      );

      for (let serial = 1; serial <= x.Qty; serial++) {
        const piece = makePieceBarcode(t.tier_code, batchNo, serial);

        await conn.execute(
          `INSERT INTO inventory_units
           (piece_barcode,tier_code,batch_no,piece_serial,purchase_id,purchase_item_id,vendor_id,category_id,
            price_tier_id,purchase_price,selling_price,mrp,material,design,colour,size,remarks,location_id,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'AVAILABLE')`,
          [
            piece,
            t.tier_code,
            batchNo,
            serial,
            purchaseId,
            purchaseItemId,
            vendor.vendor_id,
            x.category.category_id,
            t.price_tier_id,
            x.PurchasePrice,
            x.SellingPrice,
            x.MRP,
            x.Material || null,
            description,
            x.Colour || null,
            x.Size || null,
            detailRemarks || null,
            LOCATION_ID,
          ],
        );

        generatedPieces.push({
          PieceBarcode: piece,
          TierCode: t.tier_code,
          BatchNo: batchNo,
          PieceSerial: serial,
          VendorName: vendor.vendor_name,
          CategoryName: x.category.category_name,
          Particulars: x.Particulars,
          SellingPrice: x.SellingPrice,
          MRP: x.MRP,
          Size: x.Size || "",
        });
      }

      await conn.execute(
        `INSERT INTO stock_ledger
         (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,
          reference_type,reference_id,purchase_price,selling_price,mrp,material,design,colour,size,remarks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          invoiceDate,
          "PURCHASE_IN",
          LOCATION_ID,
          t.tier_code,
          vendor.vendor_id,
          x.category.category_id,
          t.price_tier_id,
          x.Qty,
          0,
          "PURCHASE",
          String(purchaseId),
          x.PurchasePrice,
          x.SellingPrice,
          x.MRP,
          x.Material || null,
          description,
          x.Colour || null,
          x.Size || null,
          [
            detailRemarks,
            `Batch ${batchNo}`,
            `${x.Qty} individual piece barcode(s) created`,
          ]
            .filter(Boolean)
            .join(" | "),
        ],
      );
    }

    await conn.commit();

    return {
      ok: true,
      purchaseId,
      invoiceNo,
      vendorId: vendor.vendor_id,
      vendorName: vendor.vendor_name,
      totalQty,
      purchaseValue,
      generatedPieces,
      message: `Purchase ${purchaseId} posted. ${totalQty} individual piece barcode(s) created.`,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}




let missingStickerSchemaReady;
async function ensureMissingStickerSchema(){
  if(!missingStickerSchemaReady){
    missingStickerSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS dress_code_quantity_locks (
        dress_code VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
        touched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS dress_code_manual_sale_items (
        manual_sale_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sale_id BIGINT UNSIGNED NOT NULL,
        dress_code VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        location_id VARCHAR(20) NOT NULL,
        vendor_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NOT NULL,
        price_tier_id BIGINT UNSIGNED NOT NULL,
        qty INT NOT NULL,
        mrp DECIMAL(12,2) NOT NULL DEFAULT 0,
        rate DECIMAL(12,2) NOT NULL,
        discount_pct DECIMAL(8,2) NOT NULL DEFAULT 0,
        discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(12,2) NOT NULL,
        purchase_price_at_sale DECIMAL(12,2) NOT NULL DEFAULT 0,
        reason VARCHAR(120) NOT NULL DEFAULT 'MISSING_BARCODE_STICKER',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_dc_manual_sale (sale_id),
        KEY idx_dc_manual_code (dress_code,location_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(e=>{missingStickerSchemaReady=null;throw e;});
  }
  await missingStickerSchemaReady;
}

function dressCodeFromPieceBarcode(barcode){
  const value=upper(barcode);
  const p=value.indexOf('-');
  return p>0 ? value.slice(0,p) : '';
}

async function lockDressCode(conn,dressCode){
  await ensureMissingStickerSchema();
  const code=upper(dressCode);
  await conn.execute('INSERT IGNORE INTO dress_code_quantity_locks(dress_code) VALUES (?)',[code]);
  await conn.execute('SELECT dress_code FROM dress_code_quantity_locks WHERE dress_code=? FOR UPDATE',[code]);
}

async function getDressCodeAvailability(conn,dressCode){
  await ensureMissingStickerSchema();
  const code=upper(dressCode);
  if(!code)return null;
  const [groups]=await conn.execute(`
    SELECT u.vendor_id,u.category_id,u.price_tier_id,u.purchase_price,u.selling_price,u.mrp,u.tier_code,
           v.vendor_name,c.category_name,
           SUM(CASE WHEN u.status='AVAILABLE' THEN 1 ELSE 0 END) AS physical_available,
           COUNT(*) AS total_piece_rows
    FROM inventory_units u
    JOIN vendors v ON v.vendor_id=u.vendor_id
    JOIN categories c ON c.category_id=u.category_id
    WHERE u.location_id=? AND UPPER(SUBSTRING_INDEX(u.piece_barcode,'-',1))=?
    GROUP BY u.vendor_id,u.category_id,u.price_tier_id,u.purchase_price,u.selling_price,u.mrp,u.tier_code,v.vendor_name,c.category_name`,
    [LOCATION_ID,code]);
  if(!groups.length)return null;
  if(groups.length>1)throw new Error(`Dress Code ${code} is linked to multiple stock classifications. Use individual barcode billing for this code.`);
  const g=groups[0];
  await ensureReturnsSchema();
  const [[deduction]]=await conn.execute(`
    SELECT GREATEST(0,
      COALESCE((SELECT SUM(d.qty)
        FROM dress_code_manual_sale_items d
        JOIN sales s ON s.sale_id=d.sale_id
        WHERE d.location_id=? AND UPPER(d.dress_code)=? AND COALESCE(s.status,'COMPLETED')<>'CANCELLED'),0)
      -
      COALESCE((SELECT SUM(ai.qty)
        FROM sale_adjustment_items ai
        JOIN sale_adjustments a ON a.adjustment_id=ai.adjustment_id
        WHERE ai.source_type='DRESS_CODE_QTY' AND UPPER(ai.barcode)=? AND a.status='COMPLETED' AND a.adjustment_type IN ('RETURN','EXCHANGE')),0)
    ) AS qty`,[LOCATION_ID,code,code]);
  const physicalAvailable=Number(g.physical_available||0);
  const unidentifiedSold=Number(deduction?.qty||0);
  const effectiveAvailable=Math.max(0,physicalAvailable-unidentifiedSold);
  return {...g,DressCode:code,PhysicalAvailable:physicalAvailable,UnidentifiedSold:unidentifiedSold,EffectiveAvailable:effectiveAvailable};
}

async function getDressCodeStickerInfo(dressCode){
  const code=upper(dressCode);
  if(!code) return {ok:false,message:'Enter Dress Code.'};
  if(code.includes('-')) return {ok:false,message:'Enter only the main Dress Code, for example 40 — not 40-001.'};
  await ensureMissingStickerSchema();
  const a=await getDressCodeAvailability(pool,code);
  if(!a) return {ok:false,message:'Dress Code not found: '+code};
  const [sizeRows]=await pool.execute(`
    SELECT DISTINCT TRIM(COALESCE(size,'')) AS size
    FROM inventory_units
    WHERE location_id=? AND status='AVAILABLE'
      AND UPPER(SUBSTRING_INDEX(piece_barcode,'-',1))=?
    ORDER BY size`,[LOCATION_ID,code]);
  const sizes=[...new Set(sizeRows.map(r=>clean(r.size)).filter(Boolean))];
  const sizeDisplay=sizes.length===0?'':sizes.length===1?sizes[0]:'MIXED';
  return {ok:true,item:{
    DressCode:code,
    SellingPrice:Number(a.selling_price||0),
    MRP:Number(a.mrp||0),
    SizeDisplay:sizeDisplay,
    Sizes:sizes,
    VendorName:a.vendor_name||'',
    CategoryName:a.category_name||'',
    TierCode:a.tier_code||'',
    PhysicalAvailableQty:Number(a.PhysicalAvailable||0),
    MissingStickerSoldQty:Number(a.UnidentifiedSold||0),
    EffectiveAvailableQty:Number(a.EffectiveAvailable||0)
  }};
}

function dressCodeBillingItem(a){
  return {
    Barcode:a.DressCode,PieceBarcode:'',DisplayCode:a.DressCode,DressCode:a.DressCode,
    TierCode:a.tier_code||'',TierName:a.tier_code||'',VendorName:a.vendor_name||'',CategoryName:a.category_name||'',
    VendorID:a.vendor_id,CategoryID:a.category_id,PriceTierID:a.price_tier_id,
    SellingPrice:Number(a.selling_price||0),MRP:Number(a.mrp||0),
    SourceType:'DRESS_CODE_QTY',Available:a.EffectiveAvailable>0?1:0,AvailableQty:Number(a.EffectiveAvailable||0),
    PhysicalAvailableQty:Number(a.PhysicalAvailable||0),UnidentifiedSoldQty:Number(a.UnidentifiedSold||0)
  };
}

let priceBarcodeSchemaReady;
async function ensurePriceBarcodeSchema(){
  if(!priceBarcodeSchemaReady){
    priceBarcodeSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS price_barcode_sequences (
        seq_key VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
        last_serial BIGINT UNSIGNED NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS price_barcodes (
        price_barcode_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        barcode VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
        code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        size VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        barcode_date DATE NOT NULL,
        serial_no BIGINT UNSIGNED NOT NULL,
        location_id VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
        sold_sale_id BIGINT UNSIGNED NULL,
        sold_bill_no VARCHAR(80) NULL,
        sold_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_price_barcodes_lookup (barcode_date,price,size,status),
        KEY idx_price_barcodes_sale (sold_sale_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS price_barcode_sale_items (
        price_barcode_sale_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sale_id BIGINT UNSIGNED NOT NULL,
        price_barcode_id BIGINT UNSIGNED NOT NULL,
        barcode VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        code VARCHAR(40) NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        size VARCHAR(50) NOT NULL,
        barcode_date DATE NOT NULL,
        qty INT NOT NULL DEFAULT 1,
        rate DECIMAL(12,2) NOT NULL,
        discount_pct DECIMAL(8,2) NOT NULL DEFAULT 0,
        discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        line_total DECIMAL(12,2) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_pb_sale_items_sale (sale_id),
        UNIQUE KEY uq_pb_sale_item_barcode (barcode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(e=>{priceBarcodeSchemaReady=null;throw e;});
  }
  await priceBarcodeSchemaReady;
}

function priceCode(price){
  const n=round2(price);
  return Number.isInteger(n)?String(n):n.toFixed(2);
}
function priceBarcodeSizeToken(size){
  const token=upper(size).replace(/[^A-Z0-9]/g,'');
  if(!token)throw new Error('Size is required.');
  return token.slice(0,20);
}
async function createPriceBarcodes(data){
  await ensurePriceBarcodeSchema();
  const price=positive(data?.Price,'Price');
  const size=upper(data?.Size);
  if(!size)throw new Error('Size is required.');
  if(size.length>50)throw new Error('Size is too long.');
  const qty=Number(data?.Qty||0);
  if(!Number.isSafeInteger(qty)||qty<1||qty>500)throw new Error('Quantity must be a whole number from 1 to 500.');
  const barcodeDate=clean(data?.BarcodeDate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(barcodeDate))throw new Error('Invalid barcode date.');
  const code=priceCode(price);
  const sizeToken=priceBarcodeSizeToken(size);
  const dateToken=barcodeDate.replaceAll('-','');
  const seqKey=[dateToken,code,sizeToken].join('|');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    await ensureConfiguredLocation(conn);
    await conn.execute('INSERT IGNORE INTO price_barcode_sequences(seq_key,last_serial) VALUES (?,0)',[seqKey]);
    const [[seq]]=await conn.execute('SELECT last_serial FROM price_barcode_sequences WHERE seq_key=? FOR UPDATE',[seqKey]);
    const start=Number(seq?.last_serial||0)+1;
    const end=start+qty-1;
    await conn.execute('UPDATE price_barcode_sequences SET last_serial=? WHERE seq_key=?',[end,seqKey]);
    const rows=[];
    for(let serial=start;serial<=end;serial++){
      const barcode=`PB${code}-${sizeToken}-${dateToken}-${String(serial).padStart(3,'0')}`;
      const [r]=await conn.execute(`INSERT INTO price_barcodes(barcode,code,price,size,barcode_date,serial_no,location_id,status) VALUES (?,?,?,?,?,?,?,'AVAILABLE')`,[barcode,code,price,size,barcodeDate,serial,LOCATION_ID]);
      rows.push({PriceBarcodeID:r.insertId,Barcode:barcode,Code:code,Price:price,Size:size,BarcodeDate:barcodeDate,SerialNo:serial,Status:'AVAILABLE'});
    }
    await conn.commit();
    return {ok:true,rows,message:`${rows.length} price barcode(s) saved.`};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function findPriceBarcode(conn, barcode, lock=false){
  await ensurePriceBarcodeSchema();
  const [rows]=await conn.execute(`SELECT *,DATE_FORMAT(barcode_date,'%Y-%m-%d') AS barcode_date_text FROM price_barcodes WHERE UPPER(barcode)=? LIMIT 1 ${lock?'FOR UPDATE':''}`,[upper(barcode)]);
  return rows[0]||null;
}

function priceBarcodeBillingItem(r){
  return {
    Barcode:r.barcode,PieceBarcode:r.barcode,DisplayCode:r.code,
    TierCode:r.code,TierName:'PRICE BARCODE',VendorName:'',CategoryName:'PRICE ITEM',
    PriceTierID:'PB:'+r.price+':'+r.size+':'+String(r.barcode_date).slice(0,10),
    SellingPrice:Number(r.price||0),MRP:Number(r.price||0),Size:r.size||'',
    BarcodeDate:r.barcode_date_text||r.barcode_date,SourceType:'PRICE_BARCODE',Available:1
  };
}
async function getBillingItemByBarcode(
  scannedBarcode,
  excludedPieceBarcodes = [],
) {
  let code = upper(scannedBarcode);
  if(/^PRICE_TIER_ID:[0-9]+$/.test(code)){
    const tier=await joinedTierById(pool,Number(code.split(':')[1]));
    if(!tier||!active(tier.active))return {ok:false,message:'Stock price tier not found.'};
    code=upper(tier.barcode);
  }

  const excluded = new Set(
    (Array.isArray(excludedPieceBarcodes) ? excludedPieceBarcodes : []).map(upper).filter(Boolean),
  );
  if (!code) return { ok: false, message: 'Scan or enter a barcode.' };

  await ensurePriceBarcodeSchema();
  await ensureMissingStickerSchema();

  const special = await findPriceBarcode(pool, code, false);
  if(special){
    if(excluded.has(code))return {ok:false,message:'This price barcode is already in the current bill: '+code};
    if(special.status!=='AVAILABLE')return {ok:false,message:`Price barcode ${code} is not available. Current status: ${special.status}`};
    if(special.location_id!==LOCATION_ID)return {ok:false,message:`Price barcode ${code} belongs to another location.`};
    return {ok:true,lookupType:'PRICE_BARCODE',scannedBarcode:code,item:priceBarcodeBillingItem(special)};
  }

  const exact = await joinedUnitByBarcode(pool, code, false);
  if (exact) {
    if (excluded.has(code)) return {ok:false,message:'This exact piece is already in the current bill: '+code};
    if (exact.status !== 'AVAILABLE') return {ok:false,message:`Piece ${code} is not available. Current status: ${exact.status}`};
    if (exact.location_id !== LOCATION_ID) return {ok:false,message:`Piece ${code} belongs to another location.`};

    const dressCode=dressCodeFromPieceBarcode(code);
    if(dressCode){
      const availability=await getDressCodeAvailability(pool,dressCode);
      if(availability && availability.EffectiveAvailable<=0){
        return {ok:false,message:`Dress Code ${dressCode} has no effective stock remaining after missing-sticker quantity deductions.`};
      }
    }
    return {ok:true,lookupType:'PIECE',scannedBarcode:code,item:billingItem(exact)};
  }

  // A bare dress code such as 40 is a quantity-level fallback for lost/missing stickers.
  // No serial piece is selected or marked sold in this mode.
  if(!code.includes('-')){
    const availability=await getDressCodeAvailability(pool,code);
    if(availability){
      if(availability.EffectiveAvailable<=0){
        return {ok:false,message:`Code ${code} has no effective stock available. Physical AVAILABLE: ${availability.PhysicalAvailable}; already deducted without serial: ${availability.UnidentifiedSold}.`};
      }
      return {ok:true,lookupType:'DRESS_CODE_QTY',scannedBarcode:code,item:dressCodeBillingItem(availability)};
    }
  }

  const [tiers] = await pool.execute(`
    SELECT t.*,v.vendor_name,c.category_name
    FROM price_tiers t
    JOIN vendors v ON v.vendor_id=t.vendor_id
    JOIN categories c ON c.category_id=t.category_id
    WHERE t.active=1 AND (UPPER(t.barcode)=? OR UPPER(t.tier_code)=?)
    LIMIT 1`,[code,code]);

  if (!tiers.length) return {ok:false,message:'Barcode not found: '+code};
  const t=tiers[0];
  const params=[t.price_tier_id,LOCATION_ID];
  let excludedSql='';
  if(excluded.size){
    excludedSql=` AND u.piece_barcode NOT IN (${[...excluded].map(()=>'?').join(',')})`;
    params.push(...excluded);
  }
  const [units]=await pool.execute(`
    SELECT u.*,v.vendor_name,c.category_name
    FROM inventory_units u
    JOIN vendors v ON v.vendor_id=u.vendor_id
    JOIN categories c ON c.category_id=u.category_id
    WHERE u.price_tier_id=? AND u.location_id=? AND u.status='AVAILABLE'
    ${excludedSql}
    ORDER BY u.inventory_unit_id LIMIT 1`,params);
  if(!units.length)return {ok:false,message:`No available stock exists for Tier Code ${t.tier_code}.`};
  return {ok:true,lookupType:'TIER',scannedBarcode:code,allocatedPieceBarcode:units[0].piece_barcode,item:billingItem(units[0])};
}

async function nextBillNo(conn) {
  // Restore a cleared sequence. Existing prefixes/counters stay unchanged.
  await conn.execute(
    "INSERT INTO bill_sequence(location_id,prefix,last_number) VALUES (?,'INV',0) ON DUPLICATE KEY UPDATE location_id=location_id",
    [LOCATION_ID]
  );
  const [[sequence]] = await conn.execute(
    "SELECT prefix,last_number FROM bill_sequence WHERE location_id=? FOR UPDATE", [LOCATION_ID]
  );
  const prefix = sequence.prefix || "INV";
  // Recover from saved bills if the counter was cleared or is behind.
  // Check all outlets because bill numbers may be globally unique.
  const [[saved]] = await conn.execute(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no,?) AS UNSIGNED)),0) AS last_number FROM sales WHERE LEFT(bill_no,?)=? AND SUBSTRING(bill_no,?) REGEXP '^[0-9]+$'",
    [prefix.length+2,prefix.length+1,prefix+'-',prefix.length+2]
  );
  const n = Math.max(Number(sequence.last_number || 0),Number(saved.last_number || 0)) + 1;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Bill-number sequence limit exceeded.");
  await conn.execute("UPDATE bill_sequence SET last_number=? WHERE location_id=?", [n, LOCATION_ID]);
  return `${prefix}-${String(n).padStart(6,"0")}`;
}

async function createSale(data) {
  const saleDate = clean(data?.SaleDate) || new Date().toISOString().slice(0, 10);
  const rawItems = Array.isArray(data?.Items) ? data.Items : [];
  const rawPayments = Array.isArray(data?.Payments) ? data.Payments : [];
  const billDiscount = nonNegative(data?.BillDiscount || 0, 'Bill Discount');
  if (!rawItems.length) throw new Error('Add at least one item to the bill.');

  await ensurePriceBarcodeSchema();
  await ensureMissingStickerSchema();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensureConfiguredLocation(conn);

    const seen = new Set();
    const cleanItems = [];
    const reservedByDress = new Map();
    const lockedDressCodes = new Set();

    async function reserveDressAvailability(dressCode, qty){
      const code=upper(dressCode);
      if(!code)throw new Error('Invalid Dress Code.');
      if(!lockedDressCodes.has(code)){
        await lockDressCode(conn,code);
        lockedDressCodes.add(code);
      }
      const availability=await getDressCodeAvailability(conn,code);
      if(!availability)throw new Error('Dress Code not found: '+code);
      const already=Number(reservedByDress.get(code)||0);
      const remaining=Number(availability.EffectiveAvailable||0)-already;
      if(qty>remaining){
        throw new Error(`Insufficient stock for Code ${code}. Available Qty: ${Math.max(0,remaining)}; requested Qty: ${qty}.`);
      }
      reservedByDress.set(code,already+qty);
      return availability;
    }

    for (let i=0;i<rawItems.length;i++) {
      const x=rawItems[i]||{};
      const requestedSource=upper(x.SourceType);

      if(requestedSource==='DRESS_CODE_QTY'){
        const dressCode=upper(x.DressCode||x.Barcode);
        const qty=Number(x.Qty||0);
        if(!dressCode)throw new Error(`Line ${i+1}: Dress Code is required.`);
        if(!Number.isSafeInteger(qty)||qty<=0)throw new Error(`Line ${i+1}: Quantity must be a whole number greater than zero.`);
        const a=await reserveDressAvailability(dressCode,qty);
        const rate=x.Rate==null||x.Rate===''?Number(a.selling_price||0):Number(x.Rate);
        const discountPct=Number(x.DiscountPct||0);
        if(!Number.isFinite(rate)||rate<0)throw new Error('Rate cannot be negative.');
        if(!Number.isFinite(discountPct)||discountPct<0||discountPct>100)throw new Error('Discount % must be between 0 and 100.');
        const gross=round2(rate*qty);
        const discountAmount=round2((gross*discountPct)/100);
        cleanItems.push({
          sourceType:'DRESS_CODE_QTY',dressCode,availability:a,qty,rate,discountPct,discountAmount,
          lineTotal:round2(gross-discountAmount)
        });
        continue;
      }

      const barcode=upper(x.Barcode);
      if(!barcode)throw new Error(`Line ${i+1}: Invalid individual piece barcode.`);
      if(seen.has(barcode))throw new Error(`Piece ${barcode} is scanned more than once in the same bill.`);
      seen.add(barcode);

      const pb=await findPriceBarcode(conn,barcode,true);
      let u=null,sourceType='STOCK',qty=1;
      if(pb){
        sourceType='PRICE_BARCODE';
        if(pb.status!=='AVAILABLE')throw new Error(`Price barcode ${barcode} cannot be sold. Current status: ${pb.status}`);
        if(pb.location_id!==LOCATION_ID)throw new Error(`Price barcode ${barcode} belongs to another location.`);
      }else{
        u=await joinedUnitByBarcode(conn,barcode,true);
        if(!u)throw new Error('Barcode not found: '+barcode);
        if(u.status!=='AVAILABLE')throw new Error(`Piece ${barcode} cannot be sold. Current status: ${u.status}`);
        if(u.location_id!==LOCATION_ID)throw new Error(`Piece ${barcode} belongs to another location.`);
        const dressCode=dressCodeFromPieceBarcode(barcode);
        if(dressCode)await reserveDressAvailability(dressCode,1);
      }

      const rate=x.Rate==null||x.Rate===''?Number(pb?pb.price:u.selling_price):Number(x.Rate);
      const discountPct=Number(x.DiscountPct||0);
      if(!Number.isFinite(rate)||rate<0)throw new Error('Rate cannot be negative.');
      if(!Number.isFinite(discountPct)||discountPct<0||discountPct>100)throw new Error('Discount % must be between 0 and 100.');
      const discountAmount=round2((rate*discountPct)/100);
      cleanItems.push({u,pb,sourceType,barcode,qty,rate,discountPct,discountAmount,lineTotal:round2(rate-discountAmount)});
    }

    const subTotal=round2(cleanItems.reduce((s,x)=>s+(x.rate*x.qty),0));
    const lineDiscount=round2(cleanItems.reduce((s,x)=>s+x.discountAmount,0));
    if(billDiscount>subTotal-lineDiscount+0.0001)throw new Error('Bill Discount cannot exceed the bill amount.');
    const netAmount=round2(Math.max(0,subTotal-lineDiscount-billDiscount));

    const allowed=new Set(['CASH','UPI','CARD']);
    const payments=rawPayments.map(p=>({PaymentMode:upper(p.PaymentMode),Amount:Number(p.Amount||0),ReferenceNo:clean(p.ReferenceNo)})).filter(p=>p.Amount>0);
    for(const p of payments){
      if(!allowed.has(p.PaymentMode))throw new Error('Invalid payment mode.');
      if(!Number.isFinite(p.Amount)||p.Amount<0)throw new Error('Invalid payment amount.');
    }
    const paidAmount=round2(payments.reduce((s,p)=>s+p.Amount,0));
    if(Math.abs(paidAmount-netAmount)>0.01)throw new Error('Payment total must exactly match the bill amount.');
    const paymentMode=payments.length===1?payments[0].PaymentMode:payments.length>1?'SPLIT':netAmount===0?'ZERO':null;
    if(!paymentMode)throw new Error('Enter payment details.');

    const billNo=await nextBillNo(conn);
    const [sr]=await conn.execute(`INSERT INTO sales
      (bill_no,sale_date,location_id,customer_name,customer_mobile,subtotal,line_discount,bill_discount,net_amount,payment_mode,paid_amount,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMPLETED')`,[
      billNo,saleDate,LOCATION_ID,clean(data?.CustomerName)||null,clean(data?.CustomerMobile)||null,
      subTotal,lineDiscount,billDiscount,netAmount,paymentMode,paidAmount
    ]);
    const saleId=sr.insertId;

    let soldQty=0;
    for(const i of cleanItems){
      soldQty+=Number(i.qty||1);
      if(i.sourceType==='DRESS_CODE_QTY'){
        const a=i.availability;
        await conn.execute(`INSERT INTO dress_code_manual_sale_items
          (sale_id,dress_code,location_id,vendor_id,category_id,price_tier_id,qty,mrp,rate,discount_pct,discount_amount,line_total,purchase_price_at_sale,reason)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'MISSING_BARCODE_STICKER')`,[
          saleId,i.dressCode,LOCATION_ID,a.vendor_id,a.category_id,a.price_tier_id,i.qty,Number(a.mrp||0),i.rate,
          i.discountPct,i.discountAmount,i.lineTotal,Number(a.purchase_price||0)
        ]);
        await conn.execute(`INSERT INTO stock_ledger
          (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
          saleDate,'SALE_OUT',LOCATION_ID,i.dressCode,a.vendor_id,a.category_id,a.price_tier_id,0,i.qty,'SALE_MISSING_STICKER',String(saleId),
          Number(a.purchase_price||0),i.rate,Number(a.mrp||0),`Bill ${billNo} | Code-only sale ${i.dressCode} | ${i.qty} item(s) | Missing barcode sticker; no serial piece marked SOLD`
        ]);
        continue;
      }

      if(i.sourceType==='PRICE_BARCODE'){
        const pb=i.pb;
        await conn.execute(`INSERT INTO price_barcode_sale_items
          (sale_id,price_barcode_id,barcode,code,price,size,barcode_date,qty,rate,discount_pct,discount_amount,line_total)
          VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,[
          saleId,pb.price_barcode_id,i.barcode,pb.code,pb.price,pb.size,pb.barcode_date,i.rate,i.discountPct,i.discountAmount,i.lineTotal
        ]);
        await conn.execute(`UPDATE price_barcodes SET status='SOLD',sold_sale_id=?,sold_bill_no=?,sold_at=NOW() WHERE price_barcode_id=?`,[saleId,billNo,pb.price_barcode_id]);
        continue;
      }

      const u=i.u;
      await conn.execute(`INSERT INTO sale_items
        (sale_id,inventory_unit_id,barcode,vendor_id,category_id,price_tier_id,qty,mrp,rate,discount_pct,discount_amount,line_total,purchase_price_at_sale)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        saleId,u.inventory_unit_id,i.barcode,u.vendor_id,u.category_id,u.price_tier_id,1,u.mrp,i.rate,i.discountPct,i.discountAmount,i.lineTotal,u.purchase_price
      ]);
      await conn.execute(`UPDATE inventory_units SET status='SOLD',sold_sale_id=?,sold_bill_no=?,sold_at=NOW() WHERE inventory_unit_id=?`,[saleId,billNo,u.inventory_unit_id]);
      await conn.execute(`INSERT INTO stock_ledger
        (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        saleDate,'SALE_OUT',LOCATION_ID,i.barcode,u.vendor_id,u.category_id,u.price_tier_id,0,1,'SALE',String(saleId),u.purchase_price,i.rate,u.mrp,`Bill ${billNo} | Exact piece ${i.barcode}`
      ]);
    }

    for(const p of payments){
      await conn.execute(`INSERT INTO sale_payments(sale_id,payment_mode,amount,reference_no) VALUES (?,?,?,?)`,[saleId,p.PaymentMode,p.Amount,p.ReferenceNo||null]);
    }

    await conn.commit();
    return {ok:true,saleId,billNo,netAmount,pieceCount:soldQty,message:`Bill ${billNo} completed. ${soldQty} item(s) sold.`};
  }catch(e){
    await conn.rollback();
    throw e;
  }finally{
    conn.release();
  }
}

async function getLatestSaleForPrint() {
  const [rows] = await pool.execute(
    `SELECT sale_id,bill_no,sale_date,customer_name,customer_mobile,net_amount,status
     FROM sales
     WHERE location_id=? AND COALESCE(status,'COMPLETED')='COMPLETED'
     ORDER BY sale_id DESC
     LIMIT 1`,
    [LOCATION_ID],
  );

  if (!rows.length) return null;
  const r = rows[0];
  return {
    SaleID: r.sale_id,
    BillNo: r.bill_no,
    SaleDate: r.sale_date,
    CustomerName: r.customer_name || '',
    CustomerMobile: r.customer_mobile || '',
    NetAmount: Number(r.net_amount || 0),
    Status: r.status || 'COMPLETED',
  };
}


async function searchSalesForDuplicate(searchValue) {
  const raw = clean(searchValue);
  if (!raw) throw new Error("Enter a Bill / Invoice No. or Customer Mobile Number.");

  // Bill number gets priority and must match exactly.
  const [billRows] = await pool.execute(
    `SELECT sale_id,bill_no,sale_date,customer_name,customer_mobile,net_amount,payment_mode,status,created_at
     FROM sales
     WHERE UPPER(bill_no)=UPPER(?)
     ORDER BY sale_id DESC
     LIMIT 10`,
    [raw],
  );

  const mapSale = (r) => ({
    SaleID: r.sale_id,
    BillNo: r.bill_no,
    SaleDate: r.sale_date,
    CustomerName: r.customer_name || "",
    CustomerMobile: r.customer_mobile || "",
    NetAmount: Number(r.net_amount || 0),
    PaymentMode: r.payment_mode || "",
    Status: r.status || "",
    CreatedAt: r.created_at,
  });

  if (billRows.length) {
    return {
      searchType: "BILL",
      rows: billRows.map(mapSale),
    };
  }

  // Mobile search ignores common formatting characters (+91, spaces, hyphens, brackets).
  const mobile = raw.replace(/\D/g, "");
  if (mobile.length < 6) {
    return { searchType: "NONE", rows: [] };
  }

  const [mobileRows] = await pool.execute(
    `SELECT sale_id,bill_no,sale_date,customer_name,customer_mobile,net_amount,payment_mode,status,created_at
     FROM sales
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_mobile,''),' ',''),'-',''),'+',''),'(',''),')','') = ?
     ORDER BY sale_id DESC
     LIMIT 100`,
    [mobile],
  );

  return {
    searchType: "MOBILE",
    rows: mobileRows.map(mapSale),
  };
}

async function getSaleReceipt(saleId) {
  await ensurePriceBarcodeSchema();
  await ensureMissingStickerSchema();
  const [[s]] = await pool.execute(
    `SELECT * FROM sales WHERE sale_id=? LIMIT 1`,

    [Number(saleId)],
  );

  if (!s) throw new Error("Sale not found.");

  const [items] = await pool.execute(
    `

    SELECT si.*,v.vendor_name,c.category_name,t.tier_code

    FROM sale_items si

    JOIN vendors v ON v.vendor_id=si.vendor_id

    JOIN categories c ON c.category_id=si.category_id

    JOIN price_tiers t ON t.price_tier_id=si.price_tier_id

    WHERE si.sale_id=? ORDER BY si.sale_item_id`,

    [Number(saleId)],
  );

  const [priceItems] = await pool.execute(`SELECT *,DATE_FORMAT(barcode_date,'%Y-%m-%d') AS barcode_date_text FROM price_barcode_sale_items WHERE sale_id=? ORDER BY price_barcode_sale_item_id`,[Number(saleId)]);

  const [manualItems] = await pool.execute(`
    SELECT d.*,v.vendor_name,c.category_name,t.tier_code
    FROM dress_code_manual_sale_items d
    JOIN vendors v ON v.vendor_id=d.vendor_id
    JOIN categories c ON c.category_id=d.category_id
    JOIN price_tiers t ON t.price_tier_id=d.price_tier_id
    WHERE d.sale_id=? ORDER BY d.manual_sale_item_id`,[Number(saleId)]);

  const [payments] = await pool.execute(
    `SELECT * FROM sale_payments WHERE sale_id=? ORDER BY payment_id`,

    [Number(saleId)],
  );

  return {
    sale: {
      SaleID: s.sale_id,

      BillNo: s.bill_no,

      SaleDate: s.sale_date,

      LocationID: s.location_id,

      LocationName: LOCATION_NAME,

      CustomerName: s.customer_name || "",

      CustomerMobile: s.customer_mobile || "",

      SubTotal: Number(s.subtotal || 0),

      LineDiscount: Number(s.line_discount || 0),

      BillDiscount: Number(s.bill_discount || 0),

      NetAmount: Number(s.net_amount || 0),

      PaymentMode: s.payment_mode,

      PaidAmount: Number(s.paid_amount || 0),

      Status: s.status,

      CreatedAt: s.created_at,
    },

    locationName: LOCATION_NAME,

    items: items.map((r) => ({
      SaleItemID: r.sale_item_id,

      SaleID: r.sale_id,

      Barcode: r.barcode,

      VendorID: r.vendor_id,

      VendorName: r.vendor_name,

      CategoryID: r.category_id,

      CategoryName: r.category_name,

      PriceTierID: r.price_tier_id,

      TierName: r.tier_code,

      Qty: r.qty,

      MRP: Number(r.mrp || 0),

      Rate: Number(r.rate || 0),

      DiscountPct: Number(r.discount_pct || 0),

      DiscountAmount: Number(r.discount_amount || 0),

      LineTotal: Number(r.line_total || 0),

      PurchasePriceAtSale: Number(r.purchase_price_at_sale || 0),
      Size: '', BarcodeDate: '', SourceType: 'STOCK', DisplayCode: r.barcode,
    })).concat(priceItems.map((r)=>({
      SaleItemID:'PB-'+r.price_barcode_sale_item_id,SaleID:r.sale_id,Barcode:r.barcode,
      VendorID:'',VendorName:'',CategoryID:'',CategoryName:'PRICE ITEM',PriceTierID:'',TierName:'PRICE BARCODE',
      Qty:r.qty,MRP:Number(r.price||0),Rate:Number(r.rate||0),DiscountPct:Number(r.discount_pct||0),
      DiscountAmount:Number(r.discount_amount||0),LineTotal:Number(r.line_total||0),PurchasePriceAtSale:0,
      Size:r.size||'',BarcodeDate:r.barcode_date_text||r.barcode_date,SourceType:'PRICE_BARCODE',DisplayCode:r.code||''
    }))).concat(manualItems.map((r)=>({
      SaleItemID:'DC-'+r.manual_sale_item_id,SaleID:r.sale_id,Barcode:r.dress_code,
      VendorID:r.vendor_id,VendorName:r.vendor_name,CategoryID:r.category_id,CategoryName:r.category_name,
      PriceTierID:r.price_tier_id,TierName:r.tier_code,Qty:Number(r.qty||0),MRP:Number(r.mrp||0),
      Rate:Number(r.rate||0),DiscountPct:Number(r.discount_pct||0),DiscountAmount:Number(r.discount_amount||0),
      LineTotal:Number(r.line_total||0),PurchasePriceAtSale:Number(r.purchase_price_at_sale||0),
      Size:'',BarcodeDate:'',SourceType:'DRESS_CODE_QTY',DisplayCode:r.dress_code||''
    }))),

    payments: payments.map((r) => ({
      PaymentID: r.payment_id,

      SaleID: r.sale_id,

      PaymentMode: r.payment_mode,

      Amount: Number(r.amount || 0),

      ReferenceNo: r.reference_no || "",

      CreatedAt: r.created_at,
    })),
  };
}

async function getStockLedger() {
  const [rows] = await pool.query(`

    SELECT l.*,v.vendor_name,c.category_name,t.tier_code

    FROM stock_ledger l

    JOIN vendors v ON v.vendor_id=l.vendor_id

    JOIN categories c ON c.category_id=l.category_id

    JOIN price_tiers t ON t.price_tier_id=l.price_tier_id

    ORDER BY l.ledger_id DESC LIMIT 500`);

  return rows.reverse().map((r) => ({
    LedgerID: r.ledger_id,

    TxnDate: r.txn_date,

    TxnType: r.txn_type,

    LocationID: r.location_id,

    LocationName: LOCATION_NAME,

    Barcode: r.barcode,

    VendorID: r.vendor_id,

    VendorName: r.vendor_name,

    CategoryID: r.category_id,

    CategoryName: r.category_name,

    PriceTierID: r.price_tier_id,

    TierName: r.tier_code,

    QtyIn: r.qty_in,

    QtyOut: r.qty_out,

    ReferenceType: r.reference_type || "",

    ReferenceID: r.reference_id || "",

    PurchasePrice: Number(r.purchase_price || 0),

    SellingPrice: Number(r.selling_price || 0),

    MRP: Number(r.mrp || 0),

    Material: r.material || "",

    Design: r.design || "",

    Colour: r.colour || "",

    Size: r.size || "",

    Remarks: r.remarks || "",

    CreatedAt: r.created_at,
  }));
}


async function ensureBarcodeEditSchema(){
  const needed={
    material:'VARCHAR(150) NULL',
    design:'VARCHAR(255) NULL',
    colour:'VARCHAR(150) NULL',
    size:'VARCHAR(100) NULL',
    remarks:'TEXT NULL',
    supplier_invoice_no:'VARCHAR(150) NULL'
  };
  for(const [column,definition] of Object.entries(needed)){
    const [rows]=await pool.execute(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_units' AND COLUMN_NAME=? LIMIT 1`,
      [column]
    );
    if(!rows.length)await pool.query(`ALTER TABLE inventory_units ADD COLUMN ${column} ${definition}`);
  }
}

function commonOrMixed(rows,field){
  const vals=rows.map(r=>r[field]==null?'':String(r[field]));
  const first=vals[0]??'';
  return {value:vals.every(v=>v===first)?first:'',mixed:!vals.every(v=>v===first)};
}

async function getBarcodeEditInfo(searchValue){
  await ensureDressSchema();
  await ensureBarcodeEditSchema();
  const search=upper(searchValue);
  if(!search)throw Error('Enter a Dress Code or full piece barcode.');

  let mode='GROUP',params=[search],where="SUBSTRING_INDEX(u.piece_barcode,'-',1)=?";
  const [exactRows]=await pool.execute('SELECT inventory_unit_id FROM inventory_units WHERE UPPER(piece_barcode)=? LIMIT 1',[search]);
  if(exactRows.length){mode='PIECE';where='UPPER(u.piece_barcode)=?';}

  const [rows]=await pool.execute(`
    SELECT u.*,v.vendor_name,c.category_name,p.invoice_no AS purchase_invoice_no,
      COALESCE(u.supplier_invoice_no,p.invoice_no,'') AS edit_invoice_no,
      COALESCE(u.material,pi.material,'') AS edit_material,
      COALESCE(u.design,pi.design,'') AS edit_design,
      COALESCE(u.colour,pi.colour,'') AS edit_colour,
      COALESCE(u.size,pi.size,'') AS edit_size,
      COALESCE(u.remarks,pi.remarks,'') AS edit_remarks,
      COALESCE(cpt.category_price_tier_id,ap.category_price_tier_id) AS category_price_tier_id
    FROM inventory_units u
    JOIN vendors v ON v.vendor_id=u.vendor_id
    JOIN categories c ON c.category_id=u.category_id
    LEFT JOIN purchase_items pi ON pi.purchase_item_id=u.purchase_item_id
    LEFT JOIN purchases p ON p.purchase_id=u.purchase_id
    LEFT JOIN category_price_tiers cpt
      ON cpt.category_id=u.category_id
     AND UPPER(cpt.tier_code)=UPPER(u.tier_code)
    LEFT JOIN automatic_purchase_codes ap ON ap.dress_code COLLATE utf8mb4_unicode_ci = SUBSTRING_INDEX(u.piece_barcode,'-',1) COLLATE utf8mb4_unicode_ci
    WHERE ${where}
    ORDER BY u.inventory_unit_id`,params);
  if(!rows.length)throw Error('Barcode or Dress Code not found: '+search);

  const fields={
    VendorID:'vendor_id',VendorName:'vendor_name',InvoiceNo:'edit_invoice_no',
    CategoryID:'category_id',CategoryPriceTierID:'category_price_tier_id',PurchasePrice:'purchase_price',SellingPrice:'selling_price',MRP:'mrp',
    Material:'edit_material',Design:'edit_design',Colour:'edit_colour',Size:'edit_size',Remarks:'edit_remarks'
  };
  const details={},mixedFields=[];
  for(const [out,key] of Object.entries(fields)){
    const {value,mixed}=commonOrMixed(rows,key);
    details[out]=['VendorID','CategoryID','CategoryPriceTierID'].includes(out)?(value?Number(value):''):
      ['PurchasePrice','SellingPrice','MRP'].includes(out)?(value===''?'':Number(value)):value;
    if(mixed)mixedFields.push(out);
  }
  if(!details.CategoryPriceTierID && details.CategoryID){
    const tierCode=upper(rows[0].tier_code);
    const [preset]=await pool.execute('SELECT category_price_tier_id FROM category_price_tiers WHERE category_id=? AND UPPER(tier_code)=? LIMIT 1',[Number(details.CategoryID),tierCode]);
    if(preset.length)details.CategoryPriceTierID=Number(preset[0].category_price_tier_id);
  }
  const statuses=[...new Set(rows.map(r=>upper(r.status)))];
  const stockStatus=statuses.length===1?statuses[0]:'MIXED';
  const editable=rows.every(r=>upper(r.status)==='AVAILABLE');
  return {
    ok:true,mode,search:mode==='PIECE'?upper(rows[0].piece_barcode):search,quantity:rows.length,details,mixedFields,
    stockStatus,editable,
    pieces:rows.map(r=>({
      PieceBarcode:r.piece_barcode,Status:r.status,VendorID:r.vendor_id,VendorName:r.vendor_name,InvoiceNo:r.edit_invoice_no||'',
      CategoryID:r.category_id,CategoryName:r.category_name,TierCode:r.tier_code,
      PurchasePrice:Number(r.purchase_price||0),SellingPrice:Number(r.selling_price||0),MRP:Number(r.mrp||0),Size:r.edit_size||r.size||''
    }))
  };
}

async function updateBarcodeDetails(data){
  await ensureDressSchema();
  await ensureBarcodeEditSchema();
  const search=upper(data?.Search),mode=upper(data?.Mode);
  if(!search||!['GROUP','PIECE'].includes(mode))throw Error('Search the barcode again before updating.');
  const changed=new Set(Array.isArray(data?.ChangedFields)?data.ChangedFields:[]);
  if(!changed.size)throw Error('No fields were changed.');

  const categoryId=Number(data?.CategoryID),presetId=Number(data?.CategoryPriceTierID);
  if(!Number.isSafeInteger(categoryId)||categoryId<=0)throw Error('Select Category.');
  if(!Number.isSafeInteger(presetId)||presetId<=0)throw Error('Select Tier Code.');
  const [[preset]]=await pool.execute('SELECT * FROM category_price_tiers WHERE category_price_tier_id=? AND category_id=? LIMIT 1',[presetId,categoryId]);
  if(!preset)throw Error('Selected Tier Code does not belong to the selected Category.');

  const invoiceNo=clean(data?.InvoiceNo);
  if(changed.has('InvoiceNo') && !invoiceNo)throw Error('Supplier Invoice No. is required.');

  // A Tier Code always carries its saved category selling price.
  if(changed.has('CategoryPriceTierID') && !changed.has('SellingPrice')){
    data={...data,SellingPrice:Number(preset.selling_price)};
    changed.add('SellingPrice');
  }

  const numeric={};
  for(const f of ['PurchasePrice','SellingPrice']){
    if(changed.has(f))numeric[f]=positive(data?.[f],f.replace(/([A-Z])/g,' $1').trim());
  }
  if(changed.has('MRP')){
    numeric.MRP=clean(data?.MRP)===''?0:nonNegative(data?.MRP,'MRP');
  }
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const where=mode==='PIECE'?'UPPER(u.piece_barcode)=?':"SUBSTRING_INDEX(u.piece_barcode,'-',1)=?";
    const [units]=await conn.execute(`SELECT u.* FROM inventory_units u WHERE ${where} FOR UPDATE`,[search]);
    if(!units.length)throw Error('Barcode or Dress Code not found: '+search);
    const nonAvailable=units.filter(u=>upper(u.status)!=='AVAILABLE');
    if(nonAvailable.length){
      if(mode==='PIECE')throw Error(`Piece ${search} is ${upper(nonAvailable[0].status)} and cannot be edited or updated.`);
      throw Error(`Dress Code ${search} contains ${nonAvailable.length} sold/non-available piece(s). Sold stock cannot be edited or updated.`);
    }

    let targetVendorId=Number(units[0].vendor_id);
    let targetVendorName='';
    if(changed.has('VendorID')){
      const rawVendor=clean(data?.VendorID);
      if(!rawVendor)throw Error('Select or enter Vendor.');
      if(/^\d+$/.test(rawVendor)){
        const [[vendor]]=await conn.execute('SELECT vendor_id,vendor_name,active FROM vendors WHERE vendor_id=? LIMIT 1',[Number(rawVendor)]);
        if(!vendor||!active(vendor.active))throw Error('Selected Vendor not found or inactive.');
        targetVendorId=Number(vendor.vendor_id);targetVendorName=vendor.vendor_name;
      }else{
        const vendor=await findOrCreateVendorByName(conn,clean(data?.VendorName)||rawVendor);
        targetVendorId=Number(vendor.vendor_id);targetVendorName=vendor.vendor_name;
      }
      await ensureVendorCategory(conn,targetVendorId,categoryId);
    }

    // If a new material name is typed, add it to Material Master once and use the canonical saved name.
    let materialValue=clean(data?.Material);
    if(changed.has('Material') && materialValue){
      const [existingMaterial]=await conn.execute('SELECT material_name FROM materials WHERE LOWER(material_name)=LOWER(?) LIMIT 1',[materialValue]);
      if(existingMaterial.length){
        materialValue=existingMaterial[0].material_name;
      }else{
        await conn.execute('INSERT INTO materials(material_name,active) VALUES (?,1)',[materialValue]);
      }
    }

    const targetCategory=categoryId;
    const targetTierCode=upper(preset.tier_code);
    const needsClass=changed.has('CategoryID')||changed.has('CategoryPriceTierID');
    const currentPurchase=numeric.PurchasePrice ?? Number(units[0].purchase_price||0);
    const currentSelling=numeric.SellingPrice ?? Number(units[0].selling_price||0);
    const currentMrp=numeric.MRP ?? Number(units[0].mrp||0);
    if(currentMrp>0 && currentSelling>currentMrp)throw Error('Selling Price cannot exceed MRP.');

    let targetPriceTierId=Number(units[0].price_tier_id);
    if(mode==='PIECE' && (changed.has('VendorID')||needsClass||changed.has('PurchasePrice')||changed.has('SellingPrice')||changed.has('MRP'))){
      const code=await nextAutoTierCode(conn);
      const t=await findOrCreateImportTier(conn,targetVendorId,targetCategory,code,currentPurchase,currentSelling,currentMrp);
      targetPriceTierId=Number(t.price_tier_id);
    }

    const sets=[],params=[];
    if(changed.has('VendorID')){sets.push('vendor_id=?');params.push(targetVendorId);}
    if(changed.has('InvoiceNo')){sets.push('supplier_invoice_no=?');params.push(invoiceNo);}
    if(needsClass){sets.push('category_id=?','tier_code=?');params.push(targetCategory,targetTierCode);}
    if(mode==='PIECE' && targetPriceTierId!==Number(units[0].price_tier_id)){sets.push('price_tier_id=?');params.push(targetPriceTierId);}
    if(changed.has('PurchasePrice')){sets.push('purchase_price=?');params.push(numeric.PurchasePrice);}
    if(changed.has('SellingPrice')){sets.push('selling_price=?');params.push(numeric.SellingPrice);}
    if(changed.has('MRP')){sets.push('mrp=?');params.push(numeric.MRP);}
    for(const [field,column] of Object.entries({Material:'material',Design:'design',Colour:'colour',Size:'size',Remarks:'remarks'})){
      if(changed.has(field)){
        sets.push(`${column}=?`);
        params.push(field==='Material'?(materialValue||null):(clean(data?.[field])||null));
      }
    }
    if(sets.length){
      params.push(search);
      const updateWhere=mode==='PIECE'?'UPPER(piece_barcode)=?':"SUBSTRING_INDEX(piece_barcode,'-',1)=?";
      await conn.execute(`UPDATE inventory_units SET ${sets.join(',')} WHERE ${updateWhere}`,params);
    }

    if(mode==='GROUP'){
      const priceTierIds=[...new Set(units.map(u=>Number(u.price_tier_id)))];
      if(priceTierIds.length===1){
        const pSets=[],pParams=[];
        if(changed.has('VendorID')){pSets.push('vendor_id=?');pParams.push(targetVendorId);}
        if(needsClass){pSets.push('category_id=?');pParams.push(targetCategory);}
        if(changed.has('PurchasePrice')){pSets.push('purchase_price=?');pParams.push(numeric.PurchasePrice);}
        if(changed.has('SellingPrice')){pSets.push('selling_price=?');pParams.push(numeric.SellingPrice);}
        if(changed.has('MRP')){pSets.push('mrp=?');pParams.push(numeric.MRP);}
        if(pSets.length){pParams.push(priceTierIds[0]);await conn.execute(`UPDATE price_tiers SET ${pSets.join(',')} WHERE price_tier_id=?`,pParams);}
      }
      const apSets=['category_id=?','category_price_tier_id=?','tier_code=?'],apParams=[targetCategory,presetId,targetTierCode];
      if(changed.has('VendorID')){apSets.push('vendor_id=?');apParams.push(targetVendorId);}
      if(changed.has('PurchasePrice')){apSets.push('purchase_price=?');apParams.push(numeric.PurchasePrice);}
      if(changed.has('SellingPrice')){apSets.push('selling_price=?');apParams.push(numeric.SellingPrice);}
      if(changed.has('MRP')){apSets.push('mrp=?');apParams.push(numeric.MRP);}
      apParams.push(search);
      await conn.execute(`UPDATE automatic_purchase_codes SET ${apSets.join(',')} WHERE dress_code=?`,apParams);

      const itemIds=[...new Set(units.map(u=>Number(u.purchase_item_id)).filter(Boolean))];
      if(itemIds.length){
        const iSets=[],iParams=[];
        if(changed.has('VendorID')){iSets.push('vendor_id=?');iParams.push(targetVendorId);}
        if(needsClass){iSets.push('category_id=?');iParams.push(targetCategory);}
        if(changed.has('PurchasePrice')){iSets.push('purchase_price=?');iParams.push(numeric.PurchasePrice);}
        if(changed.has('SellingPrice')){iSets.push('selling_price=?');iParams.push(numeric.SellingPrice);}
        if(changed.has('MRP')){iSets.push('mrp=?');iParams.push(numeric.MRP);}
        for(const [field,column] of Object.entries({Material:'material',Design:'design',Colour:'colour',Size:'size',Remarks:'remarks'})){
          if(changed.has(field)){
            iSets.push(`${column}=?`);
            iParams.push(field==='Material'?(materialValue||null):(clean(data?.[field])||null));
          }
        }
        if(iSets.length){
          const qs=itemIds.map(()=>'?').join(',');
          await conn.execute(`UPDATE purchase_items SET ${iSets.join(',')} WHERE purchase_item_id IN (${qs})`,[...iParams,...itemIds]);
        }
      }
    }

    await conn.commit();
    return {ok:true,updated:units.length,message:mode==='PIECE'?`Piece ${search} updated successfully.`:`Dress Code ${search} updated for ${units.length} product(s).`};
  }catch(e){
    await conn.rollback();throw e;
  }finally{conn.release();}
}

async function deleteBarcodeProduct(searchValue, modeValue){
  await ensureDressSchema();
  await ensureBarcodeEditSchema();

  const search=upper(searchValue);
  const mode=upper(modeValue);
  if(!search||!['GROUP','PIECE'].includes(mode))throw Error('Search the barcode again before deleting.');

  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const where=mode==='PIECE'?'UPPER(u.piece_barcode)=?':"SUBSTRING_INDEX(u.piece_barcode,'-',1)=?";
    const [units]=await conn.execute(`SELECT u.* FROM inventory_units u WHERE ${where} FOR UPDATE`,[search]);
    if(!units.length)throw Error('Barcode or Dress Code not found: '+search);

    const blocked=units.filter(u=>upper(u.status)!=='AVAILABLE');
    if(blocked.length){
      if(mode==='PIECE')throw Error(`Piece ${search} is ${upper(blocked[0].status)} and cannot be deleted.`);
      throw Error(`Dress Code ${search} contains ${blocked.length} sold/non-available piece(s). Delete is blocked to protect billing history.`);
    }

    const ids=units.map(u=>Number(u.inventory_unit_id));
    const purchaseIds=[...new Set(units.map(u=>Number(u.purchase_id)).filter(Boolean))];
    const purchaseItemIds=[...new Set(units.map(u=>Number(u.purchase_item_id)).filter(Boolean))];

    // Keep an audit trail of the stock deletion before removing the live inventory rows.
    for(const u of units){
      await conn.execute(`INSERT INTO stock_ledger
        (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,
         reference_type,reference_id,purchase_price,selling_price,mrp,material,design,colour,size,remarks)
        VALUES (CURDATE(),'STOCK_DELETE',?,?,?,?,?,0,1,'BARCODE_DELETE',?,?,?,?,?,?,?,?,?)`,[
          u.location_id,u.piece_barcode,u.vendor_id,u.category_id,u.price_tier_id,
          search,u.purchase_price,u.selling_price,u.mrp,u.material||null,u.design||null,u.colour||null,u.size||null,
          `Deleted ${mode==='PIECE'?'piece':'Dress Code group'} ${search}`
      ]);
    }

    const qs=ids.map(()=>'?').join(',');
    await conn.execute(`DELETE FROM inventory_units WHERE inventory_unit_id IN (${qs})`,ids);

    // Recalculate the affected purchase item quantities/values so purchase history stays consistent.
    for(const itemId of purchaseItemIds){
      const [[agg]]=await conn.execute(`SELECT COUNT(*) qty,COALESCE(SUM(purchase_price),0) line_value FROM inventory_units WHERE purchase_item_id=?`,[itemId]);
      const qty=Number(agg?.qty||0),lineValue=round2(agg?.line_value||0);
      if(qty<=0){
        await conn.execute('DELETE FROM purchase_batches WHERE purchase_item_id=?',[itemId]);
        await conn.execute('DELETE FROM purchase_items WHERE purchase_item_id=?',[itemId]);
      }else{
        await conn.execute('UPDATE purchase_items SET qty=?,line_value=? WHERE purchase_item_id=?',[qty,lineValue,itemId]);
        await conn.execute('UPDATE purchase_batches SET qty=? WHERE purchase_item_id=?',[qty,itemId]);
      }
    }

    // Keep the purchase header, but update its totals to the remaining products.
    for(const purchaseId of purchaseIds){
      const [[agg]]=await conn.execute(`SELECT COUNT(*) total_qty,COALESCE(SUM(purchase_price),0) purchase_value FROM inventory_units WHERE purchase_id=?`,[purchaseId]);
      await conn.execute('UPDATE purchases SET total_qty=?,purchase_value=? WHERE purchase_id=?',[
        Number(agg?.total_qty||0),round2(agg?.purchase_value||0),purchaseId
      ]);
    }

    if(mode==='GROUP'){
      // Remove helper mapping only when no physical piece with this Dress Code remains.
      const [[left]]=await conn.execute("SELECT COUNT(*) n FROM inventory_units WHERE SUBSTRING_INDEX(piece_barcode,'-',1)=?",[search]);
      if(Number(left?.n||0)===0){
        await conn.execute('DELETE FROM automatic_purchase_codes WHERE dress_code=?',[search]);
        await conn.execute('DELETE FROM dress_code_sequences WHERE dress_base=?',[search]);
      }
    }

    await conn.commit();
    return {
      ok:true,
      deleted:units.length,
      message:mode==='PIECE'
        ? `Piece ${search} deleted successfully.`
        : `Dress Code ${search}: ${units.length} product(s) deleted successfully.`
    };
  }catch(e){
    await conn.rollback();
    throw e;
  }finally{
    conn.release();
  }
}

async function getPurchaseSetup(){
  const categoryPriceTiers=await getCategoryPriceTiers();
  const [vendors]=await pool.query('SELECT * FROM vendors WHERE active=1 ORDER BY vendor_name');
  const [categories]=await pool.query('SELECT * FROM categories WHERE active=1 ORDER BY category_name');
  return {vendors:vendors.map(vendorObj),categories:categories.map(categoryObj),categoryPriceTiers};
}



/* =========================================================
   RETURNS / EXCHANGES / BILL CANCELLATION
   Keep the original sale immutable; every reversal is recorded.
   ========================================================= */
let returnsSchemaReady;
async function ensureReturnsSchema(){
  if(!returnsSchemaReady){
    returnsSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS sale_adjustments (
        adjustment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sale_id BIGINT UNSIGNED NOT NULL,
        bill_no VARCHAR(80) NOT NULL,
        adjustment_type VARCHAR(20) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        difference_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        settlement_type VARCHAR(20) NULL,
        settlement_mode VARCHAR(20) NULL,
        new_barcode VARCHAR(160) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_sale_adjustments_sale (sale_id),
        KEY idx_sale_adjustments_bill (bill_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sale_adjustment_items (
        adjustment_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        adjustment_id BIGINT UNSIGNED NOT NULL,
        sale_id BIGINT UNSIGNED NOT NULL,
        source_type VARCHAR(30) NOT NULL,
        source_item_id VARCHAR(80) NOT NULL,
        barcode VARCHAR(160) NOT NULL,
        qty INT NOT NULL,
        unit_credit DECIMAL(12,2) NOT NULL DEFAULT 0,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_adjustment_items_sale (sale_id),
        KEY idx_adjustment_items_source (source_type,source_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch(e=>{returnsSchemaReady=null;throw e;});
  }
  await returnsSchemaReady;
}

function adjustmentSourceId(item){
  return String(item?.SaleItemID||'');
}

function proratedCredit(sale,item){
  const lineTotal=Number(item.LineTotal||0);
  const afterLine=Math.max(0,Number(sale.SubTotal||0)-Number(sale.LineDiscount||0));
  const billDisc=Number(sale.BillDiscount||0);
  const allocated=afterLine>0 ? billDisc*(lineTotal/afterLine) : 0;
  const lineCredit=Math.max(0,lineTotal-allocated);
  return round2(lineCredit/Math.max(1,Number(item.Qty||1)));
}

async function getReturnedQty(conn,saleId,sourceType,sourceItemId){
  const [[r]]=await conn.execute(`SELECT COALESCE(SUM(ai.qty),0) qty
    FROM sale_adjustment_items ai JOIN sale_adjustments a ON a.adjustment_id=ai.adjustment_id
    WHERE ai.sale_id=? AND ai.source_type=? AND ai.source_item_id=?
      AND a.status='COMPLETED' AND a.adjustment_type IN ('RETURN','EXCHANGE')`,
    [saleId,sourceType,String(sourceItemId)]);
  return Number(r?.qty||0);
}

async function getReturnBill(saleId){
  await ensureReturnsSchema();
  const receipt=await getSaleReceipt(saleId);
  const [adj]=await pool.execute(`SELECT * FROM sale_adjustments WHERE sale_id=? ORDER BY adjustment_id DESC`,[Number(saleId)]);
  const out=[];
  for(const item of receipt.items){
    const returned=await getReturnedQty(pool,Number(saleId),item.SourceType,adjustmentSourceId(item));
    const soldQty=Number(item.Qty||1);
    out.push({...item,ReturnedQty:returned,ReturnableQty:Math.max(0,soldQty-returned),RefundUnitAmount:proratedCredit(receipt.sale,item)});
  }
  return {...receipt,items:out,adjustments:adj.map(a=>({
    AdjustmentID:a.adjustment_id,Type:a.adjustment_type,Reason:a.reason,Amount:Number(a.amount||0),
    DifferenceAmount:Number(a.difference_amount||0),SettlementType:a.settlement_type||'',SettlementMode:a.settlement_mode||'',
    NewBarcode:a.new_barcode||'',Status:a.status,CreatedAt:a.created_at
  }))};
}

async function reverseOneReturnItem(conn,sale,item,qty,adjustmentId,txnDate){
  const sourceType=item.SourceType;
  const sourceId=adjustmentSourceId(item);
  const already=await getReturnedQty(conn,sale.SaleID,sourceType,sourceId);
  const maxQty=Number(item.Qty||1)-already;
  if(!Number.isSafeInteger(qty)||qty<=0||qty>maxQty)throw new Error(`Return quantity for ${item.DisplayCode||item.Barcode} exceeds the remaining returnable quantity (${maxQty}).`);
  const unitCredit=proratedCredit(sale,item);
  const amount=round2(unitCredit*qty);

  if(sourceType==='STOCK'){
    // sale_items exposes the sold barcode; lock the actual inventory unit by that unique barcode.
    const [[row]]=await conn.execute(`SELECT * FROM inventory_units WHERE UPPER(piece_barcode)=? FOR UPDATE`,[upper(item.Barcode)]);
    if(!row)throw new Error('Sold stock item not found: '+item.Barcode);
    if(String(row.sold_sale_id||'')!==String(sale.SaleID)||row.status!=='SOLD')throw new Error(`Piece ${item.Barcode} is no longer in SOLD status for this bill.`);
    await conn.execute(`UPDATE inventory_units SET status='AVAILABLE',sold_sale_id=NULL,sold_bill_no=NULL,sold_at=NULL WHERE inventory_unit_id=?`,[row.inventory_unit_id]);
    await conn.execute(`INSERT INTO stock_ledger
      (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      txnDate,'RETURN_IN',LOCATION_ID,item.Barcode,row.vendor_id,row.category_id,row.price_tier_id,1,0,'SALE_RETURN',String(adjustmentId),
      Number(row.purchase_price||0),Number(item.Rate||0),Number(row.mrp||0),`Return against Bill ${sale.BillNo}`]);
  }else if(sourceType==='PRICE_BARCODE'){
    const id=Number(String(item.SaleItemID).replace('PB-',''));
    const [[pbsi]]=await conn.execute(`SELECT * FROM price_barcode_sale_items WHERE price_barcode_sale_item_id=? AND sale_id=? FOR UPDATE`,[id,sale.SaleID]);
    if(!pbsi)throw new Error('Price barcode sale item not found.');
    const [[pb]]=await conn.execute(`SELECT * FROM price_barcodes WHERE price_barcode_id=? FOR UPDATE`,[pbsi.price_barcode_id]);
    if(!pb||pb.status!=='SOLD'||String(pb.sold_sale_id||'')!==String(sale.SaleID))throw new Error(`Price barcode ${item.Barcode} is no longer sold under this bill.`);
    await conn.execute(`UPDATE price_barcodes SET status='AVAILABLE',sold_sale_id=NULL,sold_bill_no=NULL,sold_at=NULL WHERE price_barcode_id=?`,[pb.price_barcode_id]);
  }else if(sourceType==='DRESS_CODE_QTY'){
    const id=Number(String(item.SaleItemID).replace('DC-',''));
    const [[d]]=await conn.execute(`SELECT * FROM dress_code_manual_sale_items WHERE manual_sale_item_id=? AND sale_id=? FOR UPDATE`,[id,sale.SaleID]);
    if(!d)throw new Error('Dress Code sale item not found.');
    await conn.execute(`INSERT INTO stock_ledger
      (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      txnDate,'RETURN_IN',LOCATION_ID,d.dress_code,d.vendor_id,d.category_id,d.price_tier_id,qty,0,'SALE_RETURN',String(adjustmentId),
      Number(d.purchase_price_at_sale||0),Number(d.rate||0),Number(d.mrp||0),`Return against Bill ${sale.BillNo} | Code-only quantity`]);
  }else throw new Error('Unsupported return item type: '+sourceType);

  await conn.execute(`INSERT INTO sale_adjustment_items
    (adjustment_id,sale_id,source_type,source_item_id,barcode,qty,unit_credit,amount)
    VALUES (?,?,?,?,?,?,?,?)`,[adjustmentId,sale.SaleID,sourceType,sourceId,item.Barcode||item.DisplayCode||'',qty,unitCredit,amount]);
  return amount;
}

async function recordSaleReturn(data){
  await ensureReturnsSchema();
  const saleId=Number(data?.SaleID), reason=clean(data?.Reason), refundMode=upper(data?.RefundMode||'CASH');
  const selections=Array.isArray(data?.Items)?data.Items:[];
  if(!saleId)throw new Error('Select a bill.');
  if(!reason)throw new Error('Return reason is required.');
  if(!['CASH','UPI','CARD','CREDIT'].includes(refundMode))throw new Error('Select a valid refund mode.');
  if(!selections.length)throw new Error('Select at least one item to return.');
  const receipt=await getReturnBill(saleId);
  if(receipt.sale.Status==='CANCELLED')throw new Error('Cancelled bill cannot be returned.');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[locked]]=await conn.execute(`SELECT * FROM sales WHERE sale_id=? FOR UPDATE`,[saleId]);
    if(!locked||locked.status==='CANCELLED')throw new Error('Bill is cancelled or unavailable.');
    const [ar]=await conn.execute(`INSERT INTO sale_adjustments
      (sale_id,bill_no,adjustment_type,reason,amount,difference_amount,settlement_type,settlement_mode,status)
      VALUES (?,?, 'RETURN', ?,0,0,'REFUND',?,'COMPLETED')`,[saleId,receipt.sale.BillNo,reason,refundMode]);
    let total=0;
    for(const sel of selections){
      const item=receipt.items.find(x=>String(x.SaleItemID)===String(sel.SaleItemID)&&x.SourceType===sel.SourceType);
      if(!item)throw new Error('Selected return item was not found on the bill.');
      total=round2(total+await reverseOneReturnItem(conn,receipt.sale,item,Number(sel.Qty||0),ar.insertId,new Date().toISOString().slice(0,10)));
    }
    await conn.execute(`UPDATE sale_adjustments SET amount=? WHERE adjustment_id=?`,[total,ar.insertId]);
    await conn.commit();
    return {ok:true,adjustmentId:ar.insertId,refundAmount:total,refundMode,message:`Return saved. Refund ${refundMode} ₹${total.toFixed(2)}.`};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function cancelSaleBill(data){
  await ensureReturnsSchema();
  const saleId=Number(data?.SaleID),reason=clean(data?.Reason);
  if(!saleId)throw new Error('Select a bill.');
  if(!reason)throw new Error('Cancellation reason is required.');
  const receipt=await getReturnBill(saleId);
  if(receipt.sale.Status==='CANCELLED')throw new Error('This bill is already cancelled.');
  if(receipt.adjustments.some(a=>a.Status==='COMPLETED'&&['RETURN','EXCHANGE'].includes(a.Type)))throw new Error('This bill already has a return/exchange. Reverse those adjustments before cancelling the whole bill.');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[sale]]=await conn.execute(`SELECT * FROM sales WHERE sale_id=? FOR UPDATE`,[saleId]);
    if(!sale||sale.status==='CANCELLED')throw new Error('Bill is already cancelled or unavailable.');
    const [ar]=await conn.execute(`INSERT INTO sale_adjustments
      (sale_id,bill_no,adjustment_type,reason,amount,difference_amount,settlement_type,settlement_mode,status)
      VALUES (?,?, 'CANCEL', ?,?,0,'REFUND',?,'COMPLETED')`,[saleId,receipt.sale.BillNo,reason,Number(receipt.sale.NetAmount||0),receipt.sale.PaymentMode||'']);
    for(const item of receipt.items){
      const qty=Number(item.Qty||1);
      if(item.SourceType==='STOCK'){
        const [[u]]=await conn.execute(`SELECT * FROM inventory_units WHERE UPPER(piece_barcode)=? FOR UPDATE`,[upper(item.Barcode)]);
        if(u&&u.status==='SOLD'&&String(u.sold_sale_id||'')===String(saleId)){
          await conn.execute(`UPDATE inventory_units SET status='AVAILABLE',sold_sale_id=NULL,sold_bill_no=NULL,sold_at=NULL WHERE inventory_unit_id=?`,[u.inventory_unit_id]);
          await conn.execute(`INSERT INTO stock_ledger (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
            new Date().toISOString().slice(0,10),'CANCEL_IN',LOCATION_ID,item.Barcode,u.vendor_id,u.category_id,u.price_tier_id,1,0,'SALE_CANCEL',String(ar.insertId),Number(u.purchase_price||0),Number(item.Rate||0),Number(u.mrp||0),`Cancelled Bill ${receipt.sale.BillNo}`]);
        }
      }else if(item.SourceType==='PRICE_BARCODE'){
        const id=Number(String(item.SaleItemID).replace('PB-',''));
        const [[si]]=await conn.execute(`SELECT * FROM price_barcode_sale_items WHERE price_barcode_sale_item_id=? FOR UPDATE`,[id]);
        if(si)await conn.execute(`UPDATE price_barcodes SET status='AVAILABLE',sold_sale_id=NULL,sold_bill_no=NULL,sold_at=NULL WHERE price_barcode_id=? AND sold_sale_id=?`,[si.price_barcode_id,saleId]);
      }else if(item.SourceType==='DRESS_CODE_QTY'){
        const id=Number(String(item.SaleItemID).replace('DC-',''));
        const [[d]]=await conn.execute(`SELECT * FROM dress_code_manual_sale_items WHERE manual_sale_item_id=? FOR UPDATE`,[id]);
        if(d)await conn.execute(`INSERT INTO stock_ledger (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
          new Date().toISOString().slice(0,10),'CANCEL_IN',LOCATION_ID,d.dress_code,d.vendor_id,d.category_id,d.price_tier_id,qty,0,'SALE_CANCEL',String(ar.insertId),Number(d.purchase_price_at_sale||0),Number(d.rate||0),Number(d.mrp||0),`Cancelled Bill ${receipt.sale.BillNo} | Code-only quantity`]);
      }
      await conn.execute(`INSERT INTO sale_adjustment_items (adjustment_id,sale_id,source_type,source_item_id,barcode,qty,unit_credit,amount) VALUES (?,?,?,?,?,?,?,?)`,[
        ar.insertId,saleId,item.SourceType,adjustmentSourceId(item),item.Barcode||'',qty,proratedCredit(receipt.sale,item),round2(proratedCredit(receipt.sale,item)*qty)]);
    }
    await conn.execute(`UPDATE sales SET status='CANCELLED' WHERE sale_id=?`,[saleId]);
    await conn.commit();
    return {ok:true,adjustmentId:ar.insertId,refundAmount:Number(receipt.sale.NetAmount||0),message:`Bill ${receipt.sale.BillNo} cancelled and stock restored.`};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function recordSaleExchange(data){
  await ensureReturnsSchema();
  await ensurePriceBarcodeSchema();
  const saleId=Number(data?.SaleID),sourceType=upper(data?.SourceType),sourceItemId=String(data?.SaleItemID||''),reason=clean(data?.Reason),newBarcode=upper(data?.NewBarcode);
  const settlementMode=upper(data?.SettlementMode||'CASH');
  if(!saleId||!sourceItemId)throw new Error('Select the item being exchanged.');
  if(!reason)throw new Error('Exchange reason is required.');
  if(!newBarcode)throw new Error('Scan the replacement item barcode.');
  if(!['CASH','UPI','CARD','CREDIT'].includes(settlementMode))throw new Error('Select a valid settlement mode.');
  const receipt=await getReturnBill(saleId);
  if(receipt.sale.Status==='CANCELLED')throw new Error('Cancelled bill cannot be exchanged.');
  const oldItem=receipt.items.find(x=>String(x.SaleItemID)===sourceItemId&&x.SourceType===sourceType);
  if(!oldItem||Number(oldItem.ReturnableQty||0)<1)throw new Error('Selected item is no longer exchangeable.');
  if(upper(oldItem.Barcode)===newBarcode)throw new Error('Replacement barcode must be different from the returned barcode.');
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[lockedSale]]=await conn.execute(`SELECT * FROM sales WHERE sale_id=? FOR UPDATE`,[saleId]);
    if(!lockedSale||lockedSale.status==='CANCELLED')throw new Error('Bill is cancelled or unavailable.');

    let newType,newRate,newRow=null,newPb=null;
    newPb=await findPriceBarcode(conn,newBarcode,true);
    if(newPb){
      if(newPb.status!=='AVAILABLE'||newPb.location_id!==LOCATION_ID)throw new Error('Replacement price barcode is not available at this outlet.');
      newType='PRICE_BARCODE';newRate=Number(newPb.price||0);
    }else{
      newRow=await joinedUnitByBarcode(conn,newBarcode,true);
      if(!newRow||newRow.status!=='AVAILABLE'||newRow.location_id!==LOCATION_ID)throw new Error('Replacement stock barcode is not available at this outlet.');
      newType='STOCK';newRate=Number(newRow.selling_price||0);
    }
    const oldCredit=proratedCredit(receipt.sale,oldItem);
    const difference=round2(newRate-oldCredit);
    const settlementType=difference>0?'COLLECT':difference<0?'REFUND':'NONE';
    const [ar]=await conn.execute(`INSERT INTO sale_adjustments
      (sale_id,bill_no,adjustment_type,reason,amount,difference_amount,settlement_type,settlement_mode,new_barcode,status)
      VALUES (?,?, 'EXCHANGE', ?,?,?,?,?,?,'COMPLETED')`,[
      saleId,receipt.sale.BillNo,reason,oldCredit,Math.abs(difference),settlementType,settlementType==='NONE'?null:settlementMode,newBarcode]);
    await reverseOneReturnItem(conn,receipt.sale,oldItem,1,ar.insertId,new Date().toISOString().slice(0,10));

    if(newType==='PRICE_BARCODE'){
      await conn.execute(`UPDATE price_barcodes SET status='SOLD',sold_sale_id=?,sold_bill_no=?,sold_at=NOW() WHERE price_barcode_id=?`,[saleId,receipt.sale.BillNo,newPb.price_barcode_id]);
    }else{
      await conn.execute(`UPDATE inventory_units SET status='SOLD',sold_sale_id=?,sold_bill_no=?,sold_at=NOW() WHERE inventory_unit_id=?`,[saleId,receipt.sale.BillNo,newRow.inventory_unit_id]);
      await conn.execute(`INSERT INTO stock_ledger (txn_date,txn_type,location_id,barcode,vendor_id,category_id,price_tier_id,qty_in,qty_out,reference_type,reference_id,purchase_price,selling_price,mrp,remarks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        new Date().toISOString().slice(0,10),'EXCHANGE_OUT',LOCATION_ID,newBarcode,newRow.vendor_id,newRow.category_id,newRow.price_tier_id,0,1,'SALE_EXCHANGE',String(ar.insertId),Number(newRow.purchase_price||0),newRate,Number(newRow.mrp||0),`Exchange against Bill ${receipt.sale.BillNo}`]);
    }
    await conn.commit();
    return {ok:true,adjustmentId:ar.insertId,oldCredit,newRate,difference:Math.abs(difference),settlementType,settlementMode:settlementType==='NONE'?'':settlementMode,newBarcode,
      message:settlementType==='COLLECT'?`Exchange saved. Collect ₹${Math.abs(difference).toFixed(2)}.`:settlementType==='REFUND'?`Exchange saved. Refund ₹${Math.abs(difference).toFixed(2)}.`:'Exchange saved. No amount difference.'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}


/* =========================================================
   REPORTS / BUSINESS ANALYSIS
   Report calculations use the original bill date. Cancelled bills are
   excluded. Completed returns and exchanges are applied back to the
   original bill so historical sales/profit remain comparable.
   ========================================================= */
async function getReportsData(filters={}){
  await ensureReturnsSchema();
  await ensurePriceBarcodeSchema();
  await ensureMissingStickerSchema();

  const today=new Date().toISOString().slice(0,10);
  const from=clean(filters?.FromDate)||today.slice(0,8)+'01';
  const to=clean(filters?.ToDate)||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw new Error('Select a valid From Date and To Date.');
  if(from>to)throw new Error('From Date cannot be after To Date.');
  const vendorId=Number(filters?.VendorID||0),categoryId=Number(filters?.CategoryID||0);

  const [vendors]=await pool.query(`SELECT vendor_id,vendor_name FROM vendors WHERE active=1 ORDER BY vendor_name`);
  const [categories]=await pool.query(`SELECT category_id,category_name FROM categories WHERE active=1 ORDER BY category_name`);
  const [sales]=await pool.execute(`SELECT * FROM sales WHERE sale_date BETWEEN ? AND ? ORDER BY sale_date,sale_id`,[from,to]);
  const saleIds=sales.map(s=>Number(s.sale_id));

  let normal=[],price=[],manual=[],payments=[],adjustments=[],adjustmentItems=[];
  if(saleIds.length){
    const marks=saleIds.map(()=>'?').join(',');
    [normal]=await pool.query(`SELECT si.*,v.vendor_name,c.category_name,t.tier_code FROM sale_items si JOIN vendors v ON v.vendor_id=si.vendor_id JOIN categories c ON c.category_id=si.category_id JOIN price_tiers t ON t.price_tier_id=si.price_tier_id WHERE si.sale_id IN (${marks})`,saleIds);
    [price]=await pool.query(`SELECT p.* FROM price_barcode_sale_items p WHERE p.sale_id IN (${marks})`,saleIds);
    [manual]=await pool.query(`SELECT d.*,v.vendor_name,c.category_name,t.tier_code FROM dress_code_manual_sale_items d JOIN vendors v ON v.vendor_id=d.vendor_id JOIN categories c ON c.category_id=d.category_id JOIN price_tiers t ON t.price_tier_id=d.price_tier_id WHERE d.sale_id IN (${marks})`,saleIds);
    [payments]=await pool.query(`SELECT * FROM sale_payments WHERE sale_id IN (${marks})`,saleIds);
    [adjustments]=await pool.query(`SELECT * FROM sale_adjustments WHERE sale_id IN (${marks}) AND status='COMPLETED' ORDER BY created_at,adjustment_id`,saleIds);
    const adjIds=adjustments.map(a=>Number(a.adjustment_id));
    if(adjIds.length){
      const am=adjIds.map(()=>'?').join(',');
      [adjustmentItems]=await pool.query(`SELECT * FROM sale_adjustment_items WHERE adjustment_id IN (${am})`,adjIds);
    }
  }

  const salesById=new Map(sales.map(s=>[Number(s.sale_id),s]));
  const lines=[];
  const lineMap=new Map();
  function addBaseLine(sale,row,sourceType,sourceItemId,info){
    if(!sale||String(sale.status||'').toUpperCase()==='CANCELLED')return;
    const afterLine=Math.max(0,Number(sale.subtotal||0)-Number(sale.line_discount||0));
    const lineTotal=Number(row.line_total||0);
    const allocated=afterLine>0?Number(sale.bill_discount||0)*(lineTotal/afterLine):0;
    const line={
      SaleID:Number(sale.sale_id),BillNo:sale.bill_no,Date:String(sale.sale_date).slice(0,10),SourceType:sourceType,SourceItemID:String(sourceItemId),
      Barcode:info.barcode||'',VendorID:Number(info.vendorId||0),VendorName:info.vendorName||'',CategoryID:Number(info.categoryId||0),CategoryName:info.categoryName||'PRICE ITEM',
      TierCode:info.tierCode||'',Qty:Number(row.qty||1),Rate:Number(row.rate||0),Revenue:round2(lineTotal-allocated),COGS:round2(Number(info.purchasePrice||0)*Number(row.qty||1)),
      ReturnAmount:0,ExchangeDelta:0
    };
    lines.push(line);lineMap.set(sourceType+'|'+String(sourceItemId),line);
  }
  for(const r of normal)addBaseLine(salesById.get(Number(r.sale_id)),r,'STOCK',r.sale_item_id,{barcode:r.barcode,vendorId:r.vendor_id,vendorName:r.vendor_name,categoryId:r.category_id,categoryName:r.category_name,tierCode:r.tier_code,purchasePrice:r.purchase_price_at_sale});
  for(const r of price)addBaseLine(salesById.get(Number(r.sale_id)),r,'PRICE_BARCODE','PB-'+r.price_barcode_sale_item_id,{barcode:r.barcode,categoryName:'PRICE ITEM',tierCode:'PRICE BARCODE',purchasePrice:0});
  for(const r of manual)addBaseLine(salesById.get(Number(r.sale_id)),r,'DRESS_CODE_QTY','DC-'+r.manual_sale_item_id,{barcode:r.dress_code,vendorId:r.vendor_id,vendorName:r.vendor_name,categoryId:r.category_id,categoryName:r.category_name,tierCode:r.tier_code,purchasePrice:r.purchase_price_at_sale});

  // Apply returned old items (RETURN and EXCHANGE) to the original line.
  const adjById=new Map(adjustments.map(a=>[Number(a.adjustment_id),a]));
  for(const ai of adjustmentItems){
    const a=adjById.get(Number(ai.adjustment_id));
    if(!a||!['RETURN','EXCHANGE'].includes(String(a.adjustment_type||'').toUpperCase()))continue;
    const line=lineMap.get(String(ai.source_type)+'|'+String(ai.source_item_id));
    if(!line)continue;
    const q=Number(ai.qty||0),amt=Number(ai.amount||0),unitCost=line.Qty?line.COGS/line.Qty:0;
    line.Qty=round2(line.Qty-q);
    line.Revenue=round2(line.Revenue-amt);
    line.COGS=round2(line.COGS-unitCost*q);
    line.ReturnAmount=round2(line.ReturnAmount+amt);
  }

  // Add the replacement item of each exchange as a new effective sale line.
  const exchangeAdjs=adjustments.filter(a=>String(a.adjustment_type||'').toUpperCase()==='EXCHANGE'&&clean(a.new_barcode));
  const newCodes=[...new Set(exchangeAdjs.map(a=>upper(a.new_barcode)))];
  const replacementMap=new Map();
  if(newCodes.length){
    const marks=newCodes.map(()=>'?').join(',');
    const [units]=await pool.query(`SELECT u.*,v.vendor_name,c.category_name,t.tier_code FROM inventory_units u JOIN vendors v ON v.vendor_id=u.vendor_id JOIN categories c ON c.category_id=u.category_id JOIN price_tiers t ON t.price_tier_id=u.price_tier_id WHERE UPPER(u.piece_barcode) IN (${marks})`,newCodes);
    units.forEach(u=>replacementMap.set(upper(u.piece_barcode),{VendorID:Number(u.vendor_id),VendorName:u.vendor_name,CategoryID:Number(u.category_id),CategoryName:u.category_name,TierCode:u.tier_code,PurchasePrice:Number(u.purchase_price||0),Rate:Number(u.selling_price||0)}));
    const [pbs]=await pool.query(`SELECT * FROM price_barcodes WHERE UPPER(barcode) IN (${marks})`,newCodes);
    pbs.forEach(p=>replacementMap.set(upper(p.barcode),{VendorID:0,VendorName:'',CategoryID:0,CategoryName:'PRICE ITEM',TierCode:'PRICE BARCODE',PurchasePrice:0,Rate:Number(p.price||0)}));
  }
  for(const a of exchangeAdjs){
    const sale=salesById.get(Number(a.sale_id));if(!sale||String(sale.status||'').toUpperCase()==='CANCELLED')continue;
    const x=replacementMap.get(upper(a.new_barcode));if(!x)continue;
    lines.push({SaleID:Number(sale.sale_id),BillNo:sale.bill_no,Date:String(sale.sale_date).slice(0,10),SourceType:'EXCHANGE_NEW',SourceItemID:'EX-'+a.adjustment_id,Barcode:a.new_barcode,
      VendorID:x.VendorID,VendorName:x.VendorName,CategoryID:x.CategoryID,CategoryName:x.CategoryName,TierCode:x.TierCode,Qty:1,Rate:x.Rate,Revenue:round2(x.Rate),COGS:round2(x.PurchasePrice),ReturnAmount:0,ExchangeDelta:Number(a.difference_amount||0)});
  }

  const filteredLines=lines.filter(l=>(!vendorId||l.VendorID===vendorId)&&(!categoryId||l.CategoryID===categoryId));
  const effectiveSales=sales.filter(s=>String(s.status||'').toUpperCase()!=='CANCELLED');
  const activeSaleIds=new Set(filteredLines.map(l=>l.SaleID));
  const billCount=vendorId||categoryId?activeSaleIds.size:effectiveSales.length;
  const netSales=round2(filteredLines.reduce((s,l)=>s+l.Revenue,0));
  const qtySold=round2(filteredLines.reduce((s,l)=>s+l.Qty,0));
  const cogs=round2(filteredLines.reduce((s,l)=>s+l.COGS,0));
  const grossProfit=round2(netSales-cogs);
  const marginPct=netSales?round2(grossProfit/netSales*100):0;
  const returnAmount=round2(adjustments.filter(a=>String(a.adjustment_type).toUpperCase()==='RETURN').reduce((s,a)=>s+Number(a.amount||0),0));
  const cancelledBills=sales.filter(s=>String(s.status||'').toUpperCase()==='CANCELLED').length;

  function groupRows(keyFn,labelFn){
    const m=new Map();
    for(const l of filteredLines){const k=keyFn(l),label=labelFn(l);if(!m.has(k))m.set(k,{Key:k,Label:label,Qty:0,NetSales:0,COGS:0,Profit:0});const g=m.get(k);g.Qty+=l.Qty;g.NetSales+=l.Revenue;g.COGS+=l.COGS;}
    return [...m.values()].map(g=>({...g,Qty:round2(g.Qty),NetSales:round2(g.NetSales),COGS:round2(g.COGS),Profit:round2(g.NetSales-g.COGS),MarginPct:g.NetSales?round2((g.NetSales-g.COGS)/g.NetSales*100):0}));
  }
  const byDate=groupRows(l=>l.Date,l=>l.Date).sort((a,b)=>a.Key.localeCompare(b.Key));
  const byCategory=groupRows(l=>String(l.CategoryID||0)+'|'+l.CategoryName,l=>l.CategoryName).sort((a,b)=>b.NetSales-a.NetSales);
  const byVendor=groupRows(l=>String(l.VendorID||0)+'|'+(l.VendorName||'Unassigned'),l=>l.VendorName||'Unassigned').sort((a,b)=>b.NetSales-a.NetSales);
  const byPrice=groupRows(l=>String(round2(l.Rate)),l=>'₹'+Number(l.Rate||0).toFixed(2)).sort((a,b)=>Number(a.Key)-Number(b.Key));

  // Payment-mode view: posted collections less return refunds, plus/minus exchange settlement differences.
  const paymentMap=new Map();
  function pay(mode,amount){mode=upper(mode)||'UNSPECIFIED';paymentMap.set(mode,round2((paymentMap.get(mode)||0)+Number(amount||0)));}
  for(const p of payments){const sale=salesById.get(Number(p.sale_id));if(sale&&String(sale.status||'').toUpperCase()!=='CANCELLED')pay(p.payment_mode,p.amount);}
  for(const a of adjustments){const type=upper(a.adjustment_type);if(type==='RETURN')pay(a.settlement_mode,-Number(a.amount||0));else if(type==='EXCHANGE'){const sign=upper(a.settlement_type)==='COLLECT'?1:upper(a.settlement_type)==='REFUND'?-1:0;pay(a.settlement_mode,sign*Number(a.difference_amount||0));}}
  const paymentSummary=[...paymentMap.entries()].map(([PaymentMode,NetAmount])=>({PaymentMode,NetAmount})).sort((a,b)=>b.NetAmount-a.NetAmount);

  const adjustmentRows=adjustments.map(a=>({AdjustmentID:a.adjustment_id,BillNo:a.bill_no,Type:a.adjustment_type,Reason:a.reason,Amount:Number(a.amount||0),DifferenceAmount:Number(a.difference_amount||0),SettlementType:a.settlement_type||'',SettlementMode:a.settlement_mode||'',NewBarcode:a.new_barcode||'',CreatedAt:a.created_at}));
  const cancelledRows=sales.filter(s=>String(s.status||'').toUpperCase()==='CANCELLED').map(s=>({SaleID:s.sale_id,BillNo:s.bill_no,SaleDate:s.sale_date,CustomerName:s.customer_name||'',Mobile:s.customer_mobile||'',NetAmount:Number(s.net_amount||0)}));

  // Purchases in report date range.
  let purchaseSql=`SELECT p.*,v.vendor_name FROM purchases p JOIN vendors v ON v.vendor_id=p.vendor_id WHERE p.invoice_date BETWEEN ? AND ?`;
  const pp=[from,to];if(vendorId){purchaseSql+=' AND p.vendor_id=?';pp.push(vendorId);}purchaseSql+=' ORDER BY p.invoice_date,p.purchase_id';
  const [purchaseRowsRaw]=await pool.execute(purchaseSql,pp);
  const purchaseRows=purchaseRowsRaw.map(p=>({PurchaseID:p.purchase_id,Date:p.invoice_date,InvoiceNo:p.invoice_no,VendorID:p.vendor_id,VendorName:p.vendor_name,Qty:Number(p.total_qty||0),PurchaseValue:Number(p.purchase_value||0),Status:p.status||''}));
  const purchaseValue=round2(purchaseRows.reduce((s,p)=>s+p.PurchaseValue,0)),purchaseQty=round2(purchaseRows.reduce((s,p)=>s+p.Qty,0));

  // Current stock and ageing are current-position reports; date filters do not remove stock.
  let stockSql=`SELECT u.inventory_unit_id,u.piece_barcode,u.purchase_price,u.selling_price,u.created_at,p.invoice_date,u.vendor_id,v.vendor_name,u.category_id,c.category_name,u.price_tier_id,t.tier_code,u.size FROM inventory_units u JOIN vendors v ON v.vendor_id=u.vendor_id JOIN categories c ON c.category_id=u.category_id JOIN price_tiers t ON t.price_tier_id=u.price_tier_id LEFT JOIN purchases p ON p.purchase_id=u.purchase_id WHERE u.status='AVAILABLE' AND u.location_id=?`;
  const sp=[LOCATION_ID];if(vendorId){stockSql+=' AND u.vendor_id=?';sp.push(vendorId);}if(categoryId){stockSql+=' AND u.category_id=?';sp.push(categoryId);}
  const [stockUnits]=await pool.execute(stockSql,sp);
  const stockQty=stockUnits.length,stockCost=round2(stockUnits.reduce((s,u)=>s+Number(u.purchase_price||0),0)),stockRetail=round2(stockUnits.reduce((s,u)=>s+Number(u.selling_price||0),0));
  const ageNow=new Date(today+'T00:00:00Z');
  const buckets={'0-30 Days':{Qty:0,CostValue:0,RetailValue:0},'31-60 Days':{Qty:0,CostValue:0,RetailValue:0},'61-90 Days':{Qty:0,CostValue:0,RetailValue:0},'90+ Days':{Qty:0,CostValue:0,RetailValue:0}};
  for(const u of stockUnits){const d=new Date(String(u.invoice_date||u.created_at).slice(0,10)+'T00:00:00Z');const days=Math.max(0,Math.floor((ageNow-d)/86400000));const k=days<=30?'0-30 Days':days<=60?'31-60 Days':days<=90?'61-90 Days':'90+ Days';buckets[k].Qty++;buckets[k].CostValue+=Number(u.purchase_price||0);buckets[k].RetailValue+=Number(u.selling_price||0);}
  const stockAgeing=Object.entries(buckets).map(([Bucket,x])=>({Bucket,Qty:x.Qty,CostValue:round2(x.CostValue),RetailValue:round2(x.RetailValue)}));
  const stockByCategoryMap=new Map();for(const u of stockUnits){const k=u.category_name;if(!stockByCategoryMap.has(k))stockByCategoryMap.set(k,{Category:k,Qty:0,CostValue:0,RetailValue:0});const g=stockByCategoryMap.get(k);g.Qty++;g.CostValue+=Number(u.purchase_price||0);g.RetailValue+=Number(u.selling_price||0);}
  const stockByCategory=[...stockByCategoryMap.values()].map(g=>({...g,CostValue:round2(g.CostValue),RetailValue:round2(g.RetailValue)})).sort((a,b)=>b.Qty-a.Qty);

  // Fast/slow moving by current dress/tier code, using effective sales in the selected period.
  const movement=new Map();for(const l of filteredLines){const code=(l.Barcode||l.TierCode||'').split('-')[0]||l.TierCode||'UNKNOWN';if(!movement.has(code))movement.set(code,{Code:code,SoldQty:0,NetSales:0});const g=movement.get(code);g.SoldQty+=l.Qty;g.NetSales+=l.Revenue;}
  const codeStock=new Map();for(const u of stockUnits){const code=String(u.piece_barcode||'').split('-')[0]||u.tier_code||'UNKNOWN';codeStock.set(code,(codeStock.get(code)||0)+1);}
  const codes=new Set([...movement.keys(),...codeStock.keys()]);
  const movementRows=[...codes].map(code=>({Code:code,SoldQty:round2(movement.get(code)?.SoldQty||0),AvailableQty:Number(codeStock.get(code)||0),NetSales:round2(movement.get(code)?.NetSales||0)})).sort((a,b)=>b.SoldQty-a.SoldQty);

  return {
    filters:{FromDate:from,ToDate:to,VendorID:vendorId||'',CategoryID:categoryId||''},
    masters:{vendors:vendors.map(v=>({VendorID:v.vendor_id,VendorName:v.vendor_name})),categories:categories.map(c=>({CategoryID:c.category_id,CategoryName:c.category_name}))},
    summary:{BillCount:billCount,QtySold:qtySold,NetSales:netSales,COGS:cogs,GrossProfit:grossProfit,MarginPct:marginPct,ReturnAmount:returnAmount,CancelledBills:cancelledBills,PurchaseQty:purchaseQty,PurchaseValue:purchaseValue,StockQty:stockQty,StockCost:stockCost,StockRetail:stockRetail},
    sales:{byDate,byCategory,byVendor,byPrice,paymentSummary,adjustments:adjustmentRows,cancelledBills:cancelledRows},
    purchases:{rows:purchaseRows},
    stock:{ageing:stockAgeing,byCategory:stockByCategory,movement:movementRows}
  };
}

const METHODS = {
  getReportsData,
  getReturnBill,
  recordSaleReturn,
  recordSaleExchange,
  cancelSaleBill,
  getBarcodeEditInfo,
  deleteBarcodeProduct,
  updateBarcodeDetails,
  getPurchaseBarcodesByInvoice,
  getPurchaseSetup,
  getSavedPurchaseBarcodes,
  getCategoryPriceTiers,
  saveCategoryPriceTiers,
  getAppData,

  addVendor,

  addCategory,

  assignVendorCategory,

  addMaterial,

  addOrReusePriceTier,

  createPurchase,
  createImportedPurchase,

  createSale,
  createPriceBarcodes,

  getSaleReceipt,
  getLatestSaleForPrint,
  searchSalesForDuplicate,

  getStockLedger,

  getBillingItemByBarcode,
  getDressCodeStickerInfo,

  getPurchaseTierByCode,

  getRecentPurchasesFast,
};

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,

    service: "textile-api",
  });
});

app.get("/api/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT NOW() AS db_time");

    res.json({ ok: true, database: "connected", dbTime: rows[0].db_time });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.get("/api/debug-env", (_req, res) => {
  res.json({
    DB_NAME: process.env.DB_NAME || null,

    DB_HOST: process.env.DB_HOST || null,

    DB_PORT: process.env.DB_PORT || null,

    DB_USER: process.env.DB_USER || null,
  });
});

app.post("/api/rpc", async (req, res) => {
  const method = clean(req.body?.method);

  const args = Array.isArray(req.body?.args) ? req.body.args : [];

  if (!METHODS[method])
    return res

      .status(404)

      .json({ ok: false, message: "Unknown API method: " + method });

  try {
    const result = await METHODS[method](...args);

    res.json({ ok: true, result });
  } catch (e) {
    console.error(method, e);

    res.status(400).json({ ok: false, message: e.message || String(e) });
  }
});

installDatabaseAdmin(app, pool);

app.listen(PORT, () => {
  console.log(`Textile API running on http://localhost:${PORT}`);

  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
