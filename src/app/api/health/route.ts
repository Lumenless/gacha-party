import { NextResponse } from "next/server";
import { deploymentConfigIssues } from "@/server/deployment-config";
import { getServerStorageMode } from "@/server/storage-mode";
import { getServerSupabase } from "@/server/supabase";
import { collectorCryptAdapter, getCollectorCryptMode } from "@/integrations/collector-crypt/server";

export const dynamic = "force-dynamic";

async function checkProgram(): Promise<boolean> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const programId = process.env.GACHA_PARTY_PROGRAM_ID;
  if (!rpcUrl || !programId) return false;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [programId, { encoding: "base64", commitment: "confirmed" }],
    }),
    cache: "no-store",
  });
  if (!response.ok) return false;
  const body = await response.json() as { result?: { value?: { executable?: boolean } | null } };
  return body.result?.value?.executable === true;
}

export async function GET() {
  const collectorMode = getCollectorCryptMode();
  const fundsMode = process.env.NEXT_PUBLIC_FUNDS_MODE === "solana" ? "solana" : "mock";
  const votingMode = process.env.VOTING_MODE === "magicblock-per" ? "magicblock-per" : "commit-reveal";
  const configIssues = deploymentConfigIssues();
  let database = false;
  let program = false;
  let collectorCrypt = false;
  try {
    const { error } = await getServerSupabase().from("parties").select("id", { head: true, count: "exact" });
    database = !error;
  } catch { /* reported below */ }
  try { program = await checkProgram(); } catch { /* reported below */ }
  if (collectorMode === "real") {
    try { collectorCrypt = (await collectorCryptAdapter().listPacks()).some(({ isOpen }) => isOpen); } catch { /* reported below */ }
  }
  const ready = configIssues.length === 0 && database && program && (collectorMode !== "real" || collectorCrypt);
  return NextResponse.json({
    ready,
    storage: getServerStorageMode(),
    modes: { collectorCrypt: collectorMode, funds: fundsMode, voting: votingMode },
    checks: {
      configuration: configIssues.length === 0,
      database,
      solanaProgram: program,
      collectorCrypt: collectorMode === "mock" || collectorCrypt,
      collectorCryptApi: collectorMode === "real" ? collectorCrypt : null,
      privateVoting: votingMode === "magicblock-per",
      realFunds: fundsMode === "solana",
    },
    issues: configIssues,
  }, { status: ready ? 200 : 503 });
}
