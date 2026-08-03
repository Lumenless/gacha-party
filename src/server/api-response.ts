import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError } from "./wallet-auth";

export function apiError(error: unknown) {
  const message = error instanceof ZodError
    ? error.issues[0]?.message ?? "Check the submitted details."
    : error instanceof Error ? error.message : "The request could not be completed.";
  const declaredStatus = error instanceof Error && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
  const status = error instanceof AuthenticationError
    ? error.status
    : declaredStatus ?? (message === "Party not found." ? 404 : 400);
  return NextResponse.json({ error: message }, { status });
}
