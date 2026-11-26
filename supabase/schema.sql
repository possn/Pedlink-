-- =====================================================================
-- PedLink — esquema completo da base de dados (Supabase / Postgres 15+)
-- Colar no SQL Editor de um projeto novo e executar uma vez.
-- Idempotente na medida do possível; seguro para voltar a correr.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. Estrutura organizacional: ACES/ULS -> unidades funcionais
-- ---------------------------------------------------------------------
create table if not exists public.aces (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  uls         text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.unidades (
  id            uuid primary key default gen_random_uuid(),
  aces_id       uuid not null references public.aces(id) on delete restrict,
  nome          text not null,
  tipo          text not null default 'USF'
                check (tipo in ('USF','UCSP','UCC','USP','URAP','Hospital','Outra')),
  centro_saude  text,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (aces_id, nome)
);
create index if not exists unidades_aces_idx on public.unidades(aces_id);

-- ---------------------------------------------------------------------
-- 2. Perfis de utilizador
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id            uuid primary key references auth.users(id) on delete cascade,
  nome          text not null,
  email         text not null,
  papel         text not null check (papel in ('mgf','pediatra')),
  is_admin      boolean not null default false,
  aprovado      boolean not null default false,
  ativo         boolean not null default true,
  unidade_id    uuid references public.unidades(id) on delete set null,
  servico       text,            -- pediatras: hospital / serviço / área
  telefone_prof text,            -- contacto profissional opcional
  created_at    timestamptz not null default now()
);
create index if not exists perfis_unidade_idx on public.perfis(unidade_id);

-- Emails fora de @*.min-saude.pt autorizados manualmente pelo admin
create table if not exists public.emails_autorizados (
  email       text primary key,
  nota        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Funções auxiliares (schema privado, não exposto pela API)
-- ---------------------------------------------------------------------
create or replace function private.perfil_ativo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis p
                 where p.id = (select auth.uid()) and p.aprovado and p.ativo);
$$;

create or replace function private.is_pediatra() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis p
                 where p.id = (select auth.uid()) and p.aprovado and p.ativo
                   and (p.papel = 'pediatra' or p.is_admin));
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis p
                 where p.id = (select auth.uid()) and p.aprovado and p.ativo and p.is_admin);
$$;

create or replace function private.minha_unidade() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.unidade_id from public.perfis p where p.id = (select auth.uid());
$$;

create or replace function private.email_permitido(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select lower(e) ~ '@([a-z0-9-]+\.)*min-saude\.pt$'
      or exists (select 1 from public.emails_autorizados a where lower(a.email) = lower(e));
$$;

grant usage on schema private to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;

-- Expor a verificação de email ao cliente (para feedback no registo)
create or replace function public.email_permitido(e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.email_permitido(e);
$$;

-- ---------------------------------------------------------------------
-- 4. Registo: só emails institucionais; cria perfil automaticamente
-- ---------------------------------------------------------------------
create or replace function private.antes_registo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.email_permitido(new.email) then
    raise exception 'Registo permitido apenas com email institucional (@…min-saude.pt).';
  end if;
  return new;
end $$;

drop trigger if exists pedlink_antes_registo on auth.users;
create trigger pedlink_antes_registo before insert on auth.users
  for each row execute function private.antes_registo();

create or replace function private.apos_registo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_papel text := coalesce(new.raw_user_meta_data->>'papel', 'mgf');
  v_unid  uuid;
begin
  if v_papel not in ('mgf','pediatra') then v_papel := 'mgf'; end if;
  begin
    v_unid := nullif(new.raw_user_meta_data->>'unidade_id','')::uuid;
  exception when others then v_unid := null;
  end;
  insert into public.perfis (id, nome, email, papel, aprovado, unidade_id, servico)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'),''), split_part(new.email,'@',1)),
    new.email,
    v_papel,
    v_papel = 'mgf',            -- MGF com email institucional entra logo; pediatras precisam de aprovação
    v_unid,
    nullif(trim(new.raw_user_meta_data->>'servico'),'')
  ) on conflict (id) do nothing;

  if v_papel = 'pediatra' then
    insert into public.notificacoes (user_id, texto, link)
    select p.id, 'Novo pedido de acesso de pediatra: ' || coalesce(new.raw_user_meta_data->>'nome', new.email), '#/admin'
    from public.perfis p where p.is_admin and p.ativo;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Casos clínicos (anonimizados)
-- ---------------------------------------------------------------------
create sequence if not exists public.casos_seq;

create table if not exists public.casos (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique
                       default ('PL-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.casos_seq')::text, 4, '0')),
  criado_por           uuid not null default auth.uid() references public.perfis(id) on delete restrict,
  unidade_id           uuid references public.unidades(id) on delete set null,
  -- dados clínicos mínimos, sem identificação
  idade_valor          integer not null check (idade_valor between 0 and 216),
  idade_unidade        text not null check (idade_unidade in ('dias','semanas','meses','anos')),
  sexo                 text not null check (sexo in ('F','M','Indeterminado')),
  prioridade           text not null default 'normal' check (prioridade in ('urgente','prioritario','normal')),
  area                 text,          -- área/subespecialidade sugerida
  motivo               text not null check (char_length(motivo) between 3 and 300),
  historia             text check (char_length(historia) <= 8000),
  exame_objetivo       text check (char_length(exame_objetivo) <= 4000),
  exames               text check (char_length(exames) <= 6000),
  terapeutica          text check (char_length(terapeutica) <= 2000),
  pergunta             text not null check (char_length(pergunta) between 3 and 2000),
  -- gestão pela pediatria
  estado               text not null default 'novo'
                       check (estado in ('novo','em_analise','subespecialidade','respondido','reuniao_agendada','fechado')),
  pediatra_id          uuid references public.perfis(id) on delete set null,
  subespecialidade     text,
  resposta             text check (char_length(resposta) <= 8000),
  reuniao_em           timestamptz,
  reuniao_local        text,
  desfecho             text check (desfecho in ('referenciar','nao_referenciar','referenciar_urgencia','seguimento_mgf')),
  desfecho_nota        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists casos_criado_por_idx on public.casos(criado_por);
create index if not exists casos_unidade_idx on public.casos(unidade_id);
create index if not exists casos_estado_idx on public.casos(estado);
create index if not exists casos_pediatra_idx on public.casos(pediatra_id);

create table if not exists public.comentarios (
  id          uuid primary key default gen_random_uuid(),
  caso_id     uuid not null references public.casos(id) on delete cascade,
  autor_id    uuid not null default auth.uid() references public.perfis(id) on delete restrict,
  texto       text not null check (char_length(texto) between 1 and 4000),
  interno     boolean not null default false,   -- nota interna entre pediatras (invisível ao MGF)
  created_at  timestamptz not null default now()
);
create index if not exists comentarios_caso_idx on public.comentarios(caso_id);
create index if not exists comentarios_autor_idx on public.comentarios(autor_id);

create table if not exists public.anexos (
  id          uuid primary key default gen_random_uuid(),
  caso_id     uuid not null references public.casos(id) on delete cascade,
  autor_id    uuid not null default auth.uid() references public.perfis(id) on delete restrict,
  path        text not null unique,      -- caminho no bucket 'anexos': <caso_id>/<uuid>.jpg
  descricao   text,
  created_at  timestamptz not null default now()
);
create index if not exists anexos_caso_idx on public.anexos(caso_id);
create index if not exists anexos_autor_idx on public.anexos(autor_id);

-- ---------------------------------------------------------------------
-- 6. Conteúdos do projeto e documentos (critérios de referenciação)
-- ---------------------------------------------------------------------
create table if not exists public.conteudos (
  chave       text primary key,
  titulo      text not null,
  corpo       text not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists public.documentos (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  categoria   text not null default 'Critérios de referenciação',
  descricao   text,
  path        text not null unique,   -- caminho no bucket 'documentos'
  ordem       integer not null default 100,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. Notificações na app
-- ---------------------------------------------------------------------
create table if not exists public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.perfis(id) on delete cascade,
  caso_id     uuid references public.casos(id) on delete cascade,
  texto       text not null,
  link        text,
  lida        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notificacoes_user_idx on public.notificacoes(user_id, lida);
create index if not exists notificacoes_caso_idx on public.notificacoes(caso_id);

-- trigger de registo só depois de notificacoes existir
drop trigger if exists pedlink_apos_registo on auth.users;
create trigger pedlink_apos_registo after insert on auth.users
  for each row execute function private.apos_registo();

-- ---------------------------------------------------------------------
-- 8. Proteção contra identificadores (nº utente SNS / NIF / CC / contactos)
-- ---------------------------------------------------------------------
create or replace function private.tem_identificador(t text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if t is null then return null; end if;
  -- 9 dígitos seguidos ou agrupados (nº utente SNS, NIF, telefone)
  if t ~ '(^|[^0-9])[0-9]{3}[ .-]?[0-9]{3}[ .-]?[0-9]{3}([^0-9]|$)' then
    return 'Parece conter um número de 9 dígitos (nº de utente, NIF ou telefone).';
  end if;
  -- números longos (processo hospitalar, CC sem letras, etc.)
  if t ~ '[0-9]{8,}' then
    return 'Parece conter um número identificativo longo.';
  end if;
  -- Cartão de Cidadão (ex.: 12345678 9 ZZ1)
  if t ~* '[0-9]{8}\s?[0-9]\s?[a-z]{2}[0-9]' then
    return 'Parece conter um número de Cartão de Cidadão.';
  end if;
  -- endereços de email
  if t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return 'Parece conter um endereço de email.';
  end if;
  -- palavras-chave explícitas seguidas de valor
  if t ~* '(n\.?º|nº|numero|número)\s*(de\s*)?(utente|sns|processo|cc|bi)\s*[:=]?\s*[0-9]' then
    return 'Contém um número de utente/processo.';
  end if;
  return null;
end $$;

create or replace function private.validar_caso() returns trigger
language plpgsql set search_path = '' as $$
declare msg text;
begin
  msg := coalesce(
    private.tem_identificador(new.motivo),
    private.tem_identificador(new.historia),
    private.tem_identificador(new.exame_objetivo),
    private.tem_identificador(new.exames),
    private.tem_identificador(new.terapeutica),
    private.tem_identificador(new.pergunta),
    private.tem_identificador(new.resposta),
    private.tem_identificador(new.desfecho_nota));
  if msg is not null then
    raise exception 'Dados identificativos detetados: %', msg using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.validar_comentario() returns trigger
language plpgsql set search_path = '' as $$
declare msg text;
begin
  msg := private.tem_identificador(new.texto);
  if msg is not null then
    raise exception 'Dados identificativos detetados: %', msg using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists casos_validar on public.casos;
create trigger casos_validar before insert or update on public.casos
  for each row execute function private.validar_caso();

drop trigger if exists comentarios_validar on public.comentarios;
create trigger comentarios_validar before insert or update on public.comentarios
  for each row execute function private.validar_comentario();

-- ---------------------------------------------------------------------
-- 9. Regras de negócio nos casos
-- ---------------------------------------------------------------------
create or replace function private.antes_caso() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := (select auth.uid());
    new.unidade_id := coalesce(new.unidade_id, private.minha_unidade());
    new.estado := 'novo';
    new.pediatra_id := null; new.resposta := null; new.desfecho := null;
    new.reuniao_em := null; new.reuniao_local := null; new.subespecialidade := null;
    return new;
  end if;

  new.updated_at := now();
  new.id := old.id; new.codigo := old.codigo; new.criado_por := old.criado_por; new.created_at := old.created_at;

  if (select auth.uid()) is not null and not private.is_pediatra() then
    -- o MGF só pode editar a parte clínica e só enquanto o caso está 'novo'
    new.estado := old.estado; new.pediatra_id := old.pediatra_id;
    new.subespecialidade := old.subespecialidade; new.resposta := old.resposta;
    new.reuniao_em := old.reuniao_em; new.reuniao_local := old.reuniao_local;
    new.desfecho := old.desfecho; new.desfecho_nota := old.desfecho_nota;
    new.unidade_id := old.unidade_id;
  end if;
  return new;
end $$;

drop trigger if exists casos_antes on public.casos;
create trigger casos_antes before insert or update on public.casos
  for each row execute function private.antes_caso();

-- Notificações automáticas
create or replace function private.notificar_caso() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_txt text;
  rot_estado text;
begin
  if tg_op = 'INSERT' then
    insert into public.notificacoes (user_id, caso_id, texto, link)
    select p.id, new.id,
           'Novo caso ' || new.codigo || ' (' || new.prioridade || '): ' || left(new.motivo, 80),
           '#/caso/' || new.id
    from public.perfis p
    where p.aprovado and p.ativo and (p.papel = 'pediatra' or p.is_admin) and p.id <> new.criado_por;
    return new;
  end if;

  if new.estado is distinct from old.estado or new.desfecho is distinct from old.desfecho
     or new.reuniao_em is distinct from old.reuniao_em or new.resposta is distinct from old.resposta then
    rot_estado := case new.estado
      when 'novo' then 'Novo' when 'em_analise' then 'Em análise'
      when 'subespecialidade' then 'Em discussão com subespecialidade'
      when 'respondido' then 'Respondido na app' when 'reuniao_agendada' then 'Reunião agendada'
      when 'fechado' then 'Fechado' else new.estado end;
    v_txt := 'Caso ' || new.codigo || ': ' || rot_estado;
    if new.reuniao_em is not null and new.reuniao_em is distinct from old.reuniao_em then
      v_txt := v_txt || ' — reunião ' || to_char(new.reuniao_em at time zone 'Europe/Lisbon', 'DD/MM/YYYY HH24:MI');
    end if;
    if new.criado_por <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid) then
      insert into public.notificacoes (user_id, caso_id, texto, link)
      values (new.criado_por, new.id, v_txt, '#/caso/' || new.id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists casos_notificar on public.casos;
create trigger casos_notificar after insert or update on public.casos
  for each row execute function private.notificar_caso();

create or replace function private.notificar_comentario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.casos;
begin
  select * into c from public.casos where id = new.caso_id;
  -- autor do caso (se não for nota interna e não for ele próprio)
  if not new.interno and c.criado_por <> new.autor_id then
    insert into public.notificacoes (user_id, caso_id, texto, link)
    values (c.criado_por, c.id, 'Nova mensagem no caso ' || c.codigo, '#/caso/' || c.id);
  end if;
  -- pediatra responsável, ou todos os pediatras se ainda não houver responsável
  insert into public.notificacoes (user_id, caso_id, texto, link)
  select p.id, c.id,
         case when new.interno then 'Nota interna no caso ' else 'Nova mensagem no caso ' end || c.codigo,
         '#/caso/' || c.id
  from public.perfis p
  where p.aprovado and p.ativo and (p.papel = 'pediatra' or p.is_admin)
    and p.id <> new.autor_id
    and (c.pediatra_id is null or p.id = c.pediatra_id);
  return new;
end $$;

drop trigger if exists comentarios_notificar on public.comentarios;
create trigger comentarios_notificar after insert on public.comentarios
  for each row execute function private.notificar_comentario();

-- Impedir auto-promoção nos perfis
create or replace function private.antes_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() nulo = SQL Editor / service role (administração direta)
  if (select auth.uid()) is not null and not private.is_admin() then
    new.papel := old.papel; new.is_admin := old.is_admin;
    new.aprovado := old.aprovado; new.ativo := old.ativo; new.email := old.email;
    -- MGF pode mudar de unidade (transferência); pediatra também pode atualizar serviço
  end if;
  new.id := old.id; new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists perfis_antes on public.perfis;
create trigger perfis_antes before update on public.perfis
  for each row execute function private.antes_perfil();

-- ---------------------------------------------------------------------
-- 10. Row Level Security
-- ---------------------------------------------------------------------
alter table public.aces               enable row level security;
alter table public.unidades           enable row level security;
alter table public.perfis             enable row level security;
alter table public.emails_autorizados enable row level security;
alter table public.casos              enable row level security;
alter table public.comentarios        enable row level security;
alter table public.anexos             enable row level security;
alter table public.conteudos          enable row level security;
alter table public.documentos         enable row level security;
alter table public.notificacoes       enable row level security;

-- ACES e unidades: leitura pública (necessário no formulário de registo); escrita só admin
drop policy if exists aces_ler on public.aces;
create policy aces_ler on public.aces for select to anon, authenticated using (true);
drop policy if exists aces_admin on public.aces;
create policy aces_admin on public.aces for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists unidades_ler on public.unidades;
create policy unidades_ler on public.unidades for select to anon, authenticated using (true);
drop policy if exists unidades_admin on public.unidades;
create policy unidades_admin on public.unidades for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Perfis: cada um vê o seu; pediatras veem todos; MGF vê pediatras (para saber quem respondeu)
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (
  id = (select auth.uid())
  or (select private.is_pediatra())
  or ((select private.perfil_ativo()) and papel = 'pediatra')
);
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists emails_admin on public.emails_autorizados;
create policy emails_admin on public.emails_autorizados for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Casos
drop policy if exists casos_ler on public.casos;
create policy casos_ler on public.casos for select to authenticated using (
  (select private.is_pediatra())
  or ((select private.perfil_ativo()) and (
        criado_por = (select auth.uid())
        or (unidade_id is not null and unidade_id = (select private.minha_unidade()))))
);
drop policy if exists casos_criar on public.casos;
create policy casos_criar on public.casos for insert to authenticated
  with check ((select private.perfil_ativo()));
drop policy if exists casos_editar on public.casos;
create policy casos_editar on public.casos for update to authenticated using (
  (select private.is_pediatra())
  or (criado_por = (select auth.uid()) and estado = 'novo' and (select private.perfil_ativo()))
) with check (
  (select private.is_pediatra())
  or (criado_por = (select auth.uid()) and (select private.perfil_ativo()))
);
drop policy if exists casos_apagar on public.casos;
create policy casos_apagar on public.casos for delete to authenticated using (
  (select private.is_admin())
  or (criado_por = (select auth.uid()) and estado = 'novo')
);

-- Comentários: quem vê o caso vê os comentários não internos; internos só pediatras
drop policy if exists comentarios_ler on public.comentarios;
create policy comentarios_ler on public.comentarios for select to authenticated using (
  (select private.is_pediatra())
  or (not interno and exists (select 1 from public.casos c where c.id = caso_id))
);
drop policy if exists comentarios_criar on public.comentarios;
create policy comentarios_criar on public.comentarios for insert to authenticated with check (
  autor_id = (select auth.uid())
  and (select private.perfil_ativo())
  and exists (select 1 from public.casos c where c.id = caso_id)
  and (not interno or (select private.is_pediatra()))
);
drop policy if exists comentarios_apagar on public.comentarios;
create policy comentarios_apagar on public.comentarios for delete to authenticated using (
  autor_id = (select auth.uid()) or (select private.is_admin())
);

-- Anexos (metadados)
drop policy if exists anexos_ler on public.anexos;
create policy anexos_ler on public.anexos for select to authenticated using (
  exists (select 1 from public.casos c where c.id = caso_id)
);
drop policy if exists anexos_criar on public.anexos;
create policy anexos_criar on public.anexos for insert to authenticated with check (
  autor_id = (select auth.uid()) and exists (select 1 from public.casos c where c.id = caso_id)
);
drop policy if exists anexos_apagar on public.anexos;
create policy anexos_apagar on public.anexos for delete to authenticated using (
  autor_id = (select auth.uid()) or (select private.is_admin())
);

-- Conteúdos e documentos: leitura para utilizadores aprovados; escrita só admin
drop policy if exists conteudos_ler on public.conteudos;
create policy conteudos_ler on public.conteudos for select to authenticated using ((select private.perfil_ativo()));
drop policy if exists conteudos_admin on public.conteudos;
create policy conteudos_admin on public.conteudos for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists documentos_ler on public.documentos;
create policy documentos_ler on public.documentos for select to authenticated using ((select private.perfil_ativo()));
drop policy if exists documentos_admin on public.documentos;
create policy documentos_admin on public.documentos for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Notificações: cada um vê e marca as suas
drop policy if exists notificacoes_ler on public.notificacoes;
create policy notificacoes_ler on public.notificacoes for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notificacoes_editar on public.notificacoes;
create policy notificacoes_editar on public.notificacoes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notificacoes_apagar on public.notificacoes;
create policy notificacoes_apagar on public.notificacoes for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 11. Storage: buckets privados
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 5242880, array['image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf'];

-- anexos: caminho '<caso_id>/<ficheiro>'; acesso a quem pode ver o caso
drop policy if exists pedlink_anexos_ler on storage.objects;
create policy pedlink_anexos_ler on storage.objects for select to authenticated using (
  bucket_id = 'anexos' and exists (
    select 1 from public.casos c where c.id::text = (storage.foldername(name))[1])
);
drop policy if exists pedlink_anexos_criar on storage.objects;
create policy pedlink_anexos_criar on storage.objects for insert to authenticated with check (
  bucket_id = 'anexos' and (select private.perfil_ativo()) and exists (
    select 1 from public.casos c where c.id::text = (storage.foldername(name))[1])
);
drop policy if exists pedlink_anexos_apagar on storage.objects;
create policy pedlink_anexos_apagar on storage.objects for delete to authenticated using (
  bucket_id = 'anexos' and (owner_id = (select auth.uid())::text or (select private.is_admin()))
);

drop policy if exists pedlink_docs_ler on storage.objects;
create policy pedlink_docs_ler on storage.objects for select to authenticated using (
  bucket_id = 'documentos' and (select private.perfil_ativo())
);
drop policy if exists pedlink_docs_admin_ins on storage.objects;
create policy pedlink_docs_admin_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and (select private.is_admin())
);
drop policy if exists pedlink_docs_admin_upd on storage.objects;
create policy pedlink_docs_admin_upd on storage.objects for update to authenticated using (
  bucket_id = 'documentos' and (select private.is_admin())
);
drop policy if exists pedlink_docs_admin_del on storage.objects;
create policy pedlink_docs_admin_del on storage.objects for delete to authenticated using (
  bucket_id = 'documentos' and (select private.is_admin())
);

-- ---------------------------------------------------------------------
-- 11b. Permissões da API (RLS continua a filtrar as linhas)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.aces, public.unidades to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.email_permitido(text) to anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on all functions in schema private to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 12. Dados iniciais (editáveis no painel de administração)
-- ---------------------------------------------------------------------
insert into public.conteudos (chave, titulo, corpo) values
('projeto', 'O projeto PedLink',
'O PedLink liga os médicos de Medicina Geral e Familiar (MGF) aos pediatras hospitalares para discutir casos de crianças e adolescentes antes de uma eventual referenciação à consulta hospitalar.

Objetivos
• Reduzir referenciações desnecessárias e antecipar as que são necessárias.
• Dar resposta rápida a dúvidas simples diretamente na app.
• Preparar a discussão presencial, envolvendo as subespecialidades pediátricas quando útil.

Como funciona
1. O MGF cria um caso anonimizado, com prioridade e uma pergunta concreta.
2. A equipa de pediatria analisa, pode discutir com a subespecialidade e responde na app ou agenda reunião.
3. O caso termina com um desfecho: referenciar, não referenciar, referenciar à urgência ou manter seguimento em MGF.

Proteção de dados
Não introduza nome, número de utente, NIF, número de processo, data de nascimento completa, morada ou contactos do doente. A app bloqueia automaticamente padrões numéricos identificativos. As imagens são reprocessadas para remover metadados.

(Texto editável pelo administrador.)')
on conflict (chave) do nothing;

insert into public.aces (nome, uls) values
  ('ACES exemplo A (editar)', 'ULS exemplo (editar)'),
  ('ACES exemplo B (editar)', 'ULS exemplo (editar)')
on conflict (nome) do nothing;

insert into public.unidades (aces_id, nome, tipo, centro_saude)
select a.id, v.nome, v.tipo, v.cs from public.aces a
join (values
  ('ACES exemplo A (editar)', 'USF Exemplo 1', 'USF', 'Centro de Saúde Exemplo A'),
  ('ACES exemplo A (editar)', 'USF Exemplo 2', 'USF', 'Centro de Saúde Exemplo A'),
  ('ACES exemplo A (editar)', 'UCSP Exemplo',  'UCSP','Centro de Saúde Exemplo A'),
  ('ACES exemplo B (editar)', 'USF Exemplo 3', 'USF', 'Centro de Saúde Exemplo B')
) as v(aces, nome, tipo, cs) on v.aces = a.nome
on conflict (aces_id, nome) do nothing;

-- ---------------------------------------------------------------------
-- 13. Primeiro administrador
-- Depois de te registares na app, corre (substitui o email):
--   update public.perfis set papel='pediatra', is_admin=true, aprovado=true
--   where email = 'o.teu.email@xxx.min-saude.pt';
-- Para te registares com email não institucional, primeiro:
--   insert into public.emails_autorizados(email, nota) values ('x@gmail.com','admin');
-- ---------------------------------------------------------------------
