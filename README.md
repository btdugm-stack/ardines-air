# Depot Air Mineral UMKM — Local PoC

Aplikasi web responsif untuk penjualan air galon, air botol, dan es batu. Versi ini sudah memiliki alur pelanggan, member, dan admin dengan database lokal.

## Fitur yang sudah berjalan

### Pelanggan tanpa login

- Melihat dan memfilter katalog produk.
- Membeli galon, air botol, dus, dan es batu eceran.
- Keranjang dengan validasi stok tersedia.
- Checkout tanpa akun.
- Pilihan diantar atau ambil sendiri.
- Ongkir otomatis Rp5.000 untuk pengantaran.
- Nomor pesanan otomatis.
- Pelacakan pesanan menggunakan nomor order dan nomor WhatsApp.

### Member

- Simulasi login Google untuk pengembangan lokal.
- Riwayat pesanan member.
- Saldo poin dan histori perolehan.
- Poin diberikan otomatis setelah pesanan berstatus selesai dan lunas.
- Satu poin untuk setiap kelipatan transaksi Rp10.000.

### Admin

- Login admin dengan sesi server-side.
- Dashboard omzet, pesanan aktif, biaya operasional, dan estimasi netto.
- Daftar dan detail ringkas pesanan.
- Transisi status: baru → dikonfirmasi → disiapkan → siap → diantar/selesai.
- Pembatalan pesanan dengan pengembalian reservasi/stok.
- Verifikasi pembayaran.
- Cetak nota.
- Stok aktual, stok direservasi, dan stok tersedia.
- Penyesuaian stok dengan inventory movement.
- Pencatatan biaya operasional.

## Akun dummy

### Admin

```text
Email    : admin@segardepot.local
Password : Admin123!
```

### Member

Klik tombol **Lanjutkan dengan Google — Demo** pada menu Member.

```text
Email simulasi : member.demo@gmail.com
Nama           : Nadia Pelanggan
Saldo awal     : 120 poin
```

> Login Google pada versi lokal adalah simulator. Untuk production, ganti endpoint demo dengan Google OAuth/OpenID Connect dan simpan Client ID/Secret melalui environment variable—jangan hard-code kredensial produksi.

## Kebutuhan sistem

- Node.js 22.13 atau lebih baru.
- npm.
- Windows, Linux, atau macOS.

## Menjalankan aplikasi

1. Ekstrak project dan masuk ke foldernya.
2. Instal dependensi:

```bash
npm install
```

3. Jalankan development server:

```bash
npm run dev
```

4. Buka alamat yang ditampilkan terminal, biasanya:

```text
http://localhost:5173
```

Database D1 lokal dibuat dan diisi data dummy otomatis pada request pertama. Data development tersimpan di direktori lokal Wrangler pada project.

## Build production lokal

```bash
npm run build
npm run start
```

## Reset data dummy

Hentikan server, lalu hapus direktori state lokal berikut:

```text
.wrangler/
```

Jalankan kembali `npm run dev`. Schema dan seed data akan dibuat ulang otomatis.

## Alur uji cepat

1. Dari menu **Belanja**, tambahkan beberapa produk.
2. Checkout tanpa login menggunakan nomor WhatsApp dummy.
3. Catat nomor order yang muncul pada notifikasi.
4. Masuk ke menu **Admin** menggunakan akun dummy.
5. Konfirmasi order, mulai siapkan, tandai siap, verifikasi pembayaran, lalu selesaikan.
6. Cetak nota dari daftar order.
7. Untuk menguji poin, masuk sebagai member terlebih dahulu, buat order baru, lalu selesaikan dan lunasi melalui admin.

## Logika stok

- Saat checkout, jumlah produk masuk ke `reserved`.
- Saat order mulai disiapkan, jumlah berpindah dari `reserved` dan mengurangi stok fisik.
- Pembatalan sebelum disiapkan melepaskan reservasi.
- Pembatalan setelah disiapkan mengembalikan stok.
- Stok tersedia dihitung dengan rumus `stock - reserved`.

## Struktur penting

```text
app/store-app.tsx     Antarmuka pelanggan, member, dan admin
app/api/app/route.ts  API, aturan order, stok, pembayaran, dan poin
app/globals.css       Design system dan layout responsif
db/schema.ts          Definisi schema Drizzle
drizzle/              Migration database
public/og.png         Visual brand dan social preview
```

## Catatan production

Sebelum digunakan untuk transaksi riil:

- Aktifkan Google OAuth asli.
- Pindahkan akun admin awal ke secret/configuration management.
- Terapkan password hashing adaptif atau autentikasi admin berbasis identity provider.
- Tambahkan rate limiting, backup terjadwal, observability, dan kebijakan retensi data.
- Konfigurasikan WhatsApp Business API/payment gateway jika diperlukan.
- Lakukan UAT stok, galon, pembayaran, refund, dan pencetakan pada perangkat toko.
