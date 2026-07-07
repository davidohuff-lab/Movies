import type { Metadata, Viewport } from "next";
import "./globals.css";

import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Screen Ritual",
  description: "NYC repertory and arthouse movie showtimes"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Header />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
