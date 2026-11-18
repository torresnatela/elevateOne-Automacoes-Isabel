import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/** A letra da interface, a mesma do AI Office, com os seus tamanhos óticos. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "ElevateOne Automações",
  description: "Plataforma de automações ElevateOne",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e16" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
