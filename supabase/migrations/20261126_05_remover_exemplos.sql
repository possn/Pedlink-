-- Remove de vez os ACES e unidades de exemplo do esquema inicial.
-- Quem estiver ligado a uma unidade de exemplo fica sem unidade e escolhe a sua em "O meu perfil".
update public.perfis set unidade_id = null
 where unidade_id in (select id from public.unidades where nome ilike '%exemplo%');
update public.casos set unidade_id = null
 where unidade_id in (select id from public.unidades where nome ilike '%exemplo%');
delete from public.unidades where nome ilike '%exemplo%';
delete from public.aces a
 where a.nome ilike '%exemplo%'
   and not exists (select 1 from public.unidades u where u.aces_id = a.id);
