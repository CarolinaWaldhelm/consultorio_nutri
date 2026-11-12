-- =====================================================================
-- Consultório Nutri — estrutura do banco de dados
--
-- Como usar: Supabase → SQL Editor → New query → colar este arquivo
-- inteiro → Run. Pode ser executado mais de uma vez sem perder dados.
-- =====================================================================

-- ---------- Pacientes ----------
create table if not exists public.patients (
  id                    uuid primary key default gen_random_uuid(),
  code                  serial unique,                -- exibido como P-0001
  name                  text not null,
  name_norm             text not null,                -- nome sem acento/minúsculo, para busca e cruzamento
  birth_date            date,
  sex                   text check (sex in ('F', 'M')),
  phone                 text,
  email_primary         text,
  emails                text[] not null default '{}', -- todos os e-mails conhecidos (contas antigas do Nutrium)
  nutrium_registered_at date,
  tags                  text,
  status                text not null default 'ativo' check (status in ('ativo', 'inativo')),
  questionnaires_active boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists patients_name_norm_idx on public.patients (name_norm);
-- 'importacao' = inativado automaticamente pela regra dos 150 dias (volta a ativo se marcar consulta)
alter table public.patients add column if not exists inactive_reason text;

-- ---------- Consultas registradas no software (com anamnese) ----------
create table if not exists public.consultations (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  date        date not null default (now() at time zone 'America/Sao_Paulo')::date,
  type        text not null check (type in ('inicial', 'retorno')),
  objective   text check (objective in ('perda_peso', 'recomposicao', 'manutencao', 'ganho_massa')),
  anamnesis   jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists consultations_patient_idx on public.consultations (patient_id, date desc);

-- ---------- Consultas vindas da planilha do Nutrium ----------
-- Substituída por inteiro a cada importação.
create table if not exists public.nutrium_appointments (
  id          bigint generated always as identity primary key,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  date        date not null,
  start_time  text,
  end_time    text
);
create index if not exists nutrium_appointments_patient_idx on public.nutrium_appointments (patient_id, date);

-- ---------- Medições ----------
-- source: 'consulta' (registrada no software), 'nutrium_prof' (profissional no Nutrium),
--         'nutrium_app' (paciente pelo app). Do Nutrium entram só peso e altura.
create table if not exists public.measurements (
  id          bigint generated always as identity primary key,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  date        date not null,
  metric      text not null,
  value       numeric not null,
  unit        text,
  source      text not null check (source in ('consulta', 'nutrium_prof', 'nutrium_app')),
  created_at  timestamptz not null default now()
);
create index if not exists measurements_patient_idx on public.measurements (patient_id, metric, date desc);

-- ---------- Resumos e anotações vindos da IA (modo B: colados pela nutricionista) ----------
create table if not exists public.ai_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  kind        text not null default 'resumo',
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ai_notes_patient_idx on public.ai_notes (patient_id, kind, created_at desc);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists patients_touch on public.patients;
create trigger patients_touch before update on public.patients
  for each row execute function public.touch_updated_at();

drop trigger if exists consultations_touch on public.consultations;
create trigger consultations_touch before update on public.consultations
  for each row execute function public.touch_updated_at();

-- ---------- Visão geral para a tela inicial ----------
create or replace view public.patient_overview with (security_invoker = true) as
select
  p.id, p.code, p.name, p.phone, p.birth_date, p.status, p.questionnaires_active,
  greatest(c.last_date, a.last_date) as last_consult,
  n.date       as next_consult,
  n.start_time as next_time
from public.patients p
left join lateral (
  select max(date) as last_date from public.consultations
  where patient_id = p.id and date <= (now() at time zone 'America/Sao_Paulo')::date
) c on true
left join lateral (
  select max(date) as last_date from public.nutrium_appointments
  where patient_id = p.id and date < (now() at time zone 'America/Sao_Paulo')::date
) a on true
left join lateral (
  select date, start_time from public.nutrium_appointments
  where patient_id = p.id and date >= (now() at time zone 'America/Sao_Paulo')::date
  order by date, start_time
  limit 1
) n on true;

-- ---------- Acesso: só usuária logada ----------
alter table public.patients             enable row level security;
alter table public.consultations        enable row level security;
alter table public.nutrium_appointments enable row level security;
alter table public.measurements         enable row level security;
alter table public.ai_notes             enable row level security;

drop policy if exists "dona" on public.patients;
drop policy if exists "dona" on public.consultations;
drop policy if exists "dona" on public.nutrium_appointments;
drop policy if exists "dona" on public.measurements;
drop policy if exists "dona" on public.ai_notes;
create policy "dona" on public.patients             for all to authenticated using (true) with check (true);
create policy "dona" on public.consultations        for all to authenticated using (true) with check (true);
create policy "dona" on public.nutrium_appointments for all to authenticated using (true) with check (true);
create policy "dona" on public.measurements         for all to authenticated using (true) with check (true);
create policy "dona" on public.ai_notes             for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.patients, public.consultations,
  public.nutrium_appointments, public.measurements, public.ai_notes to authenticated;
grant select on public.patient_overview to authenticated;
grant usage on all sequences in schema public to authenticated;
