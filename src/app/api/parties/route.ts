import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MockCollectorCryptAdapter } from "@/integrations/collector-crypt/mock";
import { createParty } from "@/server/create-party";
import { requireRequestWallet, walletModeEnabled } from "@/server/wallet-auth";

export async function POST(request: Request) {
  try {
    const wallet = walletModeEnabled() ? requireRequestWallet(request) : "DEMO_HOST_WALLET";
    const party = await createParty(await request.json(), new MockCollectorCryptAdapter(), { wallet });
    return NextResponse.json({ id: party.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "Check the party details."
      : error instanceof Error ? error.message : "Could not create the party.";
    const status = error && typeof error === "object" && "status" in error && error.status === 401 ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
