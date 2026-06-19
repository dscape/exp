delete from medals legacy
using medals existing
where legacy.medal_type::text in ('category', 'female')
  and existing.id <> legacy.id
  and existing.event_id = legacy.event_id
  and existing.player_id = legacy.player_id
  and existing.medal_type::text = case
    when legacy.place = 1 or legacy.label ~ '^1[.ºª]' then 'gold'
    when legacy.place = 2 or legacy.label ~ '^2[.ºª]' then 'silver'
    else 'bronze'
  end
  and coalesce(existing.label, '') = coalesce(legacy.label, '');

with ranked_legacy as (
  select id,
    row_number() over (
      partition by event_id, player_id,
        case
          when place = 1 or label ~ '^1[.ºª]' then 'gold'
          when place = 2 or label ~ '^2[.ºª]' then 'silver'
          else 'bronze'
        end,
        coalesce(label, '')
      order by id
    ) as duplicate_number
  from medals
  where medal_type::text in ('category', 'female')
)
delete from medals
where id in (select id from ranked_legacy where duplicate_number > 1);

update medals
set medal_type = case
  when place = 1 or label ~ '^1[.ºª]' then 'gold'::medal_type
  when place = 2 or label ~ '^2[.ºª]' then 'silver'::medal_type
  else 'bronze'::medal_type
end
where medal_type::text in ('category', 'female');

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'medal_type'
      and e.enumlabel in ('category', 'female')
  ) then
    alter type medal_type rename to medal_type_old;
    create type medal_type as enum ('gold', 'silver', 'bronze');
    alter table medals
      alter column medal_type type medal_type
      using medal_type::text::medal_type;
    drop type medal_type_old;
  end if;
end $$;
