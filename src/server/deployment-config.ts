import bs58 from "bs58";

type Env = Record<string, string | undefined>;
const COLLECTOR_CRYPT_DEVNET_USDC_MINT = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";

function validAddress(value: string | undefined) {
  if (!value) return false;
  try { return bs58.decode(value).length === 32; } catch { return false; }
}

function validHttpsUrl(value: string | undefined) {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function deploymentConfigIssues(env: Env = process.env): string[] {
  const issues: string[] = [];
  const requiredHttps = [
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_SOLANA_RPC_URL",
    "NEXT_PUBLIC_MAGICBLOCK_ER_RPC_URL",
    "NEXT_PUBLIC_MAGICBLOCK_ROUTER_RPC_URL",
    "NEXT_PUBLIC_MAGICBLOCK_TEE_RPC_URL",
    "SUPABASE_URL",
  ];
  for (const name of requiredHttps) {
    if (!validHttpsUrl(env[name])) issues.push(`${name} must be an HTTPS URL.`);
  }
  if (env.SERVER_STORAGE_MODE !== "supabase") issues.push("SERVER_STORAGE_MODE must be supabase.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) issues.push("SUPABASE_SERVICE_ROLE_KEY is required.");
  if ((env.AUTH_SESSION_SECRET?.length ?? 0) < 32) issues.push("AUTH_SESSION_SECRET must contain at least 32 characters.");
  if (env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet") issues.push("NEXT_PUBLIC_SOLANA_CLUSTER must be devnet.");
  if (env.NEXT_PUBLIC_WALLET_MODE !== "wallet") issues.push("NEXT_PUBLIC_WALLET_MODE must be wallet.");
  if (env.NEXT_PUBLIC_ROOM_STATE_MODE !== "magicblock") issues.push("NEXT_PUBLIC_ROOM_STATE_MODE must be magicblock.");
  if ((env.VOTING_MODE ?? "commit-reveal") !== "commit-reveal") issues.push("VOTING_MODE must remain commit-reveal until PER is complete.");
  if (!validAddress(env.NEXT_PUBLIC_GACHA_PARTY_PROGRAM_ID)) issues.push("NEXT_PUBLIC_GACHA_PARTY_PROGRAM_ID is invalid.");
  if (!validAddress(env.GACHA_PARTY_PROGRAM_ID)) issues.push("GACHA_PARTY_PROGRAM_ID is invalid.");
  if (env.NEXT_PUBLIC_GACHA_PARTY_PROGRAM_ID !== env.GACHA_PARTY_PROGRAM_ID) {
    issues.push("Public and server program IDs must match.");
  }
  if (env.NEXT_PUBLIC_FUNDS_MODE === "solana") {
    if (!validAddress(env.NEXT_PUBLIC_USDC_MINT) || !validAddress(env.USDC_MINT)) {
      issues.push("Solana funding requires valid public and server USDC mint addresses.");
    } else if (env.NEXT_PUBLIC_USDC_MINT !== env.USDC_MINT) {
      issues.push("Public and server USDC mint addresses must match.");
    }
    if (!validAddress(env.NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS) || !validAddress(env.GACHA_OPERATOR_ADDRESS)) {
      issues.push("Solana funding requires valid public and server operator addresses.");
    } else if (env.NEXT_PUBLIC_GACHA_OPERATOR_ADDRESS !== env.GACHA_OPERATOR_ADDRESS) {
      issues.push("Public and server operator addresses must match.");
    }
  } else if (env.NEXT_PUBLIC_FUNDS_MODE !== "mock") {
    issues.push("NEXT_PUBLIC_FUNDS_MODE must be mock or solana.");
  }
  const collectorMode = env.COLLECTOR_CRYPT_MODE ?? "mock";
  if (collectorMode !== "mock" && collectorMode !== "real") {
    issues.push("COLLECTOR_CRYPT_MODE must be mock or real.");
  }
  if (collectorMode === "real") {
    if (env.NEXT_PUBLIC_FUNDS_MODE !== "solana") issues.push("Collector Crypt real mode requires Solana funding.");
    if (!validHttpsUrl(env.COLLECTOR_CRYPT_API_BASE_URL)) issues.push("COLLECTOR_CRYPT_API_BASE_URL must be an HTTPS URL in real mode.");
    else if (new URL(env.COLLECTOR_CRYPT_API_BASE_URL!).origin !== "https://dev-gacha.collectorcrypt.com") {
      issues.push("Collector Crypt real mode must use the verified devnet origin.");
    }
    if (!env.GACHA_OPERATOR_SECRET_KEY) issues.push("GACHA_OPERATOR_SECRET_KEY is required in Collector Crypt real mode.");
    if (env.USDC_MINT !== COLLECTOR_CRYPT_DEVNET_USDC_MINT || env.NEXT_PUBLIC_USDC_MINT !== COLLECTOR_CRYPT_DEVNET_USDC_MINT) {
      issues.push("Collector Crypt real mode requires its verified devnet USDC mint.");
    }
  }
  return issues;
}
