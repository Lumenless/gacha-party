import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  decompileTransactionMessage,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type Transaction,
  type TransactionWithLifetime,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

let cachedSigner: Promise<KeyPairSigner> | undefined;

export async function getGachaOperatorSigner(): Promise<KeyPairSigner> {
  if (cachedSigner) return cachedSigner;
  cachedSigner = loadOperatorSigner();
  return cachedSigner;
}

async function loadOperatorSigner(): Promise<KeyPairSigner> {
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") {
    throw new Error("The custodial operator signer is restricted to Solana devnet.");
  }
  const configuredAddress = process.env.GACHA_OPERATOR_ADDRESS?.trim();
  const encodedSecret = process.env.GACHA_OPERATOR_SECRET_KEY?.trim();
  if (!configuredAddress || !encodedSecret) throw new Error("The devnet Gacha operator is not configured.");

  const secretBytes = decodeSecretKey(encodedSecret);
  const signer = await createKeyPairSignerFromBytes(secretBytes);
  if (signer.address !== address(configuredAddress)) {
    throw new Error("GACHA_OPERATOR_SECRET_KEY does not match GACHA_OPERATOR_ADDRESS.");
  }
  return signer;
}

export async function signCollectorCryptTransaction(transactionBase64: string): Promise<string> {
  const signer = await getGachaOperatorSigner();
  const transactionBytes = getBase64Encoder().encode(transactionBase64);
  const transaction = getTransactionDecoder().decode(transactionBytes) as Transaction & TransactionWithLifetime;
  const existingSignatures = cloneSignatures(transaction.signatures);
  if (!(signer.address in transaction.signatures)) {
    throw new Error("Collector Crypt transaction does not require the configured operator signature.");
  }
  if (!existingSignatures.some(([signerAddress, signature]) => signerAddress !== signer.address && signature)) {
    throw new Error("Collector Crypt transaction is missing its server-side signature.");
  }

  const signed = await partiallySignTransaction([signer.keyPair], transaction);
  for (const [signerAddress, signature] of existingSignatures) {
    if (!signature || signerAddress === signer.address) continue;
    const next = signed.signatures[signerAddress as Address];
    if (!next || !bytesEqual(signature, next)) {
      throw new Error("Signing changed an existing Collector Crypt transaction signature.");
    }
  }
  if (!signed.signatures[signer.address]) throw new Error("The operator transaction signature was not produced.");
  return getBase64Decoder().decode(getTransactionEncoder().encode(signed));
}

export async function validateCollectorCryptPurchaseTransaction(
  transactionBase64: string,
  expected: { memo: string; mint: string; amountBaseUnits: bigint },
): Promise<void> {
  if (expected.amountBaseUnits <= 0n) throw new Error("Collector Crypt purchase amount must be positive.");
  const operator = await getGachaOperatorSigner();
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(transactionBase64));
  const signatures = Object.entries(transaction.signatures);
  if (signatures.length !== 2 || transaction.signatures[operator.address] !== null) {
    throw new Error("Collector Crypt purchase must contain one unsigned operator and one signed server authority.");
  }
  const serverSigner = signatures.find(([signerAddress, signature]) => signerAddress !== operator.address && signature)?.[0];
  if (!serverSigner) throw new Error("Collector Crypt purchase is missing its server authority signature.");

  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const message = decompileTransactionMessage(compiled);
  if (message.version !== "legacy" || message.feePayer.address !== operator.address) {
    throw new Error("Collector Crypt purchase must be a legacy devnet transaction paid by the operator.");
  }
  const unexpectedProgram = message.instructions.find(({ programAddress }) =>
    ![COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, TOKEN_PROGRAM_ADDRESS].includes(programAddress),
  );
  if (unexpectedProgram) throw new Error(`Collector Crypt purchase contains unexpected program ${unexpectedProgram.programAddress}.`);

  const memoInstructions = message.instructions.filter(({ programAddress }) => programAddress === MEMO_PROGRAM);
  if (memoInstructions.length !== 1) throw new Error("Collector Crypt purchase must contain exactly one memo.");
  const memoInstruction = memoInstructions[0]!;
  if (new TextDecoder().decode(memoInstruction.data) !== `${expected.memo}:open`) {
    throw new Error("Collector Crypt purchase memo does not match the prepared operation.");
  }
  if (
    memoInstruction.accounts?.length !== 1 ||
    memoInstruction.accounts[0]?.address !== serverSigner ||
    memoInstruction.accounts[0]?.role !== AccountRole.READONLY_SIGNER
  ) {
    throw new Error("Collector Crypt purchase memo is not authorized by the signed server authority.");
  }

  const tokenInstructions = message.instructions.filter(({ programAddress }) => programAddress === TOKEN_PROGRAM_ADDRESS);
  if (tokenInstructions.length !== 1 || tokenInstructions[0]?.data?.[0] !== 12) {
    throw new Error("Collector Crypt purchase must contain only one checked token transfer.");
  }
  const transfer = tokenInstructions[0];
  if (!transfer.data || transfer.data.length !== 10 || !transfer.accounts || transfer.accounts.length !== 4) {
    throw new Error("Collector Crypt purchase contains a malformed token transfer.");
  }
  const amount = decodeLittleEndianU64(transfer.data.subarray(1, 9));
  if (amount !== expected.amountBaseUnits || transfer.data[9] !== 6) {
    throw new Error("Collector Crypt purchase token amount or decimals do not match the selected pack.");
  }
  if (transfer.accounts[1]?.address !== address(expected.mint)) {
    throw new Error("Collector Crypt purchase uses an unexpected token mint.");
  }
  if (
    transfer.accounts[0]?.role !== AccountRole.WRITABLE ||
    transfer.accounts[1]?.role !== AccountRole.READONLY ||
    transfer.accounts[2]?.role !== AccountRole.WRITABLE ||
    transfer.accounts[3]?.role !== AccountRole.WRITABLE_SIGNER
  ) {
    throw new Error("Collector Crypt purchase token accounts have unexpected permissions.");
  }
  const [operatorToken] = await findAssociatedTokenPda({
    owner: operator.address,
    mint: address(expected.mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  if (transfer.accounts[0]?.address !== operatorToken) {
    throw new Error("Collector Crypt purchase does not debit the operator's canonical token account.");
  }
  if (transfer.accounts[2]?.address === operatorToken || transfer.accounts[2]?.address === operator.address) {
    throw new Error("Collector Crypt purchase has an invalid destination token account.");
  }
  if (transfer.accounts[3]?.address !== operator.address) {
    throw new Error("Collector Crypt purchase token authority is not the configured operator.");
  }
}

function decodeSecretKey(value: string): Uint8Array {
  let decoded: Uint8Array;
  try { decoded = Uint8Array.from(getBase64Encoder().encode(value)); } catch { throw new Error("GACHA_OPERATOR_SECRET_KEY is not valid base64."); }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(decoded)); } catch {
    throw new Error("GACHA_OPERATOR_SECRET_KEY must be base64-encoded Solana keypair JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("GACHA_OPERATOR_SECRET_KEY must contain exactly 64 keypair bytes.");
  }
  return Uint8Array.from(parsed as number[]);
}

function cloneSignatures(signatures: Transaction["signatures"]): Array<[string, Uint8Array | null]> {
  return Object.entries(signatures).map(([signerAddress, signature]) => [
    signerAddress,
    signature ? Uint8Array.from(signature) : null,
  ]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function decodeLittleEndianU64(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) throw new Error("Expected an eight-byte unsigned integer.");
  return bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);
}

export function resetGachaOperatorForTests() {
  cachedSigner = undefined;
}
