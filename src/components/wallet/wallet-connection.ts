import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";

export function isLiveWalletConnection(wallet: Wallet | null, account: WalletAccount | null) {
  if (!wallet || !account) return false;
  if (!(SolanaSignMessage in wallet.features) || !(SolanaSignTransaction in wallet.features)) return false;
  if (!account.features.includes(SolanaSignMessage) || !account.features.includes(SolanaSignTransaction)) return false;
  const feature = wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
  return feature.supportedTransactionVersions.includes(0);
}
