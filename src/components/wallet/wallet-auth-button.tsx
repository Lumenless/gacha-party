"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useWalletAuth } from "./wallet-auth-provider";

function truncate(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletAuthButton({ compact = false }: { compact?: boolean }) {
  const { wallets, walletAddress, status, error, connect, disconnect } = useWalletAuth();
  const { error: showError } = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (error) showError(error);
  }, [error, showError]);

  if (walletAddress) {
    return (
      <div className="relative">
        <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          <span className="font-mono">{truncate(walletAddress)}</span>
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border bg-card p-2 shadow-2xl">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Verified · Transactions enabled
            </div>
            <button type="button" onClick={() => void disconnect()} className="min-h-11 w-full rounded-md px-3 text-left text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Disconnect wallet
            </button>
          </div>
        )}
      </div>
    );
  }

  const pending = status === "connecting" || status === "signing";
  return (
    <div className="relative">
      <Button type="button" variant={compact ? "secondary" : "primary"} onClick={() => setOpen((value) => !value)} disabled={pending} loading={pending}>
        {!pending && <WalletCards className="size-4" aria-hidden="true" />}
        {status === "signing" ? "Verify in wallet…" : status === "connecting" ? "Connecting…" : "Connect wallet"}
      </Button>
      {open && !pending && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-card p-3 shadow-2xl">
          <p className="px-2 text-sm font-semibold">Choose a Solana wallet</p>
          <p className="px-2 pb-2 pt-1 text-xs leading-5 text-muted-foreground">You’ll sign a free message to prove wallet ownership. No transaction is sent.</p>
          {wallets.length ? wallets.map((wallet) => (
            <button
              key={wallet.name}
              type="button"
              onClick={() => { setOpen(false); void connect(wallet); }}
              className="flex min-h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {wallet.name}<Check className="size-4 text-muted-foreground" aria-hidden="true" />
            </button>
          )) : (
            <p className="rounded-md bg-muted px-3 py-3 text-xs leading-5 text-muted-foreground">No compatible wallet was detected. Install or unlock Phantom, Solflare, or Backpack, then reload.</p>
          )}
        </div>
      )}
    </div>
  );
}
