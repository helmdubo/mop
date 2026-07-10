# Kaiten — фактическая структура (разведка по API, 2026-07-10)

> Источник: живой аккаунт mimirhead.kaiten.ru, точечные запросы к API.
> Этот документ — контракт для движка синка и маппинга.

## Spaces (3)

| ID | Название | Роль |
|----|----------|------|
| 525309 | Gaijin tasks | **Весь клиент Gaijin** (все его проекты) |
| 530000 | Отпуска и отгулы | Attendance (Фаза 4) |
| 709240 | HR | 1x1 и HR-процессы (Фаза 4+) |

⚠️ **Ключевая поправка к discovery:** space ≠ проект. Space = клиент (или домен),
а **проект определяется ТЕГОМ карточки**: `AM` (Active Matter), `Enlisted`,
`LoC` (Line of Contact), `WT` (War Thunder). В образце инвойса WT не было —
проектов минимум четыре.

## Доски

**Gaijin tasks (525309):**
| ID | Название | Предполагаемый класс |
|----|----------|---------------------|
| 1201225 | Gaijin Art Midpoly pipeline | billable |
| 1203629 | Gaijin Art Highpoly pipeline | billable |
| 1201120 | Координация проекта | non_billable (координация/митинги) |
| 1202097 | Эпики | структурная (эпики) |
| 1203535 | На паузе | billable (отложенные) |
| 1605377 | Внутренние процессы | non_billable |

**Отпуска и отгулы (530000):** Отпуска · Обзор · Overtime&DayOff
**HR (709240):** 1x1 · Обзор — *студия уже ведёт 1x1 в Kaiten; Фаза 4 может
синхронизировать их вместо ручного ввода.*

## Типы карточек = типы работ (колонки инвойса)

**Этапы производства (child-карточки):**
`ref/blockout` (500715) · `lod00` (500714) · `Texture/Materials` (438150) ·
`lods/cls` (500716) · `Destr` (438153) · `Dmg` (438154) · `set dressing` (500718) ·
`misc` (500727) · `set dressing (deprecated)` (500717)

Highpoly pipeline: `HP` (501878) · `LP` (501879) · `Atlas` (501880) · `Bake` (501883)
— в образце инвойса этих колонок нет; уточнить, как биллится highpoly.

**Ассеты/структура:** `MP asset` (438149) · `Unique asset` (438148) · `Task` (438145) ·
`Epic` (438146) · `Sub-task` (438151) · `Card` (1)

**Attendance/HR:** `Отпуск` (441407) · `Отгул` (441412) · `sick day` (587031) ·
`Overtime` (586969) · `Day Off` (586970) · `Internal` (584618) · `Retro` (584619) ·
`Adaptation` (584620)

## Теги (18)

- **Проекты:** AM, Enlisted, LoC, WT
- **Категории ассетов:** prop, architecture, vehicle, interior, environment, decor,
  unique, texture, midpoly, refactoring
- **Годы:** 2024, 2025, 2026; прочее: africa

## Иерархия карточек (проверено на живых данных)

```
MP asset 'is_hotel_roulette/_blackjack_table' (type_id 438149, board Midpoly)
 ├── time_spent_sum: 780 мин  ← логи есть и НА РОДИТЕЛЕ
 ├── children_ids: [3 шт]      ← этапы (ref/blockout, lod00, ...)
 └── children_number_properties_sum.time_spent_sum: 870 мин  ← логи детей
```

**Часы ассета = собственные логи родителя + логи всех child.** Пул биллинга
обязан собирать по всему поддереву, а не только по child.

## time-logs API

- `GET /api/latest/time-logs` — параметры **from/to ОБЯЗАТЕЛЬНЫ** (без них 4xx).
- Поля: `id, card_id, user_id, author_id, role_id, time_spent (минуты),
  for_date, comment, created, updated, uid` + вложенный объект `card` (режем при записи).
- `updated` присутствует → ретро-правки детектируемы, но выборка всё равно оконная
  по `for_date` ⇒ стратегия оконного replace остаётся верной.

## cards API

- `updated_after` работает (проверено) → **инкрементальный синк карточек возможен**.
- Архивные карточки возвращаются в выдаче (archived: true) — отдельного
  reconcile-обхода для них не требуется, но еженедельную сверку оставляем.
- Полезные поля: `type_id, tags, parents_ids/children_ids, board_id, column_id,
  state, condition, archived, completed_at, time_spent_sum, estimate_workload,
  children_number_properties_sum, files, external_id, properties`.

## Кастомные поля компании

| ID | Название | Тип |
|----|----------|-----|
| 503755 | Оплата | checkbox |
| 418880 | Порядок отпуска | select |
| 418941 | Начало отпуска | date |
| 416111 / 522866 | Сложность | select / collective_score |
| 416112 | Проверяющий | user |
| 416110 | Описание оценки | string |
| 416113 | Jira issue key | string |
| 418959 / 507349 | Процент времени от оценки / Общее время | formula |

## Пользователи

18 аккаунтов; ключевые поля: `id, full_name, email, activated, locked, last_request_date`.

## Поправки к модели БД (внести с миграцией движка синка)

1. **`app.project_tag_mappings`** (kaiten_tag_id → project_id) — проект определяется
   тегом. `projects.kaiten_space_id` → заменить связью клиент ↔ space
   (`clients.kaiten_space_id` или таблица маппинга).
2. `task_type_mappings.kaiten_card_type_id` — уже поддержано ✓ (маппим типы карточек,
   не теги).
3. Сборка пула биллинга: часы поддерева ассета (родитель + children), а карточки
   без родителя типа `Task`/`MP asset` — сами себе ассет.
4. Attendance (Фаза 4): источник — space 530000, типы карточек Отпуск/Отгул/sick
   day/Overtime/Day Off (+ кастомные поля «Порядок/Начало отпуска»).
5. Уточнить у владельца: как биллятся HP/LP/Atlas/Bake (highpoly) — отдельные
   колонки акта или сворачиваются в существующие?
