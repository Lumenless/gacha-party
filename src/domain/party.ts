import { z } from "zod";

export const partyStatuses = [
  "DRAFT",
  "FUNDING",
  "FUNDED",
  "READY",
  "OPENING",
  "REVEALED",
  "VOTING",
  "SETTLING",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type PartyStatus = (typeof partyStatuses)[number];

const transitions: Readonly<Record<PartyStatus, readonly PartyStatus[]>> = {
  DRAFT: ["FUNDING", "CANCELLED"],
  FUNDING: ["FUNDED", "CANCELLED", "EXPIRED"],
  FUNDED: ["FUNDING", "READY", "CANCELLED", "EXPIRED"],
  READY: ["OPENING", "CANCELLED"],
  OPENING: ["REVEALED", "CANCELLED"],
  REVEALED: ["VOTING"],
  VOTING: ["SETTLING"],
  SETTLING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: PartyStatus, to: PartyStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionParty(from: PartyStatus, to: PartyStatus): PartyStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid party transition: ${from} -> ${to}`);
  }
  return to;
}

export const MIN_PARTY_PLAYERS = 2;
export const MAX_PARTY_PLAYERS = 10;

export const createPartySchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(40),
  packCode: z.string().trim().min(1),
  fundingTarget: z.string().trim().min(1),
  fundingDeadline: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Choose a valid funding deadline.",
  ),
  decisionRule: z.literal("SIMPLE_MAJORITY"),
});

export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const joinPartySchema = z.object({
  wallet: z.string().trim().min(12).max(64),
  displayName: z.string().trim().min(2, "Use at least 2 characters.").max(24),
});

export const contributeSchema = z.object({
  wallet: z.string().trim().min(12).max(64),
  amount: z.string().trim().min(1),
});

export const walletActionSchema = z.object({
  wallet: z.string().trim().min(12).max(64),
});

export const onchainContributionSyncSchema = walletActionSchema.extend({
  displayName: z.string().trim().min(2).max(24).optional(),
});

export const voteCommitSchema = walletActionSchema.extend({
  commitment: z.string().regex(/^[a-f0-9]{64}$/, "Invalid vote commitment."),
});

export const voteRevealSchema = walletActionSchema.extend({
  vote: z.enum(["KEEP", "SELL"]),
  nonce: z.string().min(16).max(128),
});

export type VoteChoice = "KEEP" | "SELL";

export type PartyActivity = {
  id: string;
  kind: "CREATED" | "JOINED" | "CONTRIBUTED" | "READY" | "COUNTDOWN" | "REVEALED" | "VOTE" | "SETTLED" | "EXPIRED" | "CANCELLED";
  message: string;
  createdAt: string;
};

export type Party = {
  id: string;
  roomAddress?: string;
  name: string;
  hostWallet: string;
  packCode: string;
  packName: string;
  packImageUrl: string;
  maxPlayers: number;
  fundingTargetBaseUnits: string;
  fundingDeadline: string;
  decisionRule: "SIMPLE_MAJORITY";
  status: PartyStatus;
  createdAt: string;
  revision: number;
  executionMode?: "MOCK" | "DEVNET";
  openingStartedAt?: string;
  countdownEndsAt?: string;
  reveal?: {
    memo: string;
    mint: string;
    name: string;
    imageUrl: string;
    rarity: "Common" | "Uncommon" | "Rare" | "Epic";
    grade: string;
    insuredValueBaseUnits: string;
  };
  voting?: {
    phase: "COMMIT" | "REVEAL" | "COMPLETE";
    deadline: string;
    commitCount: number;
    revealCount: number;
    result?: {
      keep: number;
      sell: number;
      outcome: VoteChoice;
    };
  };
  settlement?: {
    mode: "KEEP" | "SELL";
    idempotencyKey: string;
    completedAt: string;
    proceedsBaseUnits?: string;
    vaultAddress?: string;
    buybackSignature?: string;
    payoutSignature?: string;
    shares?: Array<{
      wallet: string;
      displayName: string;
      contributionBaseUnits: string;
      proceedsBaseUnits: string;
    }>;
  };
  activity: PartyActivity[];
  participants: Array<{
    wallet: string;
    displayName: string;
    contributionBaseUnits: string;
    ready: boolean;
  }>;
};
