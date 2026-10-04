"use client";

import { useEffect, useState } from "react";

/* Pop-up install PWA — otomatis muncul di semua platform:
   - Android/Chrome/Edge: tangkap beforeinstallprompt → tombol Install
   - iOS Safari: fallback instruksi "Tambahkan ke Layar Utama"
   - Tidak tampil bila sudah ter-install / baru saja ditutup (7 hari) */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> } | null>(null);
  // iOS Safari tidak punya beforeinstallprompt → deteksi manual (guard SSR)
  const [isIOS] = useState(() => {
    if (typeof window === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
  });
  const [show, setShow] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const isStandalone = () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissedKey = "ardines_install_dismissed";

    // Penundaan 7 hari setelah pengguna menutup banner. Dipakai kedua jalur —
    // timer maupun beforeinstallprompt — agar penolakan benar-benar dihormati.
    const recentlyDismissed = () => {
      const last = Number(localStorage.getItem(dismissedKey) ?? 0);
      return Date.now() - last < 7 * 24 * 60 * 60 * 1000;
    };

    const maybeShow = () => {
      if (isStandalone()) { setInstalled(true); return; }
      if (recentlyDismissed()) return;
      const t = setTimeout(() => setShow(true), 3500);
      return () => clearTimeout(t);
    };

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> });
      if (isStandalone() || recentlyDismissed()) return;
      setShow(true);
    };

    const onInstalled = () => { setInstalled(true); setShow(false); localStorage.setItem(dismissedKey, String(Date.now())); };

    const cleanup = maybeShow();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      if (cleanup) cleanup();
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !show) return null;

  const dismiss = () => {
    localStorage.setItem("ardines_install_dismissed", String(Date.now()));
    setShow(false);
  };

  const doInstall = async () => {
    if (deferred?.prompt) {
      await deferred.prompt();
      const choice = await deferred.userChoice?.catch(() => ({ outcome: "dismissed" }));
      localStorage.setItem("ardines_install_dismissed", String(Date.now()));
      setShow(false);
      if (choice?.outcome === "accepted") setInstalled(true);
    }
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="Install aplikasi">
      <div className="install-card">
        <span className="install-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v10"/><path d="m7 8 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        </span>
        <div className="install-text">
          <b>{isIOS ? "Pasang Ardines di layar utama" : "Install aplikasi Ardines"}</b>
          <small>{isIOS
            ? "Ketuk tombol Bagikan di Safari, lalu pilih “Tambahkan ke Layar Utama”."
            : "Akses lebih cepat & buka layar penuh seperti aplikasi."}</small>
        </div>
        <div className="install-actions">
          {!isIOS && <button className="primary small" onClick={() => void doInstall()}>Install</button>}
          <button className="install-close" onClick={dismiss} aria-label="Tutup">×</button>
        </div>
      </div>
    </div>
  );
}
