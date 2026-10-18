import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Server Browser",
  description: "Live Chromium controlled by Playwright"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
