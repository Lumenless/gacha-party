import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { CreatePartyForm } from "./party-form";

export const dynamic = "force-dynamic";

export default async function NewPartyPage() {
  const packs = await collectorCryptAdapter().listPacks();
  const realFunds = process.env.NEXT_PUBLIC_WALLET_MODE === "wallet" && process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 md:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[.75fr_1.25fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Create a room</p>
          <h1 className="display-type mt-4 text-4xl font-semibold sm:text-5xl">Set the stakes.</h1>
          <p className="mt-5 max-w-sm leading-7 text-muted-foreground">
            Pick one pack and set the funding window. Your wallet activates the MagicBlock room before you invite the crew.
          </p>
          <div className="mt-8 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">
            <strong className="text-primary">{realFunds ? "Devnet funding:" : "Safe demo:"}</strong>{" "}
            {realFunds
              ? `${getCollectorCryptMode() === "real" ? "Live Collector Crypt packs" : "Mock packs"} with an on-chain escrow, fixed devnet operator, and one-time purchase release.`
              : "USDC contributions remain simulated. Wallet mode only requests a free ownership signature, never a transaction."}
          </div>
        </div>
        <CreatePartyForm exactPackPrice={realFunds} packs={packs.map((pack) => ({ ...pack, priceBaseUnits: pack.priceBaseUnits.toString() }))} />
      </div>
    </main>
  );
}
