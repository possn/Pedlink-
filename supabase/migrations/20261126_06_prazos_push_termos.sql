-- =====================================================================
-- Prazos de resposta, tempos para indicadores, alertas de atraso,
-- notificações no telemóvel (Web Push) e aceitação dos termos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tempos do caso (preenchidos pela base de dados, não pela app)
-- ---------------------------------------------------------------------
alter table public.casos add column if not exists primeira_resposta_em timestamptz;
alter table public.casos add column if not exists fechado_em timestamptz;
alter table public.casos add column if not exists atraso_notificado boolean not null default false;
alter table public.perfis add column if not exists termos_aceites_em timestamptz;

-- prazo de 1.ª resposta da pediatria, em horas
create or replace function private.prazo_horas(p text) returns integer
language sql immutable set search_path = '' as $$
  select case p when 'urgente' then 48 when 'prioritario' then 168 else 720 end
$$;
grant execute on function private.prazo_horas(text) to anon, authenticated;

-- "Respondido" = a pediatria deu resposta (estado respondido/reunião/fechado, texto de resposta)
-- ou escreveu uma mensagem visível ao MGF (ver trigger dos comentários).
create or replace function private.tempos_caso() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sistema boolean := coalesce(current_setting('pedlink.sistema', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.primeira_resposta_em := null; new.fechado_em := null; new.atraso_notificado := false;
    return new;
  end if;
  if not sistema then
    new.primeira_resposta_em := old.primeira_resposta_em;
    new.atraso_notificado := old.atraso_notificado;
    new.fechado_em := old.fechado_em;
  end if;
  if new.primeira_resposta_em is null
     and (new.estado in ('respondido', 'reuniao_agendada', 'fechado') or coalesce(new.resposta, '') <> '') then
    new.primeira_resposta_em := now();
  end if;
  if new.estado = 'fechado' and new.fechado_em is null then new.fechado_em := now(); end if;
  if new.estado <> 'fechado' then new.fechado_em := null; end if;
  return new;
end $$;
drop trigger if exists zz_casos_tempos on public.casos;
create trigger zz_casos_tempos before insert or update on public.casos
  for each row execute function private.tempos_caso();

-- mensagem não interna de um pediatra conta como 1.ª resposta
create or replace function private.comentario_resposta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.interno and exists (select 1 from public.perfis p where p.id = new.autor_id and (p.papel = 'pediatra' or p.is_admin)) then
    perform set_config('pedlink.sistema', '1', true);
    update public.casos set primeira_resposta_em = now()
     where id = new.caso_id and primeira_resposta_em is null;
    perform set_config('pedlink.sistema', '', true);
  end if;
  return new;
end $$;
drop trigger if exists comentarios_resposta on public.comentarios;
create trigger comentarios_resposta after insert on public.comentarios
  for each row execute function private.comentario_resposta();

-- preencher casos já existentes
update public.casos set primeira_resposta_em = coalesce(updated_at, now())
 where primeira_resposta_em is null and (estado in ('respondido', 'reuniao_agendada', 'fechado') or coalesce(resposta, '') <> '');
update public.casos set fechado_em = coalesce(updated_at, now()) where estado = 'fechado' and fechado_em is null;

-- ---------------------------------------------------------------------
-- 2. Alertas de atraso (de hora a hora, via pg_cron)
-- ---------------------------------------------------------------------
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
            or (c.pediatra_id is null and p.papel = 'pediatra'));
    update public.casos set atraso_notificado = true where id = c.id;
    n := n + 1;
  end loop;
  perform set_config('pedlink.sistema', '', true);
  return n;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'pedlink-atrasos';
  perform cron.schedule('pedlink-atrasos', '5 * * * *', 'select private.verificar_atrasos()');
exception when others then
  raise notice 'pg_cron indisponível (%): alertas de atraso só na app', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 3. Notificações no telemóvel (Web Push)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscricoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  dispositivo text,
  created_at timestamptz not null default now()
);
alter table public.push_subscricoes enable row level security;
drop policy if exists push_proprias on public.push_subscricoes;
create policy push_proprias on public.push_subscricoes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscricoes to authenticated;

-- valores públicos de configuração (ex.: chave pública VAPID)
create table if not exists public.config_publica (chave text primary key, valor text not null);
alter table public.config_publica enable row level security;
drop policy if exists config_ler on public.config_publica;
create policy config_ler on public.config_publica for select to authenticated using (true);
grant select on public.config_publica to authenticated;

-- segredo partilhado entre a base de dados e a função de envio
create table if not exists private.config (chave text primary key, valor text not null);
revoke all on private.config from anon, authenticated;
insert into private.config (chave, valor)
values ('push_segredo', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponível: %', sqlerrm;
end $$;

create or replace function private.enviar_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare seg text;
begin
  if not exists (select 1 from public.push_subscricoes s where s.user_id = new.user_id) then return new; end if;
  select valor into seg from private.config where chave = 'push_segredo';
  begin
    perform net.http_post(
      url := 'https://zkbnhyzxuymcowfepsdz.supabase.co/functions/v1/push',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pedlink-segredo', seg)
    );
  exception when others then
    raise warning 'push não enviado: %', sqlerrm;  -- nunca impede a notificação na app
  end;
  return new;
end $$;
drop trigger if exists notificacoes_push on public.notificacoes;
create trigger notificacoes_push after insert on public.notificacoes
  for each row execute function private.enviar_push();

-- notificação de teste (botão no perfil)
create or replace function public.notificacao_teste() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sem sessão'; end if;
  insert into public.notificacoes (user_id, texto, link)
  values ((select auth.uid()), 'Notificação de teste: o PedLink vai avisá-lo neste dispositivo.', '#/perfil');
end $$;
revoke all on function public.notificacao_teste() from public, anon;
grant execute on function public.notificacao_teste() to authenticated;

-- a função de envio lê com a service role
grant usage on schema public to service_role;
grant select on public.notificacoes to service_role;
grant select, delete on public.push_subscricoes to service_role;

-- ---------------------------------------------------------------------
-- 4. Termos de uso e privacidade (rascunho editável pelo administrador)
-- ---------------------------------------------------------------------
insert into public.conteudos (chave, titulo, corpo) values ('privacidade', 'Privacidade e termos de uso',
'RASCUNHO — a validar pelo Encarregado de Proteção de Dados e pela Comissão de Ética da ULS Amadora/Sintra.

1. Finalidade
O PedLink destina-se exclusivamente à discussão clínica entre médicos de Medicina Geral e Familiar (MGF) e médicos de Pediatria da ULS Amadora/Sintra, para apoiar a decisão de referenciação à consulta hospitalar. Não substitui a referenciação formal (CTH), o processo clínico nem o Serviço de Urgência.

2. Dados dos doentes: apenas anonimizados
• É proibido introduzir dados que identifiquem o doente ou terceiros: nome, número de utente, NIF, nº de processo, data de nascimento completa, morada, contactos, fotografias do rosto ou de documentos.
• A idade é registada em anos/meses; as datas de exames devem ser aproximadas (mês/ano).
• A plataforma bloqueia automaticamente padrões de identificação conhecidos, mas a responsabilidade pela anonimização é de quem submete o caso.
• As imagens são reprocessadas no dispositivo para remover metadados (incluindo localização).

3. Dados dos profissionais
São tratados o nome, email institucional, perfil (MGF/Pediatria), unidade/serviço e o registo de atividade na plataforma, para gestão de acessos, comunicação entre equipas e avaliação do projeto. Base: execução de funções de interesse público no âmbito do SNS.

4. Ditado por voz
O ditado usa o reconhecimento de voz do sistema do telemóvel/navegador (Apple ou Google), que pode processar o áudio nos seus servidores. Não dite nomes nem números identificativos.

5. Alojamento e segurança
Base de dados alojada na União Europeia (Supabase, Irlanda), com acesso cifrado (HTTPS), autenticação individual, aprovação de contas por administrador e regras de acesso por perfil. As imagens são privadas e só acessíveis por ligações temporárias.

6. Conservação
Os casos encerrados mantêm-se disponíveis para consulta e avaliação do projeto durante 5 anos, sendo depois eliminados. Os casos de teste são eliminados antes da entrada em funcionamento.

7. Avaliação do projeto
Podem ser exportados indicadores agregados e listagens sem texto livre (códigos, datas, prioridade, unidade, desfecho), para avaliação de qualidade e eventual divulgação científica.

8. Responsabilidade clínica
A resposta da Pediatria é um parecer baseado na informação fornecida, sem observação do doente. A decisão clínica e a referenciação mantêm-se da responsabilidade do médico assistente. Situações emergentes devem seguir para o Serviço de Urgência.

9. Contacto
Coordenação do projeto PedLink — Serviço de Pediatria, Hospital Prof. Doutor Fernando Fonseca.')
on conflict (chave) do nothing;

notify pgrst, 'reload schema';
