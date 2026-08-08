import type { Party } from "@/domain/party";
import {
  decodeRoomId,
  findRoomAddress,
  MagicRouterRoomClient,
} from "@/integrations/magicblock/router-client";
import { partyRepository } from "./party-repository";

export type ResolvedPartyRoute = {
  party: Party;
  roomAddress: string | null;
};

let roomClientPromise: Promise<MagicRouterRoomClient> | null = null;

function roomClient() {
  roomClientPromise ??= MagicRouterRoomClient.create();
  return roomClientPromise;
}

function onchainRoomUrlsEnabled() {
  return process.env.NEXT_PUBLIC_ROOM_STATE_MODE === "magicblock";
}

export async function resolvePartyRoute(routeKey: string): Promise<ResolvedPartyRoute | null> {
  const partyById = await partyRepository.get(routeKey);
  if (partyById) {
    return {
      party: partyById,
      roomAddress: onchainRoomUrlsEnabled()
        ? String(await findRoomAddress(partyById.hostWallet, partyById.id))
        : null,
    };
  }

  if (!onchainRoomUrlsEnabled()) return null;

  try {
    const partyByAddress = await partyRepository.getByRoomAddress(routeKey);
    if (partyByAddress) {
      const expectedAddress = String(await findRoomAddress(partyByAddress.hostWallet, partyByAddress.id));
      return expectedAddress === routeKey ? { party: partyByAddress, roomAddress: expectedAddress } : null;
    }

    const room = await (await roomClient()).fetchRoomAtAddress(routeKey);
    if (!room) return null;

    const partyId = decodeRoomId(room.roomId);
    const party = await partyRepository.get(partyId);
    if (!party || party.hostWallet !== room.host) return null;

    const expectedAddress = String(await findRoomAddress(party.hostWallet, party.id));
    if (expectedAddress !== routeKey) return null;

    return { party, roomAddress: expectedAddress };
  } catch {
    return null;
  }
}
