import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-hanken",
  display: "swap",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "sip402 · open a tab, pay by the sip",
  description:
    "The first on-chain, capital-backed binding of x402 batch-settlement. One MetaMask permission opens a metered, revocable USDC session the chain enforces. No custodian.",
};

function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b rule bg-ink/85 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
        <Link
          href="/"
          className="font-mono text-sm font-bold tracking-tight text-text"
        >
          sip<span className="text-amber">402</span>
        </Link>
        <div className="flex items-center gap-4 text-sm sm:gap-6">
          <Link
            href="/docs"
            className="text-text-dim transition-colors hover:text-text"
          >
            Docs
          </Link>
          <Link
            href="/dashboard"
            className="text-text-dim transition-colors hover:text-text"
          >
            Demo
          </Link>
          <a
            href="https://github.com/RomarioKavin1/sip402"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-text-dim transition-colors hover:text-text sm:inline"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@sip402/core"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-text-dim transition-colors hover:text-text sm:inline"
          >
            npm
          </a>
        </div>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${jbmono.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-text antialiased">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
