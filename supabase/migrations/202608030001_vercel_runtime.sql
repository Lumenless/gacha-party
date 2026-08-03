create table if not exists public.parties (
  id text primary key,
  revision bigint not null,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint party_revision_nonnegative check (revision >= 0)
);

create table if not exists public.wallet_challenges (
  wallet text primary key,
  message text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vote_records (
  party_id text not null references public.parties(id) on delete cascade,
  wallet text not null,
  commitment text not null,
  vote text null check (vote in ('KEEP', 'SELL')),
  created_at timestamptz not null default now(),
  revealed_at timestamptz null,
  primary key (party_id, wallet)
);

create table if not exists public.settlement_locks (
  party_id text primary key references public.parties(id) on delete cascade,
  idempotency_key text not null unique,
  status text not null check (status in ('PROCESSING', 'COMPLETED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

alter table public.parties enable row level security;
alter table public.wallet_challenges enable row level security;
alter table public.vote_records enable row level security;
alter table public.settlement_locks enable row level security;

-- No browser policies are created. All access goes through server routes with the service role.

do $$
begin
  alter publication supabase_realtime add table public.parties;
exception
  when duplicate_object then null;
end $$;

create index if not exists wallet_challenges_expires_at_idx
  on public.wallet_challenges (expires_at);
create index if not exists vote_records_party_id_idx
  on public.vote_records (party_id);
