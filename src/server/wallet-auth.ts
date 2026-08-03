import {
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { walletChallengeStore } from "./wallet-challenge-store";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const WALLET_SESSION_COOKIE = "gacha_party_session";

type SessionPayload = {
  wallet: string;
  expiresAt: number;
};

const globalAuth = globalThis as typeof globalThis & {
  __gachaPartySessionSecret?: Buffer;
};

const configuredSecret = process.env.AUTH_SESSION_SECRET;
const developmentSecret = globalAuth.__gachaPartySessionSecret ?? randomBytes(32);
globalAuth.__gachaPartySessionSecret = developmentSecret;

function getSessionSecret() {
  if (configuredSecret && configuredSecret.length >= 32) return Buffer.from(configuredSecret, "utf8");
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters in production.");
  }
  return developmentSecret;
}

const walletSchema = z.string().trim().refine((value) => {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}, "Enter a valid Solana wallet address.");

const verifySchema = z.object({
  wallet: walletSchema,
  signature: z.string().min(1).max(256),
  signedMessage: z.string().min(1).max(4096),
});

export class AuthenticationError extends Error {
  readonly status = 401;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie") ?? "";
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 1) return [];
    return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]];
  }));
}

export function walletModeEnabled() {
  return process.env.NEXT_PUBLIC_WALLET_MODE === "wallet";
}

export async function createWalletChallenge(rawWallet: unknown, origin: string) {
  const wallet = walletSchema.parse(rawWallet);
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = issuedAt.getTime() + CHALLENGE_TTL_MS;
  const message = [
    "Gacha Party wants you to sign in with your Solana account:",
    wallet,
    "",
    "Approve this signature to join collaborative party rooms. This does not send a transaction.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    `Chain ID: solana:${process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");

  await walletChallengeStore.put(wallet, { message, expiresAt });
  return { message, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyWalletChallenge(rawInput: unknown): Promise<SessionPayload> {
  const input = verifySchema.parse(rawInput);
  const challenge = await walletChallengeStore.consume(input.wallet);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    throw new AuthenticationError("The sign-in request expired. Try connecting again.");
  }

  const signedMessage = Buffer.from(input.signedMessage, "base64");
  const expectedMessage = Buffer.from(challenge.message, "utf8");
  if (signedMessage.length !== expectedMessage.length || !timingSafeEqual(signedMessage, expectedMessage)) {
    throw new AuthenticationError("The wallet signed an unexpected message.");
  }

  const publicKeyBytes = Buffer.from(bs58.decode(input.wallet));
  const signatureBytes = Buffer.from(input.signature, "base64");
  if (signatureBytes.length !== 64) throw new AuthenticationError("The wallet returned an invalid signature.");

  // RFC 8410 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]),
    format: "der",
    type: "spki",
  });
  if (!verify(null, signedMessage, publicKey, signatureBytes)) {
    throw new AuthenticationError("The wallet signature could not be verified.");
  }

  return { wallet: input.wallet, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
}

export function createSessionToken(session: SessionPayload) {
  const payload = base64Url(JSON.stringify(session));
  return `${payload}.${signPayload(payload)}`;
}

export function readWalletSession(request: Request): SessionPayload | null {
  const token = parseCookies(request)[WALLET_SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = signPayload(payload);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!walletSchema.safeParse(parsed.wallet).success || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function authenticatedActionBody(request: Request): Promise<unknown> {
  const body = await request.json();
  if (!walletModeEnabled()) return body;
  const session = readWalletSession(request);
  if (!session) throw new AuthenticationError("Connect and verify your wallet to continue.");
  if (!body || typeof body !== "object" || Array.isArray(body)) return { wallet: session.wallet };
  return { ...body, wallet: session.wallet };
}

export function requireRequestWallet(request: Request) {
  const session = readWalletSession(request);
  if (!session) throw new AuthenticationError("Connect and verify your wallet to continue.");
  return session.wallet;
}

export const walletSessionMaxAge = SESSION_TTL_SECONDS;
