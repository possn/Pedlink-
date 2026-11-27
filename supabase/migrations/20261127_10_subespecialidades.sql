-- v23: encaminhamento de casos da Pediatria geral para subespecialistas.
-- Modelo (decisão do Pedro): a Pediatria geral recebe os casos novos; todos os pediatras
-- veem todos os casos; ao encaminhar, a responsabilidade passa para o subespecialista.

alter table public.perfis add column if not exists pediatria_geral boolean not null default true;
alter table public.perfis add column if not exists subespecialidades text[] not null default '{}';

create table if not exists public.encaminhamentos (
  id            uuid primary key default gen_random_uuid(),
  caso_id       uuid not null references public.casos(id) on delete cascade,
  area          text not null check (length(area) between 2 and 80),
  para_id       uuid references public.perfis(id) on delete set null,
  pergunta      text not null check (length(pergunta) between 3 and 4000),
  criado_por    uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  created_at    timestamptz not null default now(),
  respondido_em timestamptz,
  respondido_por uuid references public.perfis(id) on delete set null
);
create index if not exists encaminhamentos_caso_idx on public.encaminhamentos(caso_id);
create index if not exists encaminhamentos_para_idx on public.encaminhamentos(para_id);
alter table public.encaminhamentos enable row level security;
grant select, insert, delete on public.encaminhamentos to authenticated;

-- funções de apoio
create or replace function private.is_pediatra_geral() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis p
                 where p.id = (select auth.uid()) and p.aprovado and p.ativo
                   and ((p.papel = 'pediatra' and p.pediatria_geral) or p.is_admin));
$$;
grant execute on function private.is_pediatra_geral() to authenticated;

drop policy if exists encaminhamentos_ler on public.encaminhamentos;
create policy encaminhamentos_ler on public.encaminhamentos for select to authenticated using (
  (select private.is_pediatra()) and exists (select 1 from public.casos c where c.id = caso_id)
);
drop policy if exists encaminhamentos_criar on public.encaminhamentos;
create policy encaminhamentos_criar on public.encaminhamentos for insert to authenticated with check (
  criado_por = (select auth.uid()) and (select private.is_pediatra())
  and exists (select 1 from public.casos c where c.id = caso_id and c.estado <> 'fechado')
);
drop policy if exists encaminhamentos_apagar on public.encaminhamentos;
create policy encaminhamentos_apagar on public.encaminhamentos for delete to authenticated using (
  (criado_por = (select auth.uid()) and respondido_em is null) or (select private.is_admin())
);

-- validação do texto e campos controlados pelo sistema
create or replace function private.antes_encaminhamento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare msg text;
begin
  msg := private.tem_identificador(new.pergunta);
  if msg is not null then raise exception 'Dados identificativos detetados: %', msg using errcode = 'P0001'; end if;
  new.criado_por := coalesce((select auth.uid()), new.criado_por);
  new.created_at := now(); new.respondido_em := null; new.respondido_por := null;
  return new;
end $$;
drop trigger if exists encaminhamentos_antes on public.encaminhamentos;
create trigger encaminhamentos_antes before insert on public.encaminhamentos
  for each row execute function private.antes_encaminhamento();

-- ao encaminhar: estado do caso, área consultada e notificação aos subespecialistas
create or replace function private.apos_encaminhamento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  update public.casos
     set estado = case when estado in ('novo', 'em_analise', 'respondido') then 'subespecialidade' else estado end,
         subespecialidade = case when subespecialidade is null or subespecialidade = '' then new.area
                                 when position(new.area in subespecialidade) > 0 then subespecialidade
                                 else left(subespecialidade || ', ' || new.area, 120) end,
         pediatra_id = new.para_id   -- passa ao colega escolhido; sem colega fica em aberto até um subespecialista assumir
   where id = new.caso_id;
  select id, codigo, prioridade into c from public.casos where id = new.caso_id;
  insert into public.notificacoes (user_id, caso_id, texto, link)
  select p.id, c.id, 'Caso ' || c.codigo || ' (' || c.prioridade || ') encaminhado para ' || new.area, '#/caso/' || c.id
    from public.perfis p
   where p.aprovado and p.ativo and p.papel = 'pediatra' and p.id <> new.criado_por
     and (p.id = new.para_id or (new.para_id is null and new.area = any(p.subespecialidades)));
  return new;
end $$;
drop trigger if exists encaminhamentos_apos on public.encaminhamentos;
create trigger encaminhamentos_apos after insert on public.encaminhamentos
  for each row execute function private.apos_encaminhamento();

-- resposta do subespecialista destinatário (mensagem na Conversa ou resposta ao MGF):
-- fecha o encaminhamento e, se o caso estava sem responsável, assume-o
create or replace function private.resposta_encaminhamento(p_caso uuid, p_autor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.encaminhamentos e
     set respondido_em = now(), respondido_por = p_autor
    from public.perfis p
   where e.caso_id = p_caso and e.respondido_em is null
     and p.id = p_autor and p.papel = 'pediatra'
     and (e.para_id = p.id or (e.para_id is null and e.area = any(p.subespecialidades)));
  get diagnostics n = row_count;
  if n > 0 then
    update public.casos set pediatra_id = p_autor where id = p_caso and pediatra_id is null;
  end if;
end $$;
create or replace function private.comentario_encaminhamento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.resposta_encaminhamento(new.caso_id, new.autor_id);
  return new;
end $$;
create or replace function private.caso_encaminhamento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and coalesce(new.resposta, '') <> '' and new.resposta is distinct from old.resposta then
    perform private.resposta_encaminhamento(new.id, (select auth.uid()));
  end if;
  return new;
end $$;
drop trigger if exists casos_encaminhamento on public.casos;
create trigger casos_encaminhamento after update of resposta on public.casos
  for each row execute function private.caso_encaminhamento();
drop trigger if exists comentarios_encaminhamento on public.comentarios;
create trigger comentarios_encaminhamento after insert on public.comentarios
  for each row execute function private.comentario_encaminhamento();

-- notificações: casos novos e mensagens sem responsável só para a Pediatria geral
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
    where p.aprovado and p.ativo and ((p.papel = 'pediatra' and p.pediatria_geral) or p.is_admin) and p.id <> new.criado_por;
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
  where p.id <> new.autor_id
    and ((c.pediatra_id is null and p.aprovado and p.ativo and ((p.papel = 'pediatra' and p.pediatria_geral) or p.is_admin)) or p.id = c.pediatra_id);
  -- subespecialistas com encaminhamento pendente neste caso
  insert into public.notificacoes (user_id, caso_id, texto, link)
  select distinct p.id, c.id,
         case when new.interno then 'Nota interna no caso ' else 'Nova mensagem no caso ' end || c.codigo,
         '#/caso/' || c.id
  from public.encaminhamentos e
  join public.perfis p on p.aprovado and p.ativo and p.papel = 'pediatra'
       and (p.id = e.para_id or (e.para_id is null and e.area = any(p.subespecialidades)))
  where e.caso_id = c.id and e.respondido_em is null
    and p.id <> new.autor_id and p.id is distinct from c.pediatra_id;
  return new;
end $$;

create or replace function private.verificar_atrasos() returns integer
language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  perform set_config('pedlink.sistema', '1', true);
  for c in
    select * from public.casos
     where primeira_resposta_em is null and estado <> 'fechado' and not atraso_notificado
       and created_at + make_interval(hours => private.prazo_horas(prioridade)) < now()
  loop
    insert into public.notificacoes (user_id, caso_id, texto, link)
    select p.id, c.id, 'Caso ' || c.codigo || ' (' || c.prioridade || ') ultrapassou o prazo de resposta', '#/caso/' || c.id
      from public.perfis p
     where p.aprovado and p.ativo
       and ((c.pediatra_id is not null and p.id = c.pediatra_id) or p.is_admin
            or (c.pediatra_id is null and p.papel = 'pediatra' and p.pediatria_geral));
    update public.casos set atraso_notificado = true where id = c.id;
    n := n + 1;
  end loop;
  perform set_config('pedlink.sistema', '', true);
  return n;
end $$;

-- só o administrador define Pediatria geral / subespecialidades
create or replace function private.antes_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() nulo = SQL Editor / service role (administração direta)
  if (select auth.uid()) is not null and not private.is_admin() then
    new.papel := old.papel; new.is_admin := old.is_admin;
    new.aprovado := old.aprovado; new.ativo := old.ativo; new.email := old.email;
    new.pediatria_geral := old.pediatria_geral; new.subespecialidades := old.subespecialidades;
    -- MGF pode mudar de unidade (transferência); pediatra também pode atualizar serviço
  end if;
  new.id := old.id; new.created_at := old.created_at;
  return new;
end $$;
