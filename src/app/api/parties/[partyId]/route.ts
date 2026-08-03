import { NextResponse } from "next/server";
import { partyRepository } from "@/server/party-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partyId: string }> },
) {
  const { partyId } = await params;
  const party = await partyRepository.get(partyId);
  return party
    ? NextResponse.json(party)
    : NextResponse.json({ error: "Party not found." }, { status: 404 });
}
