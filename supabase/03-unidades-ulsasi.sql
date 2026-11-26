-- PedLink — Unidades de cuidados de saúde primários da ULS Amadora/Sintra (USF e UCSP).
-- Fonte: ULS Amadora/Sintra, Relatório Anual sobre o Acesso a Cuidados de Saúde 2024, secção 1.1.2
-- https://hff.min-saude.pt/wp-content/uploads/Relatorio-Acesso-ULSASI-2024.pdf
-- 27 USF + 10 UCSP. Agrupadas por município (antigos ACES Amadora e Sintra).
-- Seguro para correr mais de uma vez.

-- 1) Remover as unidades de exemplo (só se ninguém as estiver a usar)
delete from public.unidades u
 where u.nome like '%Exemplo%'
   and not exists (select 1 from public.perfis p where p.unidade_id = u.id)
   and not exists (select 1 from public.casos c where c.unidade_id = u.id);
update public.unidades set ativo = false where nome like '%Exemplo%';
delete from public.aces a
 where a.nome like '%exemplo%' and not exists (select 1 from public.unidades u where u.aces_id = a.id);

-- 2) Agrupamentos
insert into public.aces (nome, uls) values
  ('ULS Amadora/Sintra — Amadora', 'ULS Amadora/Sintra'),
  ('ULS Amadora/Sintra — Sintra',  'ULS Amadora/Sintra')
on conflict (nome) do nothing;

-- 3) Unidades
insert into public.unidades (aces_id, nome, tipo, centro_saude)
select a.id, v.nome, v.tipo, v.local
from (values
  ('ULS Amadora/Sintra — Amadora', 'Arco-Íris', 'USF', 'Amadora'),
  ('ULS Amadora/Sintra — Amadora', 'Ribeiro Sanches', 'USF', 'Amadora'),
  ('ULS Amadora/Sintra — Amadora', 'Águas Livres', 'USF', 'Amadora'),
  ('ULS Amadora/Sintra — Amadora', 'Alma Mater', 'USF', 'Reboleira'),
  ('ULS Amadora/Sintra — Amadora', 'Conde da Lousã', 'USF', 'Damaia'),
  ('ULS Amadora/Sintra — Amadora', 'Amato Lusitano', 'USF', 'Venda Nova'),
  ('ULS Amadora/Sintra — Amadora', 'Venda Nova', 'USF', 'Venda Nova'),
  ('ULS Amadora/Sintra — Amadora', 'Amadora', 'UCSP', 'Amadora'),
  ('ULS Amadora/Sintra — Amadora', 'António Arnaut', 'UCSP', 'Amadora'),
  ('ULS Amadora/Sintra — Amadora', 'Brandoa', 'UCSP', 'Brandoa'),
  ('ULS Amadora/Sintra — Sintra', 'Mactamã', 'USF', 'Massamá'),
  ('ULS Amadora/Sintra — Sintra', 'Mãe D''Água', 'USF', 'Massamá'),
  ('ULS Amadora/Sintra — Sintra', 'Monte da Luz', 'USF', 'Monte Abraão'),
  ('ULS Amadora/Sintra — Sintra', 'D. Maria I', 'USF', 'Queluz'),
  ('ULS Amadora/Sintra — Sintra', 'Queluz', 'USF', 'Queluz'),
  ('ULS Amadora/Sintra — Sintra', 'Belas', 'USF', 'Belas'),
  ('ULS Amadora/Sintra — Sintra', 'Flôr de Lótus', 'USF', 'Cacém'),
  ('ULS Amadora/Sintra — Sintra', 'São Marcos', 'USF', 'Agualva-Cacém'),
  ('ULS Amadora/Sintra — Sintra', 'Mira Sintra', 'USF', 'Agualva-Cacém'),
  ('ULS Amadora/Sintra — Sintra', 'Alphamouro', 'USF', 'Rio de Mouro'),
  ('ULS Amadora/Sintra — Sintra', 'Albasaúde', 'USF', 'Rio de Mouro'),
  ('ULS Amadora/Sintra — Sintra', 'Rio de Mouro', 'USF', 'Rio de Mouro'),
  ('ULS Amadora/Sintra — Sintra', 'Tapada', 'USF', 'Mem Martins'),
  ('ULS Amadora/Sintra — Sintra', 'Natividade', 'USF', 'Algueirão-Mem Martins'),
  ('ULS Amadora/Sintra — Sintra', 'D. Fernando II', 'USF', 'Algueirão-Mem Martins'),
  ('ULS Amadora/Sintra — Sintra', 'Monte da Lua', 'USF', 'Várzea de Sintra'),
  ('ULS Amadora/Sintra — Sintra', 'Cynthia', 'USF', 'Sintra'),
  ('ULS Amadora/Sintra — Sintra', 'Colares', 'USF', 'Colares'),
  ('ULS Amadora/Sintra — Sintra', 'Terra', 'USF', 'Terrugem'),
  ('ULS Amadora/Sintra — Sintra', 'Lapiás', 'USF', 'Pêro Pinheiro'),
  ('ULS Amadora/Sintra — Sintra', 'Casal de Cambra', 'UCSP', 'Casal de Cambra'),
  ('ULS Amadora/Sintra — Sintra', 'Monte Abraão', 'UCSP', 'Monte Abraão'),
  ('ULS Amadora/Sintra — Sintra', 'Agualva', 'UCSP', 'Agualva-Cacém'),
  ('ULS Amadora/Sintra — Sintra', 'Olival', 'UCSP', 'Cacém'),
  ('ULS Amadora/Sintra — Sintra', 'Algueirão', 'UCSP', 'Algueirão-Mem Martins'),
  ('ULS Amadora/Sintra — Sintra', 'São João das Lampas', 'UCSP', 'São João das Lampas'),
  ('ULS Amadora/Sintra — Sintra', 'Almargem do Bispo', 'UCSP', 'Almargem do Bispo')
) as v(aces, nome, tipo, local)
join public.aces a on a.nome = v.aces
on conflict (aces_id, nome) do update set tipo = excluded.tipo, centro_saude = excluded.centro_saude, ativo = true;

select a.nome as agrupamento, u.tipo, count(*) from public.unidades u join public.aces a on a.id = u.aces_id
where u.ativo group by 1, 2 order by 1, 2;
