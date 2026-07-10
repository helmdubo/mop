-- Уточнение владельца: колонки акта = ВСЕ стадии обоих пайплайнов
-- (midpoly + unique/highpoly). В образце инвойса HP/LP/Atlas/Bake не было
-- только потому, что в тот период таких задач не попало.

insert into app.task_types (code, invoice_label, sort_order) values
  ('hp',    'HP',    90),
  ('lp',    'LP',    100),
  ('atlas', 'Atlas', 110),
  ('bake',  'Bake',  120)
on conflict (code) do nothing;

-- Один тип карточки Kaiten может указывать только на один тип работ
create unique index if not exists task_type_mappings_card_type_uq
  on app.task_type_mappings (kaiten_card_type_id) where kaiten_card_type_id is not null;
create unique index if not exists task_type_mappings_tag_uq
  on app.task_type_mappings (kaiten_tag_id) where kaiten_tag_id is not null;

-- Маппинг: реальные ID типов карточек mimirhead.kaiten.ru (разведка 2026-07-10)
insert into app.task_type_mappings (task_type, kaiten_card_type_id) values
  ('blockout',     500715), -- ref/blockout
  ('lod00',        500714), -- lod00
  ('materials',    438150), -- Texture/Materials
  ('cls',          500716), -- lods/cls
  ('destr',        438153), -- Destr
  ('dmg',          438154), -- Dmg
  ('set_dressing', 500718), -- set dressing
  ('set_dressing', 500717), -- set dressing (deprecated)
  ('misc',         500727), -- misc
  ('hp',           501878), -- HP
  ('lp',           501879), -- LP
  ('atlas',        501880), -- Atlas
  ('bake',         501883)  -- Bake
on conflict (kaiten_card_type_id) where kaiten_card_type_id is not null do nothing;
