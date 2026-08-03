import Link from "next/link";

export default function PartyNotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Room not found</p>
      <h1 className="display-type mt-4 text-4xl font-semibold">This pull disappeared.</h1>
      <p className="mt-4 text-muted-foreground">The mock server may have restarted, or the invitation link is invalid.</p>
      <Link href="/party/new" className="mt-7 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Create a new party</Link>
    </main>
  );
}
