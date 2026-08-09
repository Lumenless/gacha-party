import { NextResponse } from "next/server";
import { MockCardCustodyAdapter } from "@/integrations/card-custody/mock";
import { OperatorCardCustodyAdapter } from "@/integrations/card-custody/operator";
import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { decideSoloParty } from "@/server/party-outcome";
import { executeRealSellSettlement } from "@/server/real-settlement";
import { markPartyEscrowSettled } from "@/server/operator-escrow";
import { authenticatedActionBody } from "@/server/wallet-auth";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const realMode = getCollectorCryptMode() === "real";
    return NextResponse.json(await decideSoloParty(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
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
