import type { Party } from "@/domain/party";
import { onchainContributionSyncSchema } from "@/domain/party";
import type { RealtimePartyAdapter } from "@/integrations/contracts";
import { DevnetEscrowClient } from "@/integrations/solana/escrow-client";
import { CURRENT_ESCROW_ACCOUNT_VERSION } from "@/integrations/solana/program-versions";
import { EscrowStatus } from "@/integrations/solana/program-client/src/generated";
import { partyRepository } from "./party-repository";
import { joinParty, syncOnchainContributions } from "./party-room";
import { assertMagicBlockJoin, registerVerifiedMagicBlockParticipant } from "./onchain-room";
import { registerPartyEscrowParticipant } from "./operator-escrow";

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

async function verifiedEscrow(party: Party, allowPendingDepositors = false) {
  const client = await escrowClient();
  const escrow = await client.fetchEscrow(party.hostWallet, party.id);
  if (!escrow) return null;
  if (escrow.version !== CURRENT_ESCROW_ACCOUNT_VERSION) {
    throw new Error("This escrow predates the current ten-player layout. Create a new demo party.");
  }
  if (String(escrow.host) !== party.hostWallet) throw new Error("The escrow host does not match this party.");
  if (String(escrow.mint) !== verifiedMint()) throw new Error("The escrow mint does not match this deployment.");
  if (String(escrow.operator) !== process.env.GACHA_OPERATOR_ADDRESS?.trim()) {
    throw new Error("The escrow operator does not match this deployment.");
  }
  if (escrow.fundingTarget !== BigInt(party.fundingTargetBaseUnits)) {
    throw new Error("The escrow funding target does not match this party.");
  }
  if (escrow.maxPlayers !== party.maxPlayers) throw new Error("The escrow player limit does not match this party.");
  const roster = escrow.participants.slice(0, escrow.participantCount).map(String);
  const partyRoster = party.participants.map(({ wallet }) => wallet);
  const partyRosterMatchesPrefix = partyRoster.every((wallet, index) => roster[index] === wallet);
  if (!partyRosterMatchesPrefix || (!allowPendingDepositors && roster.length !== partyRoster.length)) {
    throw new Error("The escrow roster does not match this party.");
  }
  return { client, escrow, roster };
}

export async function assertPartyEscrowLocked(partyId: string) {
  if (!realFundsEnabled()) return;
  const party = await requireParty(partyId);
  const verified = await verifiedEscrow(party);
  if (!verified) throw new Error("The host must initialize the onchain escrow first.");
  if (verified.escrow.status !== EscrowStatus.Locked) {
    throw new Error("The fully funded escrow must be locked before starting the countdown.");
  }
}

export async function registerVerifiedEscrowParticipant(partyId: string, wallet: string) {
  if (!realFundsEnabled()) return;
  const party = await requireParty(partyId);
  if (Date.now() > new Date(party.fundingDeadline).getTime()) {
    throw new Error("The funding deadline has passed. This party is no longer accepting players.");
  }
  if (party.participants.some(({ wallet: existing }) => existing === wallet)) {
    throw new Error("This wallet has already joined the party.");
  }
  await assertMagicBlockJoin(partyId, wallet);
  await registerPartyEscrowParticipant(party, wallet);
}

export async function syncVerifiedOnchainContributions(
  partyId: string,
  rawInput: unknown,
  realtime: RealtimePartyAdapter,
) {
  if (!realFundsEnabled()) throw new Error("Real onchain funding is not enabled.");
  const input = onchainContributionSyncSchema.parse(rawInput);
  let party = await requireParty(partyId);
  let verified = await verifiedEscrow(party, true);
  if (!verified) throw new Error("The host must initialize the onchain escrow first.");

  if (!verified.roster.includes(input.wallet)) {
    throw new Error("Only a verified escrow participant can synchronize funding.");
  }

  const pendingWallets = verified.roster.slice(party.participants.length);
  for (const wallet of pendingWallets) {
    const receipt = await verified.client.fetchReceipt(party.hostWallet, party.id, wallet);
    if (!receipt || receipt.amount < 1_000_000n) {
      throw new Error("A pending participant does not have a valid one-USDC deposit receipt.");
    }
    await registerVerifiedMagicBlockParticipant(partyId, wallet);
    party = await joinParty(partyId, {
      wallet,
      displayName: wallet === input.wallet && input.displayName
        ? input.displayName
        : `Player ${wallet.slice(0, 4)}`,
    }, realtime);
  }

  verified = await verifiedEscrow(party);
  if (!verified) throw new Error("The party escrow disappeared during synchronization.");

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
    verified.escrow.status === EscrowStatus.Cancelled,
    new Date(Number(verified.escrow.fundingDeadline) * 1_000).toISOString(),
    verified.escrow.lockedAt > 0n,
  );
}
