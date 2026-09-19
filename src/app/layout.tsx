import type { Metadata, Viewport } from "next";
import "./globals.css";

import { Header } from "@/components/header";
import { getPublicDataset } from "@/lib/repository";

export const metadata: Metadata = {
  title: "Screen Ritual",
  description: "NYC repertory and arthouse movie showtimes"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1
};

async function getGeneratedAt(): Promise<string | undefined> {
  try {
    return (await getPublicDataset()).generatedAt;
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const generatedAt = await getGeneratedAt();
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Header generatedAt={generatedAt} />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
