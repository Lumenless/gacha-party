import { NextResponse } from "next/server";
import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { revealPartyCard } from "@/server/party-outcome";
import { authenticatedActionBody } from "@/server/wallet-auth";
import { executeRealCollectorOpening } from "@/server/collector-opening";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    const collectorCrypt = collectorCryptAdapter();
    return NextResponse.json(await revealPartyCard(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
      collectorCrypt,
      Date.now(),
      getCollectorCryptMode() === "real" ? executeRealCollectorOpening : undefined,
    ));
  } catch (error) {
    return apiError(error);
  }
}
