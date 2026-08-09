import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { startedPartyCountdown, startPartyCountdown } from "@/server/party-room";
import { authenticatedActionBody } from "@/server/wallet-auth";
import { assertPartyEscrowLocked } from "@/server/onchain-escrow";
import { verifiedMagicBlockCountdown } from "@/server/onchain-room";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const body = await authenticatedActionBody(request);
    const started = await startedPartyCountdown(partyId, body);
    if (started) return NextResponse.json(started);
    await assertPartyEscrowLocked(partyId);
    const countdownEndsAt = await verifiedMagicBlockCountdown(partyId);
    return NextResponse.json(await startPartyCountdown(partyId, body, realtimePartyAdapter, Date.now(), countdownEndsAt));
  } catch (error) {
    return apiError(error);
  }
}
