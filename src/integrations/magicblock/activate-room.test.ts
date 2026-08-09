import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateMagicBlockRoom, roomActivationError } from "./activate-room";

const mocks = vi.hoisted(() => ({
  fetchRoom: vi.fn(),
  prepareInitializeAndDelegation: vi.fn(),
  simulateTransaction: vi.fn(),
  submitSignedTransaction: vi.fn(),
  fetchEscrow: vi.fn(),
  buildInitializeInstruction: vi.fn(),
}));

vi.mock("./router-client", () => ({
  MagicRouterRoomClient: {
    create: vi.fn(async () => mocks),
  },
}));

vi.mock("@/integrations/solana/escrow-client", () => ({
  DevnetEscrowClient: {
    create: vi.fn(async () => mocks),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRoom.mockResolvedValue(null);
  mocks.fetchEscrow.mockResolvedValue(null);
  mocks.buildInitializeInstruction.mockResolvedValue({ programAddress: "escrow-program", accounts: [], data: new Uint8Array() });
  mocks.prepareInitializeAndDelegation.mockResolvedValue({
    action: "initialize",
    roomAddress: "room",
    transaction: new Uint8Array([1, 2, 3]),
  });
  mocks.simulateTransaction.mockResolvedValue(10n);
  mocks.submitSignedTransaction.mockImplementation(async (_transaction, onSubmitted?: (signature: string) => void) => {
    onSubmitted?.("confirmed-signature");
    return "confirmed-signature";
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("new party MagicBlock activation", () => {
  it("simulates before wallet signing and submits the signed transaction", async () => {
    const stages: string[] = [];
    const signTransaction = vi.fn(async () => new Uint8Array([4, 5, 6]));

    const signature = await activateMagicBlockRoom({
      hostWallet: "host",
      partyId: "12345678",
      maxPlayers: 2,
      fundingTargetBaseUnits: "50000000",
      fundingDeadline: "2026-08-09T00:00:00.000Z",
      signTransaction,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["preparing", "simulating", "signing", "submitting", "confirming"]);
    expect(mocks.simulateTransaction).toHaveBeenCalledBefore(signTransaction);
    expect(signTransaction).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(mocks.submitSignedTransaction).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]), expect.any(Function));
    expect(signature).toBe("confirmed-signature");
  });

  it("does not request another signature when the room already exists", async () => {
    mocks.fetchRoom.mockResolvedValue({ address: "room" });
    const signTransaction = vi.fn();

    await expect(activateMagicBlockRoom({
      hostWallet: "host",
      partyId: "12345678",
      maxPlayers: 2,
      fundingTargetBaseUnits: "50000000",
      fundingDeadline: "2026-08-09T00:00:00.000Z",
      signTransaction,
    })).resolves.toBeNull();

    expect(signTransaction).not.toHaveBeenCalled();
    expect(mocks.prepareInitializeAndDelegation).not.toHaveBeenCalled();
  });

  it("adds escrow initialization to the host's room activation transaction in real funds mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_FUNDS_MODE", "solana");
    vi.stubEnv("NEXT_PUBLIC_USDC_MINT", "mint");
    vi.stubEnv("NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS", "operator");

    await activateMagicBlockRoom({
      hostWallet: "host",
      partyId: "12345678",
      maxPlayers: 3,
      fundingTargetBaseUnits: "75000000",
      fundingDeadline: "2026-08-09T00:00:00.000Z",
      signTransaction: async () => new Uint8Array([4, 5, 6]),
    });

    expect(mocks.buildInitializeInstruction).toHaveBeenCalledWith("host", "12345678", 75_000_000n, 1_786_233_600n, 3);
    expect(mocks.prepareInitializeAndDelegation).toHaveBeenCalledWith(
      "host",
      "12345678",
      3,
      "operator",
      [expect.objectContaining({ programAddress: "escrow-program" })],
    );
  });

  it("turns wallet cancellation into a recoverable message", () => {
    expect(roomActivationError(new Error("User rejected the request"))).toContain("invite is saved");
  });
});
