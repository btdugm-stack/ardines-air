"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import NextImage from "next/image";

type User = { id: string; name: string; email: string; role: "admin" | "member"; points: number };
type Product = { id: string; sku: string; name: string; category: string; unit: string; price: number; stock: number; reserved: number; min_stock: number; accent: string; image: string | null };
type OrderItem = { id?: number; product_id: string; product_name: string; unit: string; qty: number; unit_price: number; subtotal: number };
type Order = { id: string; order_no: string; customer_name: string; phone: string; address: string; fulfillment: string; status: string; payment_status: string; payment_method: string; total: number; points_earned: number; order_type: string; created_at: string; items: OrderItem[] };
type Expense = { id: string; category: string; description: string; amount: number; created_at: string };
type Reward = { id: string; name: string; description: string; points_cost: number; stock: number | null; active: number; product_id: string | null; created_at: string };
type Redemption = { id: string; user_id: string; reward_id: string; reward_name: string; points_cost: number; status: string; created_at: string; user_name?: string };
type Settings = { deliveryFee: number; waEnabled: boolean; waTarget: string; waGateway: string; waHost: string; waTokenSet: boolean; waSecretSet: boolean };
type AdminData = { user: User; orders: Order[]; products: Product[]; expenses: Expense[]; movements: Array<{ id: string; product_id: string; qty: number; movement_type: string; reference_id: string | null; reason: string; created_at: string }>; metrics: { revenue: number; completed: number; pending: number; expenses: number }; settings: Settings; rewards: Reward[]; redemptions: Redemption[] };
type MemberData = { user: User; orders: Order[]; ledger: Array<{ id: string; points: number; movement_type: string; created_at: string }>; rewards: Reward[]; redemptions: Redemption[] };
type View = "shop" | "track" | "member" | "admin";

const statusLabel: Record<string, string> = {
  new: "Pesanan baru", confirmed: "Dikonfirmasi", preparing: "Disiapkan", ready: "Siap",
  delivering: "Diantar", completed: "Selesai", cancelled: "Dibatalkan",
  unpaid: "Belum dibayar", paid: "Lunas",
};

const statusNext: Record<string, { status: string; label: string }> = {
  new: { status: "confirmed", label: "Konfirmasi" },
  confirmed: { status: "preparing", label: "Mulai siapkan" },
  preparing: { status: "ready", label: "Tandai siap" },
  delivering: { status: "completed", label: "Selesaikan" },
};

const paymentMethodLabel: Record<string, string> = { cod: "COD", transfer: "Transfer", qris: "QRIS", redeem: "Tukar poin" };
const movementLabel: Record<string, string> = { reserve: "Reservasi", sale: "Terjual", return: "Retur", adjustment: "Penyesuaian" };

function money(value: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value); }
function dateTime(value: string) { return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value)); }

/* ==== Export CSV untuk pembukuan ==== */
function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const sep = ";"; // pemisah yang aman dibuka di Excel (locale id-ID)
  const bom = "\uFEFF"; // BOM agar Excel mendeteksi UTF-8
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(sep));
  const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayStamp() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()); }

/* CSV — Pesanan (1 baris per pesanan; item digabung) */
function ordersToCSV(orders: Order[]): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  return {
    headers: ["No. Order", "Tipe", "Tanggal", "Pelanggan", "Telepon", "Alamat", "Pengiriman", "Status", "Pembayaran", "Metode", "Item", "Total (Rp)", "Poin"],
    rows: orders.map((o) => [
      o.order_no,
      o.order_type === "redeem" ? "Redeem" : o.order_type === "offline" ? "Offline" : "Online",
      dateTime(o.created_at), o.customer_name, o.phone, o.address,
      o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri",
      statusLabel[o.status] ?? o.status,
      o.payment_status === "paid" ? "Lunas" : "Belum bayar",
      paymentMethodLabel[o.payment_method] ?? o.payment_method,
      o.items.map((i) => `${i.qty}× ${i.product_name}`).join(", "),
      o.total, o.points_earned,
    ]),
  };
}

/* CSV — Biaya operasional */
function expensesToCSV(expenses: Expense[]): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  return {
    headers: ["Tanggal", "Kategori", "Deskripsi", "Nominal (Rp)"],
    rows: expenses.map((e) => [dateTime(e.created_at), e.category, e.description, e.amount]),
  };
}

/* CSV — Produk & stok */
function productsToCSV(products: Product[]): { headers: string[]; rows: (string | number | null | undefined)[][] } {
  return {
    headers: ["SKU", "Nama", "Kategori", "Satuan", "Harga (Rp)", "Stok Fisik", "Dipesan", "Tersedia", "Stok Min"],
    rows: products.map((p) => [p.sku, p.name, p.category, p.unit, p.price, p.stock, p.reserved, p.stock - p.reserved, p.min_stock]),
  };
}

async function callApi(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? "Permintaan tidak dapat diproses."));
  return data;
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    drop: <><path d="M12 2.5s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z"/><path d="M9 14a3 3 0 0 0 3 3"/></>,
    cart: <><path d="M3 3h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20 7H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    box: <><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5v9l9-5V8"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    truck: <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    minus: <><path d="M5 12h14"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h7v18h-7"/></>,
    print: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></>,
    wallet: <><path d="M3 6h16a2 2 0 0 1 2 2v11H3z"/><path d="M3 6V4h14v2M16 13h5"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
    trash: <><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></>,
    gift: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M12 8s-3-1-3-3a2 2 0 0 1 3-1c0 1-1 2 0 4ZM12 8s3-1 3-3a2 2 0 0 0-3-1c0 1 1 2 0 4Z"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.drop}</svg>;
}

export default function StoreApp() {
  const [view, setView] = useState<View>("shop");
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings>({ deliveryFee: 5000, waEnabled: false, waTarget: "", waGateway: "wablas", waHost: "solo.wablas.com", waTokenSet: false, waSecretSet: false });
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("Semua");
  const [query, setQuery] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const [receipt, setReceipt] = useState<Order | null>(null);

  const loadStore = async () => {
    try {
      const data = await callApi("/api/app?view=store") as unknown as { products: Product[]; user: User | null; settings: Settings };
      setProducts(data.products); setUser(data.user); setSettings(data.settings ?? { deliveryFee: 5000, waEnabled: false, waTarget: "", waGateway: "wablas", waHost: "solo.wablas.com", waTokenSet: false, waSecretSet: false });
    } catch (e) { setNotice({ msg: e instanceof Error ? e.message : "Gagal memuat toko.", kind: "error" }); }
  };

  useEffect(() => {
    let active = true;
    void callApi("/api/app?view=store")
      .then((raw) => {
        if (!active) return;
        const data = raw as unknown as { products: Product[]; user: User | null; settings: Settings };
        setProducts(data.products); setUser(data.user); setSettings(data.settings ?? { deliveryFee: 5000, waEnabled: false, waTarget: "", waGateway: "wablas", waHost: "solo.wablas.com", waTokenSet: false, waSecretSet: false });
      })
      .catch((error: unknown) => {
        if (active) setNotice({ msg: error instanceof Error ? error.message : "Gagal memuat toko.", kind: "error" });
      });
    return () => { active = false; };
  }, []);

  const navigate = async (next: View) => {
    setView(next); setNotice(null);
    if (next === "admin") await loadAdmin();
    if (next === "member") await loadMember();
  };

  const loadAdmin = async () => {
    try { setAdminData(await callApi("/api/app?view=admin") as unknown as AdminData); }
    catch { setAdminData(null); }
  };
  const loadMember = async () => {
    try { setMemberData(await callApi("/api/app?view=member") as unknown as MemberData); }
    catch { setMemberData(null); }
  };

  const cartItems = useMemo(() => products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] })), [products, cart]);
  const subtotal = cartItems.reduce((sum, p) => sum + p.price * p.qty, 0);
  const cartCount = cartItems.reduce((sum, p) => sum + p.qty, 0);
  const categories = ["Semua", ...Array.from(new Set(products.map((p) => p.category)))];
  const visibleProducts = products.filter((p) => (category === "Semua" || p.category === category) && p.name.toLowerCase().includes(query.toLowerCase()));

  const changeCart = (id: string, delta: number) => setCart((current) => {
    const product = products.find((p) => p.id === id); const next = Math.max(0, Math.min((product?.stock ?? 0) - (product?.reserved ?? 0), (current[id] ?? 0) + delta));
    const copy = { ...current }; if (next) copy[id] = next; else delete copy[id]; return copy;
  });

  const postAction = async (payload: Record<string, unknown>, after?: () => Promise<void>) => {
    setBusy(true); setNotice(null);
    try {
      const data = await callApi("/api/app", { method: "POST", body: JSON.stringify(payload) });
      if (after) await after(); return data;
    } catch (e) { setNotice({ msg: e instanceof Error ? e.message : "Aksi gagal.", kind: "error" }); throw e; }
    finally { setBusy(false); }
  };

  const logout = async () => {
    await postAction({ action: "logout" }); setUser(null); setAdminData(null); setMemberData(null); setView("shop");
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => void navigate("shop")}><span className="brand-mark"><Icon name="drop" /></span><span><strong>SEGAR.</strong><small>Depot air & es</small></span></button>
        <nav className="desktop-nav" aria-label="Navigasi utama">
          <button className={view === "shop" ? "active" : ""} onClick={() => void navigate("shop")}>Belanja</button>
          <button className={view === "track" ? "active" : ""} onClick={() => void navigate("track")}>Lacak pesanan</button>
          <button className={view === "member" ? "active" : ""} onClick={() => void navigate("member")}>Member</button>
          <button className={view === "admin" ? "active" : ""} onClick={() => void navigate("admin")}>Admin</button>
        </nav>
        <div className="header-actions">
          {user && <span className="user-pill"><span>{user.name.charAt(0)}</span>{user.name.split(" ")[0]}</span>}
          {user && <button className="icon-button" title="Keluar" onClick={() => void logout()}><Icon name="logout" /></button>}
          <button className="cart-button" onClick={() => setCheckoutOpen(true)}><Icon name="cart"/><span>Keranjang</span><b>{cartCount}</b></button>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Navigasi utama">
        <button className={view === "shop" ? "active" : ""} onClick={() => void navigate("shop")}><Icon name="search" /><span>Belanja</span></button>
        <button className={view === "track" ? "active" : ""} onClick={() => void navigate("track")}><Icon name="truck" /><span>Lacak</span></button>
        <button className={view === "member" ? "active" : ""} onClick={() => void navigate("member")}><Icon name="user" /><span>Member</span></button>
        <button className={view === "admin" ? "active" : ""} onClick={() => void navigate("admin")}><Icon name="chart" /><span>Admin</span></button>
      </nav>

      {cartItems.length > 0 && (
        <button className="floating-cart" onClick={() => setCheckoutOpen(true)} aria-label={`Buka keranjang, ${cartItems.length} produk`}>
          <Icon name="cart" />
          <b>{cartCount}</b>
          <span>{money(subtotal)}</span>
        </button>
      )}

      {notice && <div className={`global-notice ${notice.kind}`} role="alert">{notice.msg}<button onClick={() => setNotice(null)}>×</button></div>}

      {view === "shop" && <ShopView products={visibleProducts} categories={categories} category={category} setCategory={setCategory} query={query} setQuery={setQuery} cart={cart} changeCart={changeCart} cartItems={cartItems} subtotal={subtotal} onCheckout={() => setCheckoutOpen(true)} />}
      {view === "track" && <TrackView />}
      {view === "member" && <MemberView data={memberData} user={user} busy={busy} login={async () => { await postAction({ action: "login_member_demo" }); await loadStore(); await loadMember(); }} logout={logout} shop={() => void navigate("shop")} redeem={async (rewardId, payload) => { const data = await postAction({ action: "redeem_reward", rewardId, ...payload }); await loadMember(); return data; }} />}
      {view === "admin" && <AdminView data={adminData} user={user} busy={busy} login={async (email, password) => { await postAction({ action: "login_admin", email, password }); await loadStore(); await loadAdmin(); }} action={postAction} reload={loadAdmin} print={(order) => { setReceipt(order); setTimeout(() => window.print(), 180); }} />}

      {checkoutOpen && <CheckoutModal items={cartItems} subtotal={subtotal} user={user} busy={busy} deliveryFee={settings.deliveryFee} close={() => setCheckoutOpen(false)} submit={async (payload) => {
        const data = await postAction({ action: "create_order", ...payload, items: cartItems.map((p) => ({ productId: p.id, qty: p.qty })) });
        setCart({}); setCheckoutOpen(false); await loadStore(); setNotice({ msg: `Pesanan ${String(data.orderNo)} berhasil dibuat. Total ${money(Number(data.total))}.`, kind: "success" });
      }} />}
      {receipt && <Receipt order={receipt} close={() => setReceipt(null)} />}

      <footer><div><strong>SEGAR.</strong><p>Air jernih, urusan lebih ringan.</p></div><div><span>Buka setiap hari</span><b>07.00–21.00 WIB</b></div><div><span>Layanan pelanggan</span><b>0812-0000-SEGAR</b></div></footer>
    </div>
  );
}

function ShopView({ products, categories, category, setCategory, query, setQuery, cart, changeCart, cartItems, subtotal, onCheckout }: {
  products: Product[]; categories: string[]; category: string; setCategory: (v: string) => void; query: string; setQuery: (v: string) => void;
  cart: Record<string, number>; changeCart: (id: string, d: number) => void; cartItems: Array<Product & { qty: number }>; subtotal: number; onCheckout: () => void;
}) {
  return <main>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span></span>Antar cepat di sekitar Anda</div><h1>Stok air aman.<br/><em>Hidup lanjut.</em></h1><p>Air galon, air botol, dan es batu segar untuk rumah maupun usaha. Bisa ecer, bisa langsung diantar.</p><div className="hero-actions"><button className="primary" onClick={() => document.getElementById("katalog")?.scrollIntoView({ behavior: "smooth" })}>Belanja sekarang <span>→</span></button><div className="mini-proof"><span>✓</span><p><b>Tanpa login</b><small>Pesan dalam 1 menit</small></p></div></div><div className="hero-stats"><div><b>30–45</b><span>menit estimasi antar</span></div><div><b>7 hari</b><span>siap melayani</span></div><div><b>120+</b><span>pelanggan rutin</span></div></div></div>
      <div className="hero-visual"><NextImage src="/og.png" width={1675} height={942} priority alt="Layanan antar air mineral galon, botol, dan es batu"/><div className="floating-card"><span className="pulse"></span><p><b>Toko sedang buka</b><small>Pesan sebelum 20.30 WIB</small></p></div></div>
    </section>
    <section className="service-strip"><div><Icon name="truck"/><p><b>Antar cepat</b><span>Area sekitar toko</span></p></div><div><Icon name="check"/><p><b>Stok terpantau</b><span>Info tersedia real-time</span></p></div><div><Icon name="wallet"/><p><b>Bayar fleksibel</b><span>Tunai, transfer, QRIS</span></p></div></section>
    <section className="catalog-section" id="katalog"><div className="section-heading"><div><span className="kicker">PILIH KEBUTUHANMU</span><h2>Segar sampai tujuan.</h2></div><label className="search-box"><Icon name="search"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label></div>
      <div className="category-row">{categories.map((c) => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
      <div className="shop-grid"><div className="product-grid">{products.map((p) => <ProductCard key={p.id} product={p} qty={cart[p.id] ?? 0} change={changeCart}/>)}</div>
        <aside className="cart-panel"><div className="cart-title"><div><span>Pesananmu</span><b>{cartItems.length} produk</b></div><Icon name="cart"/></div>{cartItems.length === 0 ? <div className="empty-cart"><span>◌</span><b>Keranjang masih ringan</b><p>Pilih air atau es yang kamu butuhkan.</p></div> : <div className="cart-lines">{cartItems.map((p) => <div className="cart-line" key={p.id}><span className="line-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} / {p.unit}</small></div><strong>{p.qty}×</strong></div>)}</div>}<div className="cart-summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><small>Ongkir dihitung saat checkout</small><button className="primary full" disabled={!cartItems.length} onClick={onCheckout}>Lanjut pesan <span>→</span></button></div></aside>
      </div>
    </section>
  </main>;
}

function ProductCard({ product, qty, change }: { product: Product; qty: number; change: (id: string, d: number) => void }) {
  const available = product.stock - product.reserved; const icon = product.category === "Es Batu" ? "❄" : product.unit === "botol" ? "♢" : "◉";
  return <article className="product-card"><div className="product-art" style={{ "--accent": product.accent } as React.CSSProperties}>{product.image ? <NextImage src={product.image} alt={product.name} fill unoptimized sizes="400px" /> : <span>{icon}</span>}<small>{product.category}</small><i>{available <= product.min_stock ? "Stok terbatas" : "Tersedia"}</i></div><div className="product-info"><span className="sku">{product.sku}</span><h3>{product.name}</h3><p><b>{money(product.price)}</b><span>/ {product.unit}</span></p><div className="product-bottom"><small>Sisa {available} {product.unit}</small>{qty ? <div className="stepper"><button onClick={() => change(product.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button onClick={() => change(product.id, 1)}><Icon name="plus" size={16}/></button></div> : <button className="add-button" disabled={available < 1} onClick={() => change(product.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div></div></article>;
}

function CheckoutModal({ items, subtotal, user, busy, close, submit, deliveryFee }: { items: Array<Product & { qty: number }>; subtotal: number; user: User | null; busy: boolean; close: () => void; submit: (p: Record<string, unknown>) => Promise<void>; deliveryFee: number }) {
  const [form, setForm] = useState({ customerName: user?.name ?? "", phone: "", fulfillment: "delivery", address: "", paymentMethod: "cod" });
  const shipping = form.fulfillment === "delivery" ? deliveryFee : 0;
  const onSubmit = async (e: FormEvent) => { e.preventDefault(); try { await submit(form); } catch {} };
  return <div className="modal-backdrop"><section className="modal checkout-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={close}>×</button><div className="modal-head"><span className="kicker">CHECKOUT</span><h2>Selesaikan pesanan</h2><p>Tidak perlu akun. Kami hanya butuh detail pengantaran.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="checkout-columns"><div className="form-stack"><label>Nama pelanggan<input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama lengkap" /></label><label>Nomor WhatsApp<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button></div></div><div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai (COD)</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}</div><div className="order-review"><h3>Ringkasan</h3>{items.map((p) => <div className="review-line" key={p.id}><span>{p.qty}× {p.name}</span><b>{money(p.qty * p.price)}</b></div>)}<div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy}>{busy ? "Memproses..." : "Buat pesanan"}<span>→</span></button><small>Dengan memesan, Anda menyetujui konfirmasi melalui WhatsApp.</small></div></div></form></section></div>;
}

function TrackView() {
  const [orderNo, setOrderNo] = useState(""); const [phone, setPhone] = useState(""); const [order, setOrder] = useState<Order | null>(null); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(""); try { const data = await callApi(`/api/app?view=track&orderNo=${encodeURIComponent(orderNo)}&phone=${encodeURIComponent(phone)}`); setOrder(data.order as unknown as Order); } catch (e) { setOrder(null); setError(e instanceof Error ? e.message : "Tidak ditemukan."); } };
  const steps = ["new", "confirmed", "preparing", "ready", ...(order?.fulfillment === "delivery" ? ["delivering"] : []), "completed"];
  return <main className="subpage"><section className="track-card"><div className="track-intro"><span className="kicker">LACAK PESANAN</span><h1>Sudah sampai mana?</h1><p>Masukkan nomor order dan minimal 6 digit terakhir nomor WhatsApp.</p><form onSubmit={(e) => void submit(e)}><label>Nomor pesanan<input required value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="ORD-20260822-XXXXX" /></label><label>Nomor WhatsApp<input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" /></label><button className="primary"><Icon name="search"/> Lacak sekarang</button>{error && <small className="form-error">{error}</small>}</form></div><div className="track-result">{order ? <><div className="track-order-head"><div><span>{order.order_no}</span><h3>{statusLabel[order.status]}</h3></div><b>{money(order.total)}</b></div>{order.status === "cancelled" ? <div className="track-placeholder"><Icon name="box" size={54}/><h3>Pesanan dibatalkan</h3><p>Stok sudah dikembalikan. Hubungi toko bila ada pertanyaan.</p></div> : <div className="timeline">{steps.map((s, index) => { const current = steps.indexOf(order.status); return <div key={s} className={index <= current ? "done" : ""}><span>{index < current ? "✓" : index + 1}</span><p><b>{statusLabel[s]}</b><small>{index === current ? "Status saat ini" : index < current ? "Sudah diproses" : "Menunggu"}</small></p></div>; })}</div>}<div className="track-items">{order.items.map((i) => <div key={i.id}><span>{i.qty}× {i.product_name}</span><b>{money(i.subtotal)}</b></div>)}</div></> : <div className="track-placeholder"><Icon name="truck" size={54}/><h3>Perjalanan pesanan tampil di sini</h3><p>Status diperbarui oleh admin dari pesanan masuk hingga selesai.</p></div>}</div></section></main>;
}

function MemberView({ data, user, busy, login, logout, shop, redeem }: { data: MemberData | null; user: User | null; busy: boolean; login: () => Promise<void>; logout: () => Promise<void>; shop: () => void; redeem: (rewardId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const [redeemTarget, setRedeemTarget] = useState<Reward | null>(null);
  const [redeemNotice, setRedeemNotice] = useState("");
  if (!data) return <main className="auth-page"><section className="auth-card"><div className="auth-art"><div className="point-orbit"><span>+10</span><b>120</b><small>poin aktif</small></div><h2>Belanja rutin,<br/>dapat lebih.</h2><p>Member mendapatkan poin, riwayat transaksi, dan pesan ulang lebih cepat.</p></div><div className="auth-form"><span className="kicker">AKUN MEMBER</span><h1>Masuk sebagai pelanggan</h1><p>Versi lokal memakai simulasi Google. Tidak ada password member yang disimpan.</p>{user && user.role !== "member" && <div className="info-box">Anda sedang masuk sebagai {user.role}. Keluar dahulu untuk berganti peran.</div>}<button className="google-button" disabled={busy} onClick={() => void login()}><b>G</b> Lanjutkan dengan Google <span>Demo</span></button><div className="demo-credential"><b>Akun dummy member</b><span>member.demo@gmail.com</span><small>Nama: Nadia Pelanggan · Saldo awal: 120 poin</small></div>{user && <button className="text-button" onClick={() => void logout()}>Keluar dari sesi saat ini</button>}</div></section></main>;
  return <main className="dashboard member-dashboard"><div className="dashboard-top"><div><span className="kicker">MEMBER AREA</span><h1>Halo, {data.user.name.split(" ")[0]}!</h1><p>Air cukup, poin pun ikut tumbuh.</p></div><button className="primary" onClick={shop}>Pesan lagi <span>→</span></button></div>{redeemNotice && <div className="info-box" style={{ marginBottom: 16 }}>{redeemNotice}</div>}<div className="member-grid"><section className="points-card"><span>SEGAR REWARDS</span><b>{data.user.points}</b><small>poin tersedia</small><div><p>1 poin</p><span>=</span><p>Rp10.000</p></div></section><section className="member-summary"><div><Icon name="box"/><p><b>{data.orders.length}</b><span>Total pesanan</span></p></div><div><Icon name="check"/><p><b>{data.orders.filter((o) => o.status === "completed").length}</b><span>Pesanan selesai</span></p></div><div><Icon name="wallet"/><p><b>{data.orders.reduce((s, o) => s + o.points_earned, 0)}</b><span>Poin diperoleh</span></p></div></section></div><section className="panel"><div className="panel-heading"><div><span className="kicker">TUKAR POIN</span><h2>Penawaran untukmu</h2></div></div>{data.rewards?.length ? <div className="reward-grid">{data.rewards.map((r) => { const cukup = data.user.points >= r.points_cost; return <article className="reward-card" key={r.id}><div><b>{r.name}</b><small>{r.description || "—"}</small></div><strong>{r.points_cost} <span>poin</span></strong><button className={cukup ? "primary" : "primary disabled-btn"} disabled={!cukup || busy} onClick={() => { setRedeemNotice(""); setRedeemTarget(r); }}>{cukup ? "Tukar" : "Poin kurang"}</button></article>; })}</div> : <div className="empty-panel"><Icon name="check" size={42}/><b>Belum ada penawaran</b><p>Admin belum menambahkan penawaran untuk ditukar dengan poin.</p></div>}</section>{data.redemptions?.length ? <section className="panel"><div className="panel-heading"><div><span className="kicker">RIWAYAT TUKAR</span><h2>Penukaran poinmu</h2></div></div><div className="expense-list">{data.redemptions.map((r) => <div key={r.id}><span className="expense-icon"><Icon name="check"/></span><p><b>{r.reward_name}</b><small>{dateTime(r.created_at)}</small></p><div style={{ display: "flex", gap: 8, alignItems: "center" }}><strong style={{ color: "var(--teal)" }}>-{r.points_cost} poin</strong><span className={`status ${r.status === "done" ? "completed" : r.status === "pending" ? "new" : "cancelled"}`}>{r.status === "done" ? "Selesai" : r.status === "pending" ? "Menunggu" : "Dibatalkan"}</span></div></div>)}</div></section> : null}<section className="panel"><div className="panel-heading"><div><span className="kicker">RIWAYAT</span><h2>Pesanan terakhir</h2></div></div>{data.orders.length ? <div className="order-list">{data.orders.map((o) => <article key={o.id}><div><span>{o.order_no}</span>{o.order_type === "redeem" && <span className="redeem-tag">REDEEM</span>}<small>{dateTime(o.created_at)}</small></div><p>{o.items.map((i) => `${i.qty}× ${i.product_name}`).join(", ")}</p><b>{o.order_type === "redeem" ? "Gratis poin" : money(o.total)}</b><span className={`status ${o.status}`}>{statusLabel[o.status]}</span></article>)}</div> : <div className="empty-panel"><Icon name="box" size={42}/><b>Belum ada pesanan member</b><p>Pesan dari akun ini untuk mulai mengumpulkan poin.</p></div>}</section>{redeemTarget && <RedeemModal reward={redeemTarget} user={data.user} busy={busy} close={() => setRedeemTarget(null)} submit={async (payload) => { try { const res = await redeem(redeemTarget.id, payload); setRedeemTarget(null); setRedeemNotice(`Penukaran berhasil! Pesanan ${String(res.orderNo ?? "")} sudah masuk antrian toko.`); } catch {} }} />}</main>;
}

function AdminView({ data, user, busy, login, action, reload, print }: { data: AdminData | null; user: User | null; busy: boolean; login: (e: string, p: string) => Promise<void>; action: (p: Record<string, unknown>, after?: () => Promise<void>) => Promise<Record<string, unknown>>; reload: () => Promise<void>; print: (o: Order) => void }) {
  const [email, setEmail] = useState("admin@segardepot.local"); const [password, setPassword] = useState("Admin123!"); const [tab, setTab] = useState<"overview"|"orders"|"stock"|"finance"|"event">("overview"); const [expense, setExpense] = useState({ category: "Transportasi", description: "", amount: "" }); const [stockTab, setStockTab] = useState<"stok" | "riwayat">("stok"); const [productModal, setProductModal] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [deliveryFee, setDeliveryFee] = useState(String(data?.settings?.deliveryFee ?? 5000));
  const [waTarget, setWaTarget] = useState(data?.settings?.waTarget ?? "085863480872");
  const [waToken, setWaToken] = useState("");
  const [waGateway, setWaGateway] = useState(data?.settings?.waGateway ?? "wablas");
  const [waHost, setWaHost] = useState(data?.settings?.waHost ?? "solo.wablas.com");
  const [waSecret, setWaSecret] = useState("");
  const [waEnabled, setWaEnabled] = useState(data?.settings?.waEnabled ?? false);
  const [waNotice, setWaNotice] = useState("");
  const [waTesting, setWaTesting] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const ordersPaging = usePaging(data?.orders.length ?? 0, 8);
  const productsPaging = usePaging(data?.products.length ?? 0, 8);
  const movementsPaging = usePaging(data?.movements.length ?? 0, 10);
  const expensesPaging = usePaging(data?.expenses.length ?? 0, 8);
  const financeOrdersPaging = usePaging(data?.orders.length ?? 0, 8);
  const redemptionsPaging = usePaging(data?.redemptions.length ?? 0, 8);
  const [rewardModal, setRewardModal] = useState<{ open: boolean; reward: Reward | null }>({ open: false, reward: null });
  const [expenseRewardId, setExpenseRewardId] = useState("");
  if (!data) return <main className="auth-page"><section className="auth-card admin-auth"><div className="auth-art"><span className="kicker light">RUANG KENDALI</span><h2>Satu layar.<br/>Semua terkendali.</h2><p>Pantau order, stok, pemasukan, dan operasional toko.</p><div className="admin-preview"><div><span></span><b>Order hari ini</b><strong>8</strong></div><div><span></span><b>Stok aman</b><strong>92%</strong></div></div></div><form className="auth-form" onSubmit={async (e) => { e.preventDefault(); try { await login(email, password); } catch {} }}><span className="kicker">ADMIN LOGIN</span><h1>Selamat datang kembali</h1><p>Masuk menggunakan akun operasional toko.</p><label>Email admin<input value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary full" disabled={busy}>{busy ? "Memeriksa..." : "Masuk ke dashboard"}<span>→</span></button><div className="demo-credential"><b>Akun dummy admin</b><span>admin@segardepot.local</span><small>Password: Admin123!</small></div>{user && user.role !== "admin" && <div className="info-box">Sesi {user.role} akan diganti saat login admin.</div>}</form></section></main>;
  const nextFor = (o: Order) => o.status === "ready" ? { status: o.fulfillment === "delivery" ? "delivering" : "completed", label: o.fulfillment === "delivery" ? "Mulai antar" : "Selesaikan" } : statusNext[o.status];
  const doAction = async (payload: Record<string, unknown>) => { try { await action(payload, reload); } catch {} };
  return <main className="admin-layout"><aside className="admin-sidebar"><div><span className="brand-mark"><Icon name="drop" /></span><b>SEGAR.</b><small>Admin Console</small></div><nav><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Icon name="chart"/>Ringkasan</button><button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><Icon name="box"/>Pesanan <span>{data.metrics.pending}</span></button><button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}><Icon name="menu"/>Persediaan</button><button className={tab === "finance" ? "active" : ""} onClick={() => setTab("finance")}><Icon name="wallet"/>Keuangan</button><button className={tab === "event" ? "active" : ""} onClick={() => setTab("event")}><Icon name="gift"/>Event</button></nav><div className="admin-user"><span>{data.user.name.charAt(0)}</span><p><b>{data.user.name}</b><small>{data.user.email}</small></p></div></aside><section className="admin-content"><div className="admin-head"><div><span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span><h1>{tab === "overview" ? "Ringkasan operasional" : tab === "orders" ? "Kelola pesanan" : tab === "stock" ? "Persediaan produk" : tab === "finance" ? "Pemasukan & operasional" : "Event & rewards"}</h1></div><span className="live-badge"><i></i>Data aktif</span></div>
    {(tab === "overview" || tab === "finance") && <div className="metric-grid"><Metric label="Omzet selesai" value={money(data.metrics.revenue)} note={`${data.metrics.completed} transaksi lunas`} icon="chart"/><Metric label="Pesanan aktif" value={String(data.metrics.pending)} note="Butuh tindak lanjut" icon="box"/><Metric label="Biaya operasional" value={money(data.metrics.expenses)} note="Seluruh pencatatan" icon="wallet"/><Metric label="Estimasi netto" value={money(data.metrics.revenue - data.metrics.expenses)} note="Omzet dikurangi biaya" icon="check"/></div>}
    {tab === "overview" && <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">ORDER QUEUE</span><h2>Perlu diproses</h2></div><button onClick={() => setTab("orders")}>Lihat semua →</button></div><OrderTable orders={data.orders.filter((o) => !["completed", "cancelled"].includes(o.status)).slice(0, 6)} nextFor={nextFor} doAction={doAction} print={print} onEdit={setEditOrder}/></section><section className="panel stock-watch"><div className="panel-heading"><div><span className="kicker">STOCK WATCH</span><h2>Stok produk</h2></div><button onClick={() => setTab("stock")}>Lihat semua →</button></div>{[...data.products].sort((a, b) => ((a.stock - a.reserved <= a.min_stock ? 0 : 1) - (b.stock - b.reserved <= b.min_stock ? 0 : 1))).slice(0, 6).map((p) => { const available = p.stock - p.reserved; const low = available <= p.min_stock; const pct = Math.min(100, Math.max(6, available / Math.max(p.min_stock * 3, 1) * 100)); return <div className="stock-mini" key={p.id}><div><span style={{ background: p.accent }}></span><p><b>{p.name}</b><small>{available} {p.unit} tersedia{p.reserved > 0 ? ` · ${p.reserved} dipesan` : ""}</small></p><span className={`status ${low ? "cancelled" : "completed"}`}>{low ? "Stok rendah" : "Aman"}</span></div><div className="stock-bar"><i style={{ width: `${pct}%`, background: low ? "#e2574c" : p.accent }}></i></div></div>})}</section></div>}
    {tab === "orders" && <section className="panel"><div className="panel-heading"><div><span className="kicker">SEMUA PESANAN</span><h2>{data.orders.length} transaksi tercatat</h2></div><div className="head-actions"><button className="primary small" onClick={() => setOfflineOpen(true)}><Icon name="plus" size={15}/> Order offline</button><button className="download-btn" onClick={() => { const csv = ordersToCSV(data.orders); downloadCSV(`pesanan-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div></div><OrderTable orders={ordersPaging.slice(data.orders)} nextFor={nextFor} doAction={doAction} print={print} onEdit={setEditOrder}/><Pagination paging={ordersPaging} label="Pesanan"/></section>}
    {tab === "stock" && <section className="panel"><div className="panel-heading"><div><span className="kicker">INVENTORY</span><h2>Kelola produk & stok</h2></div><div className="head-actions"><div className="sub-tabs"><button className={stockTab === "stok" ? "active" : ""} onClick={() => setStockTab("stok")}>Stok</button><button className={stockTab === "riwayat" ? "active" : ""} onClick={() => setStockTab("riwayat")}>Riwayat</button></div><button className="download-btn" onClick={() => { const csv = productsToCSV(data.products); downloadCSV(`produk-stok-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button><button className="primary small" onClick={() => setProductModal({ open: true, product: null })}><Icon name="plus" size={15}/> Tambah produk</button></div></div>{stockTab === "riwayat" ? <div className="movement-list">{data.movements.length ? movementsPaging.slice(data.movements).map((m) => { const mp = data.products.find((p) => p.id === m.product_id); return <div key={m.id}><span className={`movement-badge ${m.movement_type}`}>{movementLabel[m.movement_type] ?? m.movement_type}</span><p><b>{m.reason}</b><small>{mp?.name ?? m.product_id} · {dateTime(m.created_at)}{m.reference_id ? ` · ${m.reference_id.slice(0, 18)}` : ""}</small></p><strong style={{ color: m.qty > 0 ? "var(--teal)" : "var(--danger)" }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong></div>; }) : <div className="empty-panel">Belum ada pergerakan stok.</div>}<Pagination paging={movementsPaging} label="Riwayat"/></div> : <div className="inventory-table table-scroll"><table><thead><tr><th>Produk</th><th>SKU</th><th>Stok fisik</th><th>Dipesan</th><th>Tersedia</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{productsPaging.slice(data.products).map((p) => { const available = p.stock - p.reserved; return <tr key={p.id}><td><div className="table-product"><span style={{ background: p.accent }}></span><b>{p.name}</b></div></td><td>{p.sku}</td><td>{p.stock} {p.unit}</td><td>{p.reserved}</td><td><b>{available}</b></td><td><span className={`status ${available <= p.min_stock ? "cancelled" : "completed"}`}>{available <= p.min_stock ? "Stok rendah" : "Aman"}</span></td><td><div className="row-actions"><div className="stock-actions"><button title="Kurangi stok" onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: -1 })}>−</button><button title="Tambah stok" onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: 1 })}>+</button><button title="Tambah stok 10" onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: 10 })}>+10</button></div><button className="row-icon" title="Edit produk" onClick={() => setProductModal({ open: true, product: p })}><Icon name="edit" size={16}/></button><button className="row-icon danger" title="Hapus produk" onClick={() => { if (window.confirm(`Hapus produk "${p.name}"? Tindakan tidak bisa dibatalkan.`)) void doAction({ action: "delete_product", productId: p.id }); }}><Icon name="trash" size={16}/></button></div></td></tr>})}</tbody></table><Pagination paging={productsPaging} label="Produk"/></div>}</section>}
    {tab === "finance" && <div className="finance-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">BIAYA BARU</span><h2>Catat operasional</h2></div></div><form className="expense-form" onSubmit={async (e) => { e.preventDefault(); try { await action({ action: "add_expense", ...expense, amount: Number(expense.amount) }, reload); setExpense({ category: "Transportasi", description: "", amount: "" }); setExpenseRewardId(""); } catch {} }}><label>Kategori<select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}><option>Transportasi</option><option>Pembelian stok</option><option>Listrik</option><option>Upah</option><option>Reward member</option><option>Lainnya</option></select></label>{expense.category === "Reward member" ? <label>Reward poin<select value={expenseRewardId} onChange={(e) => { const id = e.target.value; setExpenseRewardId(id); const r = data.rewards.find((x) => x.id === id); if (r) { const p = data.products.find((x) => x.id === r.product_id); setExpense({ category: "Reward member", description: `Reward: ${r.name}`, amount: p ? String(p.price) : "" }); } else { setExpense({ ...expense, description: "", amount: "" }); } }}><option value="">— Pilih penawaran —</option>{data.rewards.map((r) => { const p = data.products.find((x) => x.id === r.product_id); return <option key={r.id} value={r.id}>{r.name} ({r.points_cost} poin{p ? ` · ${money(p.price)}` : ""})</option>; })}</select></label> : null}<label>Deskripsi<input required value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} placeholder={expense.category === "Reward member" ? "Otomatis dari penawaran terpilih" : "Contoh: Bensin pengantaran"} /></label><label>Nominal<input required type="number" min="0" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="50000" /></label><button className="primary" disabled={busy}>Simpan biaya</button></form></section><section className="panel"><div className="panel-heading"><div><span className="kicker">HISTORI BIAYA</span><h2>Operasional terbaru</h2></div><button className="download-btn" onClick={() => { const csv = expensesToCSV(data.expenses); downloadCSV(`biaya-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div><div className="expense-list">{data.expenses.length ? expensesPaging.slice(data.expenses).map((e) => <div key={e.id}><span className="expense-icon"><Icon name="wallet"/></span><p><b>{e.description}</b><small>{e.category} · {dateTime(e.created_at)}</small></p><strong>-{money(e.amount)}</strong></div>) : <div className="empty-panel">Belum ada biaya tercatat.</div>}<Pagination paging={expensesPaging} label="Biaya"/></div></section></div>}
    {tab === "finance" && <div className="finance-grid" style={{ marginTop: 24 }}><section className="panel"><div className="panel-heading"><div><span className="kicker">UANG MASUK</span><h2>Riwayat pemesanan</h2></div><button className="download-btn" onClick={() => { const csv = ordersToCSV(data.orders); downloadCSV(`pemasukan-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div>{data.orders.length ? <div className="order-list">{financeOrdersPaging.slice(data.orders).map((o) => <article key={o.id}><div><span>{o.order_no}</span><small>{dateTime(o.created_at)}</small></div><p>{o.items.map((i) => `${i.qty}× ${i.product_name}`).join(", ")}</p><b style={{ color: "var(--teal-dark)" }}>+{money(o.total)}</b><span className={`status ${o.payment_status === "paid" ? "completed" : "new"}`}>{o.payment_status === "paid" ? "Lunas" : "Belum bayar"}</span></article>)}</div> : <div className="empty-panel">Belum ada pemesanan.</div>}<Pagination paging={financeOrdersPaging} label="Pesanan"/></section><section className="panel"><div className="panel-heading"><div><span className="kicker">ARUS KAS</span><h2>Ringkasan</h2></div></div>{(() => { const masuk = data.orders.filter((o) => o.payment_status === "paid").reduce((s, o) => s + o.total, 0); const keluar = data.metrics.expenses; const netto = masuk - keluar; return <div className="cashflow-summary"><div><span>Uang masuk</span><b style={{ color: "var(--teal-dark)" }}>+{money(masuk)}</b><small>{data.orders.filter((o) => o.payment_status === "paid").length} pesanan lunas</small></div><div><span>Uang keluar</span><b style={{ color: "var(--danger)" }}>-{money(keluar)}</b><small>{data.expenses.length} biaya tercatat</small></div><div className={netto >= 0 ? "positive" : "negative"}><span>Selisih (netto)</span><b>{netto >= 0 ? "+" : "-"}{money(Math.abs(netto))}</b><small>{netto >= 0 ? "Surplus" : "Defisit"}</small></div></div>; })()}</section></div>}
    {tab === "event" && <div className="finance-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">PENGATURAN</span><h2>Ongkos kirim</h2></div></div><form className="expense-form" onSubmit={async (e) => { e.preventDefault(); try { await action({ action: "update_settings", deliveryFee: Number(deliveryFee) }, reload); } catch {} }}><label>Biaya ongkir (Rp)<input required type="number" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="5000" /><small style={{ fontWeight: 600, color: "var(--muted)" }}>Dikenakan saat pelanggan memilih pengantaran. 0 = gratis.</small></label><button className="primary" disabled={busy}>Simpan ongkir</button></form></section><section className="panel"><div className="panel-heading"><div><span className="kicker">NOTIFIKASI WHATSAPP</span><h2>Order masuk ke admin</h2></div></div><form className="expense-form" onSubmit={async (e) => { e.preventDefault(); try { await action({ action: "update_settings", waTarget, waGateway, waHost, waEnabled, waToken: waToken.trim(), waSecret: waSecret.trim() }, reload); setWaToken(""); setWaSecret(""); setWaNotice("Pengaturan WhatsApp disimpan."); setTimeout(() => setWaNotice(""), 4000); } catch {} }}><label>Nomor WhatsApp admin<input required value={waTarget} onChange={(e) => setWaTarget(e.target.value)} placeholder="085863480872" /></label><label>Gateway<select value={waGateway} onChange={(e) => setWaGateway(e.target.value)}><option value="wablas">Wablas</option><option value="fonnte">Fonnte (api.fonnte.com)</option></select></label>{waGateway === "wablas" && <label>Server Wablas<input required value={waHost} onChange={(e) => setWaHost(e.target.value)} placeholder="smg.wablas.com" /><small style={{ fontWeight: 600, color: "var(--muted)" }}>Contoh: solo.wablas.com, smg.wablas.com (sesuai server akun Anda)</small></label>}<label>Token API{data.settings.waTokenSet ? <small style={{ fontWeight: 600, color: "var(--success)" }}>✓ Token tersimpan {waToken ? "(akan diganti)" : ""}</small> : <small style={{ fontWeight: 600, color: "var(--danger)" }}>Token belum diisi</small>}<input type="password" value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder={data.settings.waTokenSet ? "•••••••• (kosongkan = tetap)" : "Tempel token dari dashboard gateway"} /></label>{waGateway === "wablas" && <label>Secret Key (opsional){data.settings.waSecretSet ? <small style={{ fontWeight: 600, color: "var(--success)" }}>✓ Secret tersimpan {waSecret ? "(akan diganti)" : ""}</small> : <small style={{ fontWeight: 600, color: "var(--muted)" }}>Diperlukan bila Wablas menolak IP (Access denied)</small>}<input type="password" value={waSecret} onChange={(e) => setWaSecret(e.target.value)} placeholder="Secret key dari dashboard Wablas" /></label>}<label className="toggle-row"><span><b>Aktifkan notifikasi</b><small>Kirim pesan ke WhatsApp admin saat ada order baru</small></span><input type="checkbox" checked={waEnabled} onChange={(e) => setWaEnabled(e.target.checked)} /></label>{waNotice && <small style={{ color: "var(--teal-dark)", fontWeight: 700 }}>{waNotice}</small>}<div className="modal-actions" style={{ padding: 0 }}><button className="primary" disabled={busy}>Simpan pengaturan</button><button type="button" className="download-btn" disabled={waTesting || busy} onClick={async () => { setWaTesting(true); setWaNotice(""); try { const res = await action({ action: "test_whatsapp" }); setWaNotice(`✓ Pesan uji terkirim ke ${String(res.target ?? waTarget)} (${String(res.gateway ?? "")}).`); setTimeout(() => setWaNotice(""), 6000); } catch { setWaNotice("Gagal kirim uji — cek token & nomor."); setTimeout(() => setWaNotice(""), 6000); } finally { setWaTesting(false); } }}>{waTesting ? "Mengirim..." : "Kirim pesan uji"}</button></div></form></section><section className="panel"><div className="panel-heading"><div><span className="kicker">REWARDS MEMBER</span><h2>Penawaran tukar poin</h2></div><button className="primary small" onClick={() => setRewardModal({ open: true, reward: null })}><Icon name="plus" size={15}/> Tambah penawaran</button></div>{data.rewards.length ? <div className="reward-list">{data.rewards.map((r) => <div key={r.id}><div><b>{r.name}</b><small>{r.description || "—"} · {r.stock === null ? "Stok tak terbatas" : `Sisa ${r.stock}`} · {r.active ? "Aktif" : "Nonaktif"}</small></div><strong>{r.points_cost} poin</strong><div className="row-actions"><button title="Edit" onClick={() => setRewardModal({ open: true, reward: r })}><Icon name="edit" size={16}/></button><button title="Hapus" onClick={() => { if (window.confirm(`Hapus penawaran "${r.name}"?`)) void doAction({ action: "delete_reward", rewardId: r.id }); }}><Icon name="trash" size={16}/></button></div></div>)}</div> : <div className="empty-panel">Belum ada penawaran. Tambahkan reward pertama untuk member.</div>}</section><section className="panel"><div className="panel-heading"><div><span className="kicker">PENUKARAN</span><h2>Redemption poin</h2></div></div>{data.redemptions.length ? <><div className="expense-list">{redemptionsPaging.slice(data.redemptions).map((r) => <div key={r.id}><span className="expense-icon"><Icon name="check"/></span><p><b>{r.reward_name}</b><small>{r.user_name ?? r.user_id} · {dateTime(r.created_at)}</small></p><div style={{ display: "flex", gap: 8, alignItems: "center" }}><strong style={{ color: "var(--teal)" }}>-{r.points_cost} poin</strong>{r.status === "pending" ? <div className="row-actions"><button className="next-action" onClick={() => void doAction({ action: "update_redemption", redemptionId: r.id, status: "done" })}>Selesai</button><button className="danger-action" onClick={() => void doAction({ action: "update_redemption", redemptionId: r.id, status: "cancelled" })}>Batal</button></div> : <span className={`status ${r.status === "done" ? "completed" : "cancelled"}`}>{r.status === "done" ? "Selesai" : "Dibatalkan"}</span>}</div></div>)}</div><Pagination paging={redemptionsPaging} label="Penukaran"/></> : <div className="empty-panel">Belum ada penukaran poin.</div>}</section></div>}
   </section>{offlineOpen && <OfflineOrderModal products={data.products} deliveryFee={data.settings.deliveryFee} busy={busy} close={() => setOfflineOpen(false)} submit={async (payload) => { try { const res = await action({ action: "create_order", ...payload }); if (payload.paid && res.orderId) await action({ action: "mark_paid", orderId: String(res.orderId) }); setOfflineOpen(false); await reload(); } catch {} }} />}{editOrder && <EditOrderModal order={editOrder} products={data.products} deliveryFee={data.settings.deliveryFee} busy={busy} close={() => setEditOrder(null)} submit={async (payload) => { try { await action({ action: "update_order_details", orderId: editOrder.id, ...payload }); setEditOrder(null); await reload(); } catch {} }} />}{productModal.open && <ProductModal product={productModal.product} busy={busy} onClose={() => setProductModal({ open: false, product: null })} onSave={async (payload) => { try { await action(productModal.product ? { action: "update_product", productId: productModal.product.id, ...payload } : { action: "create_product", ...payload }, reload); setProductModal({ open: false, product: null }); } catch {} }} />}{rewardModal.open && <RewardModal reward={rewardModal.reward} products={data.products} busy={busy} onClose={() => setRewardModal({ open: false, reward: null })} onSave={async (payload) => { try { await action(rewardModal.reward ? { action: "update_reward", rewardId: rewardModal.reward.id, ...payload } : { action: "create_reward", ...payload }, reload); setRewardModal({ open: false, reward: null }); } catch {} }} />}</main>;
   }

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: string }) { return <article className="metric"><div><span>{label}</span><b>{value}</b><small>{note}</small></div><i><Icon name={icon}/></i></article>; }

/* Pagination klien — data sudah dimuat penuh; hanya slice per halaman */
function usePaging(total: number, pageSize = 8) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pages);
  return {
    page: p, pages, setPage,
    start: total ? (p - 1) * pageSize + 1 : 0,
    end: Math.min(p * pageSize, total),
    slice: <T,>(arr: T[]): T[] => arr.slice((p - 1) * pageSize, p * pageSize),
  };
}

function Pagination({ paging, label }: { paging: ReturnType<typeof usePaging>; label?: string }) {
  if (paging.pages <= 1) return null;
  return <div className="pagination"><small>{label ? `${label} · ` : ""}Menampilkan {paging.start}–{paging.end}</small><div className="pagination-btns"><button disabled={paging.page <= 1} onClick={() => paging.setPage(paging.page - 1)} aria-label="Halaman sebelumnya">‹</button><span>{paging.page} / {paging.pages}</span><button disabled={paging.page >= paging.pages} onClick={() => paging.setPage(paging.page + 1)} aria-label="Halaman berikutnya">›</button></div></div>;
}

function OfflineOrderModal({ products, deliveryFee, busy, close, submit }: { products: Product[]; deliveryFee: number; busy: boolean; close: () => void; submit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ customerName: "", phone: "", fulfillment: "pickup", address: "", paymentMethod: "cod", paid: true });
  const [query, setQuery] = useState("");
  const items = Object.entries(cart).map(([id, qty]) => ({ product: products.find((p) => p.id === id)!, qty })).filter((x) => x.product && x.qty > 0);
  const subtotal = items.reduce((s, x) => s + x.product.price * x.qty, 0);
  const shipping = form.fulfillment === "delivery" ? deliveryFee : 0;
  const change = (id: string, d: number) => setCart((c) => {
    const next = { ...c, [id]: Math.max(0, (c[id] ?? 0) + d) };
    if (next[id] === 0) delete next[id];
    return next;
  });
  const visible = products.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!items.length) return;
    await submit({ order_type: "offline", ...form, items: items.map((x) => ({ productId: x.product.id, qty: x.qty })) });
  };
  return <div className="modal-backdrop"><section className="modal offline-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={close}>×</button><div className="modal-head"><span className="kicker">ORDER OFFLINE</span><h2>Transaksi langsung di toko</h2><p>Catat penjualan walk-in. Stok otomatis ter-reservasi & masuk antrian pesanan.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="offline-grid"><div className="offline-products"><label className="offline-search"><Icon name="search"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label><div className="offline-list">{visible.map((p) => { const available = p.stock - p.reserved; const qty = cart[p.id] ?? 0; return <div key={p.id}><span className="offline-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} · sisa {available} {p.unit}</small></div>{qty ? <div className="stepper"><button type="button" onClick={() => change(p.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button type="button" onClick={() => change(p.id, 1)}><Icon name="plus" size={16}/></button></div> : <button type="button" className="add-button" disabled={available < 1} onClick={() => change(p.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div>; })}</div></div><div className="offline-form"><div className="form-stack"><label>Nama pelanggan<input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama pembeli" /></label><label>Nomor WhatsApp<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}<div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div><label className="paid-check"><input type="checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} /><span><b>Sudah dibayar</b><small>langsung tandai lunas</small></span></label></div><div className="offline-summary"><div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy || !items.length}>{busy ? "Menyimpan..." : items.length ? `Simpan order (${items.length} item)` : "Pilih produk dahulu"}<span>→</span></button></div></div></div></form></section></div>;
}

function EditOrderModal({ order, products, deliveryFee, busy, close, submit }: { order: Order; products: Product[]; deliveryFee: number; busy: boolean; close: () => void; submit: (payload: Record<string, unknown>) => Promise<void> }) {
  const [cart, setCart] = useState<Record<string, number>>(() => Object.fromEntries(order.items.map((i) => [i.product_id, i.qty])));
  const [form, setForm] = useState({ customerName: order.customer_name, phone: order.phone, fulfillment: order.fulfillment === "delivery" ? "delivery" : "pickup", address: order.address, paymentMethod: order.payment_method });
  const [query, setQuery] = useState("");
  const items = Object.entries(cart).map(([id, qty]) => ({ product: products.find((p) => p.id === id)!, qty })).filter((x) => x.product && x.qty > 0);
  const subtotal = items.reduce((s, x) => s + x.product.price * x.qty, 0);
  const shipping = form.fulfillment === "delivery" ? deliveryFee : 0;
  const change = (id: string, d: number) => setCart((c) => {
    const next = { ...c, [id]: Math.max(0, (c[id] ?? 0) + d) };
    if (next[id] === 0) delete next[id];
    return next;
  });
  const visible = products.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!items.length) return;
    await submit({ ...form, items: items.map((x) => ({ productId: x.product.id, qty: x.qty })) });
  };
  return <div className="modal-backdrop"><section className="modal offline-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={close}>×</button><div className="modal-head"><span className="kicker">EDIT PESANAN</span><h2>{order.order_no}</h2><p>Koreksi data pelanggan & item. Total dihitung ulang, stok otomatis disesuaikan.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="offline-grid"><div className="offline-products"><label className="offline-search"><Icon name="search"/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label><div className="offline-list">{visible.map((p) => { const available = p.stock - p.reserved; const qty = cart[p.id] ?? 0; return <div key={p.id}><span className="offline-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} · sisa {available} {p.unit}</small></div>{qty ? <div className="stepper"><button type="button" onClick={() => change(p.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button type="button" onClick={() => change(p.id, 1)}><Icon name="plus" size={16}/></button></div> : <button type="button" className="add-button" disabled={available < 1} onClick={() => change(p.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div>; })}</div></div><div className="offline-form"><div className="form-stack"><label>Nama pelanggan<input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama pembeli" /></label><label>Nomor WhatsApp<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}<div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div></div><div className="offline-summary"><div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total baru</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy || !items.length}>{busy ? "Menyimpan..." : items.length ? `Simpan perubahan (${items.length} item)` : "Pilih produk dahulu"}<span>→</span></button></div></div></div></form></section></div>;
}

function OrderTable({ orders, nextFor, doAction, print, onEdit }: { orders: Order[]; nextFor: (o: Order) => { status: string; label: string } | undefined; doAction: (p: Record<string, unknown>) => Promise<void>; print: (o: Order) => void; onEdit?: (o: Order) => void }) {
  const typeTag = (o: Order) => o.order_type === "redeem" ? <span className="redeem-tag">REDEEM</span> : o.order_type === "offline" ? <span className="offline-tag">OFFLINE</span> : <span className="online-tag">ONLINE</span>;
  return <div className="table-scroll"><table className="order-table"><thead><tr><th>Pesanan</th><th>Pelanggan</th><th>Item</th><th>Total</th><th>Status</th><th>Pembayaran</th><th>Aksi</th></tr></thead><tbody>{orders.length ? orders.map((o) => { const next = nextFor(o); return <tr key={o.id}><td><b>{o.order_no}</b>{typeTag(o)}<small>{dateTime(o.created_at)}</small></td><td><b>{o.customer_name}</b><small>{o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</small></td><td><span>{o.items.reduce((s, i) => s + i.qty, 0)} item</span><small>{o.items[0]?.product_name}</small></td><td>{o.order_type === "redeem" ? <b className="redeem-free">Gratis poin</b> : <b>{money(o.total)}</b>}</td><td><span className={`status ${o.status}`}>{statusLabel[o.status]}</span></td><td>{o.order_type === "redeem" ? <button className="payment-chip paid" disabled>Lunas poin</button> : <button className={`payment-chip ${o.payment_status}`} disabled={o.payment_status === "paid" || o.status === "cancelled"} onClick={() => void doAction({ action: "mark_paid", orderId: o.id })}>{statusLabel[o.payment_status]}</button>}<small>{paymentMethodLabel[o.payment_method] ?? o.payment_method}</small></td><td><div className="row-actions"><button title="Cetak" onClick={() => print(o)}><Icon name="print" size={17}/></button>{onEdit && o.order_type !== "redeem" && !["completed", "cancelled"].includes(o.status) && <button title="Edit pesanan" onClick={() => onEdit(o)}><Icon name="edit" size={17}/></button>}{next && <button className="next-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: next.status })}>{next.label}</button>}{!["completed", "cancelled"].includes(o.status) && <button className="danger-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: "cancelled" })}>Batal</button>}</div></td></tr>}) : <tr><td colSpan={7}><div className="empty-panel">Belum ada pesanan.</div></td></tr>}</tbody></table></div>;
}

/* Konversi file gambar → data URL terkompres (maks 600px, JPEG 0.8) */
function fileToCompressedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("File bukan gambar yang valid."));
      img.onload = () => {
        const MAX = 600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas tidak tersedia."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function ProductModal({ product, busy, onClose, onSave }: { product: Product | null; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({
    sku: product?.sku ?? "", name: product?.name ?? "", category: product?.category ?? "Air Galon",
    unit: product?.unit ?? "galon", price: product ? String(product.price) : "",
    stock: product ? String(product.stock) : "0", minStock: product ? String(product.min_stock) : "5",
    accent: product?.accent ?? "#176B87", image: product?.image ?? "",
  });
  const [imageBusy, setImageBusy] = useState(false);
  const accents = ["#176B87", "#D44B52", "#2895A9", "#2482C5", "#4AA3D8", "#6CBCCF", "#91D5E4", "#0B7A75", "#7A5AC9", "#C98A2D"];
  const submit = async (e: FormEvent) => { e.preventDefault(); await onSave({ ...form, image: form.image || null, price: Number(form.price), stock: Number(form.stock), minStock: Number(form.minStock) }); };
  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setImageBusy(true);
    try { setForm({ ...form, image: await fileToCompressedDataUrl(file) }); }
    catch { window.alert("Gambar tidak bisa diproses. Coba file JPG/PNG yang lebih kecil."); }
    finally { setImageBusy(false); }
  };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><div className="modal-head"><span className="kicker">{product ? "EDIT PRODUK" : "PRODUK BARU"}</span><h2>{product ? `Edit ${product.name}` : "Tambah produk"}</h2><p>{product ? "Ubah detail produk. Stok diubah lewat tombol penyesuaian." : "Stok awal tercatat sebagai penyesuaian di riwayat."}</p></div><form onSubmit={(e) => void submit(e)}><div className="product-form-grid"><label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="AQ-G19" maxLength={40} /></label><label>Nama produk<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aqua Galon 19 L" /></label><label>Kategori<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Air Galon</option><option>Air Botol</option><option>Es Batu</option><option>Lainnya</option></select></label><label>Satuan<input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="galon" /></label><label>Harga (Rp)<input required type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="23000" /></label><label>Stok awal{product ? <input value={form.stock} disabled title="Gunakan tombol penyesuaian untuk mengubah stok" /> : <input required type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" />}</label><label>Min. stok (peringatan)<input required type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} placeholder="5" /></label></div><div className="field-label" style={{ marginTop: 16 }}>Gambar produk <small style={{ color: "var(--muted)", fontWeight: 600 }}>(opsional — tampil di kartu katalog)</small></div><div className="image-uploader"><label className="image-drop"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void onPickImage(e.target.files?.[0])} /><span>{imageBusy ? "Memproses..." : form.image ? "Ganti gambar" : "Pilih gambar"}</span></label>{form.image && <div className="image-preview"><NextImage src={form.image} alt="Pratinjau produk" fill unoptimized sizes="96px" /><button type="button" className="row-icon danger" title="Hapus gambar" onClick={() => setForm({ ...form, image: "" })}><Icon name="trash" size={15}/></button></div>}</div><div className="field-label" style={{ marginTop: 16 }}>Warna aksen</div><div className="accent-row">{accents.map((c) => <button key={c} type="button" className={form.accent === c ? "selected" : ""} style={{ background: c }} onClick={() => setForm({ ...form, accent: c })} aria-label={`Aksen ${c}`} />)}</div><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan produk"}</button></div></form></section></div>;
}

function RedeemModal({ reward, user, busy, close, submit }: { reward: Reward; user: User; busy: boolean; close: () => void; submit: (p: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ customerName: user?.name ?? "", phone: "", fulfillment: "delivery", address: "" });
  const onSubmit = async (e: FormEvent) => { e.preventDefault(); try { await submit(form); } catch {} };
  return <div className="modal-backdrop"><section className="modal checkout-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={close}>×</button><div className="modal-head"><span className="kicker">TUKAR POIN</span><h2>Penukaran {reward.name}</h2><p>Lengkapi detail pemesanan. Penukaran masuk antrian toko dan diproses admin.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="checkout-columns"><div className="form-stack"><label>Nama lengkap<input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama lengkap" /></label><label>Nomor WhatsApp<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}</div><div className="order-review"><h3>Ringkasan</h3><div className="review-line"><span>{reward.name}</span><b>{reward.points_cost} poin</b></div><div className="review-fee"><span>Biaya tunai</span><b>Rp 0</b></div><div className="review-total"><span>Total poin</span><b>{reward.points_cost}</b></div><button className="primary full" disabled={busy}>{busy ? "Memproses..." : "Tukar poin sekarang"}<span>→</span></button><small>Poin akan langsung dipotong. Admin akan menghubungi Anda untuk konfirmasi.</small></div></div></form></section></div>;
}

function Receipt({ order, close }: { order: Order; close: () => void }) { return <div className="modal-backdrop receipt-wrap"><section className="receipt-print"><div className="receipt-brand"><span className="brand-mark"><Icon name="drop"/></span><div><b>SEGAR.</b><small>Depot air & es</small></div></div><div className="receipt-meta"><p><span>Nomor</span><b>{order.order_no}</b></p><p><span>Tanggal</span><b>{dateTime(order.created_at)}</b></p><p><span>Pelanggan</span><b>{order.customer_name}</b></p><p><span>Layanan</span><b>{order.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</b></p>{order.fulfillment === "delivery" && order.address ? <p className="receipt-address"><span>Alamat</span><b>{order.address}</b></p> : null}<p><span>Pembayaran</span><b>{paymentMethodLabel[order.payment_method] ?? order.payment_method}</b></p></div><div className="receipt-items">{order.items.map((i) => <div key={i.id}><p><b>{i.product_name}</b><span>{i.qty} × {money(i.unit_price)}</span></p><strong>{money(i.subtotal)}</strong></div>)}</div><div className="receipt-total"><span>Total</span><b>{money(order.total)}</b></div><div className="receipt-status"><span>{statusLabel[order.payment_status]}</span><span>{statusLabel[order.status]}</span></div><p className="receipt-thanks">Terima kasih sudah belanja di SEGAR.<br/>Air jernih, urusan lebih ringan.</p></section><div className="receipt-controls"><button onClick={close}>Tutup</button><button className="primary" onClick={() => window.print()}><Icon name="print"/> Cetak nota</button></div></div>; }

function RewardModal({ reward, products, busy, onClose, onSave }: { reward: Reward | null; products: Product[]; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ name: reward?.name ?? "", description: reward?.description ?? "", pointsCost: reward ? String(reward.points_cost) : "", stock: reward?.stock === null ? "" : String(reward?.stock ?? ""), productId: reward?.product_id ?? "" });
  const pickProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    setForm((f) => ({ ...f, productId: id, name: p ? p.name : f.name, description: p ? `Penukaran ${p.name.toLowerCase()}` : f.description }));
  };
  const submit = async (e: FormEvent) => { e.preventDefault(); await onSave({ ...form, pointsCost: Number(form.pointsCost), stock: form.stock === "" ? null : Number(form.stock), productId: form.productId || null }); };
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}>×</button><div className="modal-head"><span className="kicker">{reward ? "EDIT PENAWARAN" : "PENAWARAN BARU"}</span><h2>{reward ? `Edit ${reward.name}` : "Tambah penawaran"}</h2><p>Pilih barang dari persediaan sebagai hadiah penukaran poin.</p></div><form onSubmit={(e) => void submit(e)}><div className="product-form-grid"><label>Produk persediaan<select value={form.productId} onChange={(e) => pickProduct(e.target.value)}><option value="">— Pilih barang —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label><label>Nama penawaran<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Otomatis dari produk terpilih" /></label><label>Biaya poin<input required type="number" min="1" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} placeholder="100" /></label><label>Stok (opsional)<input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="Kosongkan = tak terbatas" /></label></div><label style={{ marginTop: 14, display: "block" }}>Deskripsi<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Contoh: Berlaku untuk pembelian berikutnya" /></label><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan penawaran"}</button></div></form></section></div>;
}
