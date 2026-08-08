import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateMagicBlockRoom, roomActivationError } from "./activate-room";

const mocks = vi.hoisted(() => ({
  fetchRoom: vi.fn(),
  prepareInitializeAndDelegation: vi.fn(),
  simulateTransaction: vi.fn(),
  submitSignedTransaction: vi.fn(),
}));

vi.mock("./router-client", () => ({
  MagicRouterRoomClient: {
    create: vi.fn(async () => mocks),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRoom.mockResolvedValue(null);
  mocks.prepareInitializeAndDelegation.mockResolvedValue({
    action: "initialize",
    roomAddress: "room",
    transaction: new Uint8Array([1, 2, 3]),
  });
  mocks.simulateTransaction.mockResolvedValue(10n);
  mocks.submitSignedTransaction.mockResolvedValue("confirmed-signature");
});

describe("new party MagicBlock activation", () => {
  it("simulates before wallet signing and submits the signed transaction", async () => {
    const stages: string[] = [];
    const signTransaction = vi.fn(async () => new Uint8Array([4, 5, 6]));

    const signature = await activateMagicBlockRoom({
      hostWallet: "host",
      partyId: "12345678",
      maxPlayers: 2,
      signTransaction,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["preparing", "simulating", "signing", "submitting"]);
    expect(mocks.simulateTransaction).toHaveBeenCalledBefore(signTransaction);
    expect(signTransaction).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(mocks.submitSignedTransaction).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]));
    expect(signature).toBe("confirmed-signature");
  });

  it("does not request another signature when the room already exists", async () => {
    mocks.fetchRoom.mockResolvedValue({ address: "room" });
    const signTransaction = vi.fn();

    await expect(activateMagicBlockRoom({
      hostWallet: "host",
      partyId: "12345678",
      maxPlayers: 2,
      signTransaction,
    })).resolves.toBeNull();

    expect(signTransaction).not.toHaveBeenCalled();
    expect(mocks.prepareInitializeAndDelegation).not.toHaveBeenCalled();
  });

  it("turns wallet cancellation into a recoverable message", () => {
    expect(roomActivationError(new Error("User rejected the request"))).toContain("invite is saved");
  });
});
