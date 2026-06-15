// ── app/layout.tsx — root layout + chrome ─────────────────────────────────────
// Wraps every page with the document shell, loads the two self-hosted Google
// fonts (exposed as CSS variables consumed by Tailwind), sets static metadata,
// and renders the sticky top nav. Purely presentational — no demo state lives
// here; the guided flow and on-chain logic are all in page.tsx.

import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { IS_MAINNET } from "@sip402/core";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "sip402 demo · grant, spend, enforce",
  description:
    "Local demo of sip402: connect MetaMask, grant one ERC-7715 permission, and watch an agent sip USDC while the chain enforces the cap.",
};

function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-canvas/85 backdrop-blur-md">
      <nav className="mx-auto flex max-w-[1040px] items-center justify-between px-5 py-3.5 sm:px-8">
        <span className="text-[17px] tracking-tight text-ink">
          sip<span className="text-primary">402</span>
          <span className="ml-2 text-[13px] text-ink-mute">demo</span>
        </span>
        <div className="flex items-center gap-4 text-[14px]">
          <span
            className={`rounded-pill border px-2.5 py-1 text-[12.5px] ${
              IS_MAINNET
                ? "border-primary/40 bg-primary-subdued/30 text-primary-deep"
                : "border-hairline text-ink-mute"
            }`}
          >
            local · {IS_MAINNET ? "Base mainnet" : "Base Sepolia"}
          </span>
          <a
            href="https://github.com/RomarioKavin1/sip402"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-mute-2 transition-colors hover:text-ink"
          >
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
