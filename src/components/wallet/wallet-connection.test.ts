import { describe, expect, it } from "vitest";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { SolanaSignMessage, SolanaSignTransaction } from "@solana/wallet-standard-features";
import { isLiveWalletConnection } from "./wallet-connection";

const account = {
  features: [SolanaSignMessage, SolanaSignTransaction],
} as unknown as WalletAccount;

const wallet = {
  features: {
    [SolanaSignMessage]: {},
    [SolanaSignTransaction]: { supportedTransactionVersions: [0] },
  },
} as unknown as Wallet;

describe("isLiveWalletConnection", () => {
  it("treats a remembered session without a live wallet account as disconnected", () => {
    expect(isLiveWalletConnection(null, null)).toBe(false);
    expect(isLiveWalletConnection(wallet, null)).toBe(false);
  });

  it("requires an account that can sign versioned Solana transactions", () => {
    expect(isLiveWalletConnection(wallet, account)).toBe(true);
    expect(isLiveWalletConnection(wallet, { ...account, features: [SolanaSignMessage] })).toBe(false);
  });
});
