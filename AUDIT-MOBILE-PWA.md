# Audit Mobile Responsif & PWA — Ardines Web

- **Tanggal**: 24 Agustus 2026
- **Target**: https://ardines.moonlab.my.id (Worker ardines-web, live)
- **Metode**: Playwright headless (viewport 360/375/390/768/1280 px, DPR sesuai device, isMobile+hasTouch), pengukuran layout & touch target via DOM, sampling pixel PIL, inspeksi source `C:\laragon\www\ardines-web`
- **Keterbatasan**: vision model tidak tersedia — analisis visual berbasis data (overflow, geometri, warna), bukan mata.

## Ringkasan Eksekutif

| Area | Status |
|---|---|
| Layout responsive (overflow) | ✅ LULUS semua viewport & semua tab |
| Navigasi mobile (bottom nav) | ✅ Aktif <1100px, safe-area OK |
| Touch target (≥44px) | ✅ LULUS (0 pelanggaran semua view) |
| iOS input zoom | ✅ LULUS (semua input 16px) |
| **PWA** | ✅ **LENGKAP** (manifest, SW, icon, meta) |
| Dashboard admin mobile | ✅ LULUS (setelah fix grid override) |

> **Update 24 Agu 2026 (sesi eksekusi)**: seluruh rekomendasi diterapkan & terverifikasi live — termasuk temuan lanjutan dari audit semua tab (grid admin mobile rusak karena base CSS menimpa media query). Detail di bawah.

---

## ✅ Yang Sudah Bagus

- **0 horizontal scroll** di semua viewport & semua tab (Belanja, Lacak, Member, Admin + cart/checkout/dashboard): `scrollWidth == clientWidth`.
- **Bottom nav mobile** aktif di ≤1100px: `display:grid` 4 kolom, fixed bottom, `backdrop-filter`, padding `calc(8px + env(safe-area-inset-bottom))`.
- **Breakpoint lengkap**: 1100px (nav), 720px (header/hero/admin), 440px (grid 1 kolom).
- **Viewport meta** OK; **kontras utama OK**; `lang="id"`.
- Tabel admin (`order-table`) di-scroll horizontal dalam container sendiri (`table-scroll` overflow-x auto) — by design, bukan overflow halaman.

---

## ✅ Fix yang Sudah Diterapkan (24 Agu 2026)

### F1. PWA lengkap — `app/layout.tsx`, `public/`
- `public/manifest.webmanifest`, `public/sw.js`, icon 192/512 + maskable (generated)
- `app/layout.tsx`: viewport themeColor, metadata manifest, apple meta + touch-icon
- `app/sw-register.tsx`: register `/sw.js`
- Verifikasi live: manifest 200, SW `activated`, meta lengkap

### F2. Touch target ≥44px — `app/globals.css`
- `.add-button` → min-height 44px; `.brand` → 44px
- `.stepper button`/`.stock-actions button` (32px) → 44px di ≤720px
- `.modal-close` (40px) → 44px
- `.payment-chip` (31px), `.row-actions button`, `.row-icon`, `.next-action`/`.danger-action`, `.panel-heading button` → min 44px di ≤720px

### F3. Input font 16px (anti auto-zoom iOS) — `app/globals.css`
- `input, textarea, select` → 16px; `.search-box input` → 16px

### F4. Grid auth/member/track mobile — `app/globals.css`
- Base `.track-card`/`.auth-card`/`.member-grid` (baris ~1640-2210) menimpa media query 720px lama (baris 1429) → tambah media query override di AKHIR file: grid 1 kolom + padding 32/24 + auth-art min-height 200

### F5. Dashboard admin mobile — `app/globals.css`
- Base `.admin-layout` (240px 1fr), `.overview-grid` (1.7fr 0.8fr), `.dashboard`, `.metric-grid`, `.order-list article`, `.admin-sidebar` semuanya SETELAH media query lama → override akhir file: admin-layout block, sidebar jadi nav sticky horizontal 4 kolom, metric-grid 1fr/2fr, overview/member-summary/finance-grid 1fr, `min-width: 0` pada grid items + panel, nav button dipersempit (min-width 0, font 11px)

### Verifikasi live (Playwright, 360/390/768 px)
- Semua tab: overflow 0, touch <44px = **0**, input <16px = **0**
- Cart drawer & checkout (390px): overflow 0, touch 0
- Admin dashboard + scrolled: scrollW=390 (tabel di-scroll dalam container sendiri), touch 0
- PWA: manifest 200, SW activated, meta lengkap

## ⚠️ Temuan Mobile UX (Medium)

### M1. 8 tombol dengan touch target < 44px
- **`.add-button`** (tombol "Tambah" di tiap kartu produk): **95×37px, font 11px** — 7× di grid produk
- **`.brand`** (logo header): tinggi 42px
- Dampak: sulit di-tap, terutama di sisi kanan layar dengan jempol; melanggar standar touch target (Apple HIG & Material: minimal 44×44pt).
- Lokasi kode: `app/globals.css:889` (`.add-button`, `padding: 10px 14px; font-size: 11px`).
- Rekomendasi: `padding: 14px 16px` (→ tinggi ~46px) dan font 12px.
- **Status: ✅ DIPERBAIKI (F2)**

### M2. Font input 14px → auto-zoom iOS saat fokus
- `--font-base: 14px` (`globals.css:53`) dipakai input pencarian (`.search-box input`, `globals.css:702`).
- Dampak: di iPhone, saat tap field pencarian, browser auto-zoom ke 16px → layout loncat, UX buruk.
- Rekomendasi: input pakai `font-size: 16px` eksplisit (hanya input, body tetap 14px), atau naikkan `--font-base` jadi 15–16px.
- **Status: ✅ DIPERBAIKI (F3)**

## ❌ Temuan PWA (High) — "Standar PWA" belum ada

Klaim desain "standar PWA" tidak terpenuhi — **tidak ada satu pun komponen PWA**:

| Komponen | Status |
|---|---|
| `manifest.webmanifest` / `manifest.json` | 404 di live, file tidak ada di `public/` maupun `dist/client/` |
| Service worker | Tidak ada file `sw.js`, tidak ada `navigator.serviceWorker.register` |
| `meta name="theme-color"` | Tidak ada |
| `apple-touch-icon` | Tidak ada |
| `apple-mobile-web-app-capable` | Tidak ada |
| Icon PWA 192/512 & maskable | Tidak ada (hanya `favicon.svg`) |

Dampak: tidak bisa di-install sebagai app (Add to Home Screen iOS = shortcut browser biasa), tidak ada offline mode, tidak ada splash screen. Padahal model bisnis depot (kasir di HP) sangat cocok dengan PWA.

Rekomendasi (urutan): 1) `public/manifest.webmanifest` + icon PNG 192/512 + maskable, 2) `public/sw.js` (cache-first untuk assets, network-first untuk API), 3) `app/layout.tsx`: tambah `<link rel="manifest">`, `meta theme-color`, `apple-touch-icon`, 4) register SW di `store-app.tsx`/layout.
- **Status: ✅ SELESAI (F1)**

## Verifikasi

- Layout: Playwright 5 viewport, semua `scrollWidth==clientWidth`, mobileNav grid ≤1100px.
- Touch: `document.querySelectorAll('button,a,input,...')` ukuran < 44px terhitung 8.
- PWA: fetch `/manifest.json` → 404; `navigator.serviceWorker.getRegistrations()` → 0; meta theme-color null.
- Screenshot: `C:\Users\muham\ugm-audit\ardines-mobile-*.png` (iPhone SE/14, Android 360, tablet, desktop, cart, admin).
