create table if not exists public.real_settlement_operations (
  party_id text primary key references public.parties(id) on delete cascade,
  status text not null check (status in ('PROCESSING', 'BUYBACK_PREPARED', 'BUYBACK_SUBMITTED', 'PAYOUT_PREPARED', 'COMPLETED', 'FAILED')),
  buyback_memo text null,
  prepared_buyback text null,
  buyback_signature text null,
  proceeds_base_units text null,
  operator_balance_before text null,
  prepared_payout text null,
  payout_signature text null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.real_settlement_operations enable row level security;
create index if not exists real_settlement_operations_status_idx
  on public.real_settlement_operations (status, updated_at);
