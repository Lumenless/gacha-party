import Image from "next/image";
import Link from "next/link";
import { ArrowRight, EyeOff, Radio, Users } from "lucide-react";

const steps = [
  { icon: Users, number: "01", title: "Pool", copy: "Invite friends and fund one pack in USDC." },
  { icon: Radio, number: "02", title: "Pull", copy: "Ready up and reveal the same card together." },
  { icon: EyeOff, number: "03", title: "Decide", copy: "Vote privately, then keep it or split the sale." },
];

export default function LandingPage() {
  return (
    <main>
      <section className="mx-auto grid min-h-[calc(100vh-4.5rem)] max-w-7xl items-center gap-12 px-4 py-12 md:grid-cols-[1.05fr_.95fr] md:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="mb-6 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            Multiplayer pack openings · powered by Solana
          </p>
          <h1 className="display-type text-6xl font-semibold leading-[0.9] sm:text-7xl lg:text-8xl">
            Pull<br />together<span className="text-primary">.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            Pool USDC with friends, open Collector Crypt packs together, and split the outcome in real time.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/party/new"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Start a party <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center justify-center rounded-md border bg-secondary px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Mock mode is active. No funds move in this build.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md py-8">
          <div className="absolute inset-8 rounded-full bg-primary/20 blur-3xl" />
          <div className="pack-float relative mx-auto aspect-[4/5] w-[72%] rotate-2 overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-2xl shadow-primary/10">
            <Image src="/packs/spark.svg" alt="Gacha Party Collector's Spark pack" fill priority className="object-cover" />
          </div>
          <div className="absolute bottom-2 left-0 rounded-xl border bg-card/95 p-4 backdrop-blur sm:left-4">
            <p className="font-mono text-2xl font-semibold tabular-nums">2 / 4</p>
            <p className="text-xs text-muted-foreground">players ready to pull</p>
          </div>
          <div className="absolute right-0 top-8 rounded-full border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
            LIVE ROOM
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t bg-card/35">
        <div className="mx-auto grid max-w-7xl gap-px px-4 py-16 md:grid-cols-3 md:px-6 lg:px-8">
          {steps.map(({ icon: Icon, number, title, copy }) => (
            <article key={title} className="border-b py-8 last:border-b-0 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-r-0">
              <div className="flex items-center justify-between">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <span className="font-mono text-xs text-muted-foreground">{number}</span>
              </div>
              <h2 className="mt-10 text-xl font-semibold">{title}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
