# DESIGN.md: Ardines

Arah desain untuk ardines-web. Isi dari pemilik produk (4 Oktober 2026), kecuali bagian yang ditandai sebagai usulan.

## Identitas

- Ardines adalah nama brand. Produknya: distributor es kristal dan depot air minum (galon, air botol, es balok/kristal), diantar atau ambil sendiri.
- Pengguna: pelanggan yang memesan, dan admin yang mengelola pesanan.

## Kepribadian

- Ramah pengguna, terasa seperti marketplace online.
- Tenang dan fungsional, bukan berani dan ramai.

## Palet

Tetap seperti yang ada di `app/globals.css`.

| Peran | Token | Terang | Gelap |
|---|---|---|---|
| Inti | `--teal` | `#087f78` | `#3fb5aa` |
| Inti | `--navy` / `--deep` | `#082d3b` | `#061e28` |
| Aksen | `--lime` | `#c9f24b` | `#d4f766` |
| Netral dasar | `--paper` | `#f7faf8` | `#0b1618` |

Warna status (`--st-*`, `--danger`, `--success`) hanya untuk menandai keadaan nyata, bukan hiasan.

## Tema

Bawaan terang, karena mayoritas pelanggan membuka aplikasi di siang hari. Mode gelap adalah pilihan pengguna lewat tombol tema, dan keduanya harus berfungsi penuh.

## Tipografi

Tidak ada font merek.

Plus Jakarta Sans untuk seluruh teks: judul, isi, formulir, dan tombol. Keputusan pemilik (4 Oktober 2026), menggantikan rencana awal yang memakai font sistem untuk teks isi.

- Bentuk huruf bulat dan terbuka (ramah), angka jelas untuk harga.
- Satu berkas font variabel (ketebalan 400 sampai 800, subset latin, sekitar 27 KB) di `public/fonts`, di-host sendiri dan ikut ter-cache service worker. Font sistem hanya cadangan saat berkas belum termuat.

## Dial

`ENERGY 1 / RHYTHM 2 / MOTION 1`

Pengecualian (keputusan pemilik, 8 Oktober 2026): halaman pilih-peran dan hero toko memakai lapisan premium, `ENERGY 2 / MOTION 2`. Di sana berlaku bingkai ganda pada kartu dan gambar, tombol pil dengan ikon di lingkarannya sendiri, lencana kecil di atas judul, dan animasi masuk satu kali. Katalog, checkout, lacak, member, dan admin tetap pada dial di atas.

Diturunkan dari "tenang dan fungsional" dan "seperti marketplace". ENERGY dan MOTION dari jawaban pemilik; RHYTHM 2 adalah tafsiran, belum dikonfirmasi.
