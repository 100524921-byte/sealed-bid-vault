create type public.app_role as enum ('organizer', 'bidder', 'auditor');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  organization text not null default '',
  signing_public_key jsonb,
  key_fingerprint text,
  key_registered_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Signed-in users read profiles" on public.profiles for select to authenticated using (true);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "Users read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare r text := coalesce(new.raw_user_meta_data->>'role', 'bidder');
begin
  insert into public.profiles (id, display_name, organization)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
          coalesce(new.raw_user_meta_data->>'organization', ''));
  if r not in ('organizer','bidder','auditor') then r := 'bidder'; end if;
  insert into public.user_roles (user_id, role) values (new.id, r::public.app_role);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  asset_type text not null default 'M&A',
  closes_at timestamptz not null,
  encryption_public_key jsonb not null,
  key_fingerprint text not null,
  created_at timestamptz not null default now()
);
grant select on public.processes to authenticated;
grant all on public.processes to service_role;
alter table public.processes enable row level security;
create policy "Signed-in users read processes" on public.processes for select to authenticated using (true);

-- Private keys: no grants to client roles at all. Only the server can read them.
create table public.process_keys (
  process_id uuid primary key references public.processes(id) on delete cascade,
  private_key jsonb not null,
  created_at timestamptz not null default now()
);
grant all on public.process_keys to service_role;
alter table public.process_keys enable row level security;

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes(id) on delete cascade,
  bidder_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  wrapped_key text not null,
  payload_hash text not null,
  signature text not null,
  signer_fingerprint text not null,
  submitted_at timestamptz not null default now(),
  unique (process_id, bidder_id)
);
grant select on public.bids to authenticated;
grant all on public.bids to service_role;
alter table public.bids enable row level security;
create policy "Bidders read own bids" on public.bids for select to authenticated using (auth.uid() = bidder_id);
create policy "Organizer reads process bids" on public.bids for select to authenticated
  using (exists (select 1 from public.processes p where p.id = process_id and p.organizer_id = auth.uid()));
create policy "Auditors read bids" on public.bids for select to authenticated using (public.has_role(auth.uid(), 'auditor'));

create table public.audit_log (
  id bigserial primary key,
  process_id uuid references public.processes(id) on delete cascade,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
alter table public.audit_log enable row level security;
create policy "Auditors read audit log" on public.audit_log for select to authenticated using (public.has_role(auth.uid(), 'auditor'));
create policy "Organizer reads own process log" on public.audit_log for select to authenticated
  using (exists (select 1 from public.processes p where p.id = process_id and p.organizer_id = auth.uid()));
create policy "Actors read own log" on public.audit_log for select to authenticated using (actor_id = auth.uid());