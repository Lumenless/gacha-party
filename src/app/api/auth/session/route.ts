import { NextResponse } from "next/server";
import { readWalletSession, WALLET_SESSION_COOKIE } from "@/server/wallet-auth";

export async function GET(request: Request) {
  const session = readWalletSession(request);
  return NextResponse.json(session ? { wallet: session.wallet, expiresAt: session.expiresAt } : { wallet: null });
}

export async function DELETE() {
  const response = NextResponse.json({ wallet: null });
  response.cookies.set(WALLET_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
