import { address } from "@solana/kit";
import { Connection } from "@magicblock-labs/ephemeral-rollups-kit";
import type { VoteChoice } from "@/domain/party";
import {
  fetchMaybePrivateVote,
  GACHA_PARTY_ROOM_PROGRAM_ADDRESS,
  PrivateVoteChoice,
} from "@/integrations/solana/program-client/src/generated";
import { findPrivateVoteAddress } from "@/integrations/magicblock/private-vote-client";
import { encodeRoomId, SOLANA_DEVNET_URL } from "@/integrations/magicblock/router-client";

export type ReleasedPrivateVote = {
  address: string;
  choice: VoteChoice;
  castAt: bigint;
  revealAfter: bigint;
};

export interface ReleasedPrivateVoteReader {
  read(partyId: string, wallet: string, now?: number): Promise<ReleasedPrivateVote | null>;
}

let devnetConnection: Promise<Connection> | null = null;

function connection() {
  devnetConnection ??= Connection.create(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_DEVNET_URL);
  return devnetConnection;
}

function bytesEqual(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export class SolanaReleasedPrivateVoteReader implements ReleasedPrivateVoteReader {
  async read(partyId: string, wallet: string, now = Date.now()): Promise<ReleasedPrivateVote | null> {
    const privateVote = await findPrivateVoteAddress(wallet, partyId);
    const account = await fetchMaybePrivateVote((await connection()).rpc, privateVote, { commitment: "confirmed" });
    if (!account.exists || account.programAddress !== GACHA_PARTY_ROOM_PROGRAM_ADDRESS) return null;
    if (account.data.voter !== address(wallet) || !bytesEqual(account.data.partyId, encodeRoomId(partyId))) {
      throw new Error("The released private vote does not match this party member.");
    }
    if (BigInt(Math.floor(now / 1_000)) <= account.data.revealAfter) {
      throw new Error("The private vote is still inside its sealed voting window.");
    }
    const choice = account.data.choice === PrivateVoteChoice.Keep
      ? "KEEP"
      : account.data.choice === PrivateVoteChoice.Sell ? "SELL" : null;
    if (!choice || account.data.castAt <= 0n) {
      throw new Error("The released private vote does not contain a valid choice.");
    }
    return {
      address: privateVote,
      choice,
      castAt: account.data.castAt,
      revealAfter: account.data.revealAfter,
    };
  }
}
