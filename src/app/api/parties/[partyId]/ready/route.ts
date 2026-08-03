import { NextResponse } from "next/server";
import { realtimePartyAdapter } from "@/integrations/realtime/server";
import { apiError } from "@/server/api-response";
import { markPartyReady } from "@/server/party-room";
import { authenticatedActionBody } from "@/server/wallet-auth";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const { partyId } = await params;
    return NextResponse.json(await markPartyReady(partyId, await authenticatedActionBody(request), realtimePartyAdapter));
  } catch (error) {
    return apiError(error);
  }
}
