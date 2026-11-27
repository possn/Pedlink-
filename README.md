# PedLink

PWA para discussão de casos pediátricos **anonimizados** entre médicos de Medicina Geral e Familiar (MGF) dos Cuidados de Saúde Primários e pediatras hospitalares, antes de uma eventual referenciação à consulta hospitalar.

- **Frontend:** HTML/CSS/JS sem build, publicado no GitHub Pages, instalável como app (PWA).
- **Backend:** Supabase (Postgres + Auth + Storage), região UE (Frankfurt). Todo o controlo de acesso é feito por Row Level Security.

## Perfis
| Perfil | Pode |
|---|---|
| **MGF** | Criar casos; ver os seus casos e os da sua unidade; conversar no caso; editar enquanto o caso está "Novo". |
| **Pediatra** | Ver todos os casos, filtrar por ACES/unidade, atribuir, mudar estado, notas internas (ex.: discussão com subespecialidade), responder, agendar reunião, registar desfecho. Precisa de aprovação. |
| **Admin** | Aprovar pediatras, gerir utilizadores, ACES e unidades, emails autorizados, texto do projeto e PDFs de critérios; estatísticas. |

Estrutura organizacional: **ACES/ULS → unidade funcional** (USF, UCSP, UCC…, com centro de saúde/polo). Cada MGF pertence a uma unidade e cada caso fica associado à unidade de origem.

Estados do caso: Novo → Em análise → Discussão com subespecialidade → Respondido na app / Reunião agendada → Fechado (com desfecho: referenciar, não referenciar, seguimento em MGF, urgência).

## Proteção de dados
- Sem nome, nº de utente, NIF, nº de processo, data de nascimento completa, morada ou contactos: só idade e sexo.
- A base de dados **rejeita** texto com números de 9 dígitos (utente SNS/NIF/telefone), números ≥ 8 dígitos, nº de CC, emails e "nº utente/processo: …". A app avisa ainda sobre datas completas, moradas e possíveis nomes.
- Imagens (qualquer fotografia, incluindo HEIC do iPhone) são redesenhadas num canvas antes do envio: EXIF/GPS e outros metadados são removidos; nome do ficheiro é aleatório.
- Buckets de Storage privados; acesso por URLs assinadas de curta duração.
- Registo só com email `@…min-saude.pt` (exceções geridas pelo admin).
- O service worker não guarda dados clínicos em cache.

## Instalação
1. Criar projeto Supabase (região *Central EU – Frankfurt*).
2. SQL Editor → executar [`supabase/schema.sql`](supabase/schema.sql) e [`supabase/02-permissoes.sql`](supabase/02-permissoes.sql); depois aplicar **todas** as migrações de `supabase/migrations/` por ordem (a GitHub Action *migracoes* fá-lo com o segredo `SUPABASE_DB_URL`). Nunca voltar a correr `schema.sql` num projeto em produção.
3. Authentication → URL Configuration: **Site URL** = `https://possn.github.io/Pedlink-/` e adicionar o mesmo em *Redirect URLs*.
4. Preencher `js/config.js` com o *Project URL* e a *publishable/anon key* (nunca a service_role).
5. Registar-se na app e, no SQL Editor, tornar-se admin:
   ```sql
   update public.perfis set papel='pediatra', is_admin=true, aprovado=true where email='o.seu.email@...';
   ```
6. As unidades da ULS Amadora/Sintra são carregadas pela migração `20261126_01`; ajustar em Administração → ACES e unidades.
7. Notificações push: definir o segredo `SUPABASE_ACCESS_TOKEN` no GitHub; a Action *funcoes* publica a Edge Function `push` e gera as chaves VAPID.

### Email
O SMTP incluído no Supabase envia poucos emails por hora (só para testes). Para produção, configurar SMTP próprio em Authentication → Emails → SMTP Settings (ex.: conta institucional ou Resend/Brevo).

## Migração futura para outra conta
Criar o novo projeto, correr `schema.sql` + migrações, exportar/importar os dados (`pg_dump --data-only` das tabelas `public.*` e os ficheiros dos buckets) e trocar `js/config.js`. O repositório pode ser transferido em GitHub → Settings → Transfer.
