import type { Party } from "@/domain/party";
import { walletActionSchema } from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { DevnetEscrowClient } from "@/integrations/solana/escrow-client";
import { partyRepository } from "./party-repository";
import { syncOnchainContributions } from "./party-room";

let clientPromise: Promise<DevnetEscrowClient> | null = null;
let clientMint: string | null = null;

function realFundsEnabled() {
  const enabled = process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  if (enabled && process.env.NEXT_PUBLIC_WALLET_MODE !== "wallet") {
    throw new Error("Real funding requires verified wallet mode.");
  }
  return enabled;
}

function verifiedMint() {
  const serverMint = process.env.USDC_MINT?.trim();
  const publicMint = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
  if (!serverMint || !publicMint) throw new Error("Real funding is missing its verified devnet mint configuration.");
  if (serverMint !== publicMint) throw new Error("Public and server token mint configuration do not match.");
  return serverMint;
}

function escrowClient() {
  const mint = verifiedMint();
  if (!clientPromise || clientMint !== mint) {
    clientMint = mint;
    clientPromise = DevnetEscrowClient.create({ mint });
  }
  return clientPromise;
}

async function requireParty(partyId: string) {
  const party = await partyRepository.get(partyId);
  if (!party) throw new Error("Party not found.");
  return party;
}

async function verifiedEscrow(party: Party) {
  const client = await escrowClient();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) return null;
  if (String(escrow.host) !== party.hostWallet) throw new Error("The escrow host does not match this party.");
  if (String(escrow.mint) !== verifiedMint()) throw new Error("The escrow mint does not match this deployment.");
  if (escrow.fundingTarget !== BigInt(party.fundingTargetBaseUnits)) {
    throw new Error("The escrow funding target does not match this party.");
  }
  const roster = escrow.participants.slice(0, escrow.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet }) => wallet);
  if (roster.length !== partyRoster.length || roster.some((wallet, index) => wallet !== partyRoster[index])) {
    throw new Error("The escrow roster does not match this party.");
  }
  return { client, escrow, roster };
}

export async function assertEscrowAllowsJoin(partyId: string) {
  if (!realFundsEnabled()) return;
  const party = await requireParty(partyId);
  if (await verifiedEscrow(party)) {
    throw new Error("The on-chain funding roster is already locked. This party cannot accept more players.");
  }
}

export async function syncVerifiedOnchainContributions(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
) {
  if (!realFundsEnabled()) throw new Error("Real on-chain funding is not enabled.");
  const input = walletActionSchema.parse(rawInput);
  const party = await requireParty(partyId);
  if (!party.participants.some(({ wallet }) => wallet === input.wallet)) {
    throw new Error("Only an escrow participant can synchronize funding.");
  }
  const verified = await verifiedEscrow(party);
  if (!verified) throw new Error("The host must initialize the on-chain escrow first.");

  const receipts = await Promise.all(verified.roster.map(async (wallet) => ({
    wallet,
    receipt: await verified.client.fetchReceipt(party.hostWallet, party.id, wallet),
  })));
  const amounts = new Map<string, bigint>();
  for (const { wallet, receipt } of receipts) {
    if (!receipt) {
      amounts.set(wallet, 0n);
      continue;
    }
    if (String(receipt.escrow) !== String(verified.escrow.address) || String(receipt.contributor) !== wallet) {
      throw new Error("A contribution receipt does not match its escrow participant.");
    }
    amounts.set(wallet, receipt.amount);
  }

  return syncOnchainContributions(
    partyId,
    amounts,
    verified.escrow.totalContributed,
    verified.escrow.fundingTarget,
    verified.roster,
    realtime,
  );
}
