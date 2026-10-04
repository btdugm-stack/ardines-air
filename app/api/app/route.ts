import { env } from "cloudflare:workers";
import {
  allowedTransitions, normalizePaymentMethod, parseAmount, parseQty, pointsFor,
} from "../../../lib/business";

type ProductRow = {
  id: string; sku: string; name: string; category: string; unit: string;
  price: number; stock: number; reserved: number; min_stock: number; accent: string; image: string | null;
};

type OrderRow = {
  id: string; order_no: string; user_id: string | null; customer_name: string;
  phone: string; address: string; fulfillment: string; status: string;
  payment_status: string; payment_method: string; total: number; points_earned: number;
  order_type: string; created_at: string;
};

type RewardRow = {
  id: string; name: string; description: string; points_cost: number;
  stock: number | null; active: number; product_id: string | null; created_at: string;
};

type RedemptionRow = {
  id: string; user_id: string; reward_id: string; reward_name: string; order_id: string | null;
  points_cost: number; status: string; created_at: string;
};

const SESSION_COOKIE = "depot_session";

/* ===== Kredensial admin =====
   PRODUKSI: isi dua Workers Secrets — ADMIN_EMAIL dan ADMIN_PASSWORD_HASH.
   Buat hash-nya dengan: node scripts/hash-password.mjs "password-baru"
   Begitu keduanya terisi, MODE DEMO mati otomatis: akun dummy admin/member
   berhenti berfungsi dan kredensialnya tidak lagi ditampilkan di layar login.

   MODE DEMO (selama secret belum diisi): akun dummy di bawah tetap aktif agar
   fungsi aplikasi bisa dicek. Jangan buka domain publik dalam mode ini. */
const DEMO_ADMIN_EMAIL = "admin@ardines.local";
const DEMO_ADMIN_PASSWORD = "Admin123!";

type Secrets = { adminEmail: string; adminHash: string };

function secrets(): Secrets {
  const vars = env as unknown as Record<string, string | undefined>;
  return {
    adminEmail: (vars.ADMIN_EMAIL ?? "").trim().toLowerCase(),
    adminHash: (vars.ADMIN_PASSWORD_HASH ?? "").trim(),
  };
}

/** Mode demo aktif selama ADMIN_EMAIL + ADMIN_PASSWORD_HASH belum diisi. */
function demoMode(): boolean {
  const s = secrets();
  return !(s.adminEmail && s.adminHash);
}

/** Perbandingan waktu-tetap agar durasi respons tidak membocorkan isi kredensial. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Verifikasi password terhadap hash "pbkdf2$<iterasi>$<salt-b64>$<hash-b64>". */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt: Uint8Array;
  try { salt = base64ToBytes(parts[2]); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" }, key, 256
  );
  return timingSafeEqual(bytesToBase64(new Uint8Array(bits)), parts[3]);
}

/** Cek kredensial admin. Mode demo → bandingkan konstanta; produksi → PBKDF2. */
async function adminCredentialsValid(email: string, password: string): Promise<boolean> {
  const s = secrets();
  if (demoMode()) {
    return timingSafeEqual(email.toLowerCase(), DEMO_ADMIN_EMAIL) && timingSafeEqual(password, DEMO_ADMIN_PASSWORD);
  }
  if (!timingSafeEqual(email.toLowerCase(), s.adminEmail)) {
    await verifyPassword(password, s.adminHash); // samakan biaya kerja
    return false;
  }
  return verifyPassword(password, s.adminHash);
}

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
    min_stock INTEGER NOT NULL DEFAULT 5, accent TEXT NOT NULL DEFAULT '#0B7A75',
    image TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, user_id TEXT,
    customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
    fulfillment TEXT NOT NULL, status TEXT NOT NULL, payment_status TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    total INTEGER NOT NULL, points_earned INTEGER NOT NULL DEFAULT 0,
    order_type TEXT NOT NULL DEFAULT 'regular', created_at TEXT NOT NULL
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
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    points_cost INTEGER NOT NULL, stock INTEGER, active INTEGER NOT NULL DEFAULT 1,
    product_id TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reward_id TEXT NOT NULL,
    reward_name TEXT NOT NULL, points_cost INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id)`,
  // Pembatas laju lintas isolate. Map di memori hanya berlaku per-isolate Worker,
  // jadi hitungan percobaan harus disimpan di D1 agar benar-benar mengikat.
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    scope TEXT NOT NULL, ip TEXT NOT NULL, count INTEGER NOT NULL,
    window_start INTEGER NOT NULL, PRIMARY KEY (scope, ip)
  )`,
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

/* Dimemoisasi sebagai promise, bukan boolean: dua permintaan bersamaan di satu
   isolate harus menunggu migrasi yang sama, bukan menjalankannya dua kali.
   Direset saat gagal agar permintaan berikutnya bisa mencoba lagi. */
let readyPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  readyPromise ??= runMigrations().catch((error) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

async function runMigrations() {
  await db().batch(schemaStatements.map((sql) => db().prepare(sql)));
  const cols = await db().prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  if (!cols.results.some((c) => c.name === "payment_method")) {
    await db().prepare("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cod'").run();
  }
  const pcols = await db().prepare("PRAGMA table_info(products)").all<{ name: string }>();
  if (!pcols.results.some((c) => c.name === "image")) {
    await db().prepare("ALTER TABLE products ADD COLUMN image TEXT").run();
  }
  const count = await db().prepare("SELECT COUNT(*) AS total FROM products").first<{ total: number }>();
  if (!count?.total) {
    // OR IGNORE: dua permintaan pertama setelah deploy bisa sama-sama membaca
    // COUNT = 0; tanpa ini yang kedua melanggar UNIQUE(sku) dan berakhir 500.
    await db().batch(seedProducts.map((p) => db().prepare(
      "INSERT OR IGNORE INTO products (id, sku, name, category, unit, price, stock, reserved, min_stock, accent) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(...p)));
  }
  await db().batch([
    db().prepare("INSERT OR IGNORE INTO users (id, name, email, role, points) VALUES (?, ?, ?, ?, ?)")
      .bind("usr-admin", "Admin Depot", secrets().adminEmail || DEMO_ADMIN_EMAIL, "admin", 0),
    db().prepare("INSERT OR IGNORE INTO users (id, name, email, role, points) VALUES (?, ?, ?, ?, ?)")
      .bind("usr-member", "Nadia Pelanggan", "member.demo@gmail.com", "member", 120),
  ]);
  // Selaraskan email admin bila ADMIN_EMAIL (atau email demo) berubah setelah
  // baris usr-admin terlanjur dibuat — INSERT OR IGNORE di atas tidak memperbarui.
  const adminEmail = secrets().adminEmail || DEMO_ADMIN_EMAIL;
  await db().prepare("UPDATE users SET email = ? WHERE id = 'usr-admin' AND email != ?")
    .bind(adminEmail, adminEmail).run();
  await ensureSettings();
  // Migrasi: kolom product_id di rewards (reward terkait produk persediaan)
  const rewardCols = await db().prepare("PRAGMA table_info(rewards)").all<{ name: string }>();
  if (!rewardCols.results.some((c) => c.name === "product_id")) {
    await db().prepare("ALTER TABLE rewards ADD COLUMN product_id TEXT").run();
  }
  // Migrasi: kolom order_type di orders (regular vs redeem) + order_id di redemptions
  const orderCols = await db().prepare("PRAGMA table_info(orders)").all<{ name: string }>();
  if (!orderCols.results.some((c) => c.name === "order_type")) {
    await db().prepare("ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'regular'").run();
  }
  const redCols = await db().prepare("PRAGMA table_info(redemptions)").all<{ name: string }>();
  if (!redCols.results.some((c) => c.name === "order_id")) {
    await db().prepare("ALTER TABLE redemptions ADD COLUMN order_id TEXT").run();
  }
  // Buang jendela pembatas laju yang sudah lewat sehari agar tabel tidak menumpuk.
  await db().prepare("DELETE FROM auth_attempts WHERE window_start < ?").bind(Date.now() - 86_400_000).run();
}

function json(data: unknown, init?: ResponseInit) { return Response.json(data, init); }
function randomId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

/* Settings: ongkir. Default Rp5.000. */
async function getSettings() {
  const rows = await db().prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key] = r.value;
  return {
    deliveryFee: Math.max(0, Math.trunc(Number(map.delivery_fee ?? 5000))),
    // Klien memakai ini untuk menampilkan/menyembunyikan kredensial dummy.
    demoMode: demoMode(),
  };
}

async function ensureSettings() {
  await db().prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('delivery_fee', '5000')").run();
}

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

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/* Pembatas laju berbasis D1 — satu upsert atomik dengan RETURNING, sehingga
   hitungannya benar walau permintaan tersebar ke banyak isolate Worker.
   Jendela bergulir: hitungan direset saat window_start sudah lewat batas. */
async function rateLimited(scope: string, ip: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const row = await db().prepare(
    `INSERT INTO auth_attempts (scope, ip, count, window_start) VALUES (?, ?, 1, ?)
     ON CONFLICT(scope, ip) DO UPDATE SET
       count = CASE WHEN auth_attempts.window_start < ? THEN 1 ELSE auth_attempts.count + 1 END,
       window_start = CASE WHEN auth_attempts.window_start < ? THEN ? ELSE auth_attempts.window_start END
     RETURNING count`
  ).bind(scope, ip, now, cutoff, cutoff, now).first<{ count: number }>();
  return (row?.count ?? 1) > limit;
}

/** Nolkan penghitung setelah login berhasil, agar salah ketik yang tersebar
    sepanjang hari tidak menumpuk sampai mengunci admin yang sah. */
async function clearRateLimit(scope: string, ip: string) {
  await db().prepare("DELETE FROM auth_attempts WHERE scope = ? AND ip = ?").bind(scope, ip).run();
}

/* Tolak permintaan lintas-origin. Sec-Fetch-Site saja tidak cukup: header itu
   opsional, jadi Origin diperiksa sebagai lapis kedua dan permintaan yang tidak
   membawa keduanya ditolak (bukan berasal dari browser). */
function crossOriginBlocked(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).origin !== new URL(request.url).origin; }
    catch { return true; }
  }
  return !site;
}

export async function GET(request: Request) {
  try {
    await ensureReady();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "store";
    const user = await currentUser(request);

    if (view === "store") {
      const products = await db().prepare("SELECT * FROM products ORDER BY category, name").all<ProductRow>();
      const settings = await getSettings();
      return json({ products: products.results, user, settings });
    }
    if (view === "me") return json({ user });
    if (view === "track") {
      if (await rateLimited("track", clientIp(request), 10, 60_000)) {
        return json({ error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." }, { status: 429 });
      }
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
      const rewards = await db().prepare("SELECT * FROM rewards WHERE active = 1 AND (stock IS NULL OR stock > 0) ORDER BY points_cost").all();
      const redemptions = await db().prepare("SELECT * FROM redemptions WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
      return json({ user, orders: await hydrateOrders(orders.results), ledger: ledger.results, rewards: rewards.results, redemptions: redemptions.results });
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
      const [settings, rewards, redemptions] = await Promise.all([
        getSettings(),
        db().prepare("SELECT * FROM rewards ORDER BY created_at DESC").all(),
        db().prepare(`SELECT r.*, u.name AS user_name FROM redemptions r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT 100`).all(),
      ]);
      return json({ user, orders: await hydrateOrders(orders.results), products: products.results, expenses: expenses.results, movements: movements.results,
        settings, rewards: rewards.results, redemptions: redemptions.results,
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
    if (crossOriginBlocked(request)) {
      return json({ error: "Permintaan tidak diizinkan." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "login_admin") {
      const ip = clientIp(request);
      if (await rateLimited("login_admin", ip, 8, 15 * 60_000)) {
        return json({ error: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit." }, { status: 429 });
      }
      const valid = await adminCredentialsValid(String(body.email ?? ""), String(body.password ?? ""));
      if (!valid) {
        console.warn("[auth] login admin gagal dari", ip);
        return json({ error: "Email atau password admin tidak sesuai." }, { status: 401 });
      }
      await clearRateLimit("login_admin", ip);
      return createSession(request, "usr-admin");
    }
    // Login member tanpa kredensial — hanya boleh hidup selama mode demo.
    if (action === "login_member_demo") {
      if (!demoMode()) return json({ error: "Login demo dinonaktifkan." }, { status: 403 });
      if (await rateLimited("login_member", clientIp(request), 20, 15 * 60_000)) {
        return json({ error: "Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit." }, { status: 429 });
      }
      return createSession(request, "usr-member");
    }
    if (action === "logout") {
      const token = readCookie(request, SESSION_COOKIE);
      if (token) await db().prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return new Response(JSON.stringify({ ok: true }), { headers: {
        "content-type": "application/json", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      }});
    }

    if (action === "create_order") {
      // Tag "offline" (kasir) hanya boleh ditetapkan admin — pengunjung anonim
      // tidak boleh menyisipkan pesanan yang tampak sudah dilayani di konter.
      const caller = await currentUser(request);
      return createOrder(request, body, caller?.role === "admin");
    }

    /* Redeem poin — khusus member: wajib form pemesanan, membuat order tipe "redeem"
       yang masuk antrian pesanan admin (tag khusus di tab Pesanan). */
    if (action === "redeem_reward") {
      const user = await currentUser(request);
      if (!user || user.role !== "member") return json({ error: "Silakan masuk sebagai member." }, { status: 401 });
      const rewardId = String(body.rewardId ?? "");
      const reward = await db().prepare("SELECT * FROM rewards WHERE id = ? AND active = 1").bind(rewardId).first<RewardRow>();
      if (!reward) return json({ error: "Penawaran tidak ditemukan." }, { status: 404 });
      if (reward.stock !== null && reward.stock <= 0) return json({ error: "Stok penawaran habis." }, { status: 409 });
      if (user.points < reward.points_cost) return json({ error: "Poin tidak mencukupi." }, { status: 409 });
      // Form pemesanan wajib (sama seperti checkout reguler)
      const customerName = String(body.customerName ?? "").trim();
      const phone = String(body.phone ?? "").trim();
      const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
      const address = String(body.address ?? "").trim();
      if (customerName.length < 2 || phone.replace(/\D/g, "").length < 9) return json({ error: "Nama dan nomor WhatsApp wajib valid." }, { status: 422 });
      if (fulfillment === "delivery" && address.length < 8) return json({ error: "Alamat pengiriman belum lengkap." }, { status: 422 });
      // Harga barang reward (0 jika tidak terhubung ke produk)
      let productPrice = 0; const productId = reward.product_id ?? "";
      if (reward.product_id) {
        const product = await db().prepare("SELECT id, price FROM products WHERE id = ?").bind(reward.product_id).first<{ id: string; price: number }>();
        if (!product) return json({ error: "Produk penawaran tidak ditemukan." }, { status: 422 });
        productPrice = Number(product.price);
      }
      const now = new Date().toISOString();
      const orderId = randomId("ord"); const orderNo = await nextOrderNo();
      const redemptionId = randomId("rdm");

      /* Potong poin sebagai pernyataan tunggal berpenjaga, lalu verifikasi.
         Di dalam batch, 0 baris terpengaruh bukan galat — redemption akan tetap
         commit walau poin tidak terpotong, dan member dapat hadiah gratis. */
      const spend = await db()
        .prepare("UPDATE users SET points = points - ? WHERE id = ? AND points >= ?")
        .bind(reward.points_cost, user.id, reward.points_cost).run();
      if ((spend.meta?.changes ?? 0) !== 1) {
        return json({ error: "Poin tidak mencukupi." }, { status: 409 });
      }

      /* Stok reward juga diklaim terpisah dengan pola yang sama. */
      if (reward.stock !== null) {
        const claim = await db()
          .prepare("UPDATE rewards SET stock = stock - 1 WHERE id = ? AND stock > 0").bind(reward.id).run();
        if ((claim.meta?.changes ?? 0) !== 1) {
          await db().prepare("UPDATE users SET points = points + ? WHERE id = ?")
            .bind(reward.points_cost, user.id).run(); // kembalikan poin yang sudah terpotong
          return json({ error: "Stok penawaran habis." }, { status: 409 });
        }
      }

      try {
        await db().batch([
          db().prepare(`INSERT INTO orders (id, order_no, user_id, customer_name, phone, address, fulfillment, status, payment_status, payment_method, total, points_earned, order_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'paid', 'redeem', 0, 0, 'redeem', ?)`)
            .bind(orderId, orderNo, user.id, customerName, phone, address, fulfillment, now),
          db().prepare("INSERT INTO order_items (order_id, product_id, product_name, unit, qty, unit_price, subtotal) VALUES (?, ?, ?, 'item', 1, ?, ?)")
            .bind(orderId, productId, reward.name, productPrice, productPrice),
          db().prepare("INSERT INTO redemptions (id, user_id, reward_id, reward_name, points_cost, status, order_id, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
            .bind(redemptionId, user.id, reward.id, reward.name, reward.points_cost, orderId, now),
          db().prepare("INSERT INTO loyalty_ledger (id, user_id, points, movement_type, order_id, created_at) VALUES (?, ?, ?, 'redeem', ?, ?)")
            .bind(randomId("loy"), user.id, -reward.points_cost, orderId, now),
        ]);
      } catch (error) {
        // Poin & stok reward sudah terpotong di luar batch — kembalikan keduanya
        // agar member tidak kehilangan poin untuk order yang tidak pernah jadi.
        await db().batch([
          db().prepare("UPDATE users SET points = points + ? WHERE id = ?").bind(reward.points_cost, user.id),
          ...(reward.stock !== null ? [db().prepare("UPDATE rewards SET stock = stock + 1 WHERE id = ?").bind(reward.id)] : []),
        ]).catch((e) => console.error("[poin] gagal mengembalikan poin:", e));
        throw error;
      }
      return json({ ok: true, orderNo, redemptionId });
    }

    const user = await currentUser(request);
    if (!user || user.role !== "admin") return json({ error: "Akses admin diperlukan." }, { status: 401 });

    if (action === "update_order") return updateOrder(body);
    if (action === "update_order_details") return updateOrderDetails(body);
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
    if (action === "update_settings") {
      const deliveryFee = body.deliveryFee === undefined ? null : Math.trunc(Number(body.deliveryFee));
      if (deliveryFee !== null && (deliveryFee < 0 || !Number.isFinite(deliveryFee))) return json({ error: "Biaya ongkir tidak valid." }, { status: 422 });
      const ops = [];
      if (deliveryFee !== null) ops.push(db().prepare("INSERT INTO settings (key, value) VALUES ('delivery_fee', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(deliveryFee)));
      if (ops.length) await db().batch(ops);
      return json({ ok: true, settings: await getSettings() });
    }
    if (action === "create_reward") {
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim();
      const pointsCost = Math.trunc(Number(body.pointsCost));
      const stockRaw = body.stock === undefined || body.stock === null || body.stock === "" ? null : Math.trunc(Number(body.stock));
      const productId = body.productId ? String(body.productId) : null;
      if (name.length < 2 || !Number.isFinite(pointsCost) || pointsCost <= 0) return json({ error: "Nama dan biaya poin penawaran wajib valid." }, { status: 422 });
      if (stockRaw !== null && (!Number.isFinite(stockRaw) || stockRaw < 0)) return json({ error: "Stok penawaran tidak valid." }, { status: 422 });
      if (productId) {
        const product = await db().prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
        if (!product) return json({ error: "Produk persediaan tidak ditemukan." }, { status: 422 });
      }
      await db().prepare("INSERT INTO rewards (id, name, description, points_cost, stock, active, product_id, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(randomId("rwd"), name, description, pointsCost, stockRaw, productId, new Date().toISOString()).run();
      return json({ ok: true });
    }
    if (action === "update_reward") {
      const rewardId = String(body.rewardId ?? "");
      const reward = await db().prepare("SELECT * FROM rewards WHERE id = ?").bind(rewardId).first<RewardRow>();
      if (!reward) return json({ error: "Penawaran tidak ditemukan." }, { status: 404 });
      const name = String(body.name ?? reward.name).trim();
      const description = String(body.description ?? reward.description).trim();
      const pointsCost = Math.trunc(Number(body.pointsCost ?? reward.points_cost));
      const stockRaw = body.stock === undefined || body.stock === null || body.stock === "" ? null : Math.trunc(Number(body.stock));
      if (name.length < 2 || !Number.isFinite(pointsCost) || pointsCost <= 0) return json({ error: "Nama dan biaya poin penawaran wajib valid." }, { status: 422 });
      if (stockRaw !== null && (!Number.isFinite(stockRaw) || stockRaw < 0)) return json({ error: "Stok penawaran tidak valid." }, { status: 422 });
      const active = body.active === undefined ? reward.active : (body.active ? 1 : 0);
      const productId = body.productId === undefined || body.productId === null || body.productId === "" ? reward.product_id : String(body.productId);
      if (productId) {
        const product = await db().prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
        if (!product) return json({ error: "Produk persediaan tidak ditemukan." }, { status: 422 });
      }
      await db().prepare("UPDATE rewards SET name = ?, description = ?, points_cost = ?, stock = ?, active = ?, product_id = ? WHERE id = ?")
        .bind(name, description, pointsCost, stockRaw, active, productId, rewardId).run();
      return json({ ok: true });
    }
    if (action === "delete_reward") {
      const rewardId = String(body.rewardId ?? "");
      await db().prepare("DELETE FROM rewards WHERE id = ?").bind(rewardId).run();
      return json({ ok: true });
    }
    if (action === "update_redemption") {
      const redemptionId = String(body.redemptionId ?? "");
      const status = String(body.status ?? "");
      if (!["done", "cancelled"].includes(status)) return json({ error: "Status penukaran tidak valid." }, { status: 422 });
      const redemption = await db().prepare("SELECT * FROM redemptions WHERE id = ?").bind(redemptionId).first<RedemptionRow>();
      if (!redemption) return json({ error: "Penukaran tidak ditemukan." }, { status: 404 });
      if (redemption.status === status) return json({ ok: true });
      const now = new Date().toISOString();
      const ops = [db().prepare("UPDATE redemptions SET status = ? WHERE id = ?").bind(status, redemptionId)];
      if (status === "done" && redemption.status === "pending") {
        // Pencatatan biaya: barang reward keluar = biaya operasional (Reward member)
        const reward = await db().prepare("SELECT * FROM rewards WHERE id = ?").bind(redemption.reward_id).first<RewardRow>();
        let amount = 0;
        if (reward?.product_id) {
          const product = await db().prepare("SELECT price FROM products WHERE id = ?").bind(reward.product_id).first<{ price: number }>();
          amount = product ? Number(product.price) : 0;
        }
        const member = await db().prepare("SELECT name FROM users WHERE id = ?").bind(redemption.user_id).first<{ name: string }>();
        ops.push(db().prepare("INSERT INTO expenses (id, category, description, amount, created_at) VALUES (?, 'Reward member', ?, ?, ?)")
          .bind(randomId("exp"), `Reward: ${redemption.reward_name} (${member?.name ?? "member"})`, amount, now));
      }
      if (status === "cancelled" && redemption.status === "pending") {
        // kembalikan poin + stok reward bila dibatalkan
        ops.push(db().prepare("UPDATE users SET points = points + ? WHERE id = ?").bind(redemption.points_cost, redemption.user_id));
        ops.push(db().prepare("INSERT INTO loyalty_ledger (id, user_id, points, movement_type, created_at) VALUES (?, ?, ?, 'refund', ?)")
          .bind(randomId("loy"), redemption.user_id, redemption.points_cost, now));
        const reward = await db().prepare("SELECT * FROM rewards WHERE id = ?").bind(redemption.reward_id).first<RewardRow>();
        if (reward && reward.stock !== null) ops.push(db().prepare("UPDATE rewards SET stock = stock + 1 WHERE id = ?").bind(reward.id));
        // sinkron: batalkan order redeem terkait
        if (redemption.order_id) ops.push(db().prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status NOT IN ('completed', 'cancelled')").bind(redemption.order_id));
      }
      await db().batch(ops);
      return json({ ok: true });
    }
    return json({ error: "Aksi tidak dikenali." }, { status: 400 });
  } catch (error) {
    console.error("[api/app]", error);
    return json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

async function createOrder(request: Request, body: Record<string, unknown>, isAdmin: boolean) {
  const customerName = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
  const address = String(body.address ?? "").trim();
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  // online (default) | offline (kasir admin) | redeem (ditangani redeem_reward)
  const orderType = isAdmin && body.order_type === "offline" ? "offline" : "regular";
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
  const settings = await getSettings();
  const shipping = fulfillment === "delivery" ? settings.deliveryFee : 0;
  const total = subtotal + shipping;
  const user = await currentUser(request);
  const orderId = randomId("ord"); const orderNo = await nextOrderNo(); const now = new Date().toISOString();

  /* Klaim reservasi lebih dulu, satu per satu, dan periksa meta.changes.
     Menaruh UPDATE berpenjaga di dalam batch tidak aman: D1 memutar balik saat
     pernyataan GAGAL, bukan saat ia tidak mengenai baris mana pun — order akan
     tetap commit tanpa reservasi dan stok bisa terjual berlebih. */
  const claimed: Array<{ productId: string; qty: number }> = [];
  for (const { product, qty } of selected) {
    const claim = await db()
      .prepare("UPDATE products SET reserved = reserved + ? WHERE id = ? AND stock - reserved >= ?")
      .bind(qty, product.id, qty).run();
    if ((claim.meta?.changes ?? 0) !== 1) {
      await releaseClaims(claimed);
      return json({ error: `Stok ${product.name} tidak mencukupi.` }, { status: 409 });
    }
    claimed.push({ productId: product.id, qty });
  }

  const statements = [db().prepare(
    `INSERT INTO orders (id, order_no, user_id, customer_name, phone, address, fulfillment, status, payment_status, payment_method, total, points_earned, order_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'unpaid', ?, ?, 0, ?, ?)`
  ).bind(orderId, orderNo, user?.role === "member" ? user.id : null, customerName, phone, address, fulfillment, paymentMethod, total, orderType, now)];
  for (const { product, qty } of selected) {
    statements.push(
      db().prepare("INSERT INTO order_items (order_id, product_id, product_name, unit, qty, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(orderId, product.id, product.name, product.unit, qty, product.price, product.price * qty),
      db().prepare("INSERT INTO inventory_movements (id, product_id, qty, movement_type, reference_id, reason, created_at) VALUES (?, ?, ?, 'reserve', ?, 'Reservasi order baru', ?)")
        .bind(randomId("mov"), product.id, qty, orderId, now),
    );
  }
  try {
    await db().batch(statements); // hanya INSERT — aman di dalam satu batch
  } catch (error) {
    await releaseClaims(claimed); // order gagal tersimpan: jangan tinggalkan reservasi menggantung
    throw error;
  }

  return json({ ok: true, orderNo, orderId, total }, { status: 201 });
}

/** Kembalikan reservasi yang sudah terlanjur diklaim saat checkout gagal di tengah jalan. */
async function releaseClaims(claimed: Array<{ productId: string; qty: number }>) {
  if (!claimed.length) return;
  try {
    await db().batch(claimed.map(({ productId, qty }) =>
      db().prepare("UPDATE products SET reserved = MAX(0, reserved - ?) WHERE id = ?").bind(qty, productId)));
  } catch (error) {
    console.error("[stok] gagal melepas reservasi:", error);
  }
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
  // Gambar produk: opsional. Hanya terima data URL gambar (jpeg/png/webp/gif) ≤ 1.5MB agar D1 tetap ringan.
  const rawImage = body.image == null ? "" : String(body.image).trim();
  const image = rawImage === ""
    ? null
    : /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(rawImage) && rawImage.length <= 1_500_000
      ? rawImage
      : null;
  if (rawImage !== "" && image === null) return null;
  const valid = sku.length >= 2 && sku.length <= 40 && name.length >= 2 && category.length >= 1 && unit.length >= 1
    && Number.isFinite(price) && price >= 0
    && Number.isFinite(stock) && stock >= 0
    && Number.isFinite(minStock) && minStock >= 0;
  return valid ? { sku, name, category, unit, price, stock, minStock, accent, image } : null;
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
    db().prepare("INSERT INTO products (id, sku, name, category, unit, price, stock, reserved, min_stock, accent, image) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
      .bind(id, fields.sku, fields.name, fields.category, fields.unit, fields.price, fields.stock, fields.minStock, fields.accent, fields.image),
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
  await db().prepare("UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, price = ?, min_stock = ?, accent = ?, image = ? WHERE id = ?")
    .bind(fields.sku, fields.name, fields.category, fields.unit, fields.price, fields.minStock, fields.accent, fields.image, productId).run();
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
  const now = new Date().toISOString();
  const statements = [db().prepare("UPDATE orders SET status = ? WHERE id = ?").bind(target, order.id)];
  if (order.order_type === "redeem") {
    // Order hasil tukar poin: stok barang dikelola lewat rewards.stock (bukan stok produk).
    // Batal order → refund poin + batalkan redemption (bila masih pending) + kembalikan stok reward.
    if (target === "cancelled") {
      const redemption = await db().prepare("SELECT * FROM redemptions WHERE order_id = ?").bind(order.id).first<RedemptionRow>();
      if (redemption && redemption.status === "pending") {
        statements.push(
          db().prepare("UPDATE users SET points = points + ? WHERE id = ?").bind(redemption.points_cost, redemption.user_id),
          db().prepare("INSERT INTO loyalty_ledger (id, user_id, points, movement_type, created_at) VALUES (?, ?, ?, 'refund', ?)")
            .bind(randomId("loy"), redemption.user_id, redemption.points_cost, now),
          db().prepare("UPDATE redemptions SET status = 'cancelled' WHERE id = ?").bind(redemption.id),
        );
        const reward = await db().prepare("SELECT * FROM rewards WHERE id = ?").bind(redemption.reward_id).first<RewardRow>();
        if (reward && reward.stock !== null) statements.push(db().prepare("UPDATE rewards SET stock = stock + 1 WHERE id = ?").bind(reward.id));
      }
    }
    await db().batch(statements);
    return json({ ok: true });
  }
  const items = await orderItems(order.id) as Array<{ product_id: string; qty: number }>;
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

/* Edit detail pesanan (opsional, untuk koreksi kesalahan order).
   Hanya order reguler yang belum selesai/dibatalkan. Redeem tidak bisa diedit.
   Item lama dibandingkan dengan baru → reserved stok disesuaikan per produk. */
async function updateOrderDetails(body: Record<string, unknown>) {
  const orderId = String(body.orderId ?? "");
  const order = await db().prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) return json({ error: "Order tidak ditemukan." }, { status: 404 });
  if (order.order_type === "redeem") return json({ error: "Order tukar poin tidak bisa diedit." }, { status: 409 });
  /* Hanya order yang reservasinya masih hidup. Sejak status 'preparing', stok
     fisik sudah dipotong dan reservasi dilepas (lihat updateOrder), sehingga
     penyesuaian reserved di bawah akan menggelembungkan angka selamanya. */
  if (!["new", "confirmed"].includes(order.status)) {
    return json({ error: "Pesanan yang sudah disiapkan tidak bisa diedit. Batalkan lalu buat pesanan baru." }, { status: 409 });
  }
  const customerName = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
  const address = String(body.address ?? "").trim();
  const paymentMethod = normalizePaymentMethod(body.paymentMethod);
  if (customerName.length < 2 || phone.replace(/\D/g, "").length < 9) return json({ error: "Nama dan nomor WhatsApp wajib valid." }, { status: 422 });
  if (fulfillment === "delivery" && address.length < 8) return json({ error: "Alamat pengiriman belum lengkap." }, { status: 422 });
  const inputItems = Array.isArray(body.items) ? body.items as Array<{ productId?: string; qty?: number }> : [];
  if (!inputItems.length) return json({ error: "Pesanan minimal berisi satu item." }, { status: 422 });

  // Validasi item + hitung subtotal
  const selected: Array<{ product: ProductRow; qty: number }> = [];
  let subtotal = 0;
  for (const item of inputItems) {
    const qty = parseQty(item.qty);
    if (qty === null || qty < 1) return json({ error: "Jumlah produk tidak valid." }, { status: 422 });
    const product = await db().prepare("SELECT * FROM products WHERE id = ?").bind(item.productId).first<ProductRow>();
    if (!product) return json({ error: "Salah satu produk tidak tersedia." }, { status: 422 });
    selected.push({ product, qty }); subtotal += product.price * qty;
  }

  // Item lama → delta reserved
  const oldItems = await db().prepare("SELECT product_id, qty FROM order_items WHERE order_id = ?").bind(orderId).all<{ product_id: string; qty: number }>();
  const oldMap = new Map(oldItems.results.map((i) => [i.product_id, i.qty]));
  const newMap = new Map(selected.map(({ product, qty }) => [product.id, qty]));
  for (const { product, qty } of selected) {
    const old = oldMap.get(product.id) ?? 0;
    const delta = qty - old;
    if (delta > 0 && product.stock - product.reserved < delta) return json({ error: `Stok ${product.name} tidak mencukupi untuk perubahan ini.` }, { status: 409 });
  }

  const settings = await getSettings();
  const shipping = fulfillment === "delivery" ? settings.deliveryFee : 0;
  const total = subtotal + shipping;
  const statements = [
    db().prepare("UPDATE orders SET customer_name = ?, phone = ?, address = ?, fulfillment = ?, payment_method = ?, total = ? WHERE id = ?")
      .bind(customerName, phone, address, fulfillment, paymentMethod, total, orderId),
    db().prepare("DELETE FROM order_items WHERE order_id = ?").bind(orderId),
  ];
  for (const { product, qty } of selected) {
    statements.push(
      db().prepare("INSERT INTO order_items (order_id, product_id, product_name, unit, qty, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(orderId, product.id, product.name, product.unit, qty, product.price, product.price * qty),
    );
  }
  // Sesuaikan reserved: delta positif → tambah; negatif → kurangi
  for (const { product, qty } of selected) {
    const delta = qty - (oldMap.get(product.id) ?? 0);
    if (delta !== 0) statements.push(db().prepare("UPDATE products SET reserved = MAX(0, reserved + ?) WHERE id = ?").bind(delta, product.id));
  }
  for (const [pid, oldQty] of oldMap) {
    if (!newMap.has(pid)) statements.push(db().prepare("UPDATE products SET reserved = MAX(0, reserved - ?) WHERE id = ?").bind(oldQty, pid));
  }
  await db().batch(statements);
  return json({ ok: true, total });
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
