import { NextResponse } from "next/server";
import { apiError } from "@/server/api-response";
import { createWalletChallenge } from "@/server/wallet-auth";

export async function POST(request: Request) {
  try {
    const { wallet } = await request.json() as { wallet?: unknown };
    return NextResponse.json(await createWalletChallenge(wallet, new URL(request.url).origin));
  } catch (error) {
    return apiError(error);
  }
}
