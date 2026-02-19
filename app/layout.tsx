import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const fallbackSiteUrl = "http://localhost:3000";
const resolvedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : fallbackSiteUrl);
const ogImageUrl = new URL("/opengraph-image", resolvedSiteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(resolvedSiteUrl),
  title: "Airsoft Quest Tracker",
  description: "Realtime map + payload mission tracking",
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title: "Airsoft Quest Tracker",
    description: "Realtime map + payload mission tracking",
    url: resolvedSiteUrl,
    siteName: "Airsoft Quest Tracker",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: "TIGLIN tactical command center visual",
        type: "image/png"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Airsoft Quest Tracker",
    description: "Realtime map + payload mission tracking",
    images: [ogImageUrl]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
