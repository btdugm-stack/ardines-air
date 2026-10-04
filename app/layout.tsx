import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "./sw-register";
import InstallPrompt from "./install-prompt";

export const metadata: Metadata = {
  title: "Ardines Group: Distributor Es Kristal & Depot Air Minum",
  description: "Distributor es kristal dan depot air minum. Pesan galon, air botol, dan es balok/kristal dengan cepat, diantar atau ambil sendiri.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Ardines Group",
    description: "Distributor Es Kristal & Depot Air Minum. Pesan, diantar, beres.",
    images: ["/og.jpg"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  // Bilah status mengikuti tema perangkat, bukan satu warna untuk semua kondisi.
  // Satu nilai; ThemeToggle menimpanya saat pengguna berganti tema.
  themeColor: "#087f78",
  width: "device-width",
  initialScale: 1,
};

/* Layar pembuka iOS. Tanpa ini Safari menampilkan layar putih kosong saat
   aplikasi terpasang dibuka — manifest background_color tidak dipakainya.
   Satu berkas per resolusi perangkat, terang dan gelap. */
const IOS_SPLASH = [
  [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3],
  [390, 844, 3], [428, 926, 3], [393, 852, 3], [430, 932, 3],
] as const;

function AppleSplashLinks() {
  return <>{IOS_SPLASH.flatMap(([w, h, dpr]) =>
    (["light", "dark"] as const).map((mode) => (
      <link
        key={`${w}x${h}@${dpr}-${mode}`}
        rel="apple-touch-startup-image"
        href={`/splash/${w}x${h}@${dpr}x-${mode}.png`}
        media={`(prefers-color-scheme: ${mode}) and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr})`}
      />
    ))
  )}</>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Skrip tema di <head> menaruh data-theme sebelum hidrasi; selisih itu disengaja.
    <html lang="id" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ardines Group" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* Terapkan tema tersimpan sebelum lukisan pertama agar tidak berkedip
            terang→gelap. Bawaannya terang; hanya "dark" yang mengubah apa pun. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("ardines_theme")==="dark"){document.documentElement.setAttribute("data-theme","dark")}}catch(e){}`,
          }}
        />
        <AppleSplashLinks />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegister />
        <InstallPrompt />
        {children}
      </body>
    </html>
  );
}
