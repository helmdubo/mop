-- Каркас MOP (принцип D37): собственные сущности первичны и живут независимо
-- от Kaiten; связь с Kaiten опциональна и устанавливается вручную.
-- Проект существует с пресейла — в Kaiten он появится только в продакшене.

alter table app.projects drop constraint projects_status_check;
alter table app.projects add constraint projects_status_check
  check (status in ('presale','active','on_hold','completed','archived'));
alter table app.projects alter column status set default 'presale';
alter table app.projects add column notes text;

-- Мини-команды (D24): производственные единицы 3-4 человека с наставником
create table app.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  project_id uuid references app.projects(id),
  mentor_employee_id uuid references app.employees(id),
  active boolean not null default true
);
alter table app.employees
  add constraint employees_team_fk foreign key (team_id) references app.teams(id);

grant select, insert, update, delete on app.teams to authenticated;
alter table app.teams enable row level security;
create policy read_app_users on app.teams for select to authenticated
  using (app.current_app_role() is not null);
create policy write_owner_pm on app.teams for all to authenticated
  using (app.current_app_role() in ('owner','pm'))
  with check (app.current_app_role() in ('owner','pm'));
create trigger teams_audit after insert or update or delete on app.teams
  for each row execute function app.audit();
