# Supabase — пошаговая настройка (prod + staging)

> Делается один раз, ~20 минут. Free-тариф позволяет 2 активных проекта — нам ровно столько.

## Шаг 1. Вход

1. Откройте [supabase.com](https://supabase.com) → **Sign in** → войдите через GitHub
   (тот же аккаунт `helmdubo`).
2. Если предложит создать организацию — создайте личную (Free plan).

## Шаг 2. Создать два проекта

Для каждого из двух проектов: **New project** →

| Поле | prod | staging |
|------|------|---------|
| Name | `mop-prod` | `mop-staging` |
| Database Password | **Generate** → сохранить в менеджер паролей | то же, свой пароль |
| Region | EU Central (Frankfurt) | EU Central (Frankfurt) |
| Plan | Free | Free |

⚠️ Пароль БД показывается один раз. Сохраните оба — они понадобятся для CI-миграций.

Проект создаётся 1–2 минуты.

## Шаг 3. Собрать ключи (для каждого проекта)

Проект → **Settings → API**:

- **Project URL** — вида `https://abcdefgh.supabase.co`
- **Project Ref** — строка `abcdefgh` (она же в URL)
- **anon / public key** — публичный ключ (можно пересылать)
- **service_role key** — 🔒 СЕКРЕТ. Никогда не вставлять в чат, git, документы.

## Шаг 4. Настроить аутентификацию (в обоих проектах)

1. **Authentication → Sign In / Up → Email**: включён.
2. Там же выключить **"Allow new users to sign up"** — доступ в MOP только
   по приглашению Owner.
3. **Authentication → URL Configuration** — заполним после первого деплоя Vercel
   (адрес приложения).

## Шаг 4.5. Открыть схемы API (в обоих проектах!)

**Settings → API → Exposed schemas**: добавить к `public` схемы **`app`** и **`kaiten`**.
Без этого приложение получит 406 на каждый запрос (грабли v1).

## Шаг 5. Access Token для CI

1. Аватар (правый верхний угол) → **Account Settings → Access Tokens**.
2. **Generate new token**, имя `mop-ci`. Сохранить (показывается один раз).

## Шаг 6. Разложить секреты

### GitHub → репозиторий `mop` → Settings → Secrets and variables → Actions → New repository secret

| Secret | Значение |
|--------|----------|
| `SUPABASE_ACCESS_TOKEN` | токен из шага 5 |
| `SUPABASE_PROJECT_REF_PROD` | ref `mop-prod` |
| `SUPABASE_PROJECT_REF_STAGING` | ref `mop-staging` |
| `SUPABASE_DB_PASSWORD_PROD` | пароль БД `mop-prod` |
| `SUPABASE_DB_PASSWORD_STAGING` | пароль БД `mop-staging` |

### Vercel (после создания проекта из репо `mop`) → Settings → Environment Variables

| Переменная | Значение | Окружение |
|------------|----------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL `mop-prod` | Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon `mop-prod` | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role `mop-prod` | Production |
| `NEXT_PUBLIC_SUPABASE_URL` (+anon, +service) | ключи `mop-staging` | Preview |
| `KAITEN_API_URL` | `https://<компания>.kaiten.ru` | Production + Preview |
| `KAITEN_API_TOKEN` | токен Kaiten | Production + Preview |
| `CRON_SECRET` | сгенерировать: `openssl rand -hex 32` | Production |

## Шаг 7. Первый пользователь (owner)

Выполняется в **обоих** проектах после применения миграций:

1. **Authentication → Users → Add user → Create new user**: ваш email + пароль
   (галочку Auto Confirm — включить).
2. **SQL Editor** → выполнить:

```sql
insert into app.app_users (auth_user_id, email, role)
select id, email, 'owner' from auth.users
where email = 'ВАШ_EMAIL'
on conflict (auth_user_id) do nothing;
```

## Шаг 8. Сообщить агенту

Пришлите в чат (это НЕ секреты):
- Project URL / Ref обоих проектов;
- anon-ключи обоих проектов (по желанию — можно и не присылать, тогда
  укажете их только в Vercel сами).

**Не присылайте**: service_role ключи, пароли БД, access token — они
кладутся только в GitHub Secrets / Vercel по таблицам выше.

После этого агент поднимает: миграции схемы, CI (staging на PR, prod на merge),
скелет приложения с auth.
