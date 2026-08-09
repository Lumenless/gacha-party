"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowRight, Clock3, Coins, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PartyStatus } from "@/domain/party";
import type { PartySummary } from "@/domain/party-summary";
import { formatUsdc } from "@/domain/money";
import { Button } from "@/components/ui/button";
import { useWalletAuth } from "@/components/wallet/wallet-auth-provider";

type LoadState = "idle" | "loading" | "success" | "error";

const statusLabel: Readonly<Record<PartyStatus, string>> = {
  DRAFT: "Draft",
  FUNDING: "Funding",
  FUNDED: "Funded",
  READY: "Ready",
  OPENING: "Opening",
  REVEALED: "Revealed",
  VOTING: "Voting",
  SETTLING: "Settling",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

function isOngoing(status: PartyStatus) {
  return status !== "COMPLETED" && status !== "CANCELLED" && status !== "EXPIRED";
}

function relativeDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(value));
}

export function YourParties() {
  const { walletAddress } = useWalletAuth();
  const [state, setState] = useState<LoadState>("idle");
  const [loadedWallet, setLoadedWallet] = useState<string | null>(null);
  const [parties, setParties] = useState<PartySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setState("loading");
    setError(null);
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    const controller = new AbortController();
    void fetch("/api/parties", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as PartySummary[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) {
          throw new Error(!Array.isArray(result) && result.error ? result.error : "Could not load your parties.");
        }
        setParties(result);
        setLoadedWallet(walletAddress);
        setState("success");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load your parties.");
        setLoadedWallet(walletAddress);
        setState("error");
      });
    return () => controller.abort();
  }, [requestVersion, walletAddress]);

  if (!walletAddress) return null;
  const visibleState = loadedWallet === walletAddress ? state : "loading";

  return (
    <section aria-labelledby="your-parties-title" className="border-b bg-card/35">
      <div className="mx-auto max-w-7xl px-4 py-10 md:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Connected rooms</p>
            <h2 id="your-parties-title" className="display-type mt-2 text-3xl font-semibold sm:text-4xl">Your parties<span className="text-primary">.</span></h2>
          </div>
          <Link href="/party/new" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            New party <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {visibleState === "loading" && (
          <div className="mt-6 grid auto-cols-[minmax(17rem,22rem)] grid-flow-col gap-4 overflow-hidden" aria-label="Loading your parties">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-xl border bg-muted" />)}
          </div>
        )}

        {visibleState === "error" && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5" role="alert">
            <div className="flex items-center gap-2 text-destructive"><AlertCircle className="size-4" aria-hidden="true" /><p className="font-semibold">Couldn’t load your parties</p></div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button type="button" variant="secondary" onClick={retry}>Try again</Button>
          </div>
        )}

        {visibleState === "success" && parties.length === 0 && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
            <div><p className="font-semibold">No parties yet</p><p className="mt-1 text-sm text-muted-foreground">Create a room, invite friends, and make your first pull together.</p></div>
            <Link href="/party/new" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Start a party <ArrowRight className="size-4" aria-hidden="true" /></Link>
          </div>
        )}

        {visibleState === "success" && parties.length > 0 && (
          <div
            className="mt-6 grid auto-cols-[minmax(17rem,22rem)] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain pb-3 snap-x snap-mandatory"
            aria-label="Your parties, horizontally scrollable"
          >
            {parties.map((party) => {
              const funded = BigInt(party.fundedBaseUnits);
              const target = BigInt(party.fundingTargetBaseUnits);
              const progress = target > 0n ? Math.min(100, Number((funded * 100n) / target)) : 0;
              const ongoing = isOngoing(party.status);
              return (
                <Link
                  key={party.id}
                  href={`/party/${party.roomAddress ?? party.id}`}
                  className="group h-full snap-start overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-[16/7] overflow-hidden bg-muted">
                    <Image src={party.packImageUrl} alt="" fill className="object-cover transition-transform duration-300 motion-reduce:transition-none group-hover:scale-[1.02]" />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
                    <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-xs font-semibold ${ongoing ? "border-primary/40 bg-primary/15 text-primary" : "bg-card/85 text-muted-foreground"}`}>
                      {statusLabel[party.status]}
                    </span>
                    {party.isHost && <span className="absolute right-3 top-3 rounded-full border bg-card/85 px-2.5 py-1 text-xs font-semibold">Host</span>}
                  </div>
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground">{party.packName}</p>
                    <h3 className="mt-1 truncate text-lg font-semibold">{party.name}</h3>
                    {ongoing && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5"><Coins className="size-3.5" aria-hidden="true" /> {formatUsdc(funded)} / {formatUsdc(target)} USDC</span>
                          <span className="font-mono tabular-nums">{progress}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${party.name} funding progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    )}
                    <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" aria-hidden="true" /> {party.participantCount} / {party.maxPlayers}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" /> {relativeDate(party.updatedAt)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
