-- House Rent Manager: run this whole script in Supabase Dashboard > SQL Editor.
-- All tables are private per authenticated user. Do not disable RLS.
create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.rental_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_name text not null check (char_length(trim(unit_name)) between 1 and 80),
  monthly_rent numeric(12,2) not null default 0 check (monthly_rent >= 0),
  tenant_id uuid null references public.tenants(id) on delete set null,
  lease_start date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, unit_name)
);

create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_id uuid not null references public.rental_units(id) on delete restrict,
  tenant_id uuid null references public.tenants(id) on delete set null,
  rent_month date not null check (extract(day from rent_month) = 1),
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null default current_date,
  method text not null default 'Cash' check (method in ('Cash','Bank transfer','bKash','Nagad','Rocket','Other')),
  note text not null default '',
  receipt_no text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists rental_units_user_idx on public.rental_units(user_id);
create index if not exists tenants_user_idx on public.tenants(user_id);
create index if not exists rent_payments_user_month_idx on public.rent_payments(user_id, rent_month);
create index if not exists rent_payments_unit_idx on public.rent_payments(unit_id);

alter table public.tenants enable row level security;
alter table public.rental_units enable row level security;
alter table public.rent_payments enable row level security;

drop policy if exists "tenant owner access" on public.tenants;
create policy "tenant owner access" on public.tenants
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "unit owner access" on public.rental_units;
create policy "unit owner access" on public.rental_units
for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (tenant_id is null or exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.user_id = (select auth.uid())
  ))
);

drop policy if exists "payment owner access" on public.rent_payments;
create policy "payment owner access" on public.rent_payments
for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.rental_units u
    where u.id = unit_id and u.user_id = (select auth.uid())
  )
  and (tenant_id is null or exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.user_id = (select auth.uid())
  ))
);

-- Also protect against mismatched ownership even if a client sends forged IDs.
create or replace function public.check_rent_payment_owner()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rental_units u
    where u.id = new.unit_id and u.user_id = new.user_id
  ) then
    raise exception 'Rental unit does not belong to this account';
  end if;
  if new.tenant_id is not null and not exists (
    select 1 from public.tenants t
    where t.id = new.tenant_id and t.user_id = new.user_id
  ) then
    raise exception 'Tenant does not belong to this account';
  end if;
  return new;
end;
$$;
drop trigger if exists rent_payment_owner_guard on public.rent_payments;
create trigger rent_payment_owner_guard before insert or update on public.rent_payments
for each row execute function public.check_rent_payment_owner();

-- Optional: enable email confirmation in Supabase Auth for production.
-- If enabled, new users may need to confirm their email before signing in.
