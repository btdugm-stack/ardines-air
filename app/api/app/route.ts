import { env } from "cloudflare:workers";
import {
  allowedTransitions, normalizePaymentMethod, parseAmount, parseQty, pointsFor, shippingFor,
} from "../../../lib/business";

type ProductRow = {
  id: string; sku: string; name: string; category: string; unit: string;
  price: number; stock: number; reserved: number; min_stock: number; accent: string;
};

type OrderRow = {
  id: string; order_no: string; user_id: string | null; customer_name: string;
  phone: string; address: string; fulfillment: string; status: string;
  payment_status: string; payment_method: string; total: number; points_earned: number; created_at: string;
};

const SESSION_COOKIE = "depot_session";
const ADMIN_EMAIL = "admin@segardepot.local";
const ADMIN_PASSWORD = "Admin123!";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    category TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL,
    stock INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5, accent TEXT NOT NULL DEFAULT '#0B7A75'
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, user_id TEXT,
    customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
    fulfillment TEXT NOT NULL, status TEXT NOT NULL, payment_status TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    total INTEGER NOT NULL, points_earned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
    product_name TEXT NOT NULL, unit TEXT NOT NULL, qty INTEGER NOT NULL,
    unit_price INTEGER NOT NULL, subtotal INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, qty INTEGER NOT NULL,
    movement_type TEXT NOT NULL, reference_id TEXT, reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL,
    amount INTEGER NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, points INTEGER NOT NULL,
    movement_type TEXT NOT NULL, order_id TEXT, created_at TEXT NOT NULL,
    UNIQUE(order_id, movement_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
];

const seedProducts = [
  ["prd-aqua-galon", "AQ-G19", "Aqua Galon 19 L", "Air Galon", "galon", 23000, 28, 6, "#176B87"],
  ["prd-lemin-galon", "LM-G15", "Le Minerale Galon 15 L", "Air Galon", "galon", 21000, 24, 6, "#D44B52"],
  ["prd-pure-galon", "PL-G15", "Pure Life Galon 15 L", "Air Galon", "galon", 20000, 18, 5, "#2895A9"],
  ["prd-aqua-botol", "AQ-B600", "Aqua Botol 600 ml", "Air Botol", "botol", 4000, 96, 24, "#2482C5"],
  ["prd-botol-dus", "AQ-D600", "Aqua 600 ml — 1 Dus", "Air Botol", "dus", 76000, 14, 4, "#4AA3D8"],
  ["prd-es-kristal", "ES-K5", "Es Batu Kristal 5 kg", "Es Batu", "bungkus", 12000, 32, 8, "#6CBCCF"],
  ["prd-es-ecer", "ES-E1", "Es Batu Eceran 1 kg", "Es Batu", "bungkus", 3000, 45, 10, "#91D5E4"],
];

function db() {
  if (!env.DB) throw new Error("Database lokal belum aktif. Jalankan aplikasi melalui npm run dev.");
  return env.DB;
}

let ready = false;

async function ensureReady() {
  if (ready) return;
  await db().batch(schemaStatements.map((sql) => db().prepare(sql)));
  const cols = await db().prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  if (!cols.results.some((c) => c.name === "payment_method")) {
    await db().prepare("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cod'").run();
  }
  const count = await db().prepare("SELECT COUNT(*) AS total FROM products").first<{ total: number }>();
  if (!count?.total) {
    await db().batch(seedProducts.map((p) => db().prepare(
      "INSERT INTO products (id, sku, name, category, unit, price, stock, reserved, min_stock, accent) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(...p)));
  }
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO users (id, name, email, role, points) VALUES (?, ?, ?, ?, ?)")
      .bind("usr-admin", "Admin Depot", ADMIN_EMAIL, "admin", 0),
    db().prepare("INSERT OR IGNORE INTO users (id, name, email, role, points) VALUES (?, ?, ?, ?, ?)")
      .bind("usr-member", "Nadia Pelanggan", "member.demo@gmail.com", "member", 120),
  ]);
  ready = true;
}

function json(data: unknown, init?: ResponseInit) { return Response.json(data, init); }
function randomId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function todayOrderNo() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date()).replaceAll("-", "");
  return `ORD-${date}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function nextOrderNo() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = todayOrderNo();
    const existing = await db().prepare("SELECT 1 FROM orders WHERE order_no = ?").bind(candidate).first();
    if (!existing) return candidate;
  }
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function currentUser(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db().prepare(
    `SELECT u.id, u.name, u.email, u.role, u.points FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, new Date().toISOString()).first<{ id: string; name: string; email: string; role: string; points: number }>();
}

async function orderItems(orderId: string) {
  const result = await db().prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").bind(orderId).all();
  return result.results;
}

async function hydrateOrders(rows: OrderRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const result = await db().prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`).bind(...ids).all();
  const byOrder = new Map<string, typeof result.results>();
  for (const item of result.results) {
    const list = byOrder.get(item.order_id as string) ?? [];
    list.push(item);
    byOrder.set(item.order_id as string, list);
  }
  return rows.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
}

async function grantPointsIfEligible(orderId: string) {
  const order = await db().prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order?.user_id || order.status !== "completed" || order.payment_status !== "paid" || order.points_earned > 0) return;
  const points = pointsFor(order.total);
  if (points <= 0) return;
  const claimed = await db().prepare("UPDATE orders SET points_earned = ? WHERE id = ? AND points_earned = 0")
    .bind(points, orderId).run();
  if ((claimed.meta?.changes ?? 0) !== 1) return;
  await db().batch([
    db().prepare("UPDATE users SET points = points + ? WHERE id = ?").bind(points, order.user_id),
    db().prepare("INSERT OR IGNORE INTO loyalty_ledger (id, user_id, points, movement_type, order_id, created_at) VALUES (?, ?, ?, 'earn', ?, ?)")
      .bind(randomId("loy"), order.user_id, points, orderId, new Date().toISOString()),
  ]);
}

const trackAttempts = new Map<string, { count: number; resetAt: number }>();

function trackThrottled(ip: string): boolean {
  const now = Date.now();
  if (trackAttempts.size > 2000) {
    for (const [key, value] of trackAttempts) {
      if (value.resetAt < now) trackAttempts.delete(key);
    }
  }
  const entry = trackAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    trackAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function GET(request: Request) {
  try {
    await ensureReady();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "store";
    const user = await currentUser(request);

    if (view === "store") {
      const products = await db().prepare("SELECT * FROM products ORDER BY category, name").all<ProductRow>();
      return json({ products: products.results, user });
    }
    if (view === "me") return json({ user });
    if (view === "track") {
      if (trackThrottled(clientIp(request))) return json({ error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." }, { status: 429 });
      const orderNo = (url.searchParams.get("orderNo") ?? "").trim().toUpperCase();
      const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
      if (phone.length < 6) return json({ error: "Masukkan minimal 6 digit terakhir nomor WhatsApp." }, { status: 422 });
      const order = await db().prepare(
        "SELECT * FROM orders WHERE order_no = ? AND REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ?"
      ).bind(orderNo, `%${phone.slice(-6)}`).first<OrderRow>();
      if (!order) return json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
      return json({ order: { ...order, items: await orderItems(order.id) } });
    }
    if (view === "member") {
      if (!user || user.role !== "member") return json({ error: "Silakan masuk sebagai member." }, { status: 401 });
      const orders = await db().prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all<OrderRow>();
      const ledger = await db().prepare("SELECT * FROM loyalty_ledger WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
      return json({ user, orders: await hydrateOrders(orders.results), ledger: ledger.results });
    }
    if (view === "admin") {
      if (!user || user.role !== "admin") return json({ error: "Akses admin diperlukan." }, { status: 401 });
      const [orders, products, expenses, completed, pending, movements] = await Promise.all([
        db().prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").all<OrderRow>(),
        db().prepare("SELECT * FROM products ORDER BY category, name").all<ProductRow>(),
        db().prepare("SELECT * FROM expenses ORDER BY created_at DESC LIMIT 50").all(),
        db().prepare("SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS total FROM orders WHERE status = 'completed' AND payment_status = 'paid'").first<{ revenue: number; total: number }>(),
        db().prepare("SELECT COUNT(*) AS total FROM orders WHERE status IN ('new', 'confirmed', 'preparing', 'ready', 'delivering')").first<{ total: number }>(),
        db().prepare("SELECT * FROM inventory_movements ORDER BY created_at DESC LIMIT 200").all(),
      ]);
      const expenseTotal = (expenses.results as Array<{ amount: number }>).reduce((sum, e) => sum + Number(e.amount), 0);
      return json({ user, orders: await hydrateOrders(orders.results), products: products.results, expenses: expenses.results, movements: movements.results,
        metrics: { revenue: completed?.revenue ?? 0, completed: completed?.total ?? 0, pending: pending?.total ?? 0, expenses: expenseTotal } });
    }
    return json({ error: "View tidak dikenali." }, { status: 400 });
  } catch (error) {
    console.error("[api/app]", error);
    return json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureReady();
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ error: "Permintaan tidak diizinkan." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "login_admin") {
      if (String(body.email).toLowerCase() !== ADMIN_EMAIL || String(body.password) !== ADMIN_PASSWORD) {
        return json({ error: "Email atau password admin tidak sesuai." }, { status: 401 });
      }
      return createSession(request, "usr-admin");
    }
    if (action === "login_member_demo") return createSession(request, "usr-member");
    if (action === "logout") {
      const token = readCookie(request, SESSION_COOKIE);
      if (token) await db().prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return new Response(JSON.stringify({ ok: true }), { headers: {
        "content-type": "application/json", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      }});
    }

    if (action === "create_order") return createOrder(request, body);

    const user = await currentUser(request);
    if (!user || user.role !== "admin") return json({ error: "Akses admin diperlukan." }, { status: 401 });

    if (action === "update_order") return updateOrder(body);
    if (action === "create_product") return createProduct(body);
    if (action === "update_product") return updateProduct(body);
    if (action === "delete_product") return deleteProduct(body);
    if (action === "mark_paid") {
      const orderId = String(body.orderId ?? "");
      await db().prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND status != 'cancelled'").bind(orderId).run();
      await grantPointsIfEligible(orderId);
      return json({ ok: true });
    }
    if (action === "adjust_stock") {
      const productId = String(body.productId ?? "");
      const delta = Math.trunc(Number(body.delta ?? 0));
      if (!delta) return json({ error: "Jumlah penyesuaian tidak valid." }, { status: 422 });
      const product = await db().prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<ProductRow>();
      if (!product || product.stock + delta < 0) return json({ error: "Penyesuaian membuat stok negatif." }, { status: 409 });
      const now = new Date().toISOString();
      await db().batch([
        db().prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(delta, productId),
        db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reason, created_at) VALUES (?, ?, ?, 'adjustment', 'Penyesuaian admin', ?)")
          .bind(randomId("mov"), productId, delta, now),
      ]);
      return json({ ok: true });
    }
    if (action === "add_expense") {
      const category = String(body.category ?? "Operasional").trim();
      const description = String(body.description ?? "").trim();
      const amount = parseAmount(body.amount);
      if (!description || amount === null) return json({ error: "Deskripsi dan nominal biaya wajib valid." }, { status: 422 });
      await db().prepare("INSERT INTO expenses (id, category, description, amount, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(randomId("exp"), category, description, amount, new Date().toISOString()).run();
      return json({ ok: true });
    }
    return json({ error: "Aksi tidak dikenali." }, { status: 400 });
  } catch (error) {
    console.error("[api/app]", error);
    return json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

async function createOrder(request: Request, body: Record<string, unknown>) {
  const customerName = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
  const address = String(body.address ?? "").trim();
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  const inputItems = Array.isArray(body.items) ? body.items as Array<{ productId?: string; qty?: number }> : [];
  if (customerName.length < 2 || phone.replace(/\D/g, "").length < 9) return json({ error: "Nama dan nomor WhatsApp wajib valid." }, { status: 422 });
  if (fulfillment === "delivery" && address.length < 8) return json({ error: "Alamat pengiriman belum lengkap." }, { status: 422 });
  if (!inputItems.length) return json({ error: "Keranjang masih kosong." }, { status: 422 });

  const selected: Array<{ product: ProductRow; qty: number }> = [];
  let subtotal = 0;
  for (const item of inputItems) {
    const qty = parseQty(item.qty);
    if (qty === null) return json({ error: "Jumlah produk tidak valid." }, { status: 422 });
    const product = await db().prepare("SELECT * FROM products WHERE id = ?").bind(item.productId).first<ProductRow>();
    if (!product) return json({ error: "Salah satu produk tidak tersedia." }, { status: 422 });
    if (product.stock - product.reserved < qty) return json({ error: `Stok ${product.name} tidak mencukupi.` }, { status: 409 });
    selected.push({ product, qty }); subtotal += product.price * qty;
  }
  const shipping = shippingFor(fulfillment);
  const total = subtotal + shipping;
  const user = await currentUser(request);
  const orderId = randomId("ord"); const orderNo = await nextOrderNo(); const now = new Date().toISOString();
  const statements = [db().prepare(
    `INSERT INTO orders (id, order_no, user_id, customer_name, phone, address, fulfillment, status, payment_status, payment_method, total, points_earned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'unpaid', ?, ?, 0, ?)`
  ).bind(orderId, orderNo, user?.role === "member" ? user.id : null, customerName, phone, address, fulfillment, paymentMethod, total, now)];
  for (const { product, qty } of selected) {
    statements.push(
      db().prepare("INSERT INTO order_items (order_id, product_id, product_name, unit, qty, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(orderId, product.id, product.name, product.unit, qty, product.price, product.price * qty),
      db().prepare("UPDATE products SET reserved = reserved + ? WHERE id = ? AND stock - reserved >= ?").bind(qty, product.id, qty),
      db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reference_id, reason, created_at) VALUES (?, ?, ?, 'reserve', ?, 'Reservasi order baru', ?)")
        .bind(randomId("mov"), product.id, qty, orderId, now),
    );
  }
  await db().batch(statements);
  return json({ ok: true, orderNo, orderId, total }, { status: 201 });
}

function productFields(body: Record<string, unknown>) {
  const sku = String(body.sku ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim();
  const unit = String(body.unit ?? "").trim();
  const price = Math.trunc(Number(body.price));
  const stock = Math.trunc(Number(body.stock ?? 0));
  const minStock = Math.trunc(Number(body.minStock ?? body.min_stock ?? 0));
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(body.accent ?? "")) ? String(body.accent) : "#0B7A75";
  const valid = sku.length >= 2 && sku.length <= 40 && name.length >= 2 && category.length >= 1 && unit.length >= 1
    && Number.isFinite(price) && price >= 0
    && Number.isFinite(stock) && stock >= 0
    && Number.isFinite(minStock) && minStock >= 0;
  return valid ? { sku, name, category, unit, price, stock, minStock, accent } : null;
}

async function skuTaken(sku: string, excludeId?: string) {
  const existing = await db().prepare("SELECT id FROM products WHERE sku = ?").bind(sku).first<{ id: string }>();
  return existing ? (excludeId ? existing.id !== excludeId : true) : false;
}

async function createProduct(body: Record<string, unknown>) {
  const fields = productFields(body);
  if (!fields) return json({ error: "Data produk tidak valid. Periksa SKU, nama, harga, dan stok." }, { status: 422 });
  if (await skuTaken(fields.sku)) return json({ error: `SKU ${fields.sku} sudah dipakai produk lain.` }, { status: 409 });
  const id = randomId("prd");
  const now = new Date().toISOString();
  await db().batch([
    db().prepare("INSERT INTO products (id, sku, name, category, unit, price, stock, reserved, min_stock, accent) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .bind(id, fields.sku, fields.name, fields.category, fields.unit, fields.price, fields.stock, fields.minStock, fields.accent),
    db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reason, created_at) VALUES (?, ?, ?, 'adjustment', 'Produk baru', ?)")
      .bind(randomId("mov"), id, fields.stock, now),
  ]);
  return json({ ok: true, productId: id }, { status: 201 });
}

async function updateProduct(body: Record<string, unknown>) {
  const productId = String(body.productId ?? "");
  const product = await db().prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<ProductRow>();
  if (!product) return json({ error: "Produk tidak ditemukan." }, { status: 404 });
  const fields = productFields(body);
  if (!fields) return json({ error: "Data produk tidak valid. Periksa SKU, nama, harga, dan stok." }, { status: 422 });
  if (await skuTaken(fields.sku, productId)) return json({ error: `SKU ${fields.sku} sudah dipakai produk lain.` }, { status: 409 });
  await db().prepare("UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, price = ?, min_stock = ?, accent = ? WHERE id = ?")
    .bind(fields.sku, fields.name, fields.category, fields.unit, fields.price, fields.minStock, fields.accent, productId).run();
  return json({ ok: true });
}

async function deleteProduct(body: Record<string, unknown>) {
  const productId = String(body.productId ?? "");
  const product = await db().prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<ProductRow>();
  if (!product) return json({ error: "Produk tidak ditemukan." }, { status: 404 });
  if (product.reserved > 0) return json({ error: "Tidak bisa dihapus — stok masih dipesan pesanan aktif." }, { status: 409 });
  await db().prepare("DELETE FROM products WHERE id = ?").bind(productId).run();
  return json({ ok: true });
}

async function updateOrder(body: Record<string, unknown>) {
  const orderId = String(body.orderId ?? ""); const target = String(body.status ?? "");
  const order = await db().prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) return json({ error: "Order tidak ditemukan." }, { status: 404 });
  if (!allowedTransitions(order.status, order.fulfillment).includes(target)) return json({ error: `Transisi ${order.status} ke ${target} tidak diizinkan.` }, { status: 409 });
  const items = await orderItems(order.id) as Array<{ product_id: string; qty: number }>;
  const statements = [db().prepare("UPDATE orders SET status = ? WHERE id = ?").bind(target, order.id)];
  const now = new Date().toISOString();
  for (const item of items) {
    if (target === "preparing") {
      statements.push(
        db().prepare("UPDATE products SET stock = stock - ?, reserved = MAX(0, reserved - ?) WHERE id = ?").bind(item.qty, item.qty, item.product_id),
        db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reference_id, reason, created_at) VALUES (?, ?, ?, 'sale', ?, 'Barang mulai disiapkan', ?)")
          .bind(randomId("mov"), item.product_id, -item.qty, order.id, now),
      );
    } else if (target === "cancelled" && ["new", "confirmed"].includes(order.status)) {
      statements.push(db().prepare("UPDATE products SET reserved = MAX(0, reserved - ?) WHERE id = ?").bind(item.qty, item.product_id));
    } else if (target === "cancelled") {
      statements.push(
        db().prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(item.qty, item.product_id),
        db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reference_id, reason, created_at) VALUES (?, ?, ?, 'return', ?, 'Order dibatalkan', ?)")
          .bind(randomId("mov"), item.product_id, item.qty, order.id, now),
      );
    }
  }
  await db().batch(statements); await grantPointsIfEligible(order.id);
  return json({ ok: true });
}

async function createSession(request: Request, userId: string) {
  await db().prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()).run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db().prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expires.toISOString()).run();
  const user = await db().prepare("SELECT id, name, email, role, points FROM users WHERE id = ?").bind(userId).first();
  const secure = request.url.startsWith("https://") ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true, user }), { headers: {
    "content-type": "application/json", "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=604800`
  }});
}
