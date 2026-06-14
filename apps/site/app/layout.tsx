import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "sip402 · open a tab, pay by the sip",
  description:
    "The first on-chain, capital-backed binding of x402 batch-settlement. One MetaMask permission opens a metered, revocable USDC session the chain enforces. No custodian.",
};

function PromoBanner() {
  return (
    <div className="w-full bg-ink text-canvas">
      <div className="mx-auto flex max-w-[1280px] items-center justify-center gap-2 px-5 py-2.5 text-center text-[13px] font-bold sm:px-8">
        <span>Proven on Base mainnet + Base Sepolia with real on-chain transactions.</span>
        <Link href="/docs#proof" className="hidden underline underline-offset-2 sm:inline">
          See the evidence
        </Link>
      </div>
    </div>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline-soft bg-canvas/90 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="text-[18px] font-bold tracking-tight text-ink">
          sip402
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          <Link
            href="/"
            className="rounded-pill bg-ink px-4 py-1.5 text-[14px] font-bold text-canvas"
          >
            Overview
          </Link>
          <Link
            href="/docs"
            className="rounded-pill border border-hairline px-4 py-1.5 text-[14px] font-bold text-ink transition-colors hover:bg-canvas-soft"
          >
            Docs
          </Link>
        </div>
        <div className="flex items-center gap-4 text-[14px]">
          <a
            href="https://github.com/RomarioKavin1/sip402"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden font-bold text-ink transition-colors hover:text-primary sm:inline"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@sip402/core"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden font-bold text-ink transition-colors hover:text-primary sm:inline"
          >
            npm
          </a>
          <Link
            href="/docs#run-the-demo"
            className="rounded-pill bg-ink-button px-5 py-2 text-[14px] font-bold text-on-primary transition-colors hover:bg-ink"
          >
            Run the demo
          </Link>
        </div>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <PromoBanner />
        <TopNav />
        {children}
      </body>
    </html>
  );
}
