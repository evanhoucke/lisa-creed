create extension if not exists pgcrypto;

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  seen_at text,
  price numeric(10, 2) not null check (price >= 0),
  amount_collected numeric(10, 2) not null default 0 check (amount_collected >= 0),
  description text,
  photo_url text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.gifts add column if not exists description text;
alter table public.gifts add column if not exists photo_url text;
alter table public.gifts add column if not exists seen_at text;
alter table public.gifts add column if not exists amount_collected numeric(10, 2) not null default 0;

create table if not exists public.participations (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts(id) on delete restrict,
  contributor_name text not null,
  contributor_email text not null,
  amount numeric(10, 2) not null check (amount > 0),
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_photos (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts(id) on delete cascade,
  photo_url text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create or replace function public.check_remaining_before_participation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price numeric(10, 2);
  v_collected numeric(10, 2);
begin
  select price, amount_collected
    into v_price, v_collected
  from public.gifts
  where id = new.gift_id
  for update;

  if v_price is null then
    raise exception 'Gift not found';
  end if;

  if new.amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if coalesce(v_collected, 0) + new.amount > v_price then
    raise exception 'Amount exceeds remaining gift budget';
  end if;

  return new;
end;
$$;

create or replace function public.sync_gift_amount_collected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.gift_id is distinct from new.gift_id then
    update public.gifts
    set amount_collected = coalesce((
      select sum(amount)
      from public.participations
      where gift_id = old.gift_id
    ), 0)
    where id = old.gift_id;
  end if;

  update public.gifts
  set amount_collected = coalesce((
    select sum(amount)
    from public.participations
    where gift_id = coalesce(new.gift_id, old.gift_id)
  ), 0)
  where id = coalesce(new.gift_id, old.gift_id);

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_check_remaining_before_participation on public.participations;
create trigger trg_check_remaining_before_participation
before insert on public.participations
for each row
execute function public.check_remaining_before_participation();

drop trigger if exists trg_sync_gift_amount_collected_after_insert on public.participations;
create trigger trg_sync_gift_amount_collected_after_insert
after insert on public.participations
for each row
execute function public.sync_gift_amount_collected();

drop trigger if exists trg_sync_gift_amount_collected_after_update on public.participations;
create trigger trg_sync_gift_amount_collected_after_update
after update on public.participations
for each row
execute function public.sync_gift_amount_collected();

drop trigger if exists trg_sync_gift_amount_collected_after_delete on public.participations;
create trigger trg_sync_gift_amount_collected_after_delete
after delete on public.participations
for each row
execute function public.sync_gift_amount_collected();

alter table public.gifts enable row level security;
alter table public.participations enable row level security;
alter table public.gift_photos enable row level security;

drop policy if exists "Public can read active gifts" on public.gifts;
create policy "Public can read active gifts"
  on public.gifts
  for select
  to anon
  using (is_active = true);

drop policy if exists "Authenticated can read all gifts" on public.gifts;
create policy "Authenticated can read all gifts"
  on public.gifts
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert gifts" on public.gifts;
create policy "Authenticated can insert gifts"
  on public.gifts
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update gifts" on public.gifts;
create policy "Authenticated can update gifts"
  on public.gifts
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated can delete gifts" on public.gifts;
create policy "Authenticated can delete gifts"
  on public.gifts
  for delete
  to authenticated
  using (true);

drop policy if exists "Public can read active gift photos" on public.gift_photos;
create policy "Public can read active gift photos"
  on public.gift_photos
  for select
  to anon
  using (
    exists (
      select 1
      from public.gifts
      where gifts.id = gift_photos.gift_id
      and gifts.is_active = true
    )
  );

drop policy if exists "Authenticated can read all gift photos" on public.gift_photos;
create policy "Authenticated can read all gift photos"
  on public.gift_photos
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated can insert gift photos" on public.gift_photos;
create policy "Authenticated can insert gift photos"
  on public.gift_photos
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated can update gift photos" on public.gift_photos;
create policy "Authenticated can update gift photos"
  on public.gift_photos
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated can delete gift photos" on public.gift_photos;
create policy "Authenticated can delete gift photos"
  on public.gift_photos
  for delete
  to authenticated
  using (true);

drop policy if exists "Public can insert participations" on public.participations;
create policy "Public can insert participations"
  on public.participations
  for insert
  to anon
  with check (true);

drop policy if exists "Authenticated can read participations" on public.participations;
create policy "Authenticated can read participations"
  on public.participations
  for select
  to authenticated
  using (true);

insert into storage.buckets (id, name, public)
values ('gift-photos', 'gift-photos', true)
on conflict (id) do nothing;

drop policy if exists "Public can read gift photos" on storage.objects;
create policy "Public can read gift photos"
  on storage.objects
  for select
  to public
  using (bucket_id = 'gift-photos');

drop policy if exists "Authenticated can upload gift photos" on storage.objects;
create policy "Authenticated can upload gift photos"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'gift-photos');

update public.gifts
set description = coalesce(description, note)
where description is null;

update public.gifts
set title = 'Flip 7'
where title = 'Flip7';

update public.gifts
set amount_collected = coalesce((
  select sum(amount)
  from public.participations
  where participations.gift_id = gifts.id
), 0);

with seeded_gifts (title, seen_at, price, description, note, sort_order, is_active) as (
  values
    (
      'Flip 7',
      'JoueClub',
      15,
      'Flip 7 est un jeu de cartes pour au moins 3 joueurs. Dans ce jeu d''ambiance de type stop ou encore, vous allez tenter de retourner des cartes une à une en espérant ne pas retourner deux fois le même numéro.',
      'Flip 7 est un jeu de cartes pour au moins 3 joueurs. Dans ce jeu d''ambiance de type stop ou encore, vous allez tenter de retourner des cartes une à une en espérant ne pas retourner deux fois le même numéro.',
      1,
      true
    ),
    (
      'Sac en cuir Paul Marius',
      'Edisac',
      135,
      'Le sac bandoulière vintage cuir, modèle LeDandy S de Paul Marius propose un style élégant et décontracté. Il se transformera aisément en sac business, porte document idéal pour formats A4 et ordinateur 15 pouces, doté de deux poches à boutons pression. Il se porte à l''épaule avec sa bandoulière ou à la main avec ses deux anses. Coloris : cuivré. Référence : LEDANDYS.',
      'Le sac bandoulière vintage cuir, modèle LeDandy S de Paul Marius propose un style élégant et décontracté. Il se transformera aisément en sac business, porte document idéal pour formats A4 et ordinateur 15 pouces, doté de deux poches à boutons pression. Il se porte à l''épaule avec sa bandoulière ou à la main avec ses deux anses. Coloris : cuivré. Référence : LEDANDYS.',
      2,
      true
    ),
    (
      'Skyjo',
      'Cultura',
      15,
      'Le but du jeu est simple : marquer le moins de points possible. Chaque joueur reçoit 12 cartes, et l''objectif est de former des séries de cartes de même valeur tout en éliminant les cartes indésirables. Le joueur avec le moins de points à la fin de la partie remporte la victoire.',
      'Le but du jeu est simple : marquer le moins de points possible. Chaque joueur reçoit 12 cartes, et l''objectif est de former des séries de cartes de même valeur tout en éliminant les cartes indésirables. Le joueur avec le moins de points à la fin de la partie remporte la victoire.',
      3,
      true
    ),
    (
      'Colo de handball',
      null,
      550,
      'Colo de handball à Dunkerque avec au programme : des entrainements de handball, du beach handball, du bowling, de la patinoire, une journée à Plopsaqua parc aquatique et de nombreuses veillées.',
      'Colo de handball à Dunkerque avec au programme : des entrainements de handball, du beach handball, du bowling, de la patinoire, une journée à Plopsaqua parc aquatique et de nombreuses veillées.',
      4,
      true
    ),
    (
      'Lego fleurs',
      'Lego',
      50,
      'Lego fleurs de lune pour créer de magnifiques fleurs en lego.',
      'Lego fleurs de lune pour créer de magnifiques fleurs en lego.',
      5,
      true
    ),
    (
      'K-way léger',
      'K-way',
      100,
      'Claude est la veste courte emblématique pour les enfants qui aiment le style K-Way. Le point fort de la veste est le volume réduit qu''elle occupe une fois pliée et rangée dans une de ses deux poches. Idéale pour être facilement transportée dans un sac à dos à l''école ou lors d''une sortie d''une journée, elle est conçue pour résister à la pluie ou au vent soudains. Couleur : rose pâle. Taille : 14 ans. Caractéristiques : imperméable et coupe-vent.',
      'Claude est la veste courte emblématique pour les enfants qui aiment le style K-Way. Le point fort de la veste est le volume réduit qu''elle occupe une fois pliée et rangée dans une de ses deux poches. Idéale pour être facilement transportée dans un sac à dos à l''école ou lors d''une sortie d''une journée, elle est conçue pour résister à la pluie ou au vent soudains. Couleur : rose pâle. Taille : 14 ans. Caractéristiques : imperméable et coupe-vent.',
      6,
      true
    ),
    (
      'Gilet de protection airbag pour l''équitation',
      'Kramer',
      300,
      'Gilet airbag d''équitation disposant d''un grand airbag sur la nuque qui protège le haut du corps et le cou en cas de chute de cheval. Marque : Kramer. Taille : XS.',
      'Gilet airbag d''équitation disposant d''un grand airbag sur la nuque qui protège le haut du corps et le cou en cas de chute de cheval. Marque : Kramer. Taille : XS.',
      7,
      true
    )
)
insert into public.gifts (title, seen_at, price, description, note, sort_order, is_active)
select
  sg.title,
  sg.seen_at,
  sg.price,
  sg.description,
  sg.note,
  sg.sort_order,
  sg.is_active
from seeded_gifts sg
where not exists (
  select 1
  from public.gifts g
  where g.title = sg.title
);

with seeded_gifts (title, seen_at) as (
  values
    ('Flip 7', 'Cultura'),
    ('Sac en cuir Paul Marius', 'Edisac'),
    ('Skyjo', 'Cultura'),
    ('Colo de handball', null),
    ('Lego fleurs', 'Lego'),
    ('K-way léger', 'K-way'),
    ('Gilet de protection airbag pour l''équitation', 'Kramer')
)
update public.gifts g
set seen_at = sg.seen_at
from seeded_gifts sg
where g.title = sg.title
  and (g.seen_at is null or g.seen_at = '');

insert into public.gift_photos (gift_id, photo_url, sort_order)
select gifts.id, gifts.photo_url, 1
from public.gifts
where gifts.photo_url is not null
and not exists (
  select 1
  from public.gift_photos
  where gift_photos.gift_id = gifts.id
);

with seeded_photos (gift_title, photo_url, sort_order) as (
  values
    ('Flip 7', 'https://picsum.photos/seed/flip7/1200/900', 1),
    ('Sac en cuir Paul Marius', 'https://picsum.photos/seed/paulmarius/1200/900', 1),
    ('Skyjo', 'https://picsum.photos/seed/skyjo/1200/900', 1),
    ('Colo de handball', 'https://picsum.photos/seed/colo-handball/1200/900', 1),
    ('Lego fleurs', 'https://picsum.photos/seed/lego-fleurs/1200/900', 1),
    ('K-way léger', 'https://picsum.photos/seed/kway-leger/1200/900', 1),
    ('Gilet de protection airbag pour l''équitation', 'https://picsum.photos/seed/gilet-airbag-equitation/1200/900', 1)
)
insert into public.gift_photos (gift_id, photo_url, sort_order)
select
  g.id,
  sp.photo_url,
  sp.sort_order
from seeded_photos sp
join public.gifts g on g.title = sp.gift_title
where not exists (
  select 1
  from public.gift_photos gp
  where gp.gift_id = g.id
    and gp.photo_url = sp.photo_url
);

update public.gifts g
set photo_url = first_photo.photo_url
from (
  select distinct on (gift_id)
    gift_id,
    photo_url
  from public.gift_photos
  order by gift_id, sort_order asc, created_at asc
) as first_photo
where g.id = first_photo.gift_id
  and (g.photo_url is null or g.photo_url = '');
