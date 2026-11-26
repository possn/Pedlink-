-- PedLink — permissões da API (projetos Supabase recentes não as concedem por defeito).
-- O RLS continua a decidir que linhas cada utilizador vê; isto só abre as tabelas à API.
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

-- Criar perfis em falta para contas já registadas (se o trigger de registo não tiver corrido)
insert into public.perfis (id, nome, email, papel, aprovado, servico)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1)),
       u.email,
       case when u.raw_user_meta_data->>'papel' = 'pediatra' then 'pediatra' else 'mgf' end,
       coalesce(u.raw_user_meta_data->>'papel', 'mgf') = 'mgf',
       nullif(trim(u.raw_user_meta_data->>'servico'), '')
from auth.users u
where not exists (select 1 from public.perfis p where p.id = u.id);
