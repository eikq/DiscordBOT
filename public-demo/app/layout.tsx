import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:4174";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "Digital Me — Thai Voice AI for Discord",
    description: "Public consent-safe sandbox for a Thai-English Discord AI companion with social memory and expressive voice intelligence.",
    openGraph: {
      title: "Digital Me — Thai Voice AI for Discord",
      description: "ลอง AI Discord Companion ที่ฟังบริบท จดจำ และตอบเป็นธรรมชาติ โดยไม่เผยแพร่ข้อมูลเสียงส่วนตัว",
      url: origin,
      siteName: "Digital Me",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Digital Me Thai Voice AI for Discord" }],
      type: "website",
    },
    twitter: { card: "summary_large_image", title: "Digital Me", description: "Thai Voice AI for Discord", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
