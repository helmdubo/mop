# MOP v2 — Спецификация Фазы 0 (Фундамент) и Фазы 1 (Billing Pipeline)

> **Версия:** 1.1 — на ревью владельцу (биллинг переработан по образцу инвойса, D25–D29)
> **Основание:** DISCOVERY.md v0.5 (решения D1–D29)
> **Дата:** 2026-07-09

---

## 1. Область

**Фаза 0 — Фундамент:** новый репозиторий, CI, два окружения Supabase (staging + prod),
аутентификация и роли, audit log, реестр сотрудников (минимум), надёжный синк Kaiten,
маппинг структуры Kaiten на проекты, производственные календари, курсы валют,
импорт истории за 1–2 года.

**Фаза 1 — Billing Pipeline:** биллинг-период → пул завершённых задач → внутренний апрув
с корректировками → клиентские корректировки → инвойс → экспорт XLSX → реестр статусов.

**Вне области этих фаз:** утилизация/аналитика (Ф2), деньги/P&L/налоги (Ф3),
отпуска/посещаемость/развитие (Ф4), лицензии/offboarding (Ф5).
Но их таблицы, влияющие на модель (fx_rates, calendars), закладываются сейчас.

---

## 2. Архитектура

```
Vercel (Next.js 15 App Router, TypeScript strict)
 ├── UI: страницы под /(app), доступ через Supabase Auth (@supabase/ssr)
 ├── Server Actions: только через user-scoped клиент (RLS активен)
 └── /api/cron/sync: Vercel Cron, авторизация CRON_SECRET,
     внутри — service role (единственное место)

Supabase
 ├── prod-проект   ← миграции применяются CI только при merge в main
 ├── staging-проект ← миграции применяются CI на PR
 └── Postgres: схемы kaiten / app / analytics
```

### Принципы (уроки v1 — обязательные)
1. **RLS — реальный механизм.** Пользовательские запросы идут через сессионный клиент;
   service role живёт только в cron-синке. Политики по ролям, не `USING(true)`.
2. **Webhook'а нет** (D23). Свежесть данных обеспечивает cron: инкрементал каждый час,
   оконный replace time_logs ежедневно, полная сверка еженедельно.
3. **Все деструктивные операции синка — внутри Postgres-функций** (одна транзакция,
   advisory lock). Частичная запись невозможна.
4. **Миграции append-only**, применяются только через CI, никогда с рабочих веток.
5. **Ошибки синка видимы**: статус каждого запуска в UI, `records=0` — предупреждение,
   не успех.
6. **Ручные данные никогда не живут в `kaiten.*`.**

---

## 3. Роли и доступ

| Роль | Кто | Права |
|------|-----|-------|
| `owner` | Владелец | Всё, включая компенсации/премии/деньги; управление пользователями |
| `pm` | PM | Биллинг (готовит), инвойсы, проекты/клиенты, сотрудники (без денег), синк |
| `lead` | TeamLead | Чтение производственных данных и биллинга своей команды; без денег |

- `app.app_users`: связь `auth.users` → роль (+ `employee_id`, `active`).
  Деактивация — мгновенный отзыв доступа (middleware + RLS).
- Новые пользователи — только приглашением Owner (email allowlist). Self-signup выключен.
- Матрица доступа реализуется RLS-политиками по `app.current_role()`
  (SQL-функция, читающая роль из `app_users` по `auth.uid()`).
- Таблицы Фазы 3+ с деньгами (`compensations`, `bonuses`, `transactions`, …):
  политика только `owner` — закладывается сразу.
- `app.audit_log`: пишется триггерами на INSERT/UPDATE/DELETE мастер-таблиц
  (actor из `auth.uid()`); читает только `owner`.

---

## 4. Схема БД (DDL, сокращённо — полные миграции при имплементации)

### 4.1 `kaiten.*` — зеркало (без FK, без ручных полей)

```sql
create schema kaiten;

-- Общий шаблон: id bigint pk, поля, kaiten_updated_at, synced_at, raw jsonb
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
  state text,                    -- active / done / archived
  archived boolean not null default false,
  estimate_minutes integer,
  completed_at timestamptz,
  kaiten_created_at timestamptz,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);

create table kaiten.time_logs (
  id bigint primary key,
  card_id bigint not null,
  user_id bigint not null,
  minutes integer not null,
  log_date date not null,        -- за какую дату списано
  comment text,
  kaiten_created_at timestamptz,
  kaiten_updated_at timestamptz,
  synced_at timestamptz not null,
  raw jsonb not null
);
create index on kaiten.time_logs (log_date);
create index on kaiten.time_logs (user_id, log_date);
create index on kaiten.time_logs (card_id);

create table kaiten.tags (
  id bigint primary key, name text not null, synced_at timestamptz not null, raw jsonb not null
);
create table kaiten.card_types (
  id bigint primary key, name text not null, synced_at timestamptz not null, raw jsonb not null
);
```

Нет `payload_hash`, нет `columns/lanes/roles/property_definitions/space_members` —
добавим, только когда появится читающая их фича (урок v1: ни одной таблицы «на будущее»).

### 4.2 `app.*` — инфраструктура синка

```sql
create schema app;

create table app.sync_runs (
  id bigserial primary key,
  entity text not null,                  -- 'cards' | 'time_logs' | ...
  mode text not null,                    -- 'incremental' | 'window_replace' | 'full'
  status text not null default 'running',-- running | completed | failed
  window_from date, window_to date,
  stats jsonb,                           -- {fetched, upserted, deleted}
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table app.sync_state (
  entity text primary key,
  last_cursor timestamptz               -- max(kaiten_updated_at) успешного инкрементала
);
```

**Транзакционный replace (сердце надёжности):**

```sql
-- Вызывается из cron-роута через RPC. Всё в одной транзакции.
create function app.replace_time_logs(p_from date, p_to date, p_rows jsonb)
returns jsonb language plpgsql security definer as $$
declare v_deleted int; v_inserted int;
begin
  -- один replace за раз на всю таблицу
  perform pg_advisory_xact_lock(hashtext('replace_time_logs'));

  delete from kaiten.time_logs where log_date between p_from and p_to;
  get diagnostics v_deleted = row_count;

  insert into kaiten.time_logs
  select * from jsonb_populate_recordset(null::kaiten.time_logs, p_rows);
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted);
end $$;
```

Аналогичная функция — для полной сверки cards (upsert + пометка исчезнувших archived).

### 4.3 `app.*` — мастер-данные Фаз 0–1

```sql
-- Люди (минимум Фазы 0; HR-поля добавит Фаза 4)
create table app.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  country text not null check (country in ('RU','KG','AM','GE')),
  employment_type text not null check (employment_type in ('staff','contractor')),
  hire_date date not null,
  probation_end_date date,
  termination_date date,
  status text not null default 'active' check (status in ('probation','active','terminated')),
  kaiten_user_id bigint unique,          -- связь с зеркалом; NULL = не работает в Kaiten
  grade text,                            -- junior/middle/senior/lead (справочник позже)
  role_title text,
  team_id uuid,                          -- FK добавится с teams (D24), nullable
  sick_leave_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Клиенты и проекты
create table app.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact jsonb,
  created_at timestamptz not null default now()
);

create table app.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  name text not null,
  kaiten_space_id bigint unique,         -- space = проект
  status text not null default 'active' check (status in ('active','on_hold','completed')),
  invoice_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- Классификация досок (billable/…): ключевой конфиг
create table app.board_mappings (
  kaiten_board_id bigint primary key,
  project_id uuid references app.projects(id),
  billing_class text not null
    check (billing_class in ('billable','administration','non_billable','time_off','ignore')),
    -- administration: внутренние/административные часы, которые БИЛЛЯТСЯ клиенту
    -- отдельной строкой по проекту (образец инвойса); семантику подтвердить (Q1 р.4)
  updated_by uuid, updated_at timestamptz not null default now()
);

-- Рейт-карты (D6): без перекрытия периодов
create extension if not exists btree_gist;
create table app.rate_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  project_id uuid references app.projects(id),   -- NULL = дефолт клиента
  hourly_rate numeric(10,2) not null,
  currency text not null default 'USD',
  valid_from date not null,
  valid_to date,                                  -- NULL = по настоящее время
  exclude using gist (
    client_id with =, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(valid_from, coalesce(valid_to,'infinity'::date), '[]') with &&
  )
);

-- Справочники Фазы 0, нужные позже повсеместно
create table app.calendars (            -- производственные календари стран (D13)
  country text not null check (country in ('RU','KG','AM','GE')),
  day date not null,
  day_type text not null check (day_type in ('workday','weekend','holiday','short_day')),
  work_hours numeric(3,1) not null default 8,
  primary key (country, day)
);

create table app.fx_rates (             -- D19
  currency text not null,
  day date not null,
  rate_to_usd numeric(14,6) not null,
  source text not null default 'auto',  -- auto | manual
  primary key (currency, day)
);

-- Пользователи приложения и аудит
create table app.app_users (
  auth_user_id uuid primary key,        -- = auth.users.id
  email text not null unique,
  role text not null check (role in ('owner','pm','lead')),
  employee_id uuid references app.employees(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table app.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,                            -- auth.uid(), NULL = система/синк
  action text not null,                  -- insert | update | delete | login | export ...
  entity text not null, entity_id text,
  before jsonb, after jsonb
);
```

### 4.4 `app.*` — Billing Pipeline (Фаза 1)

Модель следует реальному артефакту (образец «MimirHead to Gaijin», D25–D29):
инвойс — на **клиента**, охватывает несколько проектов; строка клиенту — **ассет**
(родительская карточка) с pivot'ом часов по типам работ; администрирование — отдельные
строки по проекту; клиентский апрув — на уровне строки-ассета.

```sql
-- Справочник типов работ = колонок инвойса (D26)
create table app.task_types (
  code text primary key,                 -- 'blockout','lod00','materials','cls',...
  invoice_label text not null,           -- 'ref/blockout','lods/cls',...
  sort_order integer not null default 0
);

-- Маппинг Kaiten → тип работ: тег ИЛИ тип child-карточки
create table app.task_type_mappings (
  id uuid primary key default gen_random_uuid(),
  task_type text not null references app.task_types(code),
  kaiten_tag_id bigint,
  kaiten_card_type_id bigint,
  check (kaiten_tag_id is not null or kaiten_card_type_id is not null)
);

create table app.billing_periods (       -- клиент × период (D25)
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in
    ('draft','internal_review','client_review','approved','invoiced')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (client_id, period_start, period_end)
);

-- Внутренняя гранула: (ассет × тип работ × сотрудник) за период.
-- Для экспорта агрегируется в строку-ассет с pivot'ом по task_type.
create table app.billing_items (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null references app.billing_periods(id) on delete cascade,
  project_id uuid not null references app.projects(id),
  line_kind text not null default 'asset_work'
    check (line_kind in ('asset_work','administration')),  -- D29
  asset_card_id bigint,                  -- родительская карточка (NULL для administration)
  asset_title text,                      -- снапшот названия ассета
  task_type text references app.task_types(code),
  kaiten_card_id bigint,                 -- конкретная child-карточка (источник логов)
  employee_id uuid references app.employees(id),
  kaiten_user_id bigint,
  hours_raw numeric(7,2) not null,       -- сумма логов из зеркала (иммутабельна)
  hours_internal numeric(7,2) not null,  -- после внутреннего среза
  internal_reason text,                  -- обязателен при изменении (D12)
  hours_client numeric(7,2),             -- после ответа клиента
  client_reason text,
  updated_by uuid, updated_at timestamptz not null default now(),
  check (hours_internal = hours_raw or internal_reason is not null),
  check (hours_client is null or hours_client = hours_internal or client_reason is not null)
);
create unique index on app.billing_items
  (billing_period_id, coalesce(asset_card_id,0), coalesce(kaiten_card_id,0),
   coalesce(task_type,''), coalesce(kaiten_user_id,0), line_kind, project_id);

-- Статус строки-ассета глазами клиента (чекбоксы approved / in payment, D28)
create table app.billing_asset_status (
  billing_period_id uuid not null references app.billing_periods(id) on delete cascade,
  project_id uuid not null,
  asset_card_id bigint not null,
  client_approved boolean not null default false,
  in_payment boolean not null default false,
  primary key (billing_period_id, project_id, asset_card_id)
);

create table app.invoices (              -- на клиента, мультипроектный (D25)
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references app.clients(id),
  billing_period_id uuid not null references app.billing_periods(id),
  number text not null unique,           -- INV-2026-001, шаблон настраиваемый
  currency text not null,
  hours_total numeric(9,2) not null,
  amount_total numeric(12,2) not null,   -- Σ по проектам: часы × ставка (снапшот)
  status text not null default 'draft' check (status in ('draft','sent','signed','paid')),
  issued_at date, sent_at date, signed_at date, paid_at date,
  created_at timestamptz not null default now()
);

-- Финансовая детализация: строка = проект (часы, ставка-снапшот, сумма)
create table app.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references app.invoices(id) on delete cascade,
  project_id uuid not null references app.projects(id),
  description text not null,             -- 'Active Matter: production + administration'
  hours numeric(9,2) not null,
  hourly_rate numeric(10,2) not null,    -- снапшот из rate_cards на дату периода
  amount numeric(12,2) not null,
  sort_order integer not null default 0
);
```

**Жизненный цикл периода (state machine, переходы проверяются в server actions):**

```
draft ──(PM: сформировать пул)──▶ internal_review
internal_review ──(Owner: апрув)──▶ client_review     [правки hours_internal + причины]
client_review ──(PM/Owner: ответы клиента: чекбоксы по ассетам,
                 срезы hours_client + причины)──▶ approved
approved ──(создан инвойс)──▶ invoiced
любой статус кроме invoiced ──(Owner)──▶ шаг назад (с записью в audit_log)
```

Формирование пула (`draft → internal_review`): по каждому проекту клиента выбрать
закрытые карточки billable-досок с логами в периоде; свернуть child-карточки к
родителю-ассету; определить `task_type` по маппингу (тег/тип child); строки без
маппинга — в тип `misc` с предупреждением. `hours_raw` = сумма минут по грануле;
`hours_internal := hours_raw`. Administration-строки формируются из досок класса
`administration` (по одной строке на проект). Пересборка пула возможна только в
`draft`/`internal_review` и не трогает введённые корректировки (merge по ключу).

`specification` для строки-ассета генерируется из фактических типов работ
(+ ручное редактирование перед экспортом).

### 4.5 `analytics.*` — Фаза 1 (минимум)

```sql
create schema analytics;
-- v_billing_period_summary: часы raw/internal/client, срезано по сотруднику и типу задач
-- v_unmatched_kaiten_users: логи от юзеров без app.employees (контроль качества данных)
```

---

## 5. Синк Kaiten — дизайн

### Расписание (Vercel Cron)
| Job | Частота | Что делает |
|-----|---------|-----------|
| `sync-hot` | каждый час | spaces, boards, users — полный upsert (объёмы копеечные); cards — инкрементал по `updated` (курсор `sync_state`) |
| `sync-timelogs` | ежедневно 03:00 UTC | `replace_time_logs(today-45, today)` — окно покрывает ретро-логирование и правки (D4) |
| `sync-reconcile` | еженедельно вс | полная сверка cards (archived/deleted) + `replace_time_logs` скользящими окнами по месяцу за последние 13 месяцев |

### Клиент API
- Обёртка `fetchKaiten`: таймаут, ретраи с экспоненциальным backoff на 429/5xx (3 попытки),
  жёсткий бюджет 5 req/s (token bucket).
- Ответ неожиданной формы (не массив) = **ошибка**, не «0 записей».
- Пагинация offset'ом; страница логируется в `sync_runs.stats`.

### Гарантии
- Каждый запуск = строка `sync_runs`; упавший — `failed` с текстом ошибки.
- Все delete+insert — только через RPC-функции (§4.2): транзакция + advisory lock.
- Повторный запуск любого джоба идемпотентен.
- UI `/admin/sync`: последние запуски, статусы, кнопки ручного запуска (роль pm+),
  предупреждение, если последний успешный синк старше 26 часов.

### Импорт истории (разовая процедура Фазы 0)
Скрипт: full sync справочников → cards полностью → `replace_time_logs` помесячно
за 24 месяца (последовательно, с паузами под rate limit). Прогресс — в `sync_runs`.

---

## 6. Экраны Фаз 0–1

| Маршрут | Роли | Содержимое |
|---------|------|-----------|
| `/login` | все | Вход (email+пароль / magic link) |
| `/` | все | Кокпит-заглушка: статус синка, активные периоды биллинга, последние инвойсы |
| `/admin/users` | owner | Пользователи приложения: пригласить, роль, деактивировать |
| `/admin/sync` | owner, pm | Статусы запусков, ручной запуск, health |
| `/admin/mapping` | owner, pm | Space→проект; таблица досок с классами billable/…; непромапленные доски — красным |
| `/employees` | owner, pm, lead | Реестр, связь с kaiten_user (страница показывает несматченных юзеров Kaiten) |
| `/clients` | owner, pm | Клиенты + рейт-карты (историчность ставок) |
| `/billing` | owner, pm, lead* | Список периодов по проектам, статусы |
| `/billing/[id]` | owner, pm, lead* | Таблица items: raw → internal → client, причины, итоги; переходы статусов |
| `/invoices` | owner, pm | Реестр: номер, сумма, статусы sent/signed/paid, экспорт XLSX |

\* lead — read-only, только свои проекты (Фаза 1 может отложить lead-доступ).

UI-скелет: левая навигация по доменам, верхняя панель — иерархия (проект/период),
правая выдвижная панель-инспектор (детали строки биллинга: логи, комментарии, история
корректировок из audit_log). Библиотека: Tailwind + shadcn/ui (реально установить).

**Экспорт акта часов** (XLSX, воспроизводит образец «MimirHead to Gaijin»):
строки-ассеты; колонки: `tasks | hours | <task_types по sort_order> | specification |
project | art manager | approved | in payment`; футер: `administration <Project>`,
`total <Project>` по каждому проекту, общий `total`, `total paid`. Денег в акте нет.
Финансовый инвойс (Word/PDF, часы × ставка по проектам) — отдельный экспорт,
формат уточняется (Q2 р.4). PM вставляет акт в Google Sheets шаблон клиента;
интеграция Sheets API — Фаза 5 (D18).

---

## 7. Тесты и CI (обязательный минимум)

- **CI на PR:** `npm ci && build && lint && test` + применение миграций к staging.
- **CI на merge в main:** миграции к prod, деплой Vercel.
- **Юнит:** state machine биллинг-периода (все переходы и запреты), CHECK-инварианты
  корректировок, генерация номера инвойса, расчёт `hours_raw` из логов.
- **Интеграционные (supabase local):** `replace_time_logs` — атомарность (падение вставки
  не удаляет данные), advisory lock (конкурентные вызовы), инкрементальный курсор.
- **Синк-контракт:** фикстуры реальных ответов Kaiten (снятые с прод-аккаунта) →
  трансформация → строки таблиц.

---

## 8. Definition of Done фаз

**Фаза 0:** новый пользователь входит по приглашению; синк работает по крону ≥ недели без
ручных вмешательств; история 24 мес. загружена; все доски промаплены; несматченные
юзеры Kaiten = 0; CI зелёный; в `kaiten.*` нет ни одного ручного поля.

**Фаза 1:** один реальный месячный инвойс текущего клиента проведён через pipeline
целиком (пул → внутренний срез → клиентский апрув → XLSX → sent → signed → paid)
и сумма совпала с фактическим инвойсом, выставленным по старому процессу (параллельный прогон).

---

## 9. Что нужно от владельца до старта имплементации

1. ~~Создать новый GitHub-репозиторий~~ — ✅ `helmdubo/mop`.
2. Создать два проекта Supabase (prod, staging) — инструкция: `docs/SUPABASE_SETUP.md`.
3. ~~Образец текущего инвойса~~ — ✅ получен, модель биллинга обновлена (D25–D29).
4. Ответить на вопросы **раунда 4** (DISCOVERY §8): administration-часы, финансовый
   инвойс, механика ассет/child-карточки, `in payment`/`total paid`, art manager.
5. Подтвердить D18 (экспорт XLSX как v1 инвойса).
6. Остаточные вопросы Фаз 3–4 (больничные %, сдвиг отпуска, налоговые ставки) —
   собрать заранее, не блокируют.
