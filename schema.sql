-- Tenant-sharing upgrade for House Rent Manager.
-- Run this in Supabase SQL Editor on the EXISTING project.
-- New users default to tenant role. Promote the landlord/admin account manually using the SQL below.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'tenant' check (role in ('landlord','tenant')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.create_user_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(user_id, role) values (new.id, 'tenant')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_user_profile();

-- Backfill profiles for accounts that already exist. Existing users default to tenant
-- until the property owner is explicitly promoted below.
insert into public.profiles(user_id, role)
select id, 'tenant' from auth.users
on conflict (user_id) do nothing;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$
  select role from public.profiles where user_id = (select auth.uid()) limit 1
$$;

alter table public.tenants add column if not exists auth_user_id uuid null references auth.users(id) on delete set null;
create unique index if not exists tenants_auth_user_unique on public.tenants(auth_user_id) where auth_user_id is not null;

-- Helper functions use SECURITY DEFINER to avoid RLS recursion when checking links.
create or replace function public.current_tenant_record_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select id from public.tenants where auth_user_id = (select auth.uid()) limit 1
$$;

-- Recreate policies for role-aware access.
drop policy if exists "tenant owner access" on public.tenants;
drop policy if exists "unit owner access" on public.rental_units;
drop policy if exists "payment owner access" on public.rent_payments;
drop policy if exists "profiles read own" on public.profiles;

create policy "profiles read own" on public.profiles
for select to authenticated using (user_id = (select auth.uid()));

create policy "landlords manage own tenant records" on public.tenants
for all to authenticated
using (public.current_app_role() = 'landlord' and user_id = (select auth.uid()))
with check (public.current_app_role() = 'landlord' and user_id = (select auth.uid()));

create policy "tenants read linked own record" on public.tenants
for select to authenticated using (auth_user_id = (select auth.uid()));

create policy "landlords manage own units" on public.rental_units
for all to authenticated
using (public.current_app_role() = 'landlord' and user_id = (select auth.uid()))
with check (
  public.current_app_role() = 'landlord'
  and user_id = (select auth.uid())
  and (tenant_id is null or exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.user_id = (select auth.uid())
  ))
);

create policy "tenants read assigned units" on public.rental_units
for select to authenticated using (
  public.current_app_role() = 'tenant'
  and tenant_id = public.current_tenant_record_id()
);

create policy "landlords manage own payments" on public.rent_payments
for all to authenticated
using (public.current_app_role() = 'landlord' and user_id = (select auth.uid()))
with check (
  public.current_app_role() = 'landlord'
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.rental_units u
    where u.id = unit_id and u.user_id = (select auth.uid())
  )
  and (tenant_id is null or exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.user_id = (select auth.uid())
  ))
);

create policy "tenants read own payments" on public.rent_payments
for select to authenticated using (
  public.current_app_role() = 'tenant'
  and tenant_id = public.current_tenant_record_id()
);

create or replace function public.check_rent_payment_owner()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rental_units u
    where u.id = new.unit_id and u.user_id = new.user_id
  ) then raise exception 'Rental unit does not belong to this landlord account'; end if;
  if new.tenant_id is not null and not exists (
    select 1 from public.tenants t
    where t.id = new.tenant_id and t.user_id = new.user_id
  ) then raise exception 'Tenant does not belong to this landlord account'; end if;
  return new;
end;
$$;
drop trigger if exists rent_payment_owner_guard on public.rent_payments;
create trigger rent_payment_owner_guard before insert or update on public.rent_payments
for each row execute function public.check_rent_payment_owner();

-- IMPORTANT: after running this script, promote YOUR existing landlord account.
-- Replace the email below with the email you use to sign in as the property owner.
-- Run this statement separately after replacing the email:
-- update public.profiles p set role = 'landlord'
-- from auth.users u where p.user_id = u.id and u.email = 'YOUR-LANDLORD-EMAIL@example.com';

-- To link a tenant's auth account to their tenant record, replace both email addresses:
-- update public.tenants t set auth_user_id = u.id
-- from auth.users u
-- where t.email = 'TENANT-EMAIL-STORED-IN-TENANT-RECORD@example.com'
--   and u.email = 'TENANT-LOGIN-EMAIL@example.com'
--   and t.user_id = (select id from auth.users where email = 'YOUR-LANDLORD-EMAIL@example.com');
