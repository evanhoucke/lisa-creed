create extension if not exists pgcrypto;

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  price numeric(10, 2) not null check (price >= 0),
  description text,
  photo_url text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.gifts add column if not exists description text;
alter table public.gifts add column if not exists photo_url text;

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

insert into public.gift_photos (gift_id, photo_url, sort_order)
select gifts.id, gifts.photo_url, 1
from public.gifts
where gifts.photo_url is not null
and not exists (
  select 1
  from public.gift_photos
  where gift_photos.gift_id = gifts.id
);

insert into public.gifts (title, price, description, note, sort_order)
values
  ('Bijou souvenir', 120, 'Un bijou discret pour garder un souvenir de cette journée.', 'Un bijou discret pour garder un souvenir de cette journée.', 1),
  ('Collection de livres', 75, 'Des livres inspirants que je pourrai lire au fil de l''année.', 'Des livres inspirants que je pourrai lire au fil de l''année.', 2),
  ('Participation vélo', 350, 'Un vélo pour mes trajets et balades.', 'Un vélo pour mes trajets et balades.', 3),
  ('Atelier créatif', 90, 'Une expérience artistique à partager.', 'Une expérience artistique à partager.', 4),
  ('Week-end en famille', 420, 'Une participation pour un beau moment tous ensemble.', 'Une participation pour un beau moment tous ensemble.', 5)
on conflict do nothing;
