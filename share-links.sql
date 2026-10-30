-- Secure tenant share links. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.tenant_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.tenant_share_links enable row level security;
revoke all on public.tenant_share_links from anon, authenticated;

create or replace function public.create_tenant_share_link(p_tenant_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not exists(select 1 from public.tenants t where t.id=p_tenant_id and t.user_id=auth.uid()) then
    raise exception 'Tenant not found or not owned by this account';
  end if;
  update public.tenant_share_links set revoked_at=now()
    where tenant_id=p_tenant_id and user_id=auth.uid() and revoked_at is null;
  v_token := encode(gen_random_bytes(32),'hex');
  insert into public.tenant_share_links(user_id,tenant_id,token_hash)
    values(auth.uid(),p_tenant_id,encode(digest(v_token,'sha256'),'hex'));
  return v_token;
end; $$;

create or replace function public.revoke_tenant_share_link(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.tenant_share_links set revoked_at=now()
   where tenant_id=p_tenant_id and user_id=auth.uid() and revoked_at is null;
  return true;
end; $$;

create or replace function public.get_shared_tenant_rent(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_tenant_id uuid; v_user_id uuid; v_result jsonb;
begin
  if p_token is null or length(p_token) <> 64 then return null; end if;
  select l.tenant_id,l.user_id into v_tenant_id,v_user_id
  from public.tenant_share_links l
  where l.token_hash=encode(digest(p_token,'sha256'),'hex') and l.revoked_at is null;
  if v_tenant_id is null then return null; end if;
  select jsonb_build_object(
    'tenant_name',t.full_name,
    'phone',t.phone,
    'email',t.email,
    'units',coalesce((select jsonb_agg(jsonb_build_object('unit_name',u.unit_name,'monthly_rent',u.monthly_rent,'lease_start',u.lease_start)) from public.rental_units u where u.tenant_id=t.id and u.user_id=v_user_id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('payment_date',p.payment_date,'rent_month',p.rent_month,'amount',p.amount,'method',p.method,'receipt_no',p.receipt_no,'note',p.note) order by p.payment_date desc) from public.rent_payments p where p.tenant_id=t.id and p.user_id=v_user_id),'[]'::jsonb),
    'funds',coalesce((select jsonb_agg(jsonb_build_object('fund_type',f.fund_type,'direction',f.direction,'amount',f.amount,'transaction_date',f.transaction_date,'note',f.note) order by f.transaction_date desc) from public.tenant_funds f where f.tenant_id=t.id and f.user_id=v_user_id),'[]'::jsonb)
  ) into v_result from public.tenants t where t.id=v_tenant_id and t.user_id=v_user_id;
  return v_result;
end; $$;

revoke all on function public.create_tenant_share_link(uuid) from public, anon;
revoke all on function public.revoke_tenant_share_link(uuid) from public, anon;
revoke all on function public.get_shared_tenant_rent(text) from public;
grant execute on function public.create_tenant_share_link(uuid) to authenticated;
grant execute on function public.revoke_tenant_share_link(uuid) to authenticated;
grant execute on function public.get_shared_tenant_rent(text) to anon, authenticated;
