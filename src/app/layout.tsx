import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Montserrat for the heavy capital headings, Urbanist for text (see globals.css).
// Served from the app (src/app/fonts, SIL Open Font License) so they also load offline.
const montserrat = localFont({
  variable: "--font-montserrat",
  src: [
    { path: "./fonts/montserrat-700.woff2", weight: "700" },
    { path: "./fonts/montserrat-800.woff2", weight: "800" },
    { path: "./fonts/montserrat-900.woff2", weight: "900" },
  ],
});

const urbanist = localFont({
  variable: "--font-urbanist",
  src: [
    { path: "./fonts/urbanist-400.woff2", weight: "400" },
    { path: "./fonts/urbanist-500.woff2", weight: "500" },
    { path: "./fonts/urbanist-600.woff2", weight: "600" },
    { path: "./fonts/urbanist-700.woff2", weight: "700" },
  ],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SehatLog",
  description: "Patient-owned, end-to-end encrypted health records keyed to NIN and fingerprint.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} ${urbanist.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
