import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { serverVotingAdapter } from "@/integrations/voting/server";
import { apiError } from "@/server/api-response";
import { commitPartyVote } from "@/server/party-outcome";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    return NextResponse.json(await commitPartyVote(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      serverVotingAdapter,
    ));
  } catch (error) {
    return apiError(error);
  }
}
