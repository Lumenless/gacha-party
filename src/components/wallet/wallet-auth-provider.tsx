"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getWallets } from "@wallet-standard/app";
import {
  StandardConnect,
  StandardDisconnect,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from "@wallet-standard/features";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";

type WalletStatus = "idle" | "connecting" | "signing" | "authenticated" | "error";

type WalletAuthContextValue = {
  enabled: boolean;
  wallets: readonly Wallet[];
  walletAddress: string | null;
  status: WalletStatus;
  error: string | null;
  canSignTransactions: boolean;
  connect: (wallet: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
};

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null);
const selectedWalletKey = "gacha-party-wallet-standard-name";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function supportsAuthentication(wallet: Wallet): wallet is Wallet & {
  features: StandardConnectFeature & SolanaSignMessageFeature & Partial<StandardDisconnectFeature>;
} {
  return StandardConnect in wallet.features && SolanaSignMessage in wallet.features;
}

function solanaAccount(accounts: readonly WalletAccount[]) {
  return accounts.find((account) =>
    account.chains.some((chain) => chain.startsWith("solana:")) &&
    account.features.includes(SolanaSignMessage),
  );
}

export function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_WALLET_MODE === "wallet";
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<Wallet | null>(null);
  const [activeAccount, setActiveAccount] = useState<WalletAccount | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(supportsAuthentication));
    refresh();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);

    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ wallet: string | null }>)
      .then((session) => {
        if (session.wallet) {
          setWalletAddress(session.wallet);
          setStatus("authenticated");
        }
      })
      .catch(() => undefined);

    return () => {
      offRegister();
      offUnregister();
    };
  }, [enabled]);

  const connect = useCallback(async (wallet: Wallet) => {
    if (!supportsAuthentication(wallet)) {
      setError("This wallet does not support message signing.");
      setStatus("error");
      return;
    }
    setStatus("connecting");
    setError(null);
    try {
      const connected = await wallet.features[StandardConnect].connect();
      const account = solanaAccount(connected.accounts);
      if (!account) throw new Error("Choose a Solana account that supports message signing.");

      setStatus("signing");
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: account.address }),
      });
      const challenge = await challengeResponse.json() as { message?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message) {
        throw new Error(challenge.error ?? "Could not create a wallet sign-in request.");
      }

      const [signed] = await wallet.features[SolanaSignMessage].signMessage({
        account,
        message: new TextEncoder().encode(challenge.message),
      });
      if (!signed) throw new Error("The wallet did not return a signature.");

      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: account.address,
          signature: toBase64(signed.signature),
          signedMessage: toBase64(signed.signedMessage),
        }),
      });
      const session = await verifyResponse.json() as { wallet?: string; error?: string };
      if (!verifyResponse.ok || !session.wallet) {
        throw new Error(session.error ?? "The wallet signature could not be verified.");
      }

      localStorage.setItem(selectedWalletKey, wallet.name);
      setActiveWallet(wallet);
      setActiveAccount(account);
      setWalletAddress(session.wallet);
      setStatus("authenticated");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    if (activeWallet && StandardDisconnect in activeWallet.features) {
      const feature = activeWallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect];
      await feature.disconnect().catch(() => undefined);
    }
    localStorage.removeItem(selectedWalletKey);
    setActiveWallet(null);
    setActiveAccount(null);
    setWalletAddress(null);
    setError(null);
    setStatus("idle");
  }, [activeWallet]);

  const signTransaction = useCallback(async (transaction: Uint8Array) => {
    if (!activeWallet || !activeAccount || !(SolanaSignTransaction in activeWallet.features)) {
      throw new Error("Reconnect a wallet that supports transaction signing.");
    }
    if (!activeAccount.features.includes(SolanaSignTransaction)) {
      throw new Error("The selected Solana account cannot sign transactions.");
    }
    const feature = activeWallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
    if (!feature.supportedTransactionVersions.includes(0)) {
      throw new Error("The selected wallet does not support versioned Solana transactions.");
    }
    const [result] = await feature.signTransaction({
      account: activeAccount,
      chain: "solana:devnet",
      transaction,
    });
    if (!result) throw new Error("The wallet did not return a signed transaction.");
    return new Uint8Array(result.signedTransaction);
  }, [activeAccount, activeWallet]);

  const signMessage = useCallback(async (message: Uint8Array) => {
    if (!activeWallet || !activeAccount || !(SolanaSignMessage in activeWallet.features)) {
      throw new Error("Reconnect a wallet that supports message signing.");
    }
    const feature = activeWallet.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage];
    const [result] = await feature.signMessage({
      account: activeAccount,
      message,
    });
    if (!result) throw new Error("The wallet did not return a message signature.");
    if (result.signedMessage.length !== message.length || result.signedMessage.some((byte, index) => byte !== message[index])) {
      throw new Error("The wallet signed an unexpected message.");
    }
    return new Uint8Array(result.signature);
  }, [activeAccount, activeWallet]);

  const value = useMemo(() => ({
    enabled,
    wallets,
    walletAddress,
    status,
    error,
    canSignTransactions: Boolean(activeWallet && activeAccount && SolanaSignTransaction in activeWallet.features),
    connect,
    disconnect,
    signMessage,
    signTransaction,
  }), [activeAccount, activeWallet, connect, disconnect, enabled, error, signMessage, signTransaction, status, walletAddress, wallets]);

  return <WalletAuthContext.Provider value={value}>{children}</WalletAuthContext.Provider>;
}

export function useWalletAuth() {
  const value = useContext(WalletAuthContext);
  if (!value) throw new Error("useWalletAuth must be used inside WalletAuthProvider.");
  return value;
}
