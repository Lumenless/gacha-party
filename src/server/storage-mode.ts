export type ServerStorageMode = "memory" | "supabase";

export function getServerStorageMode(): ServerStorageMode {
  const configured = process.env.SERVER_STORAGE_MODE?.trim();
  if (configured === "memory" || configured === "supabase") return configured;
  if (configured) throw new Error(`Unsupported SERVER_STORAGE_MODE: ${configured}`);
  return process.env.NODE_ENV === "test" ? "memory" : "supabase";
}
