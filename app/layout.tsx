import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

const description = "Talk to your video archive. Find any moment, edit it in one sentence, and prove what is original.";

export const metadata: Metadata = {
  // Absolute URL for link-preview images; set SITE_URL at build time when serving from a public host.
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
  title: { default: "Raccoon", template: "%s · Raccoon" },
  applicationName: "Raccoon",
  description,
  openGraph: { title: "Raccoon", description, siteName: "Raccoon", type: "website" },
  twitter: { card: "summary_large_image", title: "Raccoon", description },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-[13px] text-fg">{children}</body>
    </html>
  );
}
