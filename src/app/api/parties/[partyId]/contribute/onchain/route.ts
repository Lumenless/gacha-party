import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { syncVerifiedOnchainContributions } from "@/server/onchain-escrow";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    return NextResponse.json(await syncVerifiedOnchainContributions(
      partyId,
      await authenticatedActionBody(request),
      realtimePartyAdapter,
    ));
  } catch (error) {
    return apiError(error);
  }
}
