-- Фаза 1: Billing Pipeline — периоды, строки пула, статусы ассетов.
-- Семантика (ответы владельца): период определяет СОСТАВ пула (какие ассеты
-- приняты), биллятся ВСЕ накопленные часы ассета; кандидат в пул = карточка
-- в статусе done (state='3') на billable-доске, ещё не биллившаяся ранее.

create table app.billing_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  period_start date not null,
  period_end date not null,
  admin_percent numeric(5,2) not null,   -- снапшот clients.admin_percent
  status text not null default 'draft' check (status in
    ('draft','internal_review','client_review','approved','invoiced')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (client_id, period_start, period_end)
);

-- Гранула: (ассет × карточка-этап × пользователь). Ассет может иметь
-- собственные логи — тогда kaiten_card_id = asset_card_id.
create table app.billing_items (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null references app.billing_periods(id) on delete cascade,
  project_id uuid references app.projects(id),      -- по тегу; NULL = тег не смаплен
  asset_card_id bigint not null,
  asset_title text not null,
  kaiten_card_id bigint not null,
  stage_title text,
  task_type text references app.task_types(code),
  kaiten_user_id bigint,
  employee_id uuid references app.employees(id),
  hours_raw numeric(8,2) not null,
  hours_internal numeric(8,2) not null,
  internal_reason text,
  hours_client numeric(8,2),
  client_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (hours_internal = hours_raw or internal_reason is not null),
  check (hours_client is null or hours_client = hours_internal or client_reason is not null)
);
create unique index billing_items_grain_uq on app.billing_items
  (billing_period_id, kaiten_card_id, coalesce(kaiten_user_id, 0));
create index billing_items_asset_idx on app.billing_items (asset_card_id);
create index billing_items_period_idx on app.billing_items (billing_period_id);

-- Статус строки-ассета: клиентский апрув, art manager клиента, specification
create table app.billing_asset_status (
  billing_period_id uuid not null references app.billing_periods(id) on delete cascade,
  project_id uuid references app.projects(id),
  asset_card_id bigint not null,
  client_approved boolean not null default false,
  art_manager_id uuid references app.client_contacts(id),
  specification text,
  primary key (billing_period_id, asset_card_id)
);

-- RLS + гранты (baseline-гранты выдавались "on all tables" до создания этих таблиц)
grant select, insert, update, delete
  on app.billing_periods, app.billing_items, app.billing_asset_status to authenticated;

do $$
declare t text;
begin
  foreach t in array array['billing_periods','billing_items','billing_asset_status']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy read_app_users on app.%I for select to authenticated
       using (app.current_app_role() is not null)', t);
    execute format(
      'create policy write_owner_pm on app.%I for all to authenticated
       using (app.current_app_role() in (''owner'',''pm''))
       with check (app.current_app_role() in (''owner'',''pm''))', t);
    execute format(
      'create trigger %I_audit after insert or update or delete on app.%I
       for each row execute function app.audit()', t, t);
  end loop;
end $$;

-- Кандидаты в пул: done-ассеты billable-досок клиента, ещё не биллившиеся.
-- Возвращает плоские строки (ассет/этап × пользователь × часы), сборка — в приложении.
create or replace function app.billing_pool_candidates(p_client_id uuid)
returns table (
  asset_card_id bigint,
  card_id bigint,
  title text,
  is_asset boolean,
  type_id bigint,
  tag_ids bigint[],
  archived boolean,
  completed_at timestamptz,
  user_id bigint,
  hours numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with billable_boards as (
    select bm.kaiten_board_id
    from app.board_mappings bm
    join kaiten.boards b on b.id = bm.kaiten_board_id
    join app.clients c on c.kaiten_space_id = b.space_id
    where bm.billing_class = 'billable' and c.id = p_client_id
  ),
  assets as (
    select c.*
    from kaiten.cards c
    join billable_boards bb on bb.kaiten_board_id = c.board_id
    where c.state = '3'
      and coalesce(array_length(c.parent_ids, 1), 0) = 0
      and not exists (
        select 1 from app.billing_items bi where bi.asset_card_id = c.id
      )
  ),
  stages as (
    select ch.id, ch.title, ch.type_id, ch.tag_ids, ch.archived, ch.completed_at,
           a.id as asset_id
    from kaiten.cards ch
    join assets a on a.id = any(ch.parent_ids)
  ),
  all_cards as (
    select id as asset_card_id, id as card_id, title, true as is_asset,
           type_id, tag_ids, archived, completed_at
    from assets
    union all
    select asset_id, id, title, false, type_id, tag_ids, archived, completed_at
    from stages
  )
  select ac.asset_card_id, ac.card_id, ac.title, ac.is_asset, ac.type_id,
         ac.tag_ids, ac.archived, ac.completed_at,
         tl.user_id, round(sum(tl.minutes) / 60.0, 2) as hours
  from all_cards ac
  left join kaiten.time_logs tl on tl.card_id = ac.card_id
  group by ac.asset_card_id, ac.card_id, ac.title, ac.is_asset, ac.type_id,
           ac.tag_ids, ac.archived, ac.completed_at, tl.user_id
$$;

grant execute on function app.billing_pool_candidates(uuid) to authenticated;
grant execute on function app.billing_pool_candidates(uuid) to service_role;

-- Сид: art manager клиента из образца инвойса
insert into app.client_contacts (client_id, full_name, role)
select id, 'Oleg Postavnichev', 'art manager'
from app.clients
where kaiten_space_id = 525309
  and not exists (
    select 1 from app.client_contacts cc where cc.full_name = 'Oleg Postavnichev'
  );
