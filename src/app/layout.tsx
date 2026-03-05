import type { Metadata } from "next";
import "./globals.css";

import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "Repertory Signal",
  description: "NYC repertory and arthouse movie showtimes"
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
