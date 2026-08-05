import { loadEnvFile } from "node:process";
import { createSolanaRpc, lamports } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import { RealCollectorCryptAdapter } from "../src/integrations/collector-crypt/real";
import { getGachaOperatorSigner, validateCollectorCryptPurchaseTransaction } from "../src/server/gacha-operator";

try { loadEnvFile(".env.local"); } catch { /* Vercel/CI may inject env directly. */ }

const DEVNET_USDC_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";

async function main() {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") throw new Error("NEXT_PUBLIC_SOLANA_CLUSTER must be devnet.");
  if (process.env.USDC_MINT !== DEVNET_USDC_MINT) throw new Error("USDC_MINT must be Collector Crypt's devnet USDC mint.");
  const rpcUrl = required("NEXT_PUBLIC_SOLANA_RPC_URL");
  const operator = await getGachaOperatorSigner();
  const rpc = createSolanaRpc(rpcUrl);
  const mint = address(DEVNET_USDC_MINT);
  const [operatorToken] = await findAssociatedTokenPda({ owner: operator.address, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [balance, tokenBalance] = await Promise.all([
    rpc.getBalance(operator.address, { commitment: "confirmed" }).send(),
    rpc.getTokenAccountBalance(operatorToken, { commitment: "confirmed" }).send().catch(() => null),
  ]);

  const adapter = new RealCollectorCryptAdapter({
    apiKey: process.env.COLLECTOR_CRYPT_API_KEY,
    baseUrl: process.env.COLLECTOR_CRYPT_API_BASE_URL,
  });
  const packs = await adapter.listPacks();
  const openPacks = packs.filter((pack) => pack.isOpen);
  if (openPacks.length === 0) throw new Error("Collector Crypt reports no open public devnet packs.");

  console.log(`Collector Crypt devnet is reachable: ${openPacks.length}/${packs.length} public packs open.`);
  console.log(`Operator: ${operator.address}`);
  console.log(`Operator SOL: ${formatLamports(balance.value)}`);
  console.log(`Operator devnet USDC: ${tokenBalance?.value.uiAmountString ?? "0"}`);
  console.log(`Open packs: ${openPacks.map((pack) => `${pack.code} (${formatUsdc(pack.priceBaseUnits)} USDC)`).join(", ")}`);

  const prepareIndex = process.argv.indexOf("--prepare");
  if (prepareIndex < 0) {
    console.log("Read-only check complete. Use --prepare <pack-code> to validate an unsigned purchase without signing or submitting it.");
    return;
  }
  const packCode = process.argv[prepareIndex + 1];
  const pack = openPacks.find((candidate) => candidate.code === packCode);
  if (!pack) throw new Error(`Pack ${packCode || "<missing>"} is not currently open.`);
  const prepared = await adapter.preparePurchase({
    playerAddress: operator.address,
    cardRecipient: operator.address,
    packCode: pack.code,
  });
  await validateCollectorCryptPurchaseTransaction(prepared.transactionBase64, {
    memo: prepared.memo,
    mint,
    amountBaseUnits: pack.priceBaseUnits,
  });
  console.log(`Unsigned ${pack.code} purchase passed strict validation. It was not signed or submitted.`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function formatLamports(value: ReturnType<typeof lamports>): string {
  return `${(Number(value) / 1_000_000_000).toFixed(4)} SOL`;
}

function formatUsdc(value: bigint): string {
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
