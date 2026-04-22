-- Plan Match Supplement applications landing table.
-- Populated by POST /api/enroll from the Application's SignStage.
-- Rob reviews each row in AgentBase CRM before submitting to the carrier.

create extension if not exists "pgcrypto";

create table if not exists public.supplement_applications (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Contact
  first_name           text not null,
  last_name            text not null,
  phone                text not null,
  email                text,

  -- Address
  address              text,
  city                 text,
  state                text,
  zip                  text,
  county               text,

  -- Product
  product              text not null default 'supplement',
  carrier              text,
  plan_letter          text check (plan_letter in ('G', 'N')),

  -- Scoring
  rate_class_predicted text,
  qualification_score  integer,
  rate_range_low       integer,
  rate_range_high      integer,

  -- Medicare
  mbi_number           text,
  security_pin         text check (security_pin is null or length(security_pin) <= 4),
  part_a_effective     text,
  part_b_effective     text,

  -- Demographics
  dob_month            text,
  dob_day              text,
  dob_year             text,
  age                  integer,
  gender               text,
  tobacco_use          text,
  height_inches        integer,
  weight_lbs           integer,
  build_class          text,

  -- Intent
  enrollment_prompt    text,

  -- Status
  status               text not null default 'submitted'
                         check (status in (
                           'submitted',
                           'under_review',
                           'sent_to_carrier',
                           'awaiting_signature',
                           'signed',
                           'approved',
                           'rejected'
                         )),

  -- Full screening payload: medications[], healthAnswers, clusterCounts,
  -- comboFlags[], escalationPattern, providers[], authChecks, signedAt, etc.
  context              jsonb not null default '{}'::jsonb
);

create index if not exists supplement_applications_created_at_idx on public.supplement_applications (created_at desc);
create index if not exists supplement_applications_status_idx     on public.supplement_applications (status);
create index if not exists supplement_applications_phone_idx      on public.supplement_applications (phone);

create or replace function public.supplement_applications_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists supplement_applications_touch_updated_at on public.supplement_applications;
create trigger supplement_applications_touch_updated_at
before update on public.supplement_applications
for each row execute function public.supplement_applications_touch_updated_at();

-- Service role only; anon key is never used against this table.
-- /api/enroll authenticates with SUPABASE_SERVICE_ROLE_KEY.
alter table public.supplement_applications enable row level security;

drop policy if exists supplement_applications_service_role on public.supplement_applications;
create policy supplement_applications_service_role
  on public.supplement_applications
  for all
  to service_role
  using (true)
  with check (true);
