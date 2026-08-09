import { NextResponse } from "next/server";
import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { sellHeldPartyCard } from "@/server/party-outcome";
import { executeRealSellSettlement } from "@/server/real-settlement";
import { authenticatedActionBody } from "@/server/wallet-auth";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const realMode = getCollectorCryptMode() === "real";
    return NextResponse.json(await sellHeldPartyCard(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      collectorCryptAdapter(),
      realMode
        ? (party, collector) => executeRealSellSettlement(
            party,
            collector,
            { allowAlreadySettledKeepRecovery: true },
          )
        : undefined,
    ));
  } catch (error) {
    return apiError(error);
  }
}
