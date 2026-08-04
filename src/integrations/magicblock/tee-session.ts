import { address } from "@solana/kit";
import { getAuthToken, verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-kit";

export const MAGICBLOCK_DEVNET_TEE_URL = "https://devnet-tee.magicblock.app";

export type TeeSession = {
  endpoint: string;
  expiresAt: number;
  integrityVerified: true;
};

type TeeSessionDependencies = {
  verifyIntegrity: typeof verifyTeeRpcIntegrity;
  authenticate: typeof getAuthToken;
};

function normalizedTeeEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Private ER requires an HTTPS TEE endpoint.");
  if (url.search || url.hash) throw new Error("Configure the base TEE endpoint without query parameters.");
  return url.toString().replace(/\/$/, "");
}

export async function createVerifiedTeeSession(
  endpoint: string,
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  dependencies: TeeSessionDependencies = {
    verifyIntegrity: verifyTeeRpcIntegrity,
    authenticate: getAuthToken,
  },
): Promise<TeeSession> {
  const baseEndpoint = normalizedTeeEndpoint(endpoint);
  await dependencies.verifyIntegrity(baseEndpoint);
  const { token, expiresAt } = await dependencies.authenticate(baseEndpoint, address(wallet), signMessage);
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("MagicBlock returned an invalid TEE authorization session.");
  }
  const authenticated = new URL(baseEndpoint);
  authenticated.searchParams.set("token", token);
  return {
    endpoint: authenticated.toString(),
    expiresAt,
    integrityVerified: true,
  };
}
