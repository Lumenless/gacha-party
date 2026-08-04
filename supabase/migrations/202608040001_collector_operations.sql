create table if not exists public.collector_operations (
  party_id text primary key references public.parties(id) on delete cascade,
  status text not null check (status in ('PROCESSING', 'RELEASED', 'PREPARED', 'SUBMITTED', 'PURCHASED', 'OPENED', 'FAILED')),
  release_signature text null,
  memo text null,
  prepared_transaction text null,
  purchase_signature text null,
  purchase_confirmation_status text null,
  purchase_marker_signature text null,
  opening jsonb null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.collector_operations enable row level security;

-- No browser policies are created. The Vercel server accesses this table with the service role.
create index if not exists collector_operations_status_idx
  on public.collector_operations (status, updated_at);
