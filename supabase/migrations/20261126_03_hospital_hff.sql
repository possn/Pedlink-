-- Hospital de referência para os pediatras da ULS Amadora/Sintra.
insert into public.aces (nome, uls) values ('ULS Amadora/Sintra — Hospital', 'ULS Amadora/Sintra')
on conflict (nome) do nothing;

insert into public.unidades (aces_id, nome, tipo, centro_saude)
select a.id, 'Hospital Prof. Doutor Fernando Fonseca', 'Hospital', 'Amadora'
from public.aces a where a.nome = 'ULS Amadora/Sintra — Hospital'
on conflict (aces_id, nome) do update set tipo = 'Hospital', ativo = true;

-- Pediatras já registados sem hospital ficam associados ao HFF
update public.perfis p set unidade_id = u.id
from public.unidades u
where u.nome = 'Hospital Prof. Doutor Fernando Fonseca' and p.papel = 'pediatra' and p.unidade_id is null;

select tipo, count(*) from public.unidades where ativo group by tipo order by tipo;
