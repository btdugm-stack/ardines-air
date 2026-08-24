# Audit — Depot Air Mineral UMKM (depot-air)

Tanggal: 22 Agu 2026 · Cakupan: full-stack (statis + dinamis, browser QA + uji API langsung)
Stack: Next.js 16 / React 19 / Vite 8 / vinext / Cloudflare Workers + D1 (Miniflare lokal)

## Ringkasan eksekutif

| Severity | Jumlah |
|---|---|
| High | 3 |
| Medium | 7 |
| Low | 9 |
| **Total** | **19** |

## Status perbaikan (22 Agu 2026, batch 1)

| Temuan | Status |
|---|---|
| H1 — qty non-numerik → 500 | ✅ DIPERBAIKI: validasi `Number.isFinite(rawQty) && rawQty >= 1` → 422 "Jumlah produk tidak valid." Terverifikasi (`qty:"abc"` → 422, `qty:0` → 422, `qty:2` → 201) |
| H2 — navigasi hilang di <1100px | ✅ DIPERBAIKI: bottom nav `.mobile-nav` (4 tombol: Belanja/Lacak/Member/Admin) di media query 1100px; desktop tidak berubah. Terverifikasi DOM + CSS + klik |
| H3 — kredensial admin hardcoded | ⏳ Belum (butuh keputusan: hash password + env/secret; menyentuh alur login demo) |
| M1 — amount expense NaN lolos | ✅ DIPERBAIKI: `Number.isFinite(amount)` → 422. Terverifikasi (`amount:"abc"` → 422, valid → ok) |
| M2 — pesan error internal bocor | ✅ DIPERBAIKI: catch log ke server (`console.error`), client dapat "Terjadi kesalahan server." |
| M3 — script npm rusak di Windows | ✅ DIPERBAIKI (sebagian): `dev`/`start` tanpa prefix env POSIX (`WRANGLER_LOG_PATH` di-default vite.config). `install:ci` tetap Linux-only (butuh `flock`) — pakai `npm install` di Windows |
| M4 — tsc gagal | ✅ DIPERBAIKI: `@cloudflare/workers-types` + `types/cloudflare.d.ts` (augment `Cloudflare.Env { DB }`). `tsc --noEmit` exit 0 |
| M5 — gambar hero broken di dev | ✅ DIPERBAIKI (sebelumnya): worker redirect 302 ke aset mentah saat `!env.ASSETS` |
| M6 — schema ganda tidak sinkron | ✅ DIPERBAIKI: `db/schema.ts` kini mencerminkan schema runtime (8 tabel: +sessions, +inventory_movements, +loyalty_ledger, +accent, +payment_method). Migration `drizzle/0001_violet_madrox.sql` ter-generate via drizzle-kit (8 tabel, orders 13 kolom) |
| M7 — copy poin salah | ✅ DIPERBAIKI: "1 poin = Rp10.000". Terverifikasi di DOM |
| L1 — timeline order dibatalkan | ✅ DIPERBAIKI: tampil kartu "Pesanan dibatalkan" menggantikan timeline. Terverifikasi |
| L2 — kolisi nomor order | ✅ DIPERBAIKI: `nextOrderNo()` retry 5× + fallback unik |
| L3 — ensureReady tiap request | ✅ DIPERBAIKI: cache `let ready` (sekali per worker). Kolom `payment_method` dimigrasi via PRAGMA+ALTER untuk DB lama |
| L4 — hydrateOrders N+1 | ✅ DIPERBAIKI: satu query `IN (...)` + grouping; terverifikasi items tetap lengkap |
| L5 — payment method mati | ✅ DIPERBAIKI end-to-end: kolom `payment_method` (default cod), selector COD/Transfer/QRIS di checkout, whitelist server, label di tabel admin + nota. Terverifikasi via UI (order qris → tersimpan `qris`) |
| L6 — sesi expired + Secure | ✅ DIPERBAIKI: cleanup `DELETE ... expires_at <= now` saat login; flag `Secure` otomatis saat HTTPS |
| L7 — CSRF | ✅ DIPERBAIKI: POST dengan `sec-fetch-site: cross-site` → 403 (layer dev vinext + handler worker; terverifikasi) |
| L8 — tracking bisa ditebak | ✅ DIPERBAIKI: throttle per-IP 10 percobaan/menit → 429. Terverifikasi (11–12 → 429) |
| L9 — tanpa test bisnis | ✅ DIPERBAIKI: `lib/business.ts` (logika murni: parseQty, parseAmount, pointsFor, shippingFor, allowedTransitions, normalizePaymentMethod) + `tests/business.test.mjs` (10 test). `rendered-html.test.mjs` kini skip portabel saat `cloudflare:` scheme tidak tersedia. `npm test` = build + 10 pass / 1 skip / 0 fail |
| H3 — kredensial admin hardcoded | ⏳ DIBIARKAN atas permintaan user (alur demo lokal) |

## Fitur baru (22 Agu 2026, batch 3) — CRUD produk + histori stok

| Fitur | Status |
|---|---|
| Tambah produk (modal: SKU, nama, kategori, satuan, harga, stok awal, min-stok, warna aksen) | ✅ Terverifikasi UI + API (`create_product`, guard SKU duplikat 409, validasi 422, stok awal tercatat "Produk baru" di riwayat) |
| Edit produk (nama/harga/kategori/satuan/min-stok/aksen; stok tidak bisa diedit di sini) | ✅ Terverifikasi (prefill benar, stok input disabled, `update_product`, SKU bentrok 409) |
| Hapus produk (konfirmasi) | ✅ Terverifikasi (`delete_product`; diblokir 409 saat `reserved > 0` — pesanan aktif; riwayat pergerakan tetap tersimpan) |
| Riwayat pergerakan stok (tab Riwayat di Persediaan) | ✅ Terverifikasi: 57 entri, badge Reservasi/Terjual/Retur/Penyesuaian, nama produk, alasan, waktu, qty (±), ref order |
| Tombol aksi per baris | ✅ −1 / +1 / +10 (penyesuaian) + edit + hapus |

Logika inti (stok, transisi status, poin, auth role) **berjalan benar** — semua terverifikasi end-to-end. Masalah dominan: validasi input API (2 bug 500), portability Windows (dev/install-ci rusak), dan navigasi mobile yang hilang.

## Temuan High

### H1 — qty non-numerik lolos validasi stok → 500 Internal Server Error
- **File**: `app/api/app/route.ts:268` — `const qty = Math.max(1, Math.floor(Number(item.qty ?? 0)))`
- `Number("abc")` = NaN → `Math.max(1, NaN)` = **NaN** → cek `stock - reserved < qty` (NaN) selalu false → lolos validasi stok → subtotal/total NaN → INSERT gagal NOT NULL → 500 body kosong.
- **Bukti**: `POST /api/app {"action":"create_order",...,"items":[{"productId":"prd-aqua-galon","qty":"abc"}]}` → `HTTP/1.1 500`, `content-length: 0`. Client tidak dapat error yang berarti.
- **Dampak**: request valid bisa diganggu siapa pun (endpoint publik, tanpa auth). Total NaN tidak menyisakan data korup (batch D1 atomik — terverifikasi), tapi respon 500 kosong.
- **Fix**: validasi `Number.isFinite(qty) && qty >= 1` sebelum dipakai; tolak dengan 422.

### H2 — Navigasi hilang total di layar < 1100px (mobile)
- **File**: `app/globals.css:5` `@media(max-width:1100px){.desktop-nav{display:none}...}` + `app/store-app.tsx` header
- Satu-satunya nav (`Belanja / Lacak / Member / Admin`) disembunyikan, dan **tidak ada pengganti** (tidak ada hamburger/menu mobile; ikon `menu` hanya dipakai di sidebar admin). Yang tersisa di header: brand + tombol keranjang.
- **Dampak**: pengguna mobile (mayoritas pelanggan UMKM) tidak bisa membuka Lacak, Member, atau Admin sama sekali.
- **Fix**: tambah mobile nav (hamburger/drawer atau bottom nav) yang menampilkan 4 view yang sama.

### H3 — Kredensial admin hardcoded + tanpa rate limiting
- **File**: `app/api/app/route.ts:15-16` — `ADMIN_PASSWORD = "Admin123!"` plaintext, banding string langsung di `login_admin` (line 200).
- Login publik bisa di-bruteforce tanpa batas (tidak ada rate limit / lockout / delay).
- **Fix** (sudah tercatat di README sebagai catatan production, tapi tetap): hash password (bcrypt/argon2), taruh kredensial di secret/env, tambah rate limiting per IP.

## Temuan Medium

### M1 — Validasi amount biaya gagal untuk NaN → 500 + bocor pesan internal
- **File**: `app/api/app/route.ts:243-244` — `if (!description || amount <= 0)` — `amount` = NaN → `NaN <= 0` = **false** → validasi lolos → INSERT NaN → error.
- **Bukti**: `POST {"action":"add_expense","amount":"abc"}` (dengan sesi admin) → `{"error":"D1_ERROR: NOT NULL constraint failed: expenses.amount: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)"}` — 500 + **bocor nama constraint DB**.
- **Fix**: `Number.isFinite(amount) && amount > 0`; jangan pernah kembalikan `error.message` mentah ke client.

### M2 — Pesan error internal DB bocor ke client
- **File**: `app/api/app/route.ts:189,251` — catch mengembalikan `error.message` apa adanya. Pesan D1/SQLite bocor (lihat M1). Information disclosure tingkat rendah-menengah.
- **Fix**: log error di server, kembalikan pesan generik ("Terjadi kesalahan server.").

### M3 — Script npm rusak di Windows
- **File**: `package.json:10-11` — `"dev": "WRANGLER_LOG_PATH=... vite"` — sintaks env POSIX; npm menjalankan script via `cmd.exe` di Windows → `'WRANGLER_LOG_PATH' is not recognized...`. **Terverifikasi**: `npm run dev` gagal; workaround `export` + `npx vite` jalan.
- **File**: `scripts/install-ci.sh:10` — butuh `flock` (Linux-only). **Terverifikasi**: `flock` tidak ada di git-bash → `npm run install:ci` gagal di Windows.
- **Fix**: pakai `cross-env` (atau tulis env di dalam script), dan sediakan jalur install Windows biasa (`npm install`).

### M4 — Type-check gagal total
- **Bukti**: `npx tsc --noEmit` →
  - `TS2307: Cannot find module 'cloudflare:workers'` (route.ts, db/index.ts)
  - `TS2304: Cannot find name 'Fetcher'` / `TS2552: D1Database` (worker/index.ts)
- `@cloudflare/workers-types` tidak ada di devDependencies dan tsconfig tidak punya `types`. Build (`vinext build`) tidak memakai tsc sehingga tetap lolos — tapi tidak ada safety net type.
- **Fix**: tambah `@cloudflare/workers-types` + `"types": ["@cloudflare/workers-types"]` di tsconfig.

### M5 — Gambar hero rusak di dev mode (image optimizer crash)
- **Bukti**: `<img src="/_vinext/image?url=%2Fog.png...">` naturalWidth = 0; setiap kembali ke view Belanja muncul error overlay Vite: `Cannot read properties of undefined (reading 'fetch')` di `worker/index.ts:35` — `env.ASSETS.fetch` undefined di dev (Miniflare tidak menyediakan binding ASSETS).
- **Dampak**: dev-only; hero visual + floating card tidak tampil. Di production binding ASSETS ada, kemungkinan aman — perlu diverifikasi saat deploy.
- **Fix** ✅ **DITERAPKAN & TERVERIFIKASI (22 Agu)**: `worker/index.ts` kini redirect 302 ke aset mentah saat `!env.ASSETS` (meniru middleware dev vinext, `vinext/dist/index.js:1045-1063`). Gambar hero load normal, overlay hilang, log bersih.

### M6 — Dua sumber schema tidak sinkron
- Runtime (`route.ts:18-61`) membuat 8 tabel: `users, sessions, products, orders, order_items, inventory_movements, expenses, loyalty_ledger` + kolom `accent` di products.
- `db/schema.ts` + `drizzle/0000_*.sql` hanya 5 tabel, **tanpa** `sessions`, `inventory_movements`, `loyalty_ledger`, kolom `accent`.
- **Dampak**: `npm run db:generate` / `drizzle-kit push` menghasilkan migration yang salah dan berpotensi menghapus data. Migration terakhir juga tidak pernah dipakai di runtime (schema dibuat manual per request).
- **Fix**: jadikan `db/schema.ts` sebagai satu-satunya sumber kebenaran, atau hapus drizzle dari alur runtime.

### M7 — Copy kartu poin bertentangan dengan logika
- **Bukti**: DOM member dashboard: `SEGAR REWARDS 120 poin tersedia — 10 poin = Rp10.000`.
- Logika (`route.ts:134`): `points = Math.floor(total / 10000)` → **1 poin = Rp10.000** (terverifikasi: order Rp26.000 → +2 poin).
- **Fix**: ubah copy menjadi "1 poin = Rp10.000" (atau sesuai kebijakan bisnis yang diinginkan).

## Temuan Low

| # | Temuan | File | Catatan |
|---|---|---|---|
| L1 | Timeline lacak order **dibatalkan**: semua step "Menunggu", tanpa indikasi batal | store-app.tsx:201-202 | `indexOf("cancelled")` = -1; head tetap benar ("Dibatalkan") tapi timeline menyesatkan |
| L2 | Nomor order `Math.random().toString(36).slice(2,7)` — kolisi mungkin → 500 di unique constraint, tanpa retry | route.ts:101 | probabilitas kecil, tapi 500 tanpa pesan |
| L3 | `ensureReady()` jalan **setiap request**: 9× CREATE IF NOT EXISTS + COUNT + seed check | route.ts:78-92 | overhead konstan; untuk PoC fine, untuk production hapus |
| L4 | `hydrateOrders` N+1: 100 order → 100 query tambahan | route.ts:127-129 | batas 100 di admin; fine untuk skala ini |
| L5 | Field `payment` ("cod") di form checkout tidak pernah dipakai API; klaim "Bayar fleksibel: Tunai, transfer, QRIS" tanpa implementasi | store-app.tsx:192, route.ts | hanya `unpaid → paid` manual admin |
| L6 | Sesi expired tidak dibersihkan (tabel sessions membengkak); cookie tanpa `Secure` | route.ts:330-337 | dev fine; production perlu cleanup + Secure |
| L7 | Tidak ada CSRF token | route.ts | dimitigasi SameSite=Lax + content-type JSON (preflight), risiko rendah |
| L8 | Pelacakan bisa ditebak: orderNo 5 karakter acak + 6 digit phone | route.ts:158-166 | risiko rendah; bisa ditambah batas percobaan |
| L9 | Hanya 1 smoke test (rendered-html), tidak ada test logika bisnis | tests/ | stok/poin/transisi tidak di-cover |

## Yang sudah benar (terverifikasi)

- **SQL injection**: semua query parameterized; tidak ada string concat di SQL.
- **XSS**: payload `<script>alert(1)</script>` di customer_name tersimpan dan dirender sebagai teks inert (0 elemen script) — React escaping + tidak ada `dangerouslySetInnerHTML`.
- **Transisi status**: divalidasi server-side — `cancelled → confirmed` → 409 `Transisi cancelled ke confirmed tidak diizinkan.`
- **Logika stok**: reserve saat checkout → release saat batal (new/confirmed) → stok berkurang saat preparing → return stok saat batal setelahnya. Semua diverifikasi angka sebelum/sesudah.
- **Poin**: 1 poin per Rp10.000, hanya saat `completed` + `paid`, double-grant dicegah (guard `points_earned=0` + UNIQUE `loyalty_ledger`). Terverifikasi: 120 → 122.
- **Auth role**: member/admin view tanpa sesi → 401; admin login salah → 401.
- **Batch D1 atomik**: order gagal tidak meninggalkan data korup.
- **Error handling UI**: track "Pesanan tidak ditemukan." tampil benar; notice checkout sukses benar.
- **Keranjang**: cap stok tersedia (`stock - reserved`), stepper, subtotal+ongkir benar (Rp40.000 untuk 23rb+12rb+5rb ongkir).
- **Cetak nota**: modal + `@media print` 80mm terpisah dari UI.

## Lingkungan & catatan

- Aplikasi berjalan di `http://localhost:5173` (dev server masih aktif).
- DB lokal di `.wrangler/`; reset data = hapus folder itu.
- Belum ada git repo di folder project.
- `browser_click` tool tidak meregistrasi klik di app ini (perlu `.click()` via console) — ini quirk tooling, bukan bug aplikasi; semua interaksi QA dijalankan via DOM click.
