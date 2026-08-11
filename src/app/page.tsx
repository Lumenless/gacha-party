import Image from "next/image";
import Link from "next/link";
import { ArrowRight, EyeOff, Radio, Sparkles, Users } from "lucide-react";
import { YourParties } from "@/components/party/your-parties";

const steps = [
  { icon: Users, number: "01", title: "Pool", copy: "Invite friends and fund one pack in USDC." },
  { icon: Radio, number: "02", title: "Pull", copy: "Ready up and reveal the same card together." },
  { icon: EyeOff, number: "03", title: "Decide", copy: "Vote privately, then keep it or split the sale." },
];

export default function LandingPage() {
  const realCollector = process.env.COLLECTOR_CRYPT_MODE === "real";
  const realFunds = process.env.NEXT_PUBLIC_FUNDS_MODE === "solana";
  return (
    <main>
      <YourParties />
      <section className="mx-auto grid min-h-[calc(100vh-4.5rem)] max-w-7xl items-center gap-10 px-4 py-10 md:grid-cols-[1.05fr_.95fr] md:px-6 lg:px-8">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <Sparkles className="size-3.5" aria-hidden="true" /> Collector Crypt × MagicBlock
          </div>
          <h1 className="display-type text-6xl font-semibold leading-[0.9] sm:text-7xl lg:text-8xl">
            Pull<br />together<span className="text-primary">.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            One pack. Your crew. One big reveal. Pool USDC, pull together, then keep the card or split the sale.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/party/new"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Create a party <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center justify-center rounded-md border bg-secondary px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {realCollector && realFunds
              ? "Live on devnet · invite friends with one link"
              : "Demo mode is active. No funds move in this build."}
          </p>
        </div>

        <div className="relative mx-auto w-full max-w-md py-8" aria-label="Live party preview">
          <div className="absolute inset-8 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute left-[6%] top-[14%] aspect-[4/5] w-[62%] -rotate-6 rounded-2xl border bg-card/50" aria-hidden="true" />
          <div className="pack-float relative mx-auto aspect-[4/5] w-[72%] rotate-2 overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-2xl shadow-primary/10">
            <Image src="/packs/spark.svg" alt="Gacha Party Collector's Spark pack" fill priority className="object-cover" />
          </div>
          <div className="absolute bottom-1 left-0 rounded-xl border bg-card/95 p-4 backdrop-blur sm:left-2">
            <div className="flex -space-x-2" aria-label="Three players in the room">
              {['M', 'A', 'B'].map((initial) => (
                <span key={initial} className="grid size-9 place-items-center rounded-full border-2 border-card bg-primary/15 text-xs font-semibold text-primary">{initial}</span>
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold">3 friends ready</p>
          </div>
          <div className="absolute right-0 top-8 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-card/95 px-3 py-2 text-xs font-semibold text-primary backdrop-blur">
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" /> LIVE PARTY
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t bg-card/35">
        <div className="mx-auto grid max-w-7xl px-4 py-12 md:grid-cols-3 md:px-6 lg:px-8">
          {steps.map(({ icon: Icon, number, title, copy }) => (
            <article key={title} className="border-b py-7 last:border-b-0 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-r-0">
              <div className="flex items-center justify-between">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <span className="font-mono text-xs text-muted-foreground">{number}</span>
              </div>
              <h2 className="mt-6 text-xl font-semibold">{title}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
