"use client";

const KUNCI = "ardines_theme";

/* Tema bawaan aplikasi adalah TERANG. Mode gelap murni pilihan pengguna:
   preferensi sistem sengaja tidak dipakai otomatis, karena mayoritas pelanggan
   depot membuka aplikasi ini di siang hari dan mengharapkan tampilan terang.

   Komponen ini sengaja tanpa state React. Ikon mana yang tampil diputuskan CSS
   lewat [data-theme] pada <html>, yang sudah diset skrip di <head> sebelum
   lukisan pertama — jadi tidak ada kedipan tema dan tidak ada selisih hidrasi
   antara HTML dari server dan render pertama di peramban. */
export default function ThemeToggle() {
  const ganti = () => {
    const html = document.documentElement;
    const gelap = html.getAttribute("data-theme") === "dark";
    const berikutnya = gelap ? "light" : "dark";
    html.setAttribute("data-theme", berikutnya);
    // Bilah status ponsel ikut tema yang dipilih.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute("content", berikutnya === "dark" ? "#061e28" : "#087f78");
    });
    try { localStorage.setItem(KUNCI, berikutnya); } catch { /* mode privat — abaikan */ }
  };

  return (
    <button type="button" className="theme-toggle" onClick={ganti} title="Ganti tema terang / gelap" aria-label="Ganti tema terang atau gelap">
      <svg className="ikon-gelap" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
      <svg className="ikon-terang" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  );
}
