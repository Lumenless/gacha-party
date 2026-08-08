import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { joinParty } from "@/server/party-room";
import { joinPartySchema } from "@/domain/party";
import { registerVerifiedEscrowParticipant } from "@/server/onchain-escrow";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const input = joinPartySchema.parse(await authenticatedActionBody(request));
    await registerVerifiedEscrowParticipant(partyId, input.wallet);
    return NextResponse.json(await joinParty(partyId, input, realtimePartyAdapter));
  } catch (error) {
    return apiError(error);
  }
}
