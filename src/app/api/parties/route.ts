import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { collectorCryptAdapter } from "@/integrations/collector-crypt/server";
import { createParty } from "@/server/create-party";
import { listWalletParties } from "@/server/list-wallet-parties";
import { requireRequestWallet, walletModeEnabled } from "@/server/wallet-auth";

export async function GET(request: Request) {
  try {
    if (!walletModeEnabled()) return NextResponse.json([]);
    return NextResponse.json(await listWalletParties(requireRequestWallet(request)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your parties.";
    const status = error && typeof error === "object" && "status" in error && error.status === 401 ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const wallet = walletModeEnabled() ? requireRequestWallet(request) : "DEMO_HOST_WALLET";
    const party = await createParty(await request.json(), collectorCryptAdapter(), { wallet });
    return NextResponse.json({ id: party.id, roomAddress: party.roomAddress }, { status: 201 });
  } catch (error) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "Check the party details."
      : error instanceof Error ? error.message : "Could not create the party.";
    const status = error && typeof error === "object" && "status" in error && error.status === 401 ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
