-- Фундамент синка: гранты service_role, модель "проект = тег" (по разведке
-- KAITEN_STRUCTURE.md), сиды клиента/проектов/досок/рейт-карты.

-- 1. Supabase НЕ выдаёт service_role гранты в кастомных схемах автоматически.
--    Синк (единственный писатель зеркала) работает под service_role.
grant usage on schema kaiten to service_role;
grant usage on schema app to service_role;
grant all on all tables in schema kaiten to service_role;
grant all on all tables in schema app to service_role;
grant usage on all sequences in schema app to service_role;
alter default privileges in schema kaiten grant all on tables to service_role;
alter default privileges in schema app grant all on tables to service_role;
grant execute on function app.replace_time_logs(date, date, jsonb) to service_role;

-- 2. Проект определяется ТЕГОМ карточки, клиент — space'ом (не как в discovery)
alter table app.clients add column kaiten_space_id bigint unique;
alter table app.projects drop column kaiten_space_id;

create table app.project_tag_mappings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references app.projects(id),
  kaiten_tag_id bigint not null unique,
  kaiten_tag_name text
);
alter table app.project_tag_mappings enable row level security;
create policy read_app_users on app.project_tag_mappings for select to authenticated
  using (app.current_app_role() is not null);
create policy write_owner_pm on app.project_tag_mappings for all to authenticated
  using (app.current_app_role() in ('owner','pm'))
  with check (app.current_app_role() in ('owner','pm'));
create trigger project_tag_mappings_audit
  after insert or update or delete on app.project_tag_mappings
  for each row execute function app.audit();

-- 3. Сиды (реальные ID с mimirhead.kaiten.ru, разведка 2026-07-10)
insert into app.clients (name, admin_percent, kaiten_space_id)
values ('Gaijin', 18, 525309)
on conflict (kaiten_space_id) do nothing;

insert into app.projects (client_id, name)
select c.id, p.name
from app.clients c,
     (values ('Active Matter'), ('Enlisted'), ('Line of Contact'), ('War Thunder')) p(name)
where c.kaiten_space_id = 525309
  and not exists (select 1 from app.projects pr where pr.name = p.name);

insert into app.project_tag_mappings (project_id, kaiten_tag_id, kaiten_tag_name)
select pr.id, m.tag_id, m.tag_name
from (values
  ('Active Matter',   758734::bigint, 'AM'),
  ('Enlisted',        758743::bigint, 'Enlisted'),
  ('Line of Contact', 1008887::bigint, 'LoC'),
  ('War Thunder',     758735::bigint, 'WT')
) m(project_name, tag_id, tag_name)
join app.projects pr on pr.name = m.project_name
on conflict (kaiten_tag_id) do nothing;

insert into app.board_mappings (kaiten_board_id, billing_class) values
  (1201225, 'billable'),      -- Gaijin Art Midpoly pipeline
  (1203629, 'billable'),      -- Gaijin Art Highpoly pipeline
  (1203535, 'billable'),      -- На паузе
  (1201120, 'non_billable'),  -- Координация проекта
  (1605377, 'non_billable'),  -- Внутренние процессы
  (1202097, 'ignore'),        -- Эпики
  (1210877, 'time_off'),      -- Отпуска
  (1210940, 'time_off'),      -- Обзор (space отпусков)
  (1608821, 'time_off'),      -- Overtime&DayOff
  (1606448, 'ignore'),        -- HR: 1x1
  (1606461, 'ignore')         -- HR: Обзор
on conflict (kaiten_board_id) do nothing;

insert into app.rate_cards (client_id, hourly_rate, currency, valid_from)
select id, 25, 'USD', date '2024-01-01'
from app.clients
where kaiten_space_id = 525309
  and not exists (select 1 from app.rate_cards);
