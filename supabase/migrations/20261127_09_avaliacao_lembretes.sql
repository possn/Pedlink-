-- v22: avaliação da resposta pelo MGF + lembrete de fecho de casos respondidos.

-- 1) Avaliação (uma por caso, feita pelo MGF que o criou). Sem texto livre.
create table if not exists public.avaliacoes (
  caso_id       uuid primary key references public.casos(id) on delete cascade,
  autor_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  utilidade     smallint not null check (utilidade between 1 and 5),
  mudou_conduta boolean not null,
  evitou_ref    text not null check (evitou_ref in ('sim', 'nao', 'na')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.avaliacoes enable row level security;
grant select, insert, update on public.avaliacoes to authenticated;

drop policy if exists avaliacoes_ler on public.avaliacoes;
create policy avaliacoes_ler on public.avaliacoes for select to authenticated using (
  autor_id = (select auth.uid()) or (select private.is_pediatra())
);
drop policy if exists avaliacoes_criar on public.avaliacoes;
create policy avaliacoes_criar on public.avaliacoes for insert to authenticated with check (
  autor_id = (select auth.uid()) and (select private.perfil_ativo()) and exists (
    select 1 from public.casos c where c.id = caso_id and c.criado_por = (select auth.uid()) and c.primeira_resposta_em is not null)
);
drop policy if exists avaliacoes_editar on public.avaliacoes;
create policy avaliacoes_editar on public.avaliacoes for update to authenticated
  using (autor_id = (select auth.uid()))
  with check (autor_id = (select auth.uid()));

create or replace function private.antes_avaliacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.caso_id := old.caso_id; new.autor_id := old.autor_id; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists avaliacoes_antes on public.avaliacoes;
create trigger avaliacoes_antes before insert or update on public.avaliacoes
  for each row execute function private.antes_avaliacao();

-- avisar o pediatra responsável quando o MGF avalia
create or replace function private.notificar_avaliacao() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select id, codigo, pediatra_id into c from public.casos where id = new.caso_id;
  if c.pediatra_id is not null then
    insert into public.notificacoes (user_id, caso_id, texto, link)
    values (c.pediatra_id, c.id, 'Caso ' || c.codigo || ': o MGF avaliou a resposta (' || new.utilidade || '/5)', '#/caso/' || c.id);
  end if;
  return new;
end $$;
drop trigger if exists avaliacoes_notificar on public.avaliacoes;
create trigger avaliacoes_notificar after insert on public.avaliacoes
  for each row execute function private.notificar_avaliacao();

-- 2) Lembrete: caso respondido há 14 dias (ou reunião há 7 dias) e ainda aberto.
alter table public.casos add column if not exists lembrete_fecho boolean not null default false;

create or replace function private.lembrar_fecho() returns integer
language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  perform set_config('pedlink.sistema', '1', true);
  for c in
    select * from public.casos
     where not lembrete_fecho
       and ((estado = 'respondido' and primeira_resposta_em < now() - interval '14 days')
         or (estado = 'reuniao_agendada' and reuniao_em < now() - interval '7 days'))
  loop
    insert into public.notificacoes (user_id, caso_id, texto, link)
    select p.id, c.id, 'Caso ' || c.codigo || ' continua aberto: registe o desfecho e feche o caso', '#/caso/' || c.id
      from public.perfis p
     where p.aprovado and p.ativo
       and ((c.pediatra_id is not null and p.id = c.pediatra_id) or (c.pediatra_id is null and p.is_admin));
    if not exists (select 1 from public.avaliacoes a where a.caso_id = c.id) then
      insert into public.notificacoes (user_id, caso_id, texto, link)
      values (c.criado_por, c.id, 'Caso ' || c.codigo || ': avalie a resposta da Pediatria (30 segundos)', '#/caso/' || c.id);
    end if;
    update public.casos set lembrete_fecho = true where id = c.id;
    n := n + 1;
  end loop;
  perform set_config('pedlink.sistema', '', true);
  return n;
end $$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'pedlink-fecho';
  perform cron.schedule('pedlink-fecho', '0 9 * * *', 'select private.lembrar_fecho()');
exception when others then
  raise notice 'pg_cron indisponível (%)', sqlerrm;
end $$;
