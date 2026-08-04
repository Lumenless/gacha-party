import { NextResponse } from "next/server";
import { MockCardCustodyAdapter } from "@/integrations/card-custody/mock";
import { OperatorCardCustodyAdapter } from "@/integrations/card-custody/operator";
import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { serverVotingAdapter } from "@/integrations/voting/server";
import { apiError } from "@/server/api-response";
import { expirePartyVote } from "@/server/party-outcome";
import { authenticatedActionBody } from "@/server/wallet-auth";
import { executeRealSellSettlement } from "@/server/real-settlement";
import { markPartyEscrowSettled } from "@/server/operator-escrow";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const realMode = getCollectorCryptMode() === "real";
    return NextResponse.json(await expirePartyVote(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      serverVotingAdapter,
      collectorCryptAdapter(),
      realMode ? new OperatorCardCustodyAdapter() : new MockCardCustodyAdapter(),
      Date.now(),
      realMode ? executeRealSellSettlement : undefined,
      realMode ? markPartyEscrowSettled : undefined,
    ));
  } catch (error) {
    return apiError(error);
  }
}
