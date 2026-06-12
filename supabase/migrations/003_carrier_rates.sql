-- Migration 003: CMS Medigap carrier rate data
-- Source: Medicare.gov Plan Finder API scrape (June 2026)
-- 4,408 rows: Plan G + Plan N, NC/TX/GA, 53 carriers
-- Replaces the ~600KB embedded TypeScript data file

create table if not exists pm_supp_carrier_rates (
  id            bigint generated always as identity primary key,
  state         text not null,        -- NC, TX, GA
  zip           text not null,        -- 5-digit zip
  plan          text not null,        -- G or N
  gender        text not null,        -- FEMALE or MALE
  company       text not null,        -- CMS-filed carrier name
  rate_type     text not null,        -- ATTAINED_AGE, ISSUE_AGE, COMMUNITY_RATED
  rate_min      numeric(8,2) not null,-- monthly premium at age 65
  rate_max      numeric(8,2),
  hhd_std_min   numeric(8,2),         -- household discount (standard)
  hhd_std_max   numeric(8,2),
  hhd_rm_min    numeric(8,2),         -- household discount (roommate)
  hhd_rm_max    numeric(8,2),
  phone         text,
  website       text,
  address       text,
  scraped_at    timestamptz not null default now(),

  -- Composite index for the primary lookup pattern
  constraint uq_carrier_rate unique (state, zip, plan, gender, company)
);

-- The scoring engine queries by zip + plan + gender
create index if not exists idx_carrier_rates_lookup
  on pm_supp_carrier_rates (zip, plan, gender);

-- State-level queries for fallback
create index if not exists idx_carrier_rates_state
  on pm_supp_carrier_rates (state, plan, gender);

-- RLS: public read, no write from client
alter table pm_supp_carrier_rates enable row level security;

create policy "Public read access"
  on pm_supp_carrier_rates for select
  using (true);

comment on table pm_supp_carrier_rates is
  'CMS Medigap Plan Finder premium data. Scraped from Medicare.gov API. Refreshed periodically.';
