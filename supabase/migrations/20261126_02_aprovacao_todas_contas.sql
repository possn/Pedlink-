-- Todas as contas novas (MGF e pediatras) ficam pendentes até aprovação por um administrador.
-- Motivo: confirmação de email desligada (limite de envio do Supabase gratuito); a aprovação
-- manual garante que só colegas conhecidos acedem aos casos.
create or replace function private.apos_registo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_papel text := coalesce(new.raw_user_meta_data->>'papel', 'mgf');
  v_unid  uuid;
  v_nome  text := coalesce(nullif(trim(new.raw_user_meta_data->>'nome'),''), split_part(new.email,'@',1));
begin
  if v_papel not in ('mgf','pediatra') then v_papel := 'mgf'; end if;
  begin
    v_unid := nullif(new.raw_user_meta_data->>'unidade_id','')::uuid;
  exception when others then v_unid := null;
  end;
  insert into public.perfis (id, nome, email, papel, aprovado, unidade_id, servico)
  values (new.id, v_nome, new.email, v_papel, false, v_unid,
          nullif(trim(new.raw_user_meta_data->>'servico'),''))
  on conflict (id) do nothing;

  insert into public.notificacoes (user_id, texto, link)
  select p.id,
         'Novo pedido de acesso (' || case when v_papel = 'pediatra' then 'Pediatria' else 'MGF' end || '): ' || v_nome,
         '#/admin/utilizadores'
  from public.perfis p where p.is_admin and p.ativo and p.aprovado;
  return new;
end $$;
