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
-- Outros nomes com que o paciente aparece na agenda (sem acento/minúsculo), para o vínculo com o Google Agenda
alter table public.patients add column if not exists aliases text[] not null default '{}';
-- "Lembrar depois" no alerta de 50 dias sem retorno
alter table public.patients add column if not exists snooze_until date;

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

-- ---------- Histórico do motor de cálculos ----------
create table if not exists public.calculations (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  date            date not null default (now() at time zone 'America/Sao_Paulo')::date,
  inputs          jsonb not null,          -- sexo, idade, peso, altura, massa magra usados
  formula         text not null,
  tmb             numeric not null,
  activity_level  text not null,
  activity_factor numeric not null,
  get_kcal        numeric not null,
  objective       text,
  adjust_pct      numeric not null default 0,
  target_kcal     numeric not null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists calculations_patient_idx on public.calculations (patient_id, created_at desc);
-- Macronutrientes do cálculo: peso de referência, g/kg de proteína, % de lipídios e gramas de P/L/C
alter table public.calculations add column if not exists macros jsonb;

-- ---------- Configurações (ex.: percentuais padrão por objetivo) ----------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------- Questionários ----------
-- questions: [{id, type: 'scale'|'text'|'choice', label, min, max, min_label, max_label, options: []}]
create table if not exists public.questionnaires (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  questions   jsonb not null default '[]'::jsonb,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists questionnaires_one_default on public.questionnaires (is_default) where is_default;

-- Um envio = um link único para um paciente.
create table if not exists public.questionnaire_sends (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients (id) on delete cascade,
  questionnaire_id  uuid not null references public.questionnaires (id) on delete restrict,
  token             text not null unique check (length(token) >= 20),
  sent_at           timestamptz not null default now(),
  resent_at         timestamptz,
  answered_at       timestamptz,
  expired_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists questionnaire_sends_patient_idx on public.questionnaire_sends (patient_id, created_at desc);

create table if not exists public.questionnaire_responses (
  id                uuid primary key default gen_random_uuid(),
  send_id           uuid not null unique references public.questionnaire_sends (id) on delete cascade,
  patient_id        uuid not null references public.patients (id) on delete cascade,
  questionnaire_id  uuid not null references public.questionnaires (id) on delete restrict,
  answers           jsonb not null,
  submitted_at      timestamptz not null default now()
);
create index if not exists questionnaire_responses_patient_idx on public.questionnaire_responses (patient_id, submitted_at desc);

-- ---------- Exames laboratoriais ----------
create table if not exists public.lab_exams (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  date        date not null,
  file_path   text,            -- (não usado: os laudos não são guardados)
  file_name   text,
  notes       text,            -- resposta da IA colada pela nutricionista
  created_at  timestamptz not null default now()
);
create index if not exists lab_exams_patient_idx on public.lab_exams (patient_id, date desc);

create table if not exists public.lab_results (
  id          bigint generated always as identity primary key,
  exam_id     uuid not null references public.lab_exams (id) on delete cascade,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  date        date not null,
  marker      text not null,   -- chave padronizada (ex.: glicemia, ldl) ou outro_<nome>
  label       text not null,
  value       numeric not null,
  unit        text
);
create index if not exists lab_results_patient_idx on public.lab_results (patient_id, marker, date);

-- ---------- Lembretes (lista de tarefas da tela inicial) ----------
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (length(text) between 1 and 500),
  done_at     timestamptz,     -- marcado como feito; some da lista à meia-noite desse dia
  created_at  timestamptz not null default now()
);

-- ---------- Rotinas (tarefas que se repetem todo dia ou todo mês) ----------
create table if not exists public.routines (
  id            uuid primary key default gen_random_uuid(),
  text          text not null check (length(text) between 1 and 300),
  frequency     text not null check (frequency in ('diaria', 'mensal')),
  month_day     int check (month_day between 1 and 28), -- mensal: aparece a partir deste dia do mês
  last_done_at  timestamptz,                            -- feita no dia/mês atual = some da lista até o próximo
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- Lembretes de consulta enviados pelo WhatsApp (para não mandar duas vezes) ----------
create table if not exists public.appointment_reminders (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  event_key   text not null unique,   -- identifica a consulta (evento da agenda + data, ou consulta da planilha)
  event_date  date not null,
  event_time  text,
  sent_at     timestamptz not null default now()
);
create index if not exists appointment_reminders_date_idx on public.appointment_reminders (event_date);
-- Confirmação pelo link do lembrete
alter table public.appointment_reminders add column if not exists token text unique;
alter table public.appointment_reminders add column if not exists response text check (response in ('confirmado', 'remarcar', 'nao_vai'));
alter table public.appointment_reminders add column if not exists response_note text;
alter table public.appointment_reminders add column if not exists responded_at timestamptz;
-- Remarcação: dias da semana (seg a sex; sem sábado) e faixas de horário preferidos ({ days: ['seg', ...], slots: ['09-11', ...] })
alter table public.appointment_reminders add column if not exists response_prefs jsonb;

-- Comparecimento marcado pela nutricionista (sem marcação, conta "veio" se houver consulta registrada no dia)
create table if not exists public.appointment_attendance (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  event_key   text not null unique,
  event_date  date not null,
  event_time  text,
  status      text not null check (status in ('veio', 'faltou')),
  marked_at   timestamptz not null default now()
);
create index if not exists appointment_attendance_date_idx on public.appointment_attendance (event_date);

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
  n.start_time as next_time,
  p.email_primary, p.emails, p.aliases, p.snooze_until, p.name_norm,
  r.last_date as last_response
from public.patients p
left join lateral (
  select max((submitted_at at time zone 'America/Sao_Paulo')::date) as last_date
  from public.questionnaire_responses where patient_id = p.id
) r on true
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

-- ---------- Google Agenda (endereço secreto iCal) ----------
-- O navegador não pode ler a agenda do Google diretamente; o banco busca e devolve o texto.
-- O endereço fica em app_settings (chave calendar_ics_url) e só endereços do Google são aceitos.
create extension if not exists http with schema extensions;

create or replace function public.fetch_calendar() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  u text;
  r extensions.http_response;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Acesso negado';
  end if;
  select value #>> '{}' into u from public.app_settings where key = 'calendar_ics_url';
  if u is null or u = '' then
    return null;
  end if;
  if u !~ '^https://calendar\.google\.com/calendar/ical/' then
    raise exception 'Endereço de agenda inválido: use o "Endereço secreto no formato iCal" do Google Agenda';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');
  r := extensions.http_get(u);
  if r.status <> 200 then
    raise exception 'O Google Agenda respondeu com erro % (confira o endereço)', r.status;
  end if;
  return r.content;
end $$;
revoke all on function public.fetch_calendar() from public, anon;
grant execute on function public.fetch_calendar() to authenticated;

-- ---------- Formulário do paciente (sem login) ----------
-- O paciente só consegue: ler o questionário do próprio link e responder uma vez.
create or replace function public.get_questionnaire(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  if p_token is null or length(p_token) < 20 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select qs.answered_at, qs.expired_at, q.name as title, q.questions, split_part(p.name, ' ', 1) as first_name
    into s
    from public.questionnaire_sends qs
    join public.questionnaires q on q.id = qs.questionnaire_id
    join public.patients p on p.id = qs.patient_id
   where qs.token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if s.answered_at is not null then
    return jsonb_build_object('status', 'answered', 'first_name', s.first_name);
  end if;
  if s.expired_at is not null then
    return jsonb_build_object('status', 'expired', 'first_name', s.first_name);
  end if;
  return jsonb_build_object('status', 'ok', 'first_name', s.first_name, 'title', s.title, 'questions', s.questions);
end $$;

create or replace function public.submit_questionnaire(p_token text, p_answers jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  if p_token is null or length(p_token) < 20 then
    return 'invalid';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 20000 then
    return 'invalid';
  end if;
  select id, patient_id, questionnaire_id, answered_at, expired_at
    into s from public.questionnaire_sends where token = p_token for update;
  if not found then return 'invalid'; end if;
  if s.answered_at is not null then return 'answered'; end if;
  if s.expired_at is not null then return 'expired'; end if;
  insert into public.questionnaire_responses (send_id, patient_id, questionnaire_id, answers)
    values (s.id, s.patient_id, s.questionnaire_id, p_answers);
  update public.questionnaire_sends set answered_at = now() where id = s.id;
  return 'ok';
end $$;

revoke all on function public.get_questionnaire(text) from public;
revoke all on function public.submit_questionnaire(text, jsonb) from public;
grant execute on function public.get_questionnaire(text) to anon, authenticated;
grant execute on function public.submit_questionnaire(text, jsonb) to anon, authenticated;

-- ---------- Espaço usado (para acompanhar o limite do plano gratuito) ----------
create or replace function public.db_usage() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Acesso negado';
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'data_bytes', (select coalesce(sum(pg_total_relation_size(c.oid)), 0)
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind = 'r'),
    'patients', (select count(*) from public.patients)
  );
end $$;
revoke all on function public.db_usage() from public, anon;
grant execute on function public.db_usage() to authenticated;

-- ---------- Confirmação de consulta pelo paciente (sem login, pelo link do lembrete) ----------
create or replace function public.get_appointment(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if p_token is null or length(p_token) < 20 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select a.event_date, a.event_time, a.response, a.response_note, a.response_prefs, split_part(p.name, ' ', 1) as first_name
    into r
    from public.appointment_reminders a join public.patients p on p.id = a.patient_id
   where a.token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  return jsonb_build_object(
    'status', 'ok', 'first_name', r.first_name, 'date', r.event_date, 'time', r.event_time,
    'response', r.response, 'note', r.response_note, 'prefs', r.response_prefs,
    'open', r.event_date >= (now() at time zone 'America/Sao_Paulo')::date);
end $$;

drop function if exists public.respond_appointment(text, text, text);
create or replace function public.respond_appointment(p_token text, p_response text, p_note text default null, p_prefs jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  prefs jsonb;
begin
  if p_token is null or length(p_token) < 20 then return 'invalid'; end if;
  if p_response not in ('confirmado', 'remarcar', 'nao_vai') then return 'invalid'; end if;
  -- Só guarda dias/horários válidos (e só na remarcação).
  if p_response = 'remarcar' and p_prefs is not null and jsonb_typeof(p_prefs) = 'object' then
    prefs := jsonb_build_object(
      'days', coalesce((select jsonb_agg(d) from jsonb_array_elements_text(coalesce(p_prefs->'days', '[]')) d
                         where d in ('seg', 'ter', 'qua', 'qui', 'sex')), '[]'),
      'slots', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p_prefs->'slots', '[]')) x
                          where x in ('09-11', '11-13', '14-17')), '[]'));
  end if;
  select id, event_date into r from public.appointment_reminders where token = p_token for update;
  if not found then return 'invalid'; end if;
  if r.event_date < (now() at time zone 'America/Sao_Paulo')::date then return 'closed'; end if;
  update public.appointment_reminders
     set response = p_response, response_note = nullif(left(coalesce(p_note, ''), 1000), ''),
         response_prefs = prefs, responded_at = now()
   where id = r.id;
  return 'ok';
end $$;

revoke all on function public.get_appointment(text) from public;
revoke all on function public.respond_appointment(text, text, text, jsonb) from public;
grant execute on function public.get_appointment(text) to anon, authenticated;
grant execute on function public.respond_appointment(text, text, text, jsonb) to anon, authenticated;

-- ---------- Acesso: só usuária logada ----------
alter table public.patients             enable row level security;
alter table public.consultations        enable row level security;
alter table public.nutrium_appointments enable row level security;
alter table public.measurements         enable row level security;
alter table public.ai_notes             enable row level security;
alter table public.calculations enable row level security;
alter table public.app_settings enable row level security;
alter table public.questionnaires enable row level security;
alter table public.questionnaire_sends enable row level security;
alter table public.questionnaire_responses enable row level security;
alter table public.lab_exams enable row level security;
alter table public.lab_results enable row level security;
alter table public.todos enable row level security;
alter table public.routines enable row level security;
alter table public.appointment_reminders enable row level security;
alter table public.appointment_attendance enable row level security;

drop policy if exists "dona" on public.patients;
drop policy if exists "dona" on public.consultations;
drop policy if exists "dona" on public.nutrium_appointments;
drop policy if exists "dona" on public.measurements;
drop policy if exists "dona" on public.ai_notes;
drop policy if exists "dona" on public.calculations;
drop policy if exists "dona" on public.app_settings;
drop policy if exists "dona" on public.questionnaires;
drop policy if exists "dona" on public.questionnaire_sends;
drop policy if exists "dona" on public.questionnaire_responses;
drop policy if exists "dona" on public.lab_exams;
drop policy if exists "dona" on public.lab_results;
drop policy if exists "dona" on public.todos;
drop policy if exists "dona" on public.routines;
drop policy if exists "dona" on public.appointment_reminders;
drop policy if exists "dona" on public.appointment_attendance;
create policy "dona" on public.patients             for all to authenticated using (true) with check (true);
create policy "dona" on public.consultations        for all to authenticated using (true) with check (true);
create policy "dona" on public.nutrium_appointments for all to authenticated using (true) with check (true);
create policy "dona" on public.measurements         for all to authenticated using (true) with check (true);
create policy "dona" on public.ai_notes             for all to authenticated using (true) with check (true);
create policy "dona" on public.calculations         for all to authenticated using (true) with check (true);
create policy "dona" on public.app_settings         for all to authenticated using (true) with check (true);
create policy "dona" on public.questionnaires       for all to authenticated using (true) with check (true);
create policy "dona" on public.questionnaire_sends  for all to authenticated using (true) with check (true);
create policy "dona" on public.questionnaire_responses for all to authenticated using (true) with check (true);
create policy "dona" on public.lab_exams            for all to authenticated using (true) with check (true);
create policy "dona" on public.lab_results          for all to authenticated using (true) with check (true);
create policy "dona" on public.todos                for all to authenticated using (true) with check (true);
create policy "dona" on public.routines             for all to authenticated using (true) with check (true);
create policy "dona" on public.appointment_reminders for all to authenticated using (true) with check (true);
create policy "dona" on public.appointment_attendance for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.patients, public.consultations,
  public.nutrium_appointments, public.measurements, public.ai_notes,
  public.calculations, public.app_settings,
  public.questionnaires, public.questionnaire_sends, public.questionnaire_responses,
  public.lab_exams, public.lab_results, public.todos, public.routines, public.appointment_reminders,
  public.appointment_attendance to authenticated;
grant select on public.patient_overview to authenticated;
grant usage on all sequences in schema public to authenticated;
