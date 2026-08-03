import { notFound } from "next/navigation";
import { partyRepository } from "@/server/party-repository";
import { RoomClient } from "./room-client";

export const dynamic = "force-dynamic";

export default async function PartyPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  const party = await partyRepository.get(partyId);
  if (!party) notFound();
  return <RoomClient initialParty={party} />;
}
