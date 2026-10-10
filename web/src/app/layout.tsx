import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pxls",
  description: "Dashboard for legacy Divoom Pixoo Bluetooth displays",
  icons: { icon: [{ url: "/favicon.svg" }, { url: "/favicon-32.png", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
