-- =============================================================================
-- MOP v2 — Baseline (Фаза 0)
-- Схемы: kaiten (зеркало), app (мастер-данные + инфраструктура), analytics (views)
-- Принципы: RLS — реальный механизм; ручных полей в kaiten.* нет;
-- деструктивные операции синка — только транзакционные RPC.
-- =============================================================================

create extension if not exists btree_gist;

create schema if not exists kaiten;
create schema if not exists app;
create schema if not exists analytics;

-- -----------------------------------------------------------------------------
-- 1. KAITEN MIRROR (read-only реплика; без FK; пишет только service_role)
-- -----------------------------------------------------------------------------

create table kaiten.spaces (
  id bigint primary key,
  title text not null,
  archived boolean not null default false,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);

create table kaiten.boards (
  id bigint primary key,
  space_id bigint not null,
  title text not null,
  archived boolean not null default false,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);

create table kaiten.users (
  id bigint primary key,
  full_name text,
  email text,
  activated boolean not null default true,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);

create table kaiten.cards (
  id bigint primary key,
  board_id bigint not null,
  column_id bigint,
  title text not null,
  type_id bigint,
  parent_ids bigint[] not null default '{}',
  tag_ids bigint[] not null default '{}',
  member_ids bigint[] not null default '{}',
  state text,
  archived boolean not null default false,
  estimate_minutes integer,
  completed_at timestamptz,
  kaiten_created_at timestamptz,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);
create index cards_board_idx on kaiten.cards (board_id);
create index cards_updated_idx on kaiten.cards (kaiten_updated_at);

create table kaiten.time_logs (
  id bigint primary key,
  card_id bigint not null,
  user_id bigint not null,
  minutes integer not null,
  log_date date not null,
  comment text,
  kaiten_created_at timestamptz,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);
create index time_logs_date_idx on kaiten.time_logs (log_date);
create index time_logs_user_date_idx on kaiten.time_logs (user_id, log_date);
create index time_logs_card_idx on kaiten.time_logs (card_id);

create table kaiten.tags (
  id bigint primary key,
  name text not null,
  synced_at timestamptz not null,
  raw jsonb not null
);

create table kaiten.card_types (
  id bigint primary key,
  name text not null,
  synced_at timestamptz not null,
  raw jsonb not null
);

-- -----------------------------------------------------------------------------
-- 2. ИНФРАСТРУКТУРА СИНКА
-- -----------------------------------------------------------------------------

create table app.sync_runs (
  id bigserial primary key,
  entity text not null,
  mode text not null check (mode in ('incremental','window_replace','full')),
  status text not null default 'running' check (status in ('running','completed','failed')),
  window_from date,
  window_to date,
  stats jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table app.sync_state (
  entity text primary key,
  last_cursor timestamptz
);

-- Транзакционный replace тайм-логов: удаление и вставка атомарны,
-- конкурентные вызовы сериализуются advisory-локом.
create or replace function app.replace_time_logs(p_from date, p_to date, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_inserted integer;
begin
  perform pg_advisory_xact_lock(hashtext('replace_time_logs'));

  delete from kaiten.time_logs where log_date between p_from and p_to;
  get diagnostics v_deleted = row_count;

  insert into kaiten.time_logs
  select * from jsonb_populate_recordset(null::kaiten.time_logs, p_rows);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted);
end;
$$;

revoke all on function app.replace_time_logs(date, date, jsonb) from public;
revoke all on function app.replace_time_logs(date, date, jsonb) from anon;
revoke all on function app.replace_time_logs(date, date, jsonb) from authenticated;

-- -----------------------------------------------------------------------------
-- 3. ПОЛЬЗОВАТЕЛИ ПРИЛОЖЕНИЯ И АУДИТ
-- -----------------------------------------------------------------------------

create table app.app_users (
  auth_user_id uuid primary key,
  email text not null unique,
  role text not null check (role in ('owner','pm','lead')),
  employee_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Роль текущего пользователя; null = не приглашён или деактивирован
create or replace function app.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from app.app_users
  where auth_user_id = auth.uid() and active
$$;

create table app.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);

-- Генерический аудит-триггер для мастер-таблиц
create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.audit_log (actor, action, entity, entity_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_schema || '.' || tg_table_name,
    coalesce(
      case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id')
           else (to_jsonb(new) ->> 'id') end,
      ''),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. МАСТЕР-ДАННЫЕ (Фаза 0)
-- -----------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table app.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  country text not null check (country in ('RU','KG','AM','GE')),
  employment_type text not null check (employment_type in ('staff','contractor')),
  hire_date date not null,
  probation_end_date date,
  termination_date date,
  status text not null default 'active' check (status in ('probation','active','terminated')),
  kaiten_user_id bigint unique,
  grade text,
  role_title text,
  team_id uuid,
  sick_leave_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger employees_updated_at before update on app.employees
  for each row execute function app.set_updated_at();
create trigger employees_audit after insert or update or delete on app.employees
  for each row execute function app.audit();

create table app.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact jsonb,
  admin_percent numeric(5,2) not null default 18,
  created_at timestamptz not null default now()
);
create trigger clients_audit after insert or update or delete on app.clients
  for each row execute function app.audit();

create table app.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  full_name text not null,
  role text,
  active boolean not null default true
);

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  name text not null,
  kaiten_space_id bigint unique,
  status text not null default 'active' check (status in ('active','on_hold','completed')),
  invoice_currency text not null default 'USD',
  created_at timestamptz not null default now()
);
create trigger projects_audit after insert or update or delete on app.projects
  for each row execute function app.audit();

create table app.board_mappings (
  kaiten_board_id bigint primary key,
  project_id uuid references app.projects(id),
  billing_class text not null
    check (billing_class in ('billable','non_billable','time_off','ignore')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create trigger board_mappings_audit after insert or update or delete on app.board_mappings
  for each row execute function app.audit();

create table app.rate_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  project_id uuid references app.projects(id),
  hourly_rate numeric(10,2) not null,
  currency text not null default 'USD',
  valid_from date not null,
  valid_to date,
  exclude using gist (
    client_id with =,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  )
);
create trigger rate_cards_audit after insert or update or delete on app.rate_cards
  for each row execute function app.audit();

create table app.task_types (
  code text primary key,
  invoice_label text not null,
  sort_order integer not null default 0
);

create table app.task_type_mappings (
  id uuid primary key default gen_random_uuid(),
  task_type text not null references app.task_types(code),
  kaiten_tag_id bigint,
  kaiten_card_type_id bigint,
  check (kaiten_tag_id is not null or kaiten_card_type_id is not null)
);

create table app.calendars (
  country text not null check (country in ('RU','KG','AM','GE')),
  day date not null,
  day_type text not null check (day_type in ('workday','weekend','holiday','short_day')),
  work_hours numeric(3,1) not null default 8,
  primary key (country, day)
);

create table app.fx_rates (
  currency text not null,
  day date not null,
  rate_to_usd numeric(14,6) not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  primary key (currency, day)
);

-- Колонки акта из реального образца инвойса
insert into app.task_types (code, invoice_label, sort_order) values
  ('blockout',     'ref/blockout',  10),
  ('lod00',        'lod00',         20),
  ('materials',    'tex/materials', 30),
  ('cls',          'lods/cls',      40),
  ('destr',        'destr',         50),
  ('dmg',          'dmg',           60),
  ('set_dressing', 'set dressing',  70),
  ('misc',         'misc',          80);

-- -----------------------------------------------------------------------------
-- 5. RLS: доступ только приглашённым; зеркало — read-only; деньги — owner
-- -----------------------------------------------------------------------------

-- Гранты уровня схем/таблиц (RLS сверху сужает)
grant usage on schema kaiten to authenticated;
grant usage on schema app to authenticated;
grant select on all tables in schema kaiten to authenticated;
grant select, insert, update, delete on all tables in schema app to authenticated;
-- sequences для bigserial-таблиц, куда пишет authenticated (audit пишется definer'ом)
grant usage on all sequences in schema app to authenticated;

-- Зеркало: читают все приглашённые; писать может только service_role (bypass RLS)
do $$
declare t text;
begin
  foreach t in array array['spaces','boards','users','cards','time_logs','tags','card_types']
  loop
    execute format('alter table kaiten.%I enable row level security', t);
    execute format(
      'create policy read_app_users on kaiten.%I for select to authenticated
       using (app.current_app_role() is not null)', t);
  end loop;
end $$;

-- Мастер-данные: читают все приглашённые, пишут owner и pm
do $$
declare t text;
begin
  foreach t in array array[
    'employees','clients','client_contacts','projects','board_mappings',
    'rate_cards','task_types','task_type_mappings','calendars','fx_rates']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy read_app_users on app.%I for select to authenticated
       using (app.current_app_role() is not null)', t);
    execute format(
      'create policy write_owner_pm on app.%I for all to authenticated
       using (app.current_app_role() in (''owner'',''pm''))
       with check (app.current_app_role() in (''owner'',''pm''))', t);
  end loop;
end $$;

-- app_users: свою строку видит каждый; всё управление — owner
alter table app.app_users enable row level security;
create policy read_self on app.app_users for select to authenticated
  using (auth_user_id = auth.uid());
create policy owner_all on app.app_users for all to authenticated
  using (app.current_app_role() = 'owner')
  with check (app.current_app_role() = 'owner');

-- audit_log: читает owner; пишет только definer-триггер
alter table app.audit_log enable row level security;
create policy owner_read on app.audit_log for select to authenticated
  using (app.current_app_role() = 'owner');

-- sync_runs/sync_state: видят приглашённые (страница /admin/sync), пишет service_role
alter table app.sync_runs enable row level security;
create policy read_app_users on app.sync_runs for select to authenticated
  using (app.current_app_role() is not null);
alter table app.sync_state enable row level security;
create policy read_app_users on app.sync_state for select to authenticated
  using (app.current_app_role() is not null);
