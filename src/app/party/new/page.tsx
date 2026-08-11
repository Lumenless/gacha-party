import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { CreatePartyForm } from "./party-form";
import { RadioTower } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewPartyPage() {
  const packs = await collectorCryptAdapter().listPacks();
  const availablePacks = packs.filter(({ isOpen }) => isOpen);
  const realFunds = process.env.NEXT_PUBLIC_WALLET_MODE === "wallet" && process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 md:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-primary"><RadioTower className="size-4" aria-hidden="true" /> New party</p>
          <h1 className="display-type mt-2 text-4xl font-semibold sm:text-5xl">Pick a pack. Start the fun.</h1>
        </div>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          {realFunds
            ? `${getCollectorCryptMode() === "real" ? "Live Collector Crypt inventory" : "Demo inventory"} · Devnet USDC`
            : "Safe demo inventory · simulated USDC · no tokens move."}
        </p>
      </div>

      <div className="pt-6">
        <CreatePartyForm exactPackPrice={realFunds} packs={availablePacks.map((pack) => ({ ...pack, priceBaseUnits: pack.priceBaseUnits.toString() }))} />
      </div>
    </main>
  );
}
