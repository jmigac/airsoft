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

export const metadata: Metadata = {
  metadataBase: new URL(resolvedSiteUrl),
  title: "Airsoft Quest Tracker",
  description: "Realtime map + payload mission tracking",
  openGraph: {
    title: "Airsoft Quest Tracker",
    description: "Realtime map + payload mission tracking",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "TIGLIN tactical command center visual"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Airsoft Quest Tracker",
    description: "Realtime map + payload mission tracking",
    images: ["/opengraph-image"]
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
