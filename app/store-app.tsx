"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import ThemeToggle from "./theme-toggle";

type User = { id: string; name: string; email: string; role: "admin" | "member"; points: number };
type Product = { id: string; sku: string; name: string; category: string; unit: string; price: number; stock: number; reserved: number; min_stock: number; accent: string; image: string | null };
type OrderItem = { id?: number; product_id: string; product_name: string; unit: string; qty: number; unit_price: number; subtotal: number };
type Order = { id: string; order_no: string; customer_name: string; phone: string; address: string; fulfillment: string; status: string; payment_status: string; payment_method: string; total: number; points_earned: number; order_type: string; created_at: string; items: OrderItem[] };
type Expense = { id: string; category: string; description: string; amount: number; created_at: string };
type Reward = { id: string; name: string; description: string; points_cost: number; stock: number | null; active: number; product_id: string | null; created_at: string };
type Redemption = { id: string; user_id: string; reward_id: string; reward_name: string; points_cost: number; status: string; created_at: string; user_name?: string };
type Settings = { deliveryFee: number; demoMode: boolean };
type AdminData = { user: User; orders: Order[]; products: Product[]; expenses: Expense[]; movements: Array<{ id: string; product_id: string; qty: number; movement_type: string; reference_id: string | null; reason: string; created_at: string }>; metrics: { revenue: number; completed: number; pending: number; expenses: number }; settings: Settings; rewards: Reward[]; redemptions: Redemption[] };
type MemberData = { user: User; orders: Order[]; ledger: Array<{ id: string; points: number; movement_type: string; created_at: string }>; rewards: Reward[]; redemptions: Redemption[] };
type View = "landing" | "shop" | "track" | "member" | "admin";

const statusLabel: Record<string, string> = {
  new: "Pesanan baru", confirmed: "Dikonfirmasi", preparing: "Disiapkan", ready: "Siap",
  delivering: "Diantar", completed: "Selesai", cancelled: "Dibatalkan",
  unpaid: "Belum dibayar", paid: "Lunas",
};

/* Alur ringkas: Konfirmasi, lalu Mulai antar (hanya pengantaran), lalu Selesaikan.
   "preparing" dan "ready" tidak lagi dipakai untuk pesanan baru, tetapi pesanan
   lama yang masih berstatus itu tetap bisa dilanjutkan. */
function nextStep(o: { status: string; fulfillment: string }): { status: string; label: string } | undefined {
  if (o.status === "new") return { status: "confirmed", label: "Konfirmasi" };
  if (["confirmed", "preparing", "ready"].includes(o.status)) return o.fulfillment === "delivery" ? { status: "delivering", label: "Mulai antar" } : { status: "completed", label: "Selesaikan" };
  if (o.status === "delivering") return { status: "completed", label: "Selesaikan" };
  return undefined;
}

function tanggalJakarta(iso: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(iso)); }

const SARING_AWAL = { dari: "", sampai: "", status: "", tipe: "", bayar: "", cari: "" };

const PERAN_KEY = "ardines_peran";

/* Fakta toko dari pemilik. Satu sumber untuk hero, label buka/tutup, dan footer. */
const JAM_BUKA = 8;
const JAM_TUTUP = 20;
const JAM_BUKA_TEKS = "08.00";
const JAM_TUTUP_TEKS = "20.00";
const TELEPON_CS = "0877-2885-0052";
const TELEPON_CS_TEL = "+6287728850052";

function tokoBuka() {
  const jam = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date()));
  return jam >= JAM_BUKA && jam < JAM_TUTUP;
}

const paymentMethodLabel: Record<string, string> = { cod: "COD", transfer: "Transfer", qris: "QRIS", redeem: "Tukar poin" };
const movementLabel: Record<string, string> = { reserve: "Reservasi", sale: "Terjual", return: "Retur", adjustment: "Penyesuaian" };

function money(value: number) { return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value); }
function dateTime(value: string) { return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value)); }

/* ==== Export CSV untuk pembukuan ==== */
function csvEscape(value: string | number | null | undefined): string {
  let s = String(value ?? "");
  // Netralkan injeksi formula: Excel/LibreOffice mengeksekusi sel yang diawali
  // = + - @ (juga setelah tab/CR). Kolom nama & alamat diisi bebas pelanggan.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

/* Perilaku dialog yang diharapkan orang: Escape menutup, ketuk latar menutup,
   fokus pindah ke dalam saat dibuka lalu terkurung di sana, dan kembali ke
   elemen pemicu saat ditutup. role="dialog" + aria-modal menjanjikan semua ini;
   tanpa hook ini janji itu tidak ditepati. Dipakai keenam modal. */
function useModal(close: () => void) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  // Callback ref, bukan useRef: panel jadi state sehingga efek di bawah berjalan
  // tepat setelah elemennya terpasang, tanpa membaca ref saat render.
  const attach = useCallback((node: HTMLElement | null) => setPanel(node), []);

  const fokusable = useCallback((root: HTMLElement) => Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null), []);

  // Fokus masuk saat dibuka, kembali ke pemicu saat ditutup, dan gulir latar dikunci.
  useEffect(() => {
    if (!panel) return;
    const pemicu = document.activeElement as HTMLElement | null;
    const daftar = fokusable(panel);
    (daftar.find((el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ?? daftar[0])?.focus();

    const overflowLama = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // tanpa ini ponsel menggulir halaman di belakang

    return () => {
      document.body.style.overflow = overflowLama;
      pemicu?.focus?.();
    };
  }, [panel, fokusable]);

  // Escape menutup; Tab terkurung di dalam panel.
  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const items = fokusable(panel);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panel, close, fokusable]);

  // Ketuk latar menutup; ketukan di dalam panel tidak menembus keluar.
  const onBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  }, [close]);

  return { attach, onBackdrop };
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
  /* Pengunjung baru mendarat di halaman pilih-peran. Pilihannya diingat, jadi
     pelanggan yang kembali langsung masuk toko — landing tidak jadi hambatan
     berulang di jalur pemesanan. */
  const [view, setView] = useState<View>("landing");
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings>({ deliveryFee: 5000, demoMode: false });
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
  const [storeStatus, setStoreStatus] = useState<"loading" | "ready" | "error">("loading");
  const [memuatAkun, setMemuatAkun] = useState(false);

  const loadStore = async () => {
    try {
      const data = await callApi("/api/app?view=store") as unknown as { products: Product[]; user: User | null; settings: Settings };
      setStoreStatus("ready"); setNotice(null);
      setProducts(data.products); setUser(data.user); setSettings(data.settings ?? { deliveryFee: 5000, demoMode: false });
    } catch (e) { setStoreStatus((s) => s === "ready" ? s : "error"); setNotice({ msg: e instanceof Error ? e.message : "Gagal memuat toko.", kind: "error" }); }
  };



  const navigate = async (next: View) => {
    setView(next); setNotice(null);
    if (next === "admin") await loadAdmin();
    if (next === "member") await loadMember();
  };

  const loadAdmin = async () => {
    setMemuatAkun(true);
    try { setAdminData(await callApi("/api/app?view=admin") as unknown as AdminData); }
    catch { setAdminData(null); }
    finally { setMemuatAkun(false); }
  };
  const loadMember = async () => {
    setMemuatAkun(true);
    try { setMemberData(await callApi("/api/app?view=member") as unknown as MemberData); }
    catch { setMemberData(null); }
    finally { setMemuatAkun(false); }
  };

  useEffect(() => {
    let active = true;
    void callApi("/api/app?view=store")
      .then((raw) => {
        if (!active) return;
        const data = raw as unknown as { products: Product[]; user: User | null; settings: Settings };
        setStoreStatus("ready");
        setProducts(data.products); setUser(data.user); setSettings(data.settings ?? { deliveryFee: 5000, demoMode: false });
        // Sesi yang masih hidup, atau peran yang pernah dipilih, melewati landing.
        let peranTersimpan: string | null = null;
        try { peranTersimpan = localStorage.getItem(PERAN_KEY); } catch { /* diblokir */ }
        if (data.user?.role === "admin") { setView("admin"); void loadAdmin(); }
        else if (data.user?.role === "member" || peranTersimpan) { setView("shop"); }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStoreStatus("error");
        setNotice({ msg: error instanceof Error ? error.message : "Gagal memuat toko.", kind: "error" });
      });
    return () => { active = false; };
  }, []);

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

  /* Peran yang dipilih di landing disimpan agar kunjungan berikutnya langsung
     masuk. "admin" tidak pernah disimpan: konsol admin selalu lewat login. */
  const pilihPeran = async (peran: "guest" | "member" | "admin") => {
    setNotice(null);
    if (peran === "admin") { setView("admin"); await loadAdmin(); return; }
    try { localStorage.setItem(PERAN_KEY, peran); } catch { /* abaikan */ }
    if (peran === "member") { setView("member"); await loadMember(); return; }
    setView("shop");
  };

  const kembaliKeLanding = () => {
    try { localStorage.removeItem(PERAN_KEY); } catch { /* abaikan */ } setNotice(null); setView("landing");
  };

  const logout = async () => {
    await postAction({ action: "logout" });
    setUser(null); setAdminData(null); setMemberData(null);
    try { localStorage.removeItem(PERAN_KEY); } catch { /* abaikan */ } setView("landing");
  };

  const adminAktif = user?.role === "admin";

  if (view === "landing") {
    return (
      <div className="app-shell landing-shell">
        <div className="landing-top"><ThemeToggle /></div>
        <LandingView pilih={pilihPeran} demo={settings.demoMode} />
        {notice && <div className={`global-notice ${notice.kind}`} role="alert">{notice.msg}<button aria-label="Tutup pemberitahuan" onClick={() => setNotice(null)}>×</button></div>}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => void navigate("shop")}><span className="brand-mark"><Icon name="drop" /></span><span><strong>Ardines Group</strong><small>Es Kristal &amp; Air Minum</small></span></button>
        <nav className="desktop-nav" aria-label="Navigasi utama">
          <button className={view === "shop" ? "active" : ""} onClick={() => void navigate("shop")}>Belanja</button>
          <button className={view === "track" ? "active" : ""} onClick={() => void navigate("track")}>Lacak pesanan</button>
          <button className={view === "member" ? "active" : ""} onClick={() => void navigate("member")}>Member</button>
          {adminAktif && <button className={view === "admin" ? "active" : ""} onClick={() => void navigate("admin")}>Admin</button>}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          {!user && <button className="icon-button" title="Ganti peran" aria-label="Kembali ke halaman pilih peran" onClick={kembaliKeLanding}><Icon name="logout" /></button>}
          {user && <span className="user-pill"><span>{user.name.charAt(0)}</span>{user.name.split(" ")[0]}</span>}
          {user && <button className="icon-button" title="Keluar" onClick={() => void logout()}><Icon name="logout" /></button>}
          <button className="cart-button" onClick={() => setCheckoutOpen(true)}><Icon name="cart"/><span>Keranjang</span><b>{cartCount}</b></button>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Navigasi utama">
        <button className={view === "shop" ? "active" : ""} onClick={() => void navigate("shop")}><Icon name="search" /><span>Belanja</span></button>
        <button className={view === "track" ? "active" : ""} onClick={() => void navigate("track")}><Icon name="truck" /><span>Lacak</span></button>
        <button className={view === "member" ? "active" : ""} onClick={() => void navigate("member")}><Icon name="user" /><span>Member</span></button>
        {adminAktif && <button className={view === "admin" ? "active" : ""} onClick={() => void navigate("admin")}><Icon name="chart" /><span>Admin</span></button>}
      </nav>

      {cartItems.length > 0 && (
        <button className="floating-cart" onClick={() => setCheckoutOpen(true)} aria-label={`Buka keranjang, ${cartItems.length} produk`}>
          <Icon name="cart" />
          <b>{cartCount}</b>
          <span>{money(subtotal)}</span>
        </button>
      )}

      <div className="sr-live" role="status" aria-live="polite" aria-atomic="true">{notice?.msg ?? ""}</div>
      {notice && <div className={`global-notice ${notice.kind}`} role="alert">{notice.msg}<button aria-label="Tutup pemberitahuan" onClick={() => setNotice(null)}>×</button></div>}

      {view === "shop" && <ShopView products={visibleProducts} status={storeStatus} retry={() => void loadStore()} categories={categories} category={category} setCategory={setCategory} query={query} setQuery={setQuery} cart={cart} changeCart={changeCart} cartItems={cartItems} subtotal={subtotal} onCheckout={() => setCheckoutOpen(true)} />}
      {view === "track" && <TrackView />}
      {view === "member" && <MemberView data={memberData} loading={memuatAkun} user={user} busy={busy} demo={settings.demoMode} login={async () => { await postAction({ action: "login_member_demo" }); await loadStore(); await loadMember(); }} logout={logout} shop={() => void navigate("shop")} redeem={async (rewardId, payload) => { const data = await postAction({ action: "redeem_reward", rewardId, ...payload }); await loadMember(); return data; }} />}
      {view === "admin" && <AdminView data={adminData} loading={memuatAkun} user={user} busy={busy} demo={settings.demoMode} login={async (email, password) => { await postAction({ action: "login_admin", email, password }); await loadStore(); await loadAdmin(); }} action={postAction} reload={loadAdmin} print={(order) => { setReceipt(order); setTimeout(() => window.print(), 180); }} />}

      {checkoutOpen && <CheckoutModal items={cartItems} subtotal={subtotal} user={user} busy={busy} deliveryFee={settings.deliveryFee} close={() => setCheckoutOpen(false)} submit={async (payload) => {
        const data = await postAction({ action: "create_order", ...payload, items: cartItems.map((p) => ({ productId: p.id, qty: p.qty })) });
        setCart({}); setCheckoutOpen(false); await loadStore(); setNotice({ msg: `Pesanan ${String(data.orderNo)} berhasil dibuat. Total ${money(Number(data.total))}.`, kind: "success" });
      }} />}
      {receipt && <Receipt order={receipt} close={() => setReceipt(null)} />}

      <footer><div><strong>Ardines Group</strong><p>Distributor Es Kristal &amp; Depot Air Minum</p></div><div><span>Buka setiap hari</span><b>{JAM_BUKA_TEKS}–{JAM_TUTUP_TEKS} WIB</b></div><div><span>Layanan pelanggan</span><b><a href={`tel:${TELEPON_CS_TEL}`}>{TELEPON_CS}</a></b></div></footer>
    </div>
  );
}

/* Halaman pilih-peran. Jalur tamu sengaja jadi kartu utama dan terbesar:
   memesan tanpa login adalah nilai jual aplikasi ini, jadi landing tidak boleh
   berubah menjadi tembok. Admin ditaruh paling bawah sebagai baris tenang —
   pintu sebenarnya tetap login + pemeriksaan peran di server. */
function LandingView({ pilih, demo }: { pilih: (peran: "guest" | "member" | "admin") => Promise<void>; demo: boolean }) {
  return <main className="landing">
    <section className="landing-hero">
      <span className="brand-mark landing-mark"><Icon name="drop" size={28} /></span>
      <h1>Ardines Group</h1>
      <p className="landing-tagline">Distributor Es Kristal &amp; Depot Air Minum</p>
      <p className="landing-sub">Es kristal, air galon, dan air botol untuk rumah, warung, dan usaha kuliner. Pilih cara Anda masuk.</p>
    </section>

    <div className="landing-options">
      <button className="landing-card primary-card" onClick={() => void pilih("guest")}>
        <span className="landing-icon"><Icon name="cart" size={22} /></span>
        <span className="landing-copy">
          <b>Pesan langsung</b>
          <small>Tanpa daftar, tanpa login. Cukup isi nama, nomor WhatsApp, dan alamat.</small>
        </span>
        <span className="landing-go" aria-hidden="true">→</span>
      </button>

      <button className="landing-card" onClick={() => void pilih("member")}>
        <span className="landing-icon"><Icon name="user" size={22} /></span>
        <span className="landing-copy">
          <b>Masuk sebagai member</b>
          <small>Kumpulkan poin, lihat riwayat, dan pesan ulang lebih cepat.</small>
        </span>
        <span className="landing-go" aria-hidden="true">→</span>
      </button>
    </div>

    <div className="landing-track">
      <p>Sudah pesan dan ingin memantau? <b>Pilih &ldquo;Pesan langsung&rdquo;</b>, lalu buka tab <b>Lacak</b>.</p>
    </div>

    <div className="landing-staff">
      <button className="landing-staff-link" onClick={() => void pilih("admin")}>
        <Icon name="chart" size={15} />
        Masuk sebagai pengelola depot
      </button>
      {demo && <small className="landing-demo">Mode demo aktif: kredensial dummy masih berlaku.</small>}
    </div>
  </main>;
}

function ShopView({ products, status, retry, categories, category, setCategory, query, setQuery, cart, changeCart, cartItems, subtotal, onCheckout }: {
  products: Product[]; status: "loading" | "ready" | "error"; retry: () => void; categories: string[]; category: string; setCategory: (v: string) => void; query: string; setQuery: (v: string) => void;
  cart: Record<string, number>; changeCart: (id: string, d: number) => void; cartItems: Array<Product & { qty: number }>; subtotal: number; onCheckout: () => void;
}) {
  const buka = tokoBuka();
  return <main>
    <section className="hero">
      <div className="hero-copy"><h1>Es kristal &amp; air minum.<br/><em>Stok aman tiap hari.</em></h1><p>Distributor es kristal dan depot air minum untuk rumah, warung, dan usaha kuliner. Bisa ecer, bisa partai, langsung diantar.</p><div className="hero-actions"><button className="primary" onClick={() => document.getElementById("katalog")?.scrollIntoView({ behavior: "smooth" })}>Lihat katalog</button><div className="mini-proof"><span>✓</span><p><b>Tanpa login</b><small>Cukup nama, nomor WhatsApp, dan alamat</small></p></div></div><div className="hero-stats"><div><b>7 hari</b><span>buka {JAM_BUKA_TEKS}–{JAM_TUTUP_TEKS} WIB</span></div><div><b>120+</b><span>pelanggan rutin</span></div><div><b>Grosir</b><span>dan eceran dilayani</span></div></div></div>
      <div className="hero-visual"><NextImage src="/og.webp" width={1200} height={675} priority alt="Pengantaran es kristal, air galon, dan air botol Ardines Group"/><div className={buka ? "floating-card" : "floating-card tutup"}><span className="pulse"></span><p><b>{buka ? "Toko sedang buka" : "Toko sedang tutup"}</b><small>{buka ? `Tutup pukul ${JAM_TUTUP_TEKS} WIB` : `Buka lagi pukul ${JAM_BUKA_TEKS} WIB`}</small></p></div></div>
    </section>
    <section className="service-strip"><div><Icon name="truck"/><p><b>Antar cepat</b><span>Area sekitar toko</span></p></div><div><Icon name="check"/><p><b>Stok terpantau</b><span>Sisa stok tampil di tiap produk</span></p></div><div><Icon name="wallet"/><p><b>Bayar fleksibel</b><span>Tunai, transfer, QRIS</span></p></div></section>
    <section className="catalog-section" id="katalog"><div className="section-heading"><div><h2>Pilih kebutuhanmu</h2></div><label className="search-box"><Icon name="search"/><input type="search" inputMode="search" autoComplete="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label></div>
      <div className="category-row">{categories.map((c) => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
      <div className="shop-grid">{products.length ? <div className="product-grid">{products.map((p) => <ProductCard key={p.id} product={p} qty={cart[p.id] ?? 0} change={changeCart}/>)}</div>
        : status === "loading" ? <div className="empty-panel catalog-state" role="status"><b>Memuat katalog...</b><p>Mengambil daftar produk dan sisa stok.</p></div>
        : status === "error" ? <div className="empty-panel catalog-state"><Icon name="box" size={42}/><b>Katalog gagal dimuat</b><p>Periksa koneksi internet Anda, lalu coba lagi.</p><button className="primary small" onClick={retry}>Muat ulang katalog</button></div>
        : query || category !== "Semua" ? <div className="empty-panel catalog-state"><Icon name="search" size={42}/><b>Tidak ada produk yang cocok</b><p>{query ? `Tidak ada produk bernama "${query}"${category !== "Semua" ? ` di kategori ${category}` : ""}.` : `Kategori ${category} sedang kosong.`}</p><button className="primary small" onClick={() => { setQuery(""); setCategory("Semua"); }}>Tampilkan semua produk</button></div>
        : <div className="empty-panel catalog-state"><Icon name="box" size={42}/><b>Katalog belum berisi produk</b><p>Untuk memesan sekarang, hubungi toko di {TELEPON_CS}.</p></div>}
        <aside className="cart-panel"><div className="cart-title"><div><span>Pesananmu</span><b>{cartItems.length} produk</b></div><Icon name="cart"/></div>{cartItems.length === 0 ? <div className="empty-cart"><span>◌</span><b>Keranjang masih ringan</b><p>Pilih air atau es yang kamu butuhkan.</p></div> : <div className="cart-lines">{cartItems.map((p) => <div className="cart-line" key={p.id}><span className="line-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} / {p.unit}</small></div><strong>{p.qty}×</strong></div>)}</div>}<div className="cart-summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><small>Ongkir dihitung saat checkout</small><button className="primary full" disabled={!cartItems.length} onClick={onCheckout}>Lanjut pesan </button></div></aside>
      </div>
    </section>
  </main>;
}

function ProductCard({ product, qty, change }: { product: Product; qty: number; change: (id: string, d: number) => void }) {
  const available = product.stock - product.reserved; const icon = product.category === "Es Batu" ? "❄" : product.unit === "botol" ? "♢" : "◉";
  return <article className="product-card"><div className="product-art" style={{ "--accent": product.accent } as React.CSSProperties}>{product.image ? <NextImage src={product.image} alt={product.name} fill unoptimized sizes="400px" /> : <span>{icon}</span>}<small>{product.category}</small><i>{available <= product.min_stock ? "Stok terbatas" : "Tersedia"}</i></div><div className="product-info"><span className="sku">{product.sku}</span><h3>{product.name}</h3><p><b>{money(product.price)}</b><span>/ {product.unit}</span></p><div className="product-bottom"><small>Sisa {available} {product.unit}</small>{qty ? <div className="stepper"><button aria-label={`Kurangi ${product.name}`} onClick={() => change(product.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button aria-label={`Tambah ${product.name}`} onClick={() => change(product.id, 1)}><Icon name="plus" size={16}/></button></div> : <button className="add-button" disabled={available < 1} onClick={() => change(product.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div></div></article>;
}

function CheckoutModal({ items, subtotal, user, busy, close, submit, deliveryFee }: { items: Array<Product & { qty: number }>; subtotal: number; user: User | null; busy: boolean; close: () => void; submit: (p: Record<string, unknown>) => Promise<void>; deliveryFee: number }) {
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(close);
  const [form, setForm] = useState({ customerName: user?.name ?? "", phone: "", fulfillment: "delivery", address: "", paymentMethod: "cod" });
  const shipping = form.fulfillment === "delivery" ? deliveryFee : 0;
  const onSubmit = async (e: FormEvent) => { e.preventDefault(); try { await submit(form); } catch {} };
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal checkout-modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={close}>×</button><div className="modal-head"><h2>Selesaikan pesanan</h2><p>Tidak perlu akun. Kami hanya butuh detail pengantaran.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="checkout-columns"><div className="form-stack"><label>Nama pelanggan<input autoComplete="name" autoCapitalize="words" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama lengkap" /></label><label>Nomor WhatsApp<input type="tel" inputMode="numeric" autoComplete="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button></div></div><div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai (COD)</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea autoComplete="street-address" autoCapitalize="sentences" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}</div><div className="order-review"><h3>Ringkasan</h3>{items.map((p) => <div className="review-line" key={p.id}><span>{p.qty}× {p.name}</span><b>{money(p.qty * p.price)}</b></div>)}<div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy}>{busy ? "Memproses..." : "Buat pesanan"}</button><small>Dengan memesan, Anda menyetujui konfirmasi melalui WhatsApp.</small></div></div></form></section></div>;
}

function TrackView() {
  const [orderNo, setOrderNo] = useState(""); const [phone, setPhone] = useState(""); const [order, setOrder] = useState<Order | null>(null); const [error, setError] = useState("");
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(""); try { const data = await callApi(`/api/app?view=track&orderNo=${encodeURIComponent(orderNo)}&phone=${encodeURIComponent(phone)}`); setOrder(data.order as unknown as Order); } catch (e) { setOrder(null); setError(e instanceof Error ? e.message : "Tidak ditemukan."); } };
  const steps = ["new", "confirmed", ...(order?.fulfillment === "delivery" ? ["delivering"] : []), "completed"];
  return <main className="subpage"><section className="track-card"><div className="track-intro"><span className="kicker">Lacak pesanan</span><h1>Sudah sampai mana?</h1><p>Masukkan nomor order dan minimal 6 digit terakhir nomor WhatsApp.</p><form onSubmit={(e) => void submit(e)}><label>Nomor pesanan<input autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={orderNo} onChange={(e) => setOrderNo(e.target.value)} placeholder="ORD-20260822-XXXXX" /></label><label>Nomor WhatsApp<input type="tel" inputMode="numeric" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" /></label><button className="primary"><Icon name="search"/> Lacak sekarang</button>{error && <small className="form-error">{error}</small>}</form></div><div className="track-result">{order ? <><div className="track-order-head"><div><span>{order.order_no}</span><h3>{statusLabel[order.status]}</h3></div><b>{money(order.total)}</b></div>{order.status === "cancelled" ? <div className="track-placeholder"><Icon name="box" size={54}/><h3>Pesanan dibatalkan</h3><p>Stok sudah dikembalikan. Hubungi toko bila ada pertanyaan.</p></div> : <div className="timeline">{steps.map((s, index) => { const current = steps.indexOf(["preparing", "ready"].includes(order.status) ? "confirmed" : order.status); return <div key={s} className={index <= current ? "done" : ""}><span>{index < current ? "✓" : index + 1}</span><p><b>{statusLabel[s]}</b><small>{index === current ? "Status saat ini" : index < current ? "Sudah diproses" : "Menunggu"}</small></p></div>; })}</div>}<div className="track-items">{order.items.map((i) => <div key={i.id}><span>{i.qty}× {i.product_name}</span><b>{money(i.subtotal)}</b></div>)}</div></> : <div className="track-placeholder"><Icon name="truck" size={54}/><h3>Perjalanan pesanan tampil di sini</h3><p>Status diperbarui oleh admin dari pesanan masuk hingga selesai.</p></div>}</div></section></main>;
}

function MemberView({ data, loading, user, busy, demo, login, logout, shop, redeem }: { data: MemberData | null; loading: boolean; user: User | null; busy: boolean; demo: boolean; login: () => Promise<void>; logout: () => Promise<void>; shop: () => void; redeem: (rewardId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>> }) {
  const [redeemTarget, setRedeemTarget] = useState<Reward | null>(null);
  const [redeemNotice, setRedeemNotice] = useState("");
  if (!data && loading) return <main className="auth-page"><div className="empty-panel" role="status"><b>Memuat akun member...</b><p>Mengambil poin dan riwayat pesanan.</p></div></main>;
  if (!data) return <main className="auth-page"><section className="auth-card"><div className="auth-art"><h2>Belanja rutin,<br/>dapat lebih.</h2><p>Member mendapatkan poin, riwayat transaksi, dan pesan ulang lebih cepat.</p><p className="auth-rule">Setiap belanja Rp10.000 mendapat 1 poin.</p></div><div className="auth-form"><h1>Masuk sebagai pelanggan</h1>{demo && <p>Versi lokal memakai simulasi Google. Tidak ada password member yang disimpan.</p>}{user && user.role !== "member" && <div className="info-box">Anda sedang masuk sebagai {user.role}. Keluar dahulu untuk berganti peran.</div>}{demo ? <><button className="google-button" disabled={busy} onClick={() => void login()}><b>G</b> Lanjutkan dengan Google <span>Demo</span></button><div className="demo-credential"><b>Akun dummy member</b><span>member.demo@gmail.com</span><small>Nama: Nadia Pelanggan · Saldo awal: 120 poin</small></div></> : <div className="info-box">Login member belum tersedia. Hubungi admin depot untuk mendaftar.</div>}{user && <button className="text-button" onClick={() => void logout()}>Keluar dari sesi saat ini</button>}</div></section></main>;
  return <main className="dashboard member-dashboard"><div className="dashboard-top"><div><span className="kicker">Akun member</span><h1>Halo, {data.user.name.split(" ")[0]}!</h1><p>Air cukup, poin pun ikut tumbuh.</p></div><button className="primary" onClick={shop}>Pesan lagi </button></div>{redeemNotice && <div className="info-box" style={{ marginBottom: 16 }}>{redeemNotice}</div>}<div className="member-grid"><section className="points-card"><span>Poin Ardines</span><b>{data.user.points}</b><small>poin tersedia</small><div><p>1 poin</p><span>=</span><p>Rp10.000</p></div></section><section className="member-summary"><div><Icon name="box"/><p><b>{data.orders.length}</b><span>Total pesanan</span></p></div><div><Icon name="check"/><p><b>{data.orders.filter((o) => o.status === "completed").length}</b><span>Pesanan selesai</span></p></div><div><Icon name="wallet"/><p><b>{data.orders.reduce((s, o) => s + o.points_earned, 0)}</b><span>Poin diperoleh</span></p></div></section></div><section className="panel"><div className="panel-heading"><div><span className="kicker">Tukar poin</span><h2>Penawaran untukmu</h2></div></div>{data.rewards?.length ? <div className="reward-grid">{data.rewards.map((r) => { const cukup = data.user.points >= r.points_cost; return <article className="reward-card" key={r.id}><div><b>{r.name}</b>{r.description && <small>{r.description}</small>}</div><strong>{r.points_cost} <span>poin</span></strong><button className={cukup ? "primary" : "primary disabled-btn"} disabled={!cukup || busy} onClick={() => { setRedeemNotice(""); setRedeemTarget(r); }}>{cukup ? "Tukar" : "Poin kurang"}</button></article>; })}</div> : <div className="empty-panel"><Icon name="check" size={42}/><b>Belum ada penawaran</b><p>Admin belum menambahkan penawaran untuk ditukar dengan poin.</p></div>}</section>{data.redemptions?.length ? <section className="panel"><div className="panel-heading"><div><h2>Penukaran poinmu</h2></div></div><div className="expense-list">{data.redemptions.map((r) => <div key={r.id}><span className="expense-icon"><Icon name="check"/></span><p><b>{r.reward_name}</b><small>{dateTime(r.created_at)}</small></p><div style={{ display: "flex", gap: 8, alignItems: "center" }}><strong style={{ color: "var(--st-teal)" }}>-{r.points_cost} poin</strong><span className={`status ${r.status === "done" ? "completed" : r.status === "pending" ? "new" : "cancelled"}`}>{r.status === "done" ? "Selesai" : r.status === "pending" ? "Menunggu" : "Dibatalkan"}</span></div></div>)}</div></section> : null}<section className="panel"><div className="panel-heading"><div><h2>Pesanan terakhir</h2></div></div>{data.orders.length ? <div className="order-list">{data.orders.map((o) => <article key={o.id}><div><span>{o.order_no}</span>{o.order_type === "redeem" && <span className="redeem-tag">REDEEM</span>}<small>{dateTime(o.created_at)}</small></div><p>{o.items.map((i) => `${i.qty}× ${i.product_name}`).join(", ")}</p><b>{o.order_type === "redeem" ? "Gratis poin" : money(o.total)}</b><span className={`status ${o.status}`}>{statusLabel[o.status]}</span></article>)}</div> : <div className="empty-panel"><Icon name="box" size={42}/><b>Belum ada pesanan member</b><p>Pesan dari akun ini untuk mulai mengumpulkan poin.</p></div>}</section>{redeemTarget && <RedeemModal reward={redeemTarget} user={data.user} busy={busy} close={() => setRedeemTarget(null)} submit={async (payload) => { try { const res = await redeem(redeemTarget.id, payload); setRedeemTarget(null); setRedeemNotice(`Penukaran berhasil! Pesanan ${String(res.orderNo ?? "")} sudah masuk antrian toko.`); } catch {} }} />}</main>;
}

function AdminView({ data, loading, user, busy, demo, login, action, reload, print }: { data: AdminData | null; loading: boolean; user: User | null; busy: boolean; demo: boolean; login: (e: string, p: string) => Promise<void>; action: (p: Record<string, unknown>, after?: () => Promise<void>) => Promise<Record<string, unknown>>; reload: () => Promise<void>; print: (o: Order) => void }) {
  const [email, setEmail] = useState(demo ? "admin@ardines.local" : ""); const [password, setPassword] = useState(demo ? "Admin123!" : ""); const [tab, setTab] = useState<"overview"|"orders"|"stock"|"finance"|"event">("overview"); const [expense, setExpense] = useState({ category: "Transportasi", description: "", amount: "" }); const [stockTab, setStockTab] = useState<"stok" | "riwayat">("stok"); const [productModal, setProductModal] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [deliveryFee, setDeliveryFee] = useState(String(data?.settings?.deliveryFee ?? 5000));
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [subPesanan, setSubPesanan] = useState<"aktif" | "riwayat">("aktif");
  const [saring, setSaring] = useState(SARING_AWAL);
  const pesananAktif = (data?.orders ?? []).filter((o) => !["completed", "cancelled"].includes(o.status));
  const riwayat = (data?.orders ?? []).filter((o) => {
    const tgl = tanggalJakarta(o.created_at);
    const tipe = o.order_type === "redeem" ? "redeem" : o.order_type === "offline" ? "offline" : "online";
    const cari = saring.cari.trim().toLowerCase();
    return (!saring.dari || tgl >= saring.dari) && (!saring.sampai || tgl <= saring.sampai)
      && (!saring.status || o.status === saring.status) && (!saring.tipe || tipe === saring.tipe)
      && (!saring.bayar || o.payment_status === saring.bayar)
      && (!cari || o.order_no.toLowerCase().includes(cari) || o.customer_name.toLowerCase().includes(cari) || o.phone.includes(cari));
  });
  const saringAktif = Object.values(saring).some(Boolean);
  const daftarPesanan = subPesanan === "aktif" ? pesananAktif : riwayat;
  /* Satu definisi uang masuk untuk Ringkasan dan Keuangan: pesanan lunas yang
     tidak dibatalkan, di luar penukaran poin. */
  const pesananLunas = (data?.orders ?? []).filter((o) => o.payment_status === "paid" && o.status !== "cancelled" && o.order_type !== "redeem");
  const ordersPaging = usePaging(daftarPesanan.length, 8);
  const productsPaging = usePaging(data?.products.length ?? 0, 8);
  const movementsPaging = usePaging(data?.movements.length ?? 0, 10);
  const expensesPaging = usePaging(data?.expenses.length ?? 0, 8);
  const financeOrdersPaging = usePaging(pesananLunas.length, 8);
  const redemptionsPaging = usePaging(data?.redemptions.length ?? 0, 8);
  const [rewardModal, setRewardModal] = useState<{ open: boolean; reward: Reward | null }>({ open: false, reward: null });
  const [expenseRewardId, setExpenseRewardId] = useState("");
  if (!data && loading) return <main className="auth-page"><div className="empty-panel" role="status"><b>Memuat konsol admin...</b><p>Mengambil pesanan, stok, dan catatan keuangan.</p></div></main>;
  if (!data) return <main className="auth-page"><section className="auth-card admin-auth"><div className="auth-art"><span className="kicker light">Konsol admin</span><h2>Satu layar.<br/>Semua terkendali.</h2><p>Pantau order, stok, pemasukan, dan operasional toko.</p></div><form className="auth-form" onSubmit={async (e) => { e.preventDefault(); try { await login(email, password); } catch {} }}><h1>Login admin</h1><p>Masuk menggunakan akun operasional toko.</p><label>Email admin<input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="primary full" disabled={busy}>{busy ? "Memeriksa..." : "Masuk ke dashboard"}</button>{demo && <div className="demo-credential"><b>Akun dummy admin</b><span>admin@ardines.local</span><small>Password: Admin123!</small></div>}{demo && <div className="info-box">Mode demo: kredensial masih bawaan kode. Isi secret <code>ADMIN_EMAIL</code> dan <code>ADMIN_PASSWORD_HASH</code> sebelum domain dibuka ke publik.</div>}{user && user.role !== "admin" && <div className="info-box">Sesi {user.role} akan diganti saat login admin.</div>}</form></section></main>;
  const nextFor = nextStep;
  const doAction = async (payload: Record<string, unknown>) => { try { await action(payload, reload); } catch {} };
  const uangMasuk = pesananLunas.reduce((sum, o) => sum + o.total, 0);
  const uangKeluar = data.metrics.expenses;
  const netto = uangMasuk - uangKeluar;
  const arusKas = <div className="cashflow-summary"><div><span>Uang masuk</span><b style={{ color: "var(--teal-dark)" }}>+{money(uangMasuk)}</b><small>{pesananLunas.length} pesanan lunas</small></div><div><span>Uang keluar</span><b style={{ color: "var(--danger-teks)" }}>-{money(uangKeluar)}</b><small>{data.expenses.length} biaya tercatat</small></div><div className={netto >= 0 ? "positive" : "negative"}><span>Selisih (netto)</span><b>{netto >= 0 ? "+" : "-"}{money(Math.abs(netto))}</b><small>{netto >= 0 ? "Surplus" : "Defisit"}</small></div></div>;
  const belumDibayar = pesananAktif.filter((o) => o.payment_status !== "paid").length;
  return <main className="admin-layout"><aside className="admin-sidebar"><div><span className="brand-mark"><Icon name="drop" /></span><b>Ardines Group</b><small>Konsol Admin</small></div><nav aria-label="Bagian konsol admin">{([["overview", "chart", "Ringkasan"], ["orders", "box", "Pesanan"], ["stock", "menu", "Persediaan"], ["finance", "wallet", "Keuangan"], ["event", "gift", "Event"]] as const).map(([id, icon, label]) => <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon name={icon}/><b>{label}</b>{id === "orders" && data.metrics.pending > 0 && <span aria-label={`${data.metrics.pending} pesanan aktif`}>{data.metrics.pending}</span>}</button>)}</nav><div className="admin-user"><span>{data.user.name.charAt(0)}</span><p><b>{data.user.name}</b><small>{data.user.email}</small></p></div></aside><section className="admin-content"><div className="admin-head"><div><span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</span><h1>{tab === "overview" ? "Ringkasan operasional" : tab === "orders" ? "Kelola pesanan" : tab === "stock" ? "Persediaan produk" : tab === "finance" ? "Pemasukan & operasional" : "Event & rewards"}</h1></div></div>
    {tab === "overview" && <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Pesanan aktif</span><h2>{pesananAktif.length ? `${pesananAktif.length} pesanan sedang berjalan` : "Tidak ada pesanan aktif"}</h2></div><button onClick={() => { setSubPesanan("aktif"); setTab("orders"); }}>Kelola di Pesanan →</button></div>{pesananAktif.length ? <div className="status-monitor">{(["new", "confirmed", "delivering"] as const).map((st) => { const n = pesananAktif.filter((o) => (["preparing", "ready"].includes(o.status) ? "confirmed" : o.status) === st).length; return <div key={st} className={n ? "" : "kosong"}><span className={`status ${st}`}>{statusLabel[st]}</span><b>{n}</b></div>; })}<div className={belumDibayar ? "" : "kosong"}><span className="status new">Belum dibayar</span><b>{belumDibayar}</b></div></div> : <div className="empty-panel">Semua pesanan sudah selesai atau dibatalkan. Pesanan baru muncul di sini dan di tab Pesanan.</div>}<div className="panel-heading monitor-sub"><div><span className="kicker">Arus kas</span></div><button onClick={() => setTab("finance")}>Rincian di Keuangan →</button></div>{arusKas}</section><section className="panel stock-watch"><div className="panel-heading"><div><h2>Stok produk</h2></div><button onClick={() => setTab("stock")}>Kelola di Persediaan →</button></div>{[...data.products].sort((a, b) => ((a.stock - a.reserved <= a.min_stock ? 0 : 1) - (b.stock - b.reserved <= b.min_stock ? 0 : 1))).slice(0, 6).map((p) => { const available = p.stock - p.reserved; const low = available <= p.min_stock; const pct = Math.min(100, Math.max(6, available / Math.max(p.min_stock * 3, 1) * 100)); return <div className="stock-mini" key={p.id}><div><span style={{ background: p.accent }}></span><p><b>{p.name}</b><small>{available} {p.unit} tersedia{p.reserved > 0 ? ` · ${p.reserved} dipesan` : ""}</small></p><span className={`status ${low ? "cancelled" : "completed"}`}>{low ? "Stok rendah" : "Aman"}</span></div><div className="stock-bar"><i style={{ width: `${pct}%`, background: low ? "var(--danger)" : "var(--teal)" }}></i></div></div>})}</section></div>}
    {tab === "orders" && <section className="panel"><div className="panel-heading"><div><h2>{subPesanan === "aktif" ? `${pesananAktif.length} pesanan perlu diproses` : `${riwayat.length} pesanan${saringAktif ? " cocok" : " tercatat"}`}</h2></div><div className="head-actions"><div className="sub-tabs"><button className={subPesanan === "aktif" ? "active" : ""} onClick={() => { setSubPesanan("aktif"); ordersPaging.setPage(1); }}>Pesanan</button><button className={subPesanan === "riwayat" ? "active" : ""} onClick={() => { setSubPesanan("riwayat"); ordersPaging.setPage(1); }}>Riwayat pesanan</button></div>{subPesanan === "aktif" ? <button className="primary small" onClick={() => setOfflineOpen(true)}><Icon name="plus" size={15}/> Order offline</button> : <button className="download-btn" disabled={!riwayat.length} onClick={() => { const csv = ordersToCSV(riwayat); downloadCSV(`riwayat-pesanan-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button>}</div></div>
      {subPesanan === "riwayat" && <form className="filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>Dari tanggal<input type="date" value={saring.dari} max={saring.sampai || undefined} onChange={(e) => { setSaring({ ...saring, dari: e.target.value }); ordersPaging.setPage(1); }} /></label>
        <label>Sampai tanggal<input type="date" value={saring.sampai} min={saring.dari || undefined} onChange={(e) => { setSaring({ ...saring, sampai: e.target.value }); ordersPaging.setPage(1); }} /></label>
        <label>Status<select value={saring.status} onChange={(e) => { setSaring({ ...saring, status: e.target.value }); ordersPaging.setPage(1); }}><option value="">Semua status</option>{["new", "confirmed", "delivering", "completed", "cancelled"].map((st) => <option key={st} value={st}>{statusLabel[st]}</option>)}</select></label>
        <label>Jenis<select value={saring.tipe} onChange={(e) => { setSaring({ ...saring, tipe: e.target.value }); ordersPaging.setPage(1); }}><option value="">Semua jenis</option><option value="online">Online</option><option value="offline">Offline</option><option value="redeem">Tukar poin</option></select></label>
        <label>Pembayaran<select value={saring.bayar} onChange={(e) => { setSaring({ ...saring, bayar: e.target.value }); ordersPaging.setPage(1); }}><option value="">Semua</option><option value="paid">Lunas</option><option value="unpaid">Belum dibayar</option></select></label>
        <label>Cari<input type="search" autoComplete="off" value={saring.cari} onChange={(e) => { setSaring({ ...saring, cari: e.target.value }); ordersPaging.setPage(1); }} placeholder="No. order, nama, atau nomor" /></label>
        <button type="button" className="download-btn" disabled={!saringAktif} onClick={() => { setSaring(SARING_AWAL); ordersPaging.setPage(1); }}>Hapus filter</button>
      </form>}
      {subPesanan === "aktif"
        ? <><OrderTable orders={ordersPaging.slice(daftarPesanan)} nextFor={nextFor} doAction={doAction} print={print} onEdit={setEditOrder} kosong="Tidak ada pesanan yang perlu diproses. Pesanan baru dari pelanggan masuk ke sini otomatis; penjualan di toko dicatat lewat Order offline."/><OrderCards orders={ordersPaging.slice(daftarPesanan)} nextFor={nextFor} doAction={doAction} print={print} onEdit={setEditOrder} kosong="Tidak ada pesanan yang perlu diproses. Pesanan baru dari pelanggan masuk ke sini otomatis; penjualan di toko dicatat lewat Order offline."/></>
        : <><OrderTable orders={ordersPaging.slice(daftarPesanan)} nextFor={() => undefined} doAction={doAction} print={print} readOnly kosong={saringAktif ? "Tidak ada pesanan yang cocok dengan filter ini. Longgarkan rentang tanggal atau hapus filter." : "Belum ada pesanan tercatat."}/><OrderCards orders={ordersPaging.slice(daftarPesanan)} nextFor={() => undefined} doAction={doAction} print={print} readOnly kosong={saringAktif ? "Tidak ada pesanan yang cocok dengan filter ini. Longgarkan rentang tanggal atau hapus filter." : "Belum ada pesanan tercatat."}/></>}
      <Pagination paging={ordersPaging} label={subPesanan === "aktif" ? "Pesanan" : "Riwayat"}/>{subPesanan === "riwayat" && data.orders.length >= 100 && <p className="filter-note">Riwayat memuat 100 pesanan terakhir.</p>}</section>}
    {tab === "stock" && <section className="panel"><div className="panel-heading"><div><h2>Kelola produk & stok</h2></div><div className="head-actions"><div className="sub-tabs"><button className={stockTab === "stok" ? "active" : ""} onClick={() => setStockTab("stok")}>Stok</button><button className={stockTab === "riwayat" ? "active" : ""} onClick={() => setStockTab("riwayat")}>Riwayat</button></div><button className="primary small" onClick={() => setProductModal({ open: true, product: null })}><Icon name="plus" size={15}/> Tambah produk</button><button className="download-btn" onClick={() => { const csv = productsToCSV(data.products); downloadCSV(`produk-stok-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div></div>{stockTab === "riwayat" ? <div className="movement-list">{data.movements.length ? movementsPaging.slice(data.movements).map((m) => { const mp = data.products.find((p) => p.id === m.product_id); return <div key={m.id}><span className={`movement-badge ${m.movement_type}`}>{movementLabel[m.movement_type] ?? m.movement_type}</span><p><b>{m.reason}</b><small>{mp?.name ?? m.product_id} · {dateTime(m.created_at)}{m.reference_id ? ` · ${m.reference_id.slice(0, 18)}` : ""}</small></p><strong style={{ color: m.qty > 0 ? "var(--st-teal)" : "var(--danger-teks)" }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong></div>; }) : <div className="empty-panel">Belum ada pergerakan stok. Riwayat terisi saat ada pesanan atau penyesuaian stok.</div>}<Pagination paging={movementsPaging} label="Riwayat"/></div> : <div className="inventory-table table-scroll"><table><thead><tr><th>Produk</th><th>SKU</th><th>Stok fisik</th><th>Dipesan</th><th>Tersedia</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{productsPaging.slice(data.products).map((p) => { const available = p.stock - p.reserved; return <tr key={p.id}><td><div className="table-product"><span style={{ background: p.accent }}></span><b>{p.name}</b></div></td><td data-label="SKU">{p.sku}</td><td data-label="Stok fisik">{p.stock} {p.unit}</td><td data-label="Dipesan">{p.reserved}</td><td data-label="Tersedia"><b>{available}</b></td><td data-label="Status"><span className={`status ${available <= p.min_stock ? "cancelled" : "completed"}`}>{available <= p.min_stock ? "Stok rendah" : "Aman"}</span></td><td><div className="row-actions"><div className="stock-actions"><button title="Kurangi stok" aria-label={`Kurangi stok ${p.name} 1`} onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: -1 })}>−</button><button title="Tambah stok" aria-label={`Tambah stok ${p.name} 1`} onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: 1 })}>+</button><button title="Tambah stok 10" aria-label={`Tambah stok ${p.name} 10`} onClick={() => void doAction({ action: "adjust_stock", productId: p.id, delta: 10 })}>+10</button></div><button className="row-icon" title="Edit produk" aria-label={`Edit ${p.name}`} onClick={() => setProductModal({ open: true, product: p })}><Icon name="edit" size={16}/></button><button className="row-icon danger" title="Hapus produk" aria-label={`Hapus ${p.name}`} onClick={() => { if (window.confirm(`Hapus produk "${p.name}"? Tindakan tidak bisa dibatalkan.`)) void doAction({ action: "delete_product", productId: p.id }); }}><Icon name="trash" size={16}/></button></div></td></tr>})}</tbody></table><Pagination paging={productsPaging} label="Produk"/></div>}</section>}
    {tab === "finance" && <section className="panel arus-kas-panel"><div className="panel-heading"><div><span className="kicker">Arus kas</span><h2>Uang masuk dan keluar</h2></div></div>{arusKas}</section>}
    {tab === "finance" && <div className="finance-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Biaya baru</span><h2>Catat operasional</h2></div></div><form className="expense-form" onSubmit={async (e) => { e.preventDefault(); try { await action({ action: "add_expense", ...expense, amount: Number(expense.amount) }, reload); setExpense({ category: "Transportasi", description: "", amount: "" }); setExpenseRewardId(""); } catch {} }}><label>Kategori<select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}><option>Transportasi</option><option>Pembelian stok</option><option>Listrik</option><option>Upah</option><option>Reward member</option><option>Lainnya</option></select></label>{expense.category === "Reward member" ? <label>Reward poin<select value={expenseRewardId} onChange={(e) => { const id = e.target.value; setExpenseRewardId(id); const r = data.rewards.find((x) => x.id === id); if (r) { const p = data.products.find((x) => x.id === r.product_id); setExpense({ category: "Reward member", description: `Reward: ${r.name}`, amount: p ? String(p.price) : "" }); } else { setExpense({ ...expense, description: "", amount: "" }); } }}><option value="">Pilih penawaran</option>{data.rewards.map((r) => { const p = data.products.find((x) => x.id === r.product_id); return <option key={r.id} value={r.id}>{r.name} ({r.points_cost} poin{p ? ` · ${money(p.price)}` : ""})</option>; })}</select></label> : null}<label>Deskripsi<input autoCapitalize="sentences" required value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} placeholder={expense.category === "Reward member" ? "Otomatis dari penawaran terpilih" : "Contoh: Bensin pengantaran"} /></label><label>Nominal<input required type="number" inputMode="numeric" min="0" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="50000" /></label><button className="primary" disabled={busy}>Simpan biaya</button></form></section><section className="panel"><div className="panel-heading"><div><span className="kicker">Riwayat biaya</span><h2>Operasional terbaru</h2></div><button className="download-btn" onClick={() => { const csv = expensesToCSV(data.expenses); downloadCSV(`biaya-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div><div className="expense-list">{data.expenses.length ? expensesPaging.slice(data.expenses).map((e) => <div key={e.id}><span className="expense-icon"><Icon name="wallet"/></span><p><b>{e.description}</b><small>{e.category} · {dateTime(e.created_at)}</small></p><strong>-{money(e.amount)}</strong></div>) : <div className="empty-panel">Belum ada biaya tercatat. Isi formulir Catat operasional untuk mencatat yang pertama.</div>}<Pagination paging={expensesPaging} label="Biaya"/></div></section></div>}
    {tab === "finance" && <section className="panel"><div className="panel-heading"><div><span className="kicker">Uang masuk</span><h2>Pesanan lunas</h2></div><button className="download-btn" onClick={() => { const csv = ordersToCSV(pesananLunas); downloadCSV(`pemasukan-${todayStamp()}.csv`, csv.headers, csv.rows); }}><Icon name="download" size={15}/> Download CSV</button></div>{pesananLunas.length ? <div className="order-list">{financeOrdersPaging.slice(pesananLunas).map((o) => <article key={o.id}><div><span>{o.order_no}</span><small>{dateTime(o.created_at)}</small></div><p>{o.items.map((i) => `${i.qty}× ${i.product_name}`).join(", ")}</p><b style={{ color: "var(--teal-dark)" }}>+{money(o.total)}</b><span className="status completed">{paymentMethodLabel[o.payment_method] ?? o.payment_method}</span></article>)}</div> : <div className="empty-panel">Belum ada pesanan lunas. Tandai pembayaran di tab Pesanan, lalu pemasukannya tercatat di sini.</div>}<Pagination paging={financeOrdersPaging} label="Pemasukan"/></section>}
    {tab === "event" && <div className="finance-grid"><section className="panel"><div className="panel-heading"><div><span className="kicker">Pengaturan</span><h2>Ongkos kirim</h2></div></div><form className="expense-form" onSubmit={async (e) => { e.preventDefault(); try { await action({ action: "update_settings", deliveryFee: Number(deliveryFee) }, reload); } catch {} }}><label>Biaya ongkir (Rp)<input required type="number" inputMode="numeric" min="0" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="5000" /><small style={{ fontWeight: 600, color: "var(--muted)" }}>Dikenakan saat pelanggan memilih pengantaran. 0 = gratis.</small></label><button className="primary" disabled={busy}>Simpan ongkir</button></form></section><section className="panel"><div className="panel-heading"><div><span className="kicker">Reward member</span><h2>Penawaran tukar poin</h2></div><button className="primary small" onClick={() => setRewardModal({ open: true, reward: null })}><Icon name="plus" size={15}/> Tambah penawaran</button></div>{data.rewards.length ? <div className="reward-list">{data.rewards.map((r) => <div key={r.id}><div><b>{r.name}</b><small>{r.description ? `${r.description} · ` : ""}{r.stock === null ? "Stok tak terbatas" : `Sisa ${r.stock}`} · {r.active ? "Aktif" : "Nonaktif"}</small></div><strong>{r.points_cost} poin</strong><div className="row-actions"><button title="Edit" onClick={() => setRewardModal({ open: true, reward: r })}><Icon name="edit" size={16}/></button><button title="Hapus" onClick={() => { if (window.confirm(`Hapus penawaran "${r.name}"?`)) void doAction({ action: "delete_reward", rewardId: r.id }); }}><Icon name="trash" size={16}/></button></div></div>)}</div> : <div className="empty-panel">Belum ada penawaran. Tambahkan reward pertama untuk member.</div>}</section><section className="panel"><div className="panel-heading"><div><h2>Penukaran poin</h2></div></div>{data.redemptions.length ? <><div className="expense-list">{redemptionsPaging.slice(data.redemptions).map((r) => <div key={r.id}><span className="expense-icon"><Icon name="check"/></span><p><b>{r.reward_name}</b><small>{r.user_name ?? r.user_id} · {dateTime(r.created_at)}</small></p><div style={{ display: "flex", gap: 8, alignItems: "center" }}><strong style={{ color: "var(--st-teal)" }}>-{r.points_cost} poin</strong>{r.status === "pending" ? <div className="row-actions"><button className="next-action" onClick={() => void doAction({ action: "update_redemption", redemptionId: r.id, status: "done" })}>Selesai</button><button className="danger-action" onClick={() => void doAction({ action: "update_redemption", redemptionId: r.id, status: "cancelled" })}>Batal</button></div> : <span className={`status ${r.status === "done" ? "completed" : "cancelled"}`}>{r.status === "done" ? "Selesai" : "Dibatalkan"}</span>}</div></div>)}</div><Pagination paging={redemptionsPaging} label="Penukaran"/></> : <div className="empty-panel">Belum ada penukaran poin. Penukaran dari member muncul di sini untuk diproses.</div>}</section></div>}
   </section>{offlineOpen && <OfflineOrderModal products={data.products} deliveryFee={data.settings.deliveryFee} busy={busy} close={() => setOfflineOpen(false)} submit={async (payload) => { try { const res = await action({ action: "create_order", ...payload }); if (payload.paid && res.orderId) await action({ action: "mark_paid", orderId: String(res.orderId) }); setOfflineOpen(false); await reload(); } catch {} }} />}{editOrder && <EditOrderModal order={editOrder} products={data.products} deliveryFee={data.settings.deliveryFee} busy={busy} close={() => setEditOrder(null)} submit={async (payload) => { try { await action({ action: "update_order_details", orderId: editOrder.id, ...payload }); setEditOrder(null); await reload(); } catch {} }} />}{productModal.open && <ProductModal product={productModal.product} busy={busy} onClose={() => setProductModal({ open: false, product: null })} onSave={async (payload) => { try { await action(productModal.product ? { action: "update_product", productId: productModal.product.id, ...payload } : { action: "create_product", ...payload }, reload); setProductModal({ open: false, product: null }); } catch {} }} />}{rewardModal.open && <RewardModal reward={rewardModal.reward} products={data.products} busy={busy} onClose={() => setRewardModal({ open: false, reward: null })} onSave={async (payload) => { try { await action(rewardModal.reward ? { action: "update_reward", rewardId: rewardModal.reward.id, ...payload } : { action: "create_reward", ...payload }, reload); setRewardModal({ open: false, reward: null }); } catch {} }} />}</main>;
   }


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
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(close);
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
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal offline-modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={close}>×</button><div className="modal-head"><span className="kicker">Order offline</span><h2>Transaksi langsung di toko</h2><p>Catat penjualan walk-in. Stok otomatis ter-reservasi & masuk antrian pesanan.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="offline-grid"><div className="offline-products"><label className="offline-search"><Icon name="search"/><input type="search" inputMode="search" autoComplete="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label><div className="offline-list">{visible.map((p) => { const available = p.stock - p.reserved; const qty = cart[p.id] ?? 0; return <div key={p.id}><span className="offline-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} · sisa {available} {p.unit}</small></div>{qty ? <div className="stepper"><button type="button" aria-label={`Kurangi ${p.name}`} onClick={() => change(p.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button type="button" aria-label={`Tambah ${p.name}`} onClick={() => change(p.id, 1)}><Icon name="plus" size={16}/></button></div> : <button type="button" className="add-button" disabled={available < 1} onClick={() => change(p.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div>; })}{!visible.length && <p className="empty-panel">Tidak ada produk yang cocok. Periksa ejaan nama atau SKU.</p>}</div></div><div className="offline-form"><div className="form-stack"><label>Nama pelanggan<input autoComplete="name" autoCapitalize="words" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama pembeli" /></label><label>Nomor WhatsApp<input type="tel" inputMode="numeric" autoComplete="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea autoComplete="street-address" autoCapitalize="sentences" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}<div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div><label className="paid-check"><input type="checkbox" checked={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.checked })} /><span><b>Sudah dibayar</b><small>langsung tandai lunas</small></span></label></div><div className="offline-summary"><div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy || !items.length}>{busy ? "Menyimpan..." : items.length ? `Simpan order (${items.length} item)` : "Pilih produk dahulu"}</button></div></div></div></form></section></div>;
}

function EditOrderModal({ order, products, deliveryFee, busy, close, submit }: { order: Order; products: Product[]; deliveryFee: number; busy: boolean; close: () => void; submit: (payload: Record<string, unknown>) => Promise<void> }) {
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(close);
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
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal offline-modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={close}>×</button><div className="modal-head"><span className="kicker">Edit pesanan</span><h2>{order.order_no}</h2><p>Koreksi data pelanggan & item. Total dihitung ulang, stok otomatis disesuaikan.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="offline-grid"><div className="offline-products"><label className="offline-search"><Icon name="search"/><input type="search" inputMode="search" autoComplete="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari produk..." /></label><div className="offline-list">{visible.map((p) => { const available = p.stock - p.reserved; const qty = cart[p.id] ?? 0; return <div key={p.id}><span className="offline-dot" style={{ background: p.accent }}></span><div><b>{p.name}</b><small>{money(p.price)} · sisa {available} {p.unit}</small></div>{qty ? <div className="stepper"><button type="button" aria-label={`Kurangi ${p.name}`} onClick={() => change(p.id, -1)}><Icon name="minus" size={16}/></button><b>{qty}</b><button type="button" aria-label={`Tambah ${p.name}`} onClick={() => change(p.id, 1)}><Icon name="plus" size={16}/></button></div> : <button type="button" className="add-button" disabled={available < 1} onClick={() => change(p.id, 1)}><Icon name="plus" size={17}/> Tambah</button>}</div>; })}{!visible.length && <p className="empty-panel">Tidak ada produk yang cocok. Periksa ejaan nama atau SKU.</p>}</div></div><div className="offline-form"><div className="form-stack"><label>Nama pelanggan<input autoComplete="name" autoCapitalize="words" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama pembeli" /></label><label>Nomor WhatsApp<input type="tel" inputMode="numeric" autoComplete="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea autoComplete="street-address" autoCapitalize="sentences" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}<div><span className="field-label">Metode pembayaran</span><div className="choice-row"><button type="button" className={form.paymentMethod === "cod" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "cod" })}><Icon name="wallet"/> Tunai</button><button type="button" className={form.paymentMethod === "transfer" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "transfer" })}><Icon name="wallet"/> Transfer</button><button type="button" className={form.paymentMethod === "qris" ? "selected" : ""} onClick={() => setForm({ ...form, paymentMethod: "qris" })}><Icon name="wallet"/> QRIS</button></div></div></div><div className="offline-summary"><div className="review-fee"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="review-fee"><span>Ongkir</span><b>{shipping ? money(shipping) : "Gratis"}</b></div><div className="review-total"><span>Total baru</span><b>{money(subtotal + shipping)}</b></div><button className="primary full" disabled={busy || !items.length}>{busy ? "Menyimpan..." : items.length ? `Simpan perubahan (${items.length} item)` : "Pilih produk dahulu"}</button></div></div></div></form></section></div>;
}

/* Kartu pesanan untuk layar sempit. Tabel 7 kolom selebar ~1.050 px memaksa
   admin menggeser samping di jendela ~270 px — padahal memantau pesanan adalah
   tugas utamanya. Data dan aksinya persis sama dengan OrderTable; hanya
   susunannya menurun, dan aksi berikutnya diangkat jadi tombol lebar penuh.
   Tabel tetap dipakai di >= 720 px (lihat .order-cards / .table-scroll di CSS). */
function OrderCards({ orders, nextFor, doAction, print, onEdit, readOnly, kosong }: { orders: Order[]; readOnly?: boolean; kosong?: string; nextFor: (o: Order) => { status: string; label: string } | undefined; doAction: (p: Record<string, unknown>) => Promise<void>; print: (o: Order) => void; onEdit?: (o: Order) => void }) {
  if (!orders.length) return <div className="order-cards"><div className="empty-panel">{kosong ?? "Tidak ada pesanan di daftar ini."}</div></div>;
  return <div className="order-cards">{orders.map((o) => {
    const next = nextFor(o);
    const redeem = o.order_type === "redeem";
    const bisaEdit = onEdit && !redeem && ["new", "confirmed"].includes(o.status);
    const bisaBatal = !readOnly && !["completed", "cancelled"].includes(o.status);
    return <article className="order-card" key={o.id}>
      <header>
        <div>
          <b>{o.order_no}</b>
          {redeem ? <span className="redeem-tag">REDEEM</span> : o.order_type === "offline" ? <span className="offline-tag">OFFLINE</span> : <span className="online-tag">ONLINE</span>}
          <small>{dateTime(o.created_at)} · {o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</small>
        </div>
        <span className={`status ${o.status}`}>{statusLabel[o.status]}</span>
      </header>
      <div className="order-card-body">
        <div>
          <b>{o.customer_name}</b>
          <small>{o.items.reduce((sum, i) => sum + i.qty, 0)} item · {o.items[0]?.product_name}{o.items.length > 1 ? ` +${o.items.length - 1}` : ""}</small>
        </div>
        {redeem ? <b className="redeem-free">Gratis poin</b> : <b className="order-card-total">{money(o.total)}</b>}
      </div>
      {(next || bisaEdit || bisaBatal || readOnly) && <div className="order-card-actions">
        {next && <button className="next-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: next.status })}>{next.label}</button>}
        <button title="Cetak nota" aria-label={`Cetak nota ${o.order_no}`} onClick={() => print(o)}><Icon name="print" size={17}/></button>
        {bisaEdit && <button title="Edit pesanan" aria-label={`Edit pesanan ${o.order_no}`} onClick={() => onEdit(o)}><Icon name="edit" size={17}/></button>}
        {bisaBatal && <button className="danger-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: "cancelled" })}>Batal</button>}
      </div>}
      <footer>
        {redeem
          ? <button className="payment-chip paid" disabled>Lunas poin</button>
          : <button className={`payment-chip ${o.payment_status}`} disabled={readOnly || o.payment_status === "paid" || o.status === "cancelled"} onClick={() => void doAction({ action: "mark_paid", orderId: o.id })}>{statusLabel[o.payment_status]}</button>}
        <small>{paymentMethodLabel[o.payment_method] ?? o.payment_method}</small>
      </footer>
    </article>;
  })}</div>;
}

function OrderTable({ orders, nextFor, doAction, print, onEdit, readOnly, kosong }: { orders: Order[]; readOnly?: boolean; kosong?: string; nextFor: (o: Order) => { status: string; label: string } | undefined; doAction: (p: Record<string, unknown>) => Promise<void>; print: (o: Order) => void; onEdit?: (o: Order) => void }) {
  const typeTag = (o: Order) => o.order_type === "redeem" ? <span className="redeem-tag">REDEEM</span> : o.order_type === "offline" ? <span className="offline-tag">OFFLINE</span> : <span className="online-tag">ONLINE</span>;
  return <div className="table-scroll order-table-wrap"><table className="order-table"><thead><tr><th>Pesanan</th><th>Pelanggan</th><th>Item</th><th>Total</th><th>Status</th><th>Pembayaran</th><th>Aksi</th></tr></thead><tbody>{orders.length ? orders.map((o) => { const next = nextFor(o); return <tr key={o.id}><td><b>{o.order_no}</b>{typeTag(o)}<small>{dateTime(o.created_at)}</small></td><td><b>{o.customer_name}</b><small>{o.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</small></td><td><span>{o.items.reduce((s, i) => s + i.qty, 0)} item</span><small>{o.items[0]?.product_name}</small></td><td>{o.order_type === "redeem" ? <b className="redeem-free">Gratis poin</b> : <b>{money(o.total)}</b>}</td><td><span className={`status ${o.status}`}>{statusLabel[o.status]}</span></td><td>{o.order_type === "redeem" ? <button className="payment-chip paid" disabled>Lunas poin</button> : <button className={`payment-chip ${o.payment_status}`} disabled={readOnly || o.payment_status === "paid" || o.status === "cancelled"} onClick={() => void doAction({ action: "mark_paid", orderId: o.id })}>{statusLabel[o.payment_status]}</button>}<small>{paymentMethodLabel[o.payment_method] ?? o.payment_method}</small></td><td><div className="row-actions"><button title="Cetak nota" aria-label={`Cetak nota ${o.order_no}`} onClick={() => print(o)}><Icon name="print" size={17}/></button>{onEdit && o.order_type !== "redeem" && ["new", "confirmed"].includes(o.status) && <button title="Edit pesanan" aria-label={`Edit pesanan ${o.order_no}`} onClick={() => onEdit(o)}><Icon name="edit" size={17}/></button>}{next && <button className="next-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: next.status })}>{next.label}</button>}{!readOnly && !["completed", "cancelled"].includes(o.status) && <button className="danger-action" onClick={() => void doAction({ action: "update_order", orderId: o.id, status: "cancelled" })}>Batal</button>}</div></td></tr>}) : <tr><td colSpan={7}><div className="empty-panel">{kosong ?? "Tidak ada pesanan di daftar ini."}</div></td></tr>}</tbody></table></div>;
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
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(onClose);
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
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={onClose}>×</button><div className="modal-head"><h2>{product ? `Edit ${product.name}` : "Tambah produk"}</h2><p>{product ? "Ubah detail produk. Stok diubah lewat tombol penyesuaian." : "Stok awal tercatat sebagai penyesuaian di riwayat."}</p></div><form onSubmit={(e) => void submit(e)}><div className="product-form-grid"><label>SKU<input autoCapitalize="characters" spellCheck={false} required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="AQ-G19" maxLength={40} /></label><label>Nama produk<input autoCapitalize="words" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aqua Galon 19 L" /></label><label>Kategori<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Air Galon</option><option>Air Botol</option><option>Es Batu</option><option>Lainnya</option></select></label><label>Satuan<input autoCapitalize="none" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="galon" /></label><label>Harga (Rp)<input required type="number" inputMode="numeric" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="23000" /></label><label>Stok awal{product ? <input inputMode="numeric" value={form.stock} disabled title="Gunakan tombol penyesuaian untuk mengubah stok" /> : <input inputMode="numeric" required type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" />}</label><label>Min. stok (peringatan)<input required type="number" inputMode="numeric" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} placeholder="5" /></label></div><div className="field-label" style={{ marginTop: 16 }}>Gambar produk <small style={{ color: "var(--muted)", fontWeight: 600 }}>(opsional, tampil di kartu katalog)</small></div><div className="image-uploader"><label className="image-drop"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void onPickImage(e.target.files?.[0])} /><span>{imageBusy ? "Memproses..." : form.image ? "Ganti gambar" : "Pilih gambar"}</span></label>{form.image && <div className="image-preview"><NextImage src={form.image} alt="Pratinjau produk" fill unoptimized sizes="96px" /><button type="button" className="row-icon danger" title="Hapus gambar" onClick={() => setForm({ ...form, image: "" })}><Icon name="trash" size={15}/></button></div>}</div><div className="field-label" style={{ marginTop: 16 }}>Warna aksen</div><div className="accent-row">{accents.map((c) => <button key={c} type="button" className={form.accent === c ? "selected" : ""} style={{ background: c }} onClick={() => setForm({ ...form, accent: c })} aria-label={`Aksen ${c}`} />)}</div><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan produk"}</button></div></form></section></div>;
}

function RedeemModal({ reward, user, busy, close, submit }: { reward: Reward; user: User; busy: boolean; close: () => void; submit: (p: Record<string, unknown>) => Promise<void> }) {
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(close);
  const [form, setForm] = useState({ customerName: user?.name ?? "", phone: "", fulfillment: "delivery", address: "" });
  const onSubmit = async (e: FormEvent) => { e.preventDefault(); try { await submit(form); } catch {} };
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal checkout-modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={close}>×</button><div className="modal-head"><h2>Penukaran {reward.name}</h2><p>Lengkapi detail pemesanan. Penukaran masuk antrian toko dan diproses admin.</p></div><form onSubmit={(e) => void onSubmit(e)}><div className="checkout-columns"><div className="form-stack"><label>Nama lengkap<input autoComplete="name" autoCapitalize="words" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nama lengkap" /></label><label>Nomor WhatsApp<input type="tel" inputMode="numeric" autoComplete="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" /></label><div><span className="field-label">Cara menerima</span><div className="choice-row"><button type="button" className={form.fulfillment === "delivery" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "delivery" })}><Icon name="truck"/> Diantar</button><button type="button" className={form.fulfillment === "pickup" ? "selected" : ""} onClick={() => setForm({ ...form, fulfillment: "pickup" })}><Icon name="box"/> Ambil sendiri</button></div></div>{form.fulfillment === "delivery" && <label>Alamat lengkap<textarea autoComplete="street-address" autoCapitalize="sentences" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jalan, nomor rumah, patokan..." /></label>}</div><div className="order-review"><h3>Ringkasan</h3><div className="review-line"><span>{reward.name}</span><b>{reward.points_cost} poin</b></div><div className="review-fee"><span>Biaya tunai</span><b>Rp 0</b></div><div className="review-total"><span>Total poin</span><b>{reward.points_cost}</b></div><button className="primary full" disabled={busy}>{busy ? "Memproses..." : "Tukar poin sekarang"}</button><small>Poin akan langsung dipotong. Admin akan menghubungi Anda untuk konfirmasi.</small></div></div></form></section></div>;
}

function Receipt({ order, close }: { order: Order; close: () => void }) {
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(close);
  return <div onClick={tutupLewatLatar} className="modal-backdrop receipt-wrap"><section ref={pasangPanel} className="receipt-print"><div className="receipt-brand"><span className="brand-mark"><Icon name="drop"/></span><div><b>Ardines Group</b><small>Es Kristal &amp; Air Minum</small></div></div><div className="receipt-meta"><p><span>Nomor</span><b>{order.order_no}</b></p><p><span>Tanggal</span><b>{dateTime(order.created_at)}</b></p><p><span>Pelanggan</span><b>{order.customer_name}</b></p><p><span>Layanan</span><b>{order.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</b></p>{order.fulfillment === "delivery" && order.address ? <p className="receipt-address"><span>Alamat</span><b>{order.address}</b></p> : null}<p><span>Pembayaran</span><b>{paymentMethodLabel[order.payment_method] ?? order.payment_method}</b></p></div><div className="receipt-items">{order.items.map((i) => <div key={i.id}><p><b>{i.product_name}</b><span>{i.qty} × {money(i.unit_price)}</span></p><strong>{money(i.subtotal)}</strong></div>)}</div><div className="receipt-total"><span>Total</span><b>{money(order.total)}</b></div><div className="receipt-status"><span>{statusLabel[order.payment_status]}</span><span>{statusLabel[order.status]}</span></div><p className="receipt-thanks">Terima kasih sudah belanja di Ardines Group.<br/>Distributor Es Kristal &amp; Depot Air Minum</p></section><div className="receipt-controls"><button onClick={close}>Tutup</button><button className="primary" onClick={() => window.print()}><Icon name="print"/> Cetak nota</button></div></div>; }

function RewardModal({ reward, products, busy, onClose, onSave }: { reward: Reward | null; products: Product[]; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const { attach: pasangPanel, onBackdrop: tutupLewatLatar } = useModal(onClose);
  const [form, setForm] = useState({ name: reward?.name ?? "", description: reward?.description ?? "", pointsCost: reward ? String(reward.points_cost) : "", stock: reward?.stock === null ? "" : String(reward?.stock ?? ""), productId: reward?.product_id ?? "" });
  const pickProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    setForm((f) => ({ ...f, productId: id, name: p ? p.name : f.name, description: p ? `Penukaran ${p.name.toLowerCase()}` : f.description }));
  };
  const submit = async (e: FormEvent) => { e.preventDefault(); await onSave({ ...form, pointsCost: Number(form.pointsCost), stock: form.stock === "" ? null : Number(form.stock), productId: form.productId || null }); };
  return <div onClick={tutupLewatLatar} className="modal-backdrop"><section ref={pasangPanel} className="modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="Tutup" onClick={onClose}>×</button><div className="modal-head"><h2>{reward ? `Edit ${reward.name}` : "Tambah penawaran"}</h2><p>Pilih barang dari persediaan sebagai hadiah penukaran poin.</p></div><form onSubmit={(e) => void submit(e)}><div className="product-form-grid"><label>Produk persediaan<select value={form.productId} onChange={(e) => pickProduct(e.target.value)}><option value="">Pilih barang</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label><label>Nama penawaran<input autoCapitalize="words" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Otomatis dari produk terpilih" /></label><label>Biaya poin<input required type="number" inputMode="numeric" min="1" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} placeholder="100" /></label><label>Stok (opsional)<input type="number" inputMode="numeric" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="Kosongkan = tak terbatas" /></label></div><label style={{ marginTop: 14, display: "block" }}>Deskripsi<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Contoh: Berlaku untuk pembelian berikutnya" /></label><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan..." : "Simpan penawaran"}</button></div></form></section></div>;
}
