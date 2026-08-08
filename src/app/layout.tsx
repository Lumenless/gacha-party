import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WalletAuthButton } from "@/components/wallet/wallet-auth-button";
import { WalletAuthProvider } from "@/components/wallet/wallet-auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gacha Party — Pull together",
  description: "Pool USDC with friends and open Collector Crypt packs together.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const isDevnetLive = process.env.COLLECTOR_CRYPT_MODE === "real" && process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  return (
    <html lang="en">
      <body className="noise antialiased">
        <WalletAuthProvider>
        <header className="mx-auto flex h-18 w-full max-w-7xl items-center justify-between px-4 md:px-6 lg:px-8">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <span className="hidden whitespace-nowrap sm:inline">GACHA PARTY</span>
          </Link>
          <div className="flex items-center gap-2">
            {process.env.NEXT_PUBLIC_WALLET_MODE === "wallet" ? (
              <WalletAuthButton compact />
            ) : (
              <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">Mock mode</span>
            )}
            {isDevnetLive ? (
              <span className="whitespace-nowrap rounded-full border border-primary/35 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">Collector devnet</span>
            ) : null}
            <span className="hidden rounded-full border px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex">
              Devnet
            </span>
          </div>
        </header>
        {children}
        </WalletAuthProvider>
      </body>
    </html>
  );
}
