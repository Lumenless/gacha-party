import { notFound, redirect } from "next/navigation";
import { resolvePartyRoute } from "@/server/party-route";
import { RoomClient } from "./room-client";

export const dynamic = "force-dynamic";

export default async function PartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<{ host?: string }>;
}) {
  const { partyId } = await params;
  const resolved = await resolvePartyRoute(partyId);
  if (!resolved) notFound();
  if (resolved.roomAddress && partyId !== resolved.roomAddress) {
    const query = (await searchParams).host === "1" ? "?host=1" : "";
    redirect(`/party/${resolved.roomAddress}${query}`);
  }
  return <RoomClient initialParty={resolved.party} />;
}
