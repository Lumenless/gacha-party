import { NextResponse } from "next/server";
import { MockCardCustodyAdapter } from "@/integrations/card-custody/mock";
import { MockCollectorCryptAdapter } from "@/integrations/collector-crypt/mock";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { serverVotingAdapter } from "@/integrations/voting/server";
import { apiError } from "@/server/api-response";
import { expirePartyVote } from "@/server/party-outcome";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    return NextResponse.json(await expirePartyVote(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      serverVotingAdapter,
      new MockCollectorCryptAdapter(),
      new MockCardCustodyAdapter(),
    ));
  } catch (error) {
    return apiError(error);
  }
}
