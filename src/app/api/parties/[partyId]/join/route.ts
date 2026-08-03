import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { joinParty } from "@/server/party-room";
import { assertEscrowAllowsJoin } from "@/server/onchain-escrow";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    await assertEscrowAllowsJoin(partyId);
    return NextResponse.json(await joinParty(partyId, await authenticatedActionBody(request), realtimePartyAdapter));
  } catch (error) {
    return apiError(error);
  }
}
