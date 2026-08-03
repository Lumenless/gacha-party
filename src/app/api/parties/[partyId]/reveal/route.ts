import { NextResponse } from "next/server";
import { MockCollectorCryptAdapter } from "@/integrations/collector-crypt/mock";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { revealPartyCard } from "@/server/party-outcome";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    return NextResponse.json(await revealPartyCard(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      new MockCollectorCryptAdapter(),
    ));
  } catch (error) {
    return apiError(error);
  }
}
