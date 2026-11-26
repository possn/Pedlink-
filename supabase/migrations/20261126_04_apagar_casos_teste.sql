-- Apagar todos os casos (fase de testes) e recomeçar a numeração PL-AAAA-0001.
-- Só administradores. Os ficheiros de imagem são apagados pela app antes de chamar esta função.
create or replace function public.apagar_todos_casos()
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare n integer;
begin
  if not private.is_admin() then
    raise exception 'Apenas administradores';
  end if;
  delete from public.notificacoes where caso_id is not null;
  delete from public.anexos;
  delete from public.comentarios;
  delete from public.casos;
  get diagnostics n = row_count;
  alter sequence public.casos_seq restart with 1;
  return n;
end;
$$;

revoke all on function public.apagar_todos_casos() from public, anon;
grant execute on function public.apagar_todos_casos() to authenticated;
