import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pxls",
  description: "Dashboard for legacy Divoom Pixoo Bluetooth displays",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
