-- Auditoria (v21): correções de robustez e segurança.

-- 1) Registo de notificações push robusto: o mesmo telemóvel pode ter sido usado
--    por outro utilizador (o endpoint é único). Substitui a subscrição de forma atómica.
create or replace function public.registar_push(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.perfil_ativo() then
    raise exception 'Sem permissão';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then
    raise exception 'Subscrição inválida';
  end if;
  delete from public.push_subscricoes where endpoint = p_endpoint;
  insert into public.push_subscricoes (user_id, endpoint, p256dh, auth, dispositivo)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, left(p_dispositivo, 60));
end $$;
revoke all on function public.registar_push(text, text, text, text) from public, anon;
grant execute on function public.registar_push(text, text, text, text) to authenticated;

-- 2) Mudança de unidade por um MGF altera os casos que vê: avisar os administradores.
create or replace function private.aviso_mudanca_unidade() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  if new.unidade_id is distinct from old.unidade_id
     and (select auth.uid()) is not null and not private.is_admin()
     and new.papel = 'mgf' then
    select coalesce(u.nome, 'sem unidade') into v_nome from public.unidades u where u.id = new.unidade_id;
    insert into public.notificacoes (user_id, texto, link)
    select p.id, 'Um MGF alterou a sua unidade para ' || coalesce(v_nome, 'sem unidade') || '. Confirme em Administração.', '#/admin/utilizadores'
      from public.perfis p where p.is_admin and p.ativo;
  end if;
  return new;
end $$;
drop trigger if exists perfis_aviso_unidade on public.perfis;
create trigger perfis_aviso_unidade after update of unidade_id on public.perfis
  for each row execute function private.aviso_mudanca_unidade();

-- 3) Limpeza diária de notificações lidas com mais de 180 dias (minimização de dados).
create index if not exists notificacoes_created_idx on public.notificacoes(created_at);
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'pedlink-limpeza';
  perform cron.schedule('pedlink-limpeza', '30 3 * * *',
    $q$delete from public.notificacoes where lida and created_at < now() - interval '180 days'$q$);
exception when others then
  raise notice 'pg_cron indisponível (%)', sqlerrm;
end $$;

-- 4) Lista de casos ordenada por data.
create index if not exists casos_created_idx on public.casos(created_at desc);
