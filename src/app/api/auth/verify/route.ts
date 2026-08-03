import { NextResponse } from "next/server";
import { apiError } from "@/server/api-response";
import {
  createSessionToken,
  verifyWalletChallenge,
  WALLET_SESSION_COOKIE,
  walletSessionMaxAge,
} from "@/server/wallet-auth";

export async function POST(request: Request) {
  try {
    const session = await verifyWalletChallenge(await request.json());
    const response = NextResponse.json({ wallet: session.wallet, expiresAt: session.expiresAt });
    response.cookies.set(WALLET_SESSION_COOKIE, createSessionToken(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: walletSessionMaxAge,
      path: "/",
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
