import { comparePartySummaries, partyUpdatedAt, type PartySummary } from "@/domain/party-summary";
import { findRoomAddress } from "@/integrations/magicblock/router-client";
import { partyRepository } from "./party-repository";

export async function listWalletParties(wallet: string): Promise<PartySummary[]> {
  const parties = await partyRepository.listByWallet(wallet);
  const summaries = await Promise.all(parties.map(async (party): Promise<PartySummary> => ({
    id: party.id,
    roomAddress: party.roomAddress ?? (process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock"
      ? String(await findRoomAddress(party.hostWallet, party.id))
      : null),
    name: party.name,
    packName: party.packName,
    packImageUrl: party.packImageUrl,
    status: party.status,
    updatedAt: partyUpdatedAt(party),
    participantCount: party.participants.length,
    maxPlayers: party.maxPlayers,
    fundedBaseUnits: party.participants
      .reduce((total, participant) => total + BigInt(participant.contributionBaseUnits), 0n)
      .toString(),
    fundingTargetBaseUnits: party.fundingTargetBaseUnits,
    isHost: party.hostWallet === wallet,
  })));
  return summaries.sort(comparePartySummaries);
}
