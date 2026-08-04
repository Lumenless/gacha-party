import {
  address,
  createKeyPairSignerFromBytes,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type Transaction,
  type TransactionWithLifetime,
} from "@solana/kit";

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

export function resetGachaOperatorForTests() {
  cachedSigner = undefined;
}
