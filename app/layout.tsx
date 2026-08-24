import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Depot Air Mineral UMKM",
  description: "Pesan air galon, air botol, dan es batu dengan cepat. Kelola order, stok, dan operasional dalam satu aplikasi.",
  openGraph: {
    title: "Depot Air Mineral UMKM",
    description: "Pesan air & es, cepat sampai.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
