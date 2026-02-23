create extension if not exists pgcrypto;

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
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
set amount_collected = coalesce((
  select sum(amount)
  from public.participations
  where participations.gift_id = gifts.id
), 0);

with seeded_gifts (title, price, description, note, sort_order, is_active) as (
  values
    (
      'Flip7',
      15,
      'Flip 7 est un jeu de cartes pour au moins 3 joueurs. Dans ce jeu d''ambiance de type stop ou encore, vous allez tenter de retourner des cartes une à une en espérant ne pas retourner deux fois le même numéro.',
      'Flip 7 est un jeu de cartes pour au moins 3 joueurs. Dans ce jeu d''ambiance de type stop ou encore, vous allez tenter de retourner des cartes une à une en espérant ne pas retourner deux fois le même numéro.',
      1,
      true
    ),
    (
      'Sac en cuir Paul Marius',
      135,
      'Le sac en cuir Paul Marius propose un style élégant et décontracté. Il se transforme en sac business, porte-document idéal pour formats A4 et ordinateur 15 pouces, avec deux poches à boutons pression.',
      'Le sac en cuir Paul Marius propose un style élégant et décontracté. Il se transforme en sac business, porte-document idéal pour formats A4 et ordinateur 15 pouces, avec deux poches à boutons pression.',
      2,
      true
    ),
    ('Participation vélo', 350, 'Un vélo pour mes trajets et balades.', 'Un vélo pour mes trajets et balades.', 3, true),
    ('Atelier créatif', 90, 'Une expérience artistique à partager.', 'Une expérience artistique à partager.', 4, true),
    ('Week-end en famille', 420, 'Une participation pour un beau moment tous ensemble.', 'Une participation pour un beau moment tous ensemble.', 5, true)
)
insert into public.gifts (title, price, description, note, sort_order, is_active)
select
  sg.title,
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
    ('Flip7', 'https://picsum.photos/seed/flip7/1200/900', 1),
    ('Sac en cuir Paul Marius', 'https://picsum.photos/seed/paulmarius/1200/900', 1),
    ('Participation vélo', 'https://picsum.photos/seed/velo/1200/900', 1),
    ('Atelier créatif', 'https://picsum.photos/seed/atelier/1200/900', 1),
    ('Week-end en famille', 'https://picsum.photos/seed/famille/1200/900', 1)
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
