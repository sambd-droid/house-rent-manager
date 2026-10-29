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


-- ---------------------------------------------------------------------------
-- No-login tenant sharing links. Each tenant receives a unique secret URL.
-- The raw token is returned only once to the authenticated landlord; only its
-- SHA-256 hash is stored. Public visitors can call the narrowly scoped RPC only.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);
alter table public.tenant_share_links enable row level security;
revoke all on public.tenant_share_links from anon, authenticated;

create or replace function public.create_tenant_share_link(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then raise exception 'Sign in as the landlord to create a sharing link'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = v_uid and p.role = 'landlord') then
    raise exception 'Only landlord accounts can create sharing links';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.user_id = v_uid) then
    raise exception 'Tenant not found in your account';
  end if;
  if not exists (select 1 from public.rental_units u where u.tenant_id = p_tenant_id and u.user_id = v_uid and u.active) then
    raise exception 'Assign this tenant to an active rental unit first';
  end if;
  update public.tenant_share_links set revoked_at = now()
    where tenant_id = p_tenant_id and user_id = v_uid and revoked_at is null;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.tenant_share_links(user_id, tenant_id, token_hash)
    values (v_uid, p_tenant_id, encode(digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;
revoke all on function public.create_tenant_share_link(uuid) from public, anon;
grant execute on function public.create_tenant_share_link(uuid) to authenticated;

create or replace function public.revoke_tenant_share_link(p_tenant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.user_id=v_uid and p.role='landlord') then
    raise exception 'Only signed-in landlords can revoke sharing links';
  end if;
  update public.tenant_share_links set revoked_at=now()
   where tenant_id=p_tenant_id and user_id=v_uid and revoked_at is null;
  return true;
end;
$$;
revoke all on function public.revoke_tenant_share_link(uuid) from public, anon;
grant execute on function public.revoke_tenant_share_link(uuid) to authenticated;

create or replace function public.get_shared_tenant_rent(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant public.tenants%rowtype;
  v_unit public.rental_units%rowtype;
  v_payments jsonb;
  v_hash text;
begin
  if p_token is null or length(p_token) < 40 or length(p_token) > 100 then
    raise exception 'Invalid or revoked private link';
  end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select t.* into v_tenant
    from public.tenant_share_links l
    join public.tenants t on t.id=l.tenant_id and t.user_id=l.user_id
    where l.token_hash=v_hash and l.revoked_at is null
    limit 1;
  if not found then raise exception 'Invalid or revoked private link'; end if;
  select u.* into v_unit
    from public.rental_units u
    where u.tenant_id=v_tenant.id and u.user_id=v_tenant.user_id and u.active
    order by u.lease_start desc
    limit 1;
  if not found then
    return jsonb_build_object('tenant_name', v_tenant.full_name, 'unit', null, 'payments', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'unit_id', p.unit_id, 'receipt_no', p.receipt_no,
      'payment_date', p.payment_date, 'rent_month', p.rent_month,
      'method', p.method, 'amount', p.amount
    ) order by p.payment_date desc), '[]'::jsonb)
    into v_payments
    from public.rent_payments p
    where p.user_id=v_tenant.user_id and p.tenant_id=v_tenant.id and p.unit_id=v_unit.id;
  return jsonb_build_object(
    'tenant_name', v_tenant.full_name,
    'unit', jsonb_build_object('id',v_unit.id,'unit_name',v_unit.unit_name,
      'monthly_rent',v_unit.monthly_rent,'lease_start',v_unit.lease_start,'active',v_unit.active),
    'payments', v_payments
  );
end;
$$;
revoke all on function public.get_shared_tenant_rent(text) from public, authenticated;
grant execute on function public.get_shared_tenant_rent(text) to anon, authenticated;
