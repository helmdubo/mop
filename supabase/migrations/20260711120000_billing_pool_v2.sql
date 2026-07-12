-- Пул биллинга v2 (фидбек владельца):
-- 1) архивные ассеты НЕ попадают в пул (архив = оплачено/ушло из продакшена);
-- 2) гранула биллинга — карточка-этап: этапы могут уходить в разные инвойсы,
--    поэтому "уже забиллено" проверяется по kaiten_card_id, а не по ассету;
-- 3) индексы под сборку пула (join по parent_ids был полным перебором).

create index if not exists cards_parent_ids_gin
  on kaiten.cards using gin (parent_ids);
create index if not exists cards_done_assets_idx
  on kaiten.cards (board_id) where state = '3' and not archived;
create index if not exists billing_items_card_idx
  on app.billing_items (kaiten_card_id);

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
    select c.id, c.title, c.type_id, c.tag_ids, c.archived, c.completed_at
    from kaiten.cards c
    join billable_boards bb on bb.kaiten_board_id = c.board_id
    where c.state = '3'
      and not c.archived
      and coalesce(array_length(c.parent_ids, 1), 0) = 0
  ),
  stages as (
    select ch.id, ch.title, ch.type_id, ch.tag_ids, ch.archived, ch.completed_at,
           (select a.id from assets a where a.id = any(ch.parent_ids) limit 1) as asset_id
    from kaiten.cards ch
    where ch.parent_ids && (select coalesce(array_agg(id), '{}'::bigint[]) from assets)
  ),
  all_cards as (
    select id as asset_card_id, id as card_id, title, true as is_asset,
           type_id, tag_ids, archived, completed_at
    from assets
    union all
    select asset_id, id, title, false, type_id, tag_ids, archived, completed_at
    from stages
    where asset_id is not null
  ),
  unbilled as (
    select ac.*
    from all_cards ac
    where not exists (
      select 1 from app.billing_items bi where bi.kaiten_card_id = ac.card_id
    )
  )
  select u.asset_card_id, u.card_id, u.title, u.is_asset, u.type_id,
         u.tag_ids, u.archived, u.completed_at,
         tl.user_id, round(sum(tl.minutes) / 60.0, 2) as hours
  from unbilled u
  left join kaiten.time_logs tl on tl.card_id = u.card_id
  group by u.asset_card_id, u.card_id, u.title, u.is_asset, u.type_id,
           u.tag_ids, u.archived, u.completed_at, tl.user_id
$$;
