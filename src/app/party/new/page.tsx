import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { CreatePartyForm } from "./party-form";
import { RadioTower, ShieldCheck, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewPartyPage() {
  const packs = await collectorCryptAdapter().listPacks();
  const realFunds = process.env.NEXT_PUBLIC_WALLET_MODE === "wallet" && process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 md:px-6 lg:px-8">
      <nav aria-label="Gacha Party sections" className="flex items-center gap-1 overflow-x-auto border-y py-2">
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md bg-primary/10 px-4 text-sm font-semibold text-primary">
          <RadioTower className="size-4" aria-hidden="true" /> New party
        </span>
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 px-4 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden="true" /> 1–10 players
        </span>
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 px-4 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" /> Majority vote
        </span>
      </nav>

      <div className="flex flex-col justify-between gap-3 py-6 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Collector Crypt · shared pulls</p>
          <h1 className="display-type mt-2 text-3xl font-semibold sm:text-4xl">Choose your party pack.</h1>
        </div>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {realFunds
            ? `${getCollectorCryptMode() === "real" ? "Live Collector Crypt inventory" : "Demo inventory"} · pooled devnet USDC · MagicBlock room.`
            : "Safe demo inventory · simulated USDC · no tokens move."}
        </p>
      </div>

      <CreatePartyForm exactPackPrice={realFunds} packs={packs.map((pack) => ({ ...pack, priceBaseUnits: pack.priceBaseUnits.toString() }))} />
    </main>
  );
}
