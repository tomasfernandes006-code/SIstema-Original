# Segurança e privacidade — diagnóstico e plano

> **Este documento só analisa e propõe.** Nada foi alterado no código nem no
> banco: nenhum SQL daqui foi executado, nenhum arquivo de `js/` foi modificado e
> nenhuma configuração do Supabase foi tocada.
>
> Retrato do repositório na branch `preparar-auditoria` (HEAD `dbd5db3`).
>
> **Nenhum segredo é reproduzido aqui** (por decisão, não por esquecimento): não
> há senha, chave publicável, chave `service_role` nem chave privada VAPID neste
> arquivo. Os valores são referenciados pelo **arquivo e linha** onde vivem, e
> todos os SQLs usam placeholders como `<SENHA_NOVA>`.

## Índice

1. [Resumo do diagnóstico](#1-resumo-do-diagnóstico)
2. [Login da secretaria com senha em texto no código](#2-login-da-secretaria-com-senha-em-texto-no-código)
3. [`alunos.json` e `professores.json` públicos (LGPD)](#3-alunosjson-e-professoresjson-públicos-lgpd)
4. [Bucket `atestados` público](#4-bucket-atestados-público)
5. [RLS de `ocorrencias`, `atrasos` e `push_subscriptions`](#5-rls-de-ocorrencias-atrasos-e-push_subscriptions)
6. [Como confirmar o estado atual](#6-como-confirmar-o-estado-atual)
7. [Ordem sugerida de execução](#7-ordem-sugerida-de-execução)
8. [Limitações deste documento](#8-limitações-deste-documento)

## 1. Resumo do diagnóstico

| # | Achado | Onde o código mostra | Risco | Depende de |
| --- | --- | --- | --- | --- |
| **A1** | Usuário e senha da secretaria em **texto claro** no JavaScript do site, conferidos no navegador | `js/dados.js:27-29` (lista `USUARIOS`), `js/dados.js:729-733` (`autenticarSecretaria`), `js/app.js:422-432` | **Alto** — o arquivo é público: qualquer visitante baixa `/js/dados.js` e lê a credencial | RPC no banco (§2) |
| **A2** | `alunos.json` (6 registros: RA, nome, sala, turno) e `professores.json` (2 registros: RA, nome) são **arquivos públicos** do site | raiz do repositório + `fetch` em `js/dados.js` | **Alto (LGPD)** — dados de menores sem controle de acesso | listas no banco + autenticação (§3) |
| **A3** | Bucket `atestados` **público**, aberto sem login | `js/dados.js:519-521` (`getPublicUrl`), upload em `js/dados.js:1071-1073` | **Alto (LGPD)** — atestado é dado de saúde (sensível) | bucket privado + URL assinada (§4) |
| **A4** | RLS das 3 tabelas: **estado desconhecido** (o repositório não tem `migrations/` nem dump); o que o código exige está mapeado em §5 | `js/dados.js` (select/insert/update), `js/push.js` (upsert) | **Alto** — com policy ampla (ou RLS desligada) a chave publicável escreve/apaga qualquer linha | painel do Supabase + RPCs (§5) |
| **A5** | **Não existe autenticação real**: nem Supabase Auth, nem token próprio — a única credencial do site é a chave publicável | `js/supabase-config.js`, `js/sessao.js`, guards em `js/app.js:42/50/58` | **Alto / estrutural** — a RLS não consegue diferenciar a secretaria de um visitante; o `guard` do painel é escolha de tela, não barreira | Supabase Auth (destrava A2/A3/A4) |
| **A6** | Sem auditoria: o painel não registra quem abriu ou mudou o quê | não existe tabela/coluna para isso | Médio | tabela de log (opcional) |

### O que já está certo (base para a correção)

- **Senha de aluno/professor nunca sai do banco**: quem confere é a RPC
  `verificar_senha`, e a troca é a RPC `trocar_senha` — o hash não passa pelo
  navegador (`js/dados.js:674-698`, `750-774`, `817-836`, `874-893`).
- **O `id` das linhas é gerado pelo banco** (o site nunca envia `id`), o que
  dificulta forjar registro com id alheio.
- **O atestado sobe com nome UUID** (`gerarNomeDoAtestado`): o caminho do arquivo
  não carrega RA nem nome do aluno (`js/dados.js:1070`).
- **A chave `service_role` não está no site**: é usada só dentro da Edge Function
  `enviar-push`, injetada pelo ambiente; a **chave privada VAPID também não está
  no repositório** (`supabase/functions/enviar-push/index.ts:21-33`).
- A Edge Function **recusa** chamadas sem o header `x-webhook-secret` (401).
- `supabase/.temp/` (cache do CLI, que guarda o vínculo do projeto e a URL de
  conexão) está no `.gitignore`, junto com `node_modules/`, `.firebase/` e
  `servidor/banco.db`.

## 2. Login da secretaria com senha em texto no código

### O que o código mostra hoje

- `js/dados.js:27-29` — a lista `USUARIOS` guarda a conta da secretaria com a
  **senha em texto claro** (o valor não é reproduzido neste documento).
- `js/dados.js:729-733` — `autenticarSecretaria(usuario, senha)` faz
  `USUARIOS.find(...)` comparando `u.senha === senha` **no próprio navegador**:
  sem rede, sem RPC, sem hash.
- `js/app.js:422-432` — a tela `#/secretaria-login` chama essa função; quando ela
  devolve `null`, a tela mostra "usuário ou senha incorretos".
- `js/sessao.js` — no sucesso, grava `{ id, nome, tipo: "SECRETARIA" }` em
  `sessionStorage` (chave `livro-ocorrencias:sessao`), e `js/app.js:58` libera o
  painel quando `Sessao.obter()?.tipo === "SECRETARIA"`.

### Por que é risco

1. **É público por construção.** O sistema é um site estático: `js/dados.js` é
   baixado por qualquer visitante (basta abrir a URL do arquivo). Não existe
   ofuscação que resolva — a credencial viaja no payload da página.
2. **Conferir no cliente não protege nada.** Quem quiser abrir o painel não
   precisa da senha: basta gravar `{"tipo":"SECRETARIA"}` na `sessionStorage`
   pelo Console do navegador e abrir `#/painel` — o `guard` (`js/app.js:58`) olha
   apenas esse objeto. O `guard` é conveniência de navegação, **não** barreira.
3. **A barreira real hoje é a RLS** (§5). O que impede ler/alterar dados é a
   política das tabelas diante da chave publicável. Corrigir o item 2 fecha a
   exposição da credencial, mas **não** fecha o acesso ao painel: isso é o §5.
4. **A senha atual já está exposta** (publicada no repositório e servida no site).
   Remover do código sem trocar a senha não resolve.
5. **Senha em texto claro é reutilizável**: se a secretaria usar a mesma senha em
   outro sistema, o vazamento se estende para lá.

### Plano de correção

**Etapa 1 — contas no banco**, espelhando o que já existe para aluno/professor:
tabela `secretaria_usuarios` com `senha_hash` (bcrypt via `pgcrypto`), RLS ligada
e **nenhuma policy** — a tabela não é legível pela chave publicável (nem para
`select`); só as funções `security definer` a leem, e ainda com `revoke all` para
`anon`/`authenticated` como reforço.

**Etapa 2 — RPC `verificar_senha_secretaria`**, no mesmo desenho da
`verificar_senha`: recebe usuário e senha, devolve `true`/`false`, roda como
`security definer` e é a única porta liberada para `anon`.

**Etapa 3 — cadastrar a conta e trocar a senha** com uma função administrativa
que **não** é liberada para `anon` (senão qualquer visitante redefiniria a
senha). A senha nova deve ser longa, aleatória, guardada em gerenciador de senhas
e digitada apenas no SQL Editor — **nunca** no repositório.

**Etapa 4 — ajustar o site** (poucas linhas, depois do §5):
`autenticarSecretaria` passa a ser `async` e a chamar
`supabase.rpc("verificar_senha_secretaria", { p_usuario, p_senha })`, exatamente
como `autenticarProfessor` já faz (`js/dados.js:683-698`). No fim,
`js/dados.js` deixa de conter qualquer credencial.

**Etapa 5 — opcional**: tela de troca de senha da secretaria (hoje não existe)
com `trocar_senha_secretaria`, e registro de auditoria (A6).

### SQL proposto (aplicar no SQL Editor do Supabase — nada disso foi executado)

```sql
-- =====================================================================
-- Item 2: conta da secretaria conferida no BANCO (nenhuma senha no site)
-- =====================================================================

-- bcrypt vem do pgcrypto (no Supabase ele fica no schema "extensions")
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.secretaria_usuarios (
  id            uuid primary key default gen_random_uuid(),
  usuario       text        not null unique,
  senha_hash    text        not null,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.secretaria_usuarios is
  'Contas da secretaria: guarda apenas o hash bcrypt; nenhuma chave publica le esta tabela.';

-- RLS ligada e SEM policy: acesso direto negado para anon/authenticated.
alter table public.secretaria_usuarios enable row level security;
revoke all on table public.secretaria_usuarios from anon, authenticated;

-- ---------------------------------------------------------------------
-- O que o site vai chamar (mesmo formato da verificar_senha atual)
-- ---------------------------------------------------------------------
create or replace function public.verificar_senha_secretaria(p_usuario text, p_senha text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.secretaria_usuarios s
     where s.usuario = lower(btrim(coalesce(p_usuario, '')))
       and s.ativo
       and s.senha_hash = extensions.crypt(coalesce(p_senha, ''), s.senha_hash)
  );
$$;

revoke all on function public.verificar_senha_secretaria(text, text) from public;
grant execute on function public.verificar_senha_secretaria(text, text) to anon, authenticated;
```

```sql
-- ---------------------------------------------------------------------
-- Administracao: rodar no SQL Editor e NAO liberar para anon
-- ---------------------------------------------------------------------
create or replace function public.definir_senha_secretaria(p_usuario text, p_senha text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.secretaria_usuarios (usuario, senha_hash)
  values (lower(btrim(p_usuario)), extensions.crypt(p_senha, extensions.gen_salt('bf', 10)))
  on conflict (usuario) do update
     set senha_hash    = excluded.senha_hash,
         atualizado_em = now(),
         ativo         = true;
$$;

-- Sem esta revogacao, qualquer visitante poderia trocar a senha da secretaria.
revoke all on function public.definir_senha_secretaria(text, text) from public, anon, authenticated;

-- Uso (a senha entra só aqui e não fica gravada em nenhum arquivo):
--   select public.definir_senha_secretaria('<USUARIO>', '<SENHA_NOVA>');

-- ---------------------------------------------------------------------
-- Opcional: troca de senha pela propria secretaria (espelha trocar_senha)
-- ---------------------------------------------------------------------
create or replace function public.trocar_senha_secretaria(
  p_usuario text, p_senha_atual text, p_nova_senha text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare trocou boolean;
begin
  update public.secretaria_usuarios
     set senha_hash    = extensions.crypt(p_nova_senha, extensions.gen_salt('bf', 10)),
         atualizado_em = now()
   where usuario   = lower(btrim(coalesce(p_usuario, '')))
     and ativo
     and senha_hash = extensions.crypt(coalesce(p_senha_atual, ''), senha_hash)
  returning true into trocou;
  return coalesce(trocou, false);
end;
$$;

revoke all on function public.trocar_senha_secretaria(text, text, text) from public;
grant execute on function public.trocar_senha_secretaria(text, text, text) to anon, authenticated;
```

Observações sobre esse SQL:

- É o **mesmo padrão** que já roda para aluno/professor (hash e comparação dentro
  do banco); a novidade é a tabela e a RPC da secretaria.
- `extensions.crypt` / `extensions.gen_salt` estão qualificados porque o
  `search_path` da função é fixado em `public, extensions`; sem isso a função não
  acharia o `pgcrypto`.
- **Não há limite de tentativas** de senha: o Postgres não limita por padrão. Se
  quiser, dá para registrar tentativas em uma tabela e bloquear após N erros
  (fora do escopo desta proposta).
- **Antes de aplicar**: trocar a senha (a atual já está exposta) e verificar se o
  mesmo par usuário/senha não é usado em outro sistema.
- Depois de aplicar, o site só fica "pronto" quando `js/dados.js` passar a chamar
  a RPC e a lista `USUARIOS` perder o campo de senha (etapa 4).

## 3. `alunos.json` e `professores.json` públicos (LGPD)

### O que o código mostra hoje

- `alunos.json`, na raiz do projeto: **6 registros** com os campos `RA`, `nome`,
  `sala` e `turno`.
- `professores.json`, na raiz do projeto: **2 registros** com `RA` e `nome`.
- Os dois arquivos são lidos em tempo de execução pelo `js/dados.js`
  (`carregarAlunosDoArquivo`, linha 192; `carregarProfessoresDoArquivo`, linha
  354 — com `fetch` e, se falhar, `XMLHttpRequest`) e alimentam as listas usadas
  pelas telas: `Dados.listarTurnos()` (925), `Dados.listarSalas(turno)` (932),
  `Dados.listarAlunosPorSala(turno, sala)` (938) e `Dados.buscarAlunoPorRa(ra)`
  (946).
- Como são arquivos da raiz, **são servidos como qualquer página do site**: quem
  abrir `https://<site>/alunos.json` recebe o JSON completo, sem login, sem
  chave, sem nada. O mesmo vale para `professores.json`.
- Eles não são apenas "lista de nomes": são a **única fonte de verdade** de
  nome/sala/turno. Sem eles, o seletor de turno → sala → aluno, a checagem de RA
  no login (`autenticarAluno`/`autenticarProfessor`) e o nome mostrado nos cards
  do painel deixam de funcionar.

### Por que é risco (LGPD)

- `nome + RA + sala + turno` identificam uma pessoa — dado pessoal (art. 5º, I).
  Sendo alunos, são dados de criança/adolescente, que a LGPD trata com cuidado
  extra (art. 14: melhor interesse e consentimento do responsável quando
  aplicável).
- O que mais existe no sistema agrava o quadro: `ocorrencias` guarda
  `aluno_nome`, `aluno_ra`, `turma`, `detalhes` (texto livre, que pode conter
  informação de saúde, família, religião etc.) e `tipo` podendo ser `SAUDE`;
  `atrasos` guarda `motivo`, `justificativa_tipo`, `responsavel_nome` (nome de um
  terceiro, que nem é aluno da escola) e o caminho do atestado, que é **dado de
  saúde** (art. 5º, II — ver §4).
- Publicar as listas é tratamento **sem controle de acesso**: qualquer visitante
  (e qualquer robô) copia tudo. Não há, no repositório, documento de finalidade,
  base legal, prazo de retenção nem registro de operações.
- Indexadores e arquivos históricos (cache de busca, Wayback Machine, forks)
  podem manter cópia depois que o arquivo sair do ar.
- **Ponto honesto de engenharia:** `robots.txt` e `<meta name="robots"
  content="noindex">` reduzem a indexação, mas **não** impedem o acesso; mover o
  arquivo para o banco resolve a exposição do *arquivo*, mas não a da *consulta*,
  se a consulta continuar aberta a quem tem a chave publicável (§5).
- Este documento **não é parecer jurídico**: a validação de bases legais e textos
  deve passar pela direção da escola / encarregado de dados (DPO).

### Plano de correção

**Curto prazo — organização e minimização (não muda código):**

1. Escrever a finalidade, a base legal, o prazo de retenção e o contato do
   encarregado, e publicar isso como aviso de privacidade nas telas de entrada
   (`#/` e logins).
2. Para menores, registrar a ciência/consentimento do responsável (fora do
   sistema, se não virar requisito funcional).
3. Não acrescentar nenhum campo além do necessário: e-mail, telefone, CPF, foto
   e data de nascimento **não** são usados hoje e não devem entrar.
4. `robots.txt` na raiz + `<meta name="robots" content="noindex">` no
   `index.html` — paliativo contra indexação, **não** é controle de acesso.
5. Orientar quem escreve `detalhes`/`motivo` a não registrar dado de saúde ou de
   família além do necessário (o texto livre é o maior risco de "dado a mais").

**Médio prazo — tirar as listas do repositório público:**

6. Criar as tabelas `alunos` e `professores` **no Supabase** (SQL abaixo), com
   RLS ligada e **nenhuma policy**: a chave publicável não lê nenhuma das duas.
7. Atender as telas por RPCs mínimas `security definer`, no lugar do `fetch`:
   - `listar_turnos()` e `listar_salas_do_turno(p_turno)` → só turnos e salas;
   - `listar_alunos_da_sala(p_turno, p_sala)` → **id opaco + nome** (sem RA);
   - `registrar_ocorrencia(p_aluno_id, ...)` → o banco resolve nome/RA/turma do
     aluno e grava; a tela deixa de receber a lista de RAs (hoje ela recebe, é
     assim que preenche `aluno_nome` e `aluno_ra`);
   - `registrar_atraso(p_aluno_id, ...)` no mesmo desenho;
   - o login continua mandando o RA digitado direto para `verificar_senha` —
     **não** existe RPC que "liste RAs".
8. Trocar em `js/dados.js` as quatro funções de lista (linhas 925, 932, 938, 946)
   e apagar `alunos.json`/`professores.json` da raiz. Atenção: `aluno_id` e
   `professor_id` recebem hoje `sessao.id` (`js/app.js:646` e `792`), que vem dos
   JSONs — com o banco, esses ids passam a ser o `id`/`ra` da tabela. É migração
   de dados, não só de código.
9. Levar o mesmo aviso de privacidade para as telas de professor e de aluno.

**Limite honesto desse desenho:** sem autenticação, essas RPCs continuam abertas
a quem tem a chave publicável, e RA curto (`2001`, `2002`...) é trivial de
enumerar. Elas reduzem muito o volume exposto (não dá para "baixar a lista
inteira" de uma vez), mas **não** fecham o acesso — o fechamento real é o §5.

**Longo prazo — retenção e direitos:**

10. Retenção: hoje o registro fica no banco **para sempre**; o sistema apenas
    deixa de ler o que é de semanas anteriores (`limiteDeRetencaoISO`,
    `js/dados.js:468` — segunda-feira 00:00 desta semana). Definir um prazo
    (ex.: 90 dias) e apagar/anonimizar automaticamente; para histórico, guardar
    **contagem agregada** por turma/período em vez da linha com nome.
11. Criar um canal para o titular pedir acesso/correção/exclusão (art. 18) e um
    registro simples de quem pediu o quê.
12. Histórico do Git: os JSONs já publicados **continuam no histórico do
    repositório** (e em forks/caches). Se o repositório é público, avaliar
    limpeza de histórico — sabendo que reescrever histórico não remove cópias
    externas.

```sql
-- =====================================================================
-- Item 3: listas de alunos e professores no banco, sem arquivo publico
-- =====================================================================
create table if not exists public.alunos (
  id        uuid primary key default gen_random_uuid(),
  ra        text        not null unique,
  nome      text        not null,
  sala      text        not null,
  turno     text        not null,
  ativo     boolean     not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.professores (
  id        uuid primary key default gen_random_uuid(),
  ra        text        not null unique,
  nome      text        not null,
  ativo     boolean     not null default true,
  criado_em timestamptz not null default now()
);

comment on table public.alunos is
  'Lista de alunos. RLS ligada e sem policy: so as RPCs deste bloco leem a tabela.';
comment on table public.professores is
  'Lista de professores. RLS ligada e sem policy: so as RPCs deste bloco leem a tabela.';

alter table public.alunos      enable row level security;
alter table public.professores enable row level security;
revoke all on table public.alunos, public.professores from anon, authenticated;

-- ---------------------------------------------------------------------
-- O que as telas passam a chamar (no lugar do fetch nos .json)
-- ---------------------------------------------------------------------
create or replace function public.listar_turnos()
returns table (turno text)
language sql security definer set search_path = public as $$
  select distinct a.turno from public.alunos a where a.ativo order by a.turno;
$$;
grant execute on function public.listar_turnos() to anon;

create or replace function public.listar_salas_do_turno(p_turno text)
returns table (sala text)
language sql security definer set search_path = public as $$
  select distinct a.sala from public.alunos a
   where a.ativo and a.turno = p_turno
   order by a.sala;
$$;
grant execute on function public.listar_salas_do_turno(text) to anon;

-- devolve id opaco + nome; o RA nao sai daqui
create or replace function public.listar_alunos_da_sala(p_turno text, p_sala text)
returns table (id uuid, nome text)
language sql security definer set search_path = public as $$
  select a.id, a.nome from public.alunos a
   where a.ativo and a.turno = p_turno and a.sala = p_sala
   order by a.nome;
$$;
grant execute on function public.listar_alunos_da_sala(text, text) to anon;

-- o login do professor precisa do NOME a partir do RA (nada de senha aqui)
create or replace function public.buscar_professor_por_ra(p_ra text)
returns table (nome text)
language sql security definer set search_path = public as $$
  select p.nome from public.professores p where p.ativo and p.ra = p_ra;
$$;
grant execute on function public.buscar_professor_por_ra(text) to anon;

-- ---------------------------------------------------------------------
-- Gravacao: o banco resolve nome/RA/turma do aluno (a tela manda so o id)
-- ---------------------------------------------------------------------
create or replace function public.registrar_ocorrencia(
  p_aluno_id       uuid,
  p_tipo           text,
  p_gravidade      text,
  p_detalhes       text,
  p_professor_id   text,
  p_professor_nome text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_aluno public.alunos%rowtype;
  v_novo  uuid;
begin
  if p_tipo not in ('INDISCIPLINA','ATRASO','MATERIAL','SAUDE','OUTRO') then
    raise exception 'tipo invalido';
  end if;
  if p_gravidade not in ('LEVE','MODERADA','GRAVE') then
    raise exception 'gravidade invalida';
  end if;
  if char_length(coalesce(p_detalhes, '')) > 2000 then
    raise exception 'detalhes muito longos';
  end if;

  select * into v_aluno from public.alunos where id = p_aluno_id and ativo;
  if not found then
    raise exception 'aluno nao encontrado';
  end if;

  insert into public.ocorrencias (
    professor_id, professor_nome, aluno_nome, aluno_ra, turma,
    tipo, gravidade, detalhes, status, criada_em, atualizada_em
  ) values (
    p_professor_id, p_professor_nome, v_aluno.nome, v_aluno.ra, v_aluno.sala,
    p_tipo, p_gravidade, coalesce(p_detalhes, ''), 'NOVA', now(), now()
  )
  returning id into v_novo;

  return v_novo;
end;
$$;
grant execute on function public.registrar_ocorrencia(uuid,text,text,text,text,text) to anon;
```

Notas sobre esse SQL:

- `alunos` e `professores` ficam **sem nenhuma policy**: nem `select` para `anon`.
  Todo o acesso passa pelas RPCs acima.
- `registrar_ocorrencia` **depende** do §5 (a tabela `ocorrencias` deixa de aceitar
  `insert` direto); é a peça que liga as duas correções.
- `p_professor_id` / `p_professor_nome` continuam vindo da sessão do professor
  (hoje `sessao.id`, `js/app.js:646`). Com Supabase Auth (§5) o banco poderia
  resolver isso sozinho, sem confiar no que a tela manda.
- Carga inicial: uma vez, no SQL Editor ou no Table Editor, por exemplo
  `insert into public.alunos (ra, nome, sala, turno) values ('<RA>','<NOME>','<SALA>','<TURNO>');`
  — **nunca** a partir do site.

## 4. Bucket `atestados` público

### O que o código mostra hoje

- O bucket se chama `atestados` e é tratado como **público** — o comentário do
  próprio código diz isso (`js/dados.js:515-517`).
- O painel monta o link do atestado com
  `supabase.storage.from("atestados").getPublicUrl(linha.atestado_path)`
  (`js/dados.js:519-521`) e abre a foto/PDF **sem login**.
- Upload: `js/dados.js:1041-1082` (`enviarAtestado`) — aceita imagem ou PDF,
  recusa acima de 10 MB, redimensiona imagem no canvas (máx. 1600 px, JPEG 0.85) e
  sobe com `upload(caminho, conteudo, { contentType })` (linhas 1071-1073).
- O nome do arquivo é `<uuid>.<extensão>` (`gerarNomeDoAtestado`, linha 1070):
  bom sinal, porque o caminho **não** carrega RA nem nome.
- O que vai para `atrasos.atestado_path` é só o caminho; o nome original fica em
  `atestado_nome_arquivo`, para exibir na tela.
- Quem envia para o bucket é o **navegador do aluno**, usando a chave publicável.

### Por que é risco

- Atestado médico é **dado pessoal sensível de saúde** (art. 5º, II, LGPD). Link
  aberto significa que quem tiver a URL vê o documento, normalmente com nome,
  datas, CRM/assinatura e diagnóstico.
- A URL **não é secreta**: entra no histórico do navegador, em logs de proxy, em
  capturas de tela e em qualquer compartilhamento. O UUID no nome dificulta
  adivinhar, mas isso é obscuridade, não controle de acesso.
- **Sem expiração e sem exclusão**: o arquivo fica no bucket indefinidamente, mesmo
  depois de a linha em `atrasos` sair do filtro da semana
  (`listarEntradasAtrasadas`, `js/dados.js:1120-1126`).
- Se existir policy de `select` em `storage.objects` para `anon` (é o que costuma
  vir junto de bucket público), a **API ainda deixa listar** os objetos do bucket,
  o que torna a coleção de atestados enumerável. Estado atual = a confirmar (§6).
- **Upload aberto**: qualquer visitante com a chave publicável pode subir arquivo
  no bucket, porque quem envia é o navegador (custo e abuso).

### Plano de correção

1. Marcar o bucket como **privado** e impor limites no próprio bucket
   (`file_size_limit`, `allowed_mime_types`), para não depender só da validação em
   JavaScript.
   **Atenção:** fazer isso antes de mudar o código **quebra** o link do atestado no
   painel (o `getPublicUrl` deixa de funcionar).
2. Trocar `getPublicUrl` por **URL assinada de curta duração**
   (`createSignedUrl(path, 300)`). Mas isso só protege se **quem assina estiver
   autenticado**: com a chave publicável e uma policy permissiva, um visitante
   também conseguiria pedir a assinatura. Ordem correta: **§5 primeiro (Auth da
   secretaria), bucket depois**.
3. Depois disso, servir o arquivo de um dos dois jeitos:
   - **A (recomendada, com Auth):** policy de `select` em `storage.objects` apenas
     para o papel `authenticated`; a secretaria logada gera a URL assinada e o link
     abre por poucos minutos.
   - **B (sem Auth):** bucket privado + uma Edge Function que valida um token
     próprio — mais trabalho e mais um segredo para administrar.
4. **Retenção:** apagar o arquivo (e limpar `atestado_path`) depois de N dias, com
   `pg_cron` chamando uma Edge Function ou um script agendado.
5. **Minimizar:** avaliar se o fluxo precisa mesmo guardar o documento; a
   alternativa é receber o atestado na secretaria, fora do sistema, e registrar
   apenas "atestado apresentado" (hoje, quando o aluno marca "tenho atestado", o
   arquivo é obrigatório no formulário).
6. **Metadados:** a imagem passa pelo canvas (o que já descarta EXIF), mas **PDF
   sobe intacto** e pode carregar dados do emissor — vale avisar o aluno ou
   reencodar depois.
7. **Auditoria:** registrar quando alguém abre o atestado (hoje nada é registrado).

```sql
-- =====================================================================
-- Item 4: bucket privado, com limites e leitura so para sessao autenticada
-- =====================================================================

-- 1) o bucket deixa de ser publico e ganha limites no SERVIDOR
--    (NAO rode isto antes de trocar o getPublicUrl por createSignedUrl)
update storage.buckets
   set public             = false,
       file_size_limit    = 10485760,   -- 10 MB, igual ao que o JS ja valida
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'atestados';

-- 2) escrita: continua vindo do navegador do aluno (que nao tem login),
--    limitada a nome no padrao <uuid>.<extensao> e aos formatos aceitos
drop policy if exists "aluno envia atestado" on storage.objects;
create policy "aluno envia atestado" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'atestados'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
  );

-- 3) leitura: apenas sessao autenticada (secretaria com Supabase Auth, ver §5)
drop policy if exists "secretaria le atestado" on storage.objects;
create policy "secretaria le atestado" on storage.objects
  for select to authenticated
  using (bucket_id = 'atestados');

-- 4) propositalmente SEM policy de update/delete para anon:
--    sem policy a operacao e negada (nao ha como "apagar" pela chave publica).
```

Notas sobre esse SQL:

- **Antes de aplicar**: confira (e remova) qualquer policy de `select` para `anon`
  nesse bucket — é ela que normalmente acompanha um bucket marcado como público.
  A consulta está no §6.
- O arquivo `storage.objects.name` é o caminho completo, e o site gera
  `<uuid>.<ext>` em minúsculas (`crypto.randomUUID`), por isso a expressão regular
  funciona como trava do formato.
- O passo 1 **não apaga** os arquivos existentes: eles simplesmente deixam de ser
  acessíveis pela URL pública. As URLs já compartilhadas, porém, circularam — o
  que reforça a decisão de tornar o bucket privado e, se possível, trocar as
  chaves de acesso do projeto em um vazamento confirmado.
- `file_size_limit` e `allowed_mime_types` são checados pelo Storage **antes** da
  policy, então valem como limite real (o JS também valida, mas o JS pode ser
  contornado por quem chama a API direto).

## 5. RLS de `ocorrencias`, `atrasos` e `push_subscriptions`

### O que o código exige hoje (mapeado no código, não no banco)

| Tabela | Operação pedida com a chave publicável | Onde | Observação |
| --- | --- | --- | --- |
| `ocorrencias` | `select *` com `criada_em >= <segunda 00:00>` e ordem decrescente | `js/dados.js:530-535` | o painel inteiro depende disso |
| `ocorrencias` | `insert` **com retorno** (`.select().single()`) | `js/dados.js:956-972` | exige `insert` **e** `select` (para devolver a linha) |
| `ocorrencias` | `update` de `status` + `atualizada_em` por `id` | `js/dados.js:996-999` | botões de status do painel |
| `atrasos` | `select *` (mesmo filtro) | `js/dados.js:560-563` | painel |
| `atrasos` | `insert` com retorno | `js/dados.js:1090-1107` | formulário do aluno |
| `atrasos` | `update` de `status` + `atualizada_em` | `js/dados.js:1131-1134` | botões do painel |
| `push_subscriptions` | `insert`/`update` do mesmo `endpoint` (`upsert`, `onConflict: "endpoint"`) | `js/push.js:60-69` | o site **não lê** essa tabela |
| `push_subscriptions` | `select` e `delete` | **só** na Edge Function, com `service_role` (`supabase/functions/enviar-push/index.ts:40`, `58-60`) | `service_role` ignora RLS: **não** precisa de policy |
| `storage.objects` (`atestados`) | `insert` (upload do aluno) | `js/dados.js:1071-1073` | ver §4 |
| `storage.objects` (`atestados`) | `select` (abrir o atestado) | via URL pública (`getPublicUrl`) | ver §4 |

Valores que o site realmente grava (conferidos no código, para usar nos `check`):
`status` = `NOVA` / `LIDA` / `EM_ANDAMENTO` / `RESOLVIDA` (`js/app.js:865-868`,
`1179-1180`); `tipo` = `INDISCIPLINA` / `ATRASO` / `MATERIAL` / `SAUDE` / `OUTRO`;
`gravidade` = `LEVE` / `MODERADA` / `GRAVE`; `justificativa_tipo` = `RESPONSAVEL`
/ `ATESTADO` (`js/app.js:718`, `797`, `1237-1241`).

**Nenhuma tela pede `delete`** em `ocorrencias`, `atrasos` ou
`push_subscriptions` — a exclusão de linhas só acontece na Edge Function
(inscrições de push mortas, com `service_role`).

### Diagnóstico

- **O estado atual não é visível pelo repositório**: não existe
  `supabase/migrations/` nem dump versionado do schema. Se as tabelas foram
  criadas pelo painel, as policies estão registradas apenas lá. O §6 mostra como
  confirmar (é o passo mais importante antes de aplicar qualquer coisa).
- Se o site funciona hoje, há dois cenários: (a) policies existem e são
  permissivas (`using (true)`), ou (b) o **RLS está desligado**. Nas configurações
  padrão do Supabase o papel `anon` recebe privilégios de tabela no schema
  `public` — quem barra a operação é a RLS. Logo, **RLS desligado significa
  leitura, escrita e exclusão liberadas** para quem tem a chave publicável.
- **A limitação estrutural (A5):** sem autenticação, a RLS não separa a secretaria
  de um visitante. Como o painel lê as tabelas com a chave publicável, qualquer
  policy de `select` que faça o painel funcionar também deixa qualquer visitante
  ler tudo (`aluno_nome`, `aluno_ra`, `detalhes`, `motivo`, responsável...). Ou
  seja, **hoje o login do painel é apenas visual**; o controle de acesso real é a
  policy — e, nesse desenho, ela só consegue ser "todos ou ninguém".
- Se existir policy de `update` com `using (true)`, qualquer visitante altera
  **qualquer coluna** de qualquer linha (não só `status`): dá para trocar
  `aluno_nome`, esvaziar `detalhes` etc. **RLS não limita coluna** — isso se
  resolve com RPC (abaixo) ou com trigger de proteção. Fingir que a policy de
  update é "só status" é um erro comum.
- `push_subscriptions`: o site precisa **gravar** (`upsert`) e **não precisa ler**.
  Com policy de `select` para `anon`, qualquer pessoa baixa os `endpoint`s dos
  aparelhos inscritos — o identificador do dispositivo e o dado necessário para
  enviar push (junto da chave privada VAPID). Não há motivo para essa leitura
  estar aberta.
- Não ter policy de `delete` já nega a exclusão, mas convém **revogar o
  privilégio** também: assim a proteção não depende de um único mecanismo.

### Bloco A — plano mínimo (fecha o pior **sem** mudar o site)

O que este bloco resolve: liga a RLS explicitamente, deixa as policies restritas
ao que o site usa, impede exclusão e impede `insert` de lixo (enums e tamanhos).
O que ele **não** resolve: qualquer visitante continua lendo tudo (é o A5).

```sql
-- =====================================================================
-- Item 5 / Bloco A: RLS minima, compativel com o site ATUAL
-- (rodar DEPOIS do dump do §6, para nao perder o que ja existe)
-- =====================================================================
alter table public.ocorrencias        enable row level security;
alter table public.atrasos            enable row level security;
alter table public.push_subscriptions enable row level security;

-- segunda barreira: o site nao precisa destes privilegios
revoke delete, truncate, references, trigger on public.ocorrencias        from anon, authenticated;
revoke delete, truncate, references, trigger on public.atrasos            from anon, authenticated;
revoke delete, truncate, references, trigger on public.push_subscriptions from anon, authenticated;

-- ------------------------------------------------------------- ocorrencias --
drop policy if exists "site le ocorrencias" on public.ocorrencias;
create policy "site le ocorrencias" on public.ocorrencias
  for select to anon using (true);

drop policy if exists "site cria ocorrencia" on public.ocorrencias;
create policy "site cria ocorrencia" on public.ocorrencias
  for insert to anon
  with check (
    tipo in ('INDISCIPLINA','ATRASO','MATERIAL','SAUDE','OUTRO')
    and gravidade in ('LEVE','MODERADA','GRAVE')
    and status in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA')
    and char_length(coalesce(detalhes,''))       <= 2000
    and char_length(coalesce(aluno_nome,''))     between 1 and 120
    and char_length(coalesce(professor_nome,'')) between 1 and 120
    and coalesce(aluno_ra,'') ~ '^[0-9]{1,10}$'
  );

drop policy if exists "site atualiza status ocorrencia" on public.ocorrencias;
create policy "site atualiza status ocorrencia" on public.ocorrencias
  for update to anon
  using (true)
  with check (status in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA'));

-- ----------------------------------------------------------------- atrasos --
drop policy if exists "site le atrasos" on public.atrasos;
create policy "site le atrasos" on public.atrasos
  for select to anon using (true);

drop policy if exists "site cria atraso" on public.atrasos;
create policy "site cria atraso" on public.atrasos
  for insert to anon
  with check (
    justificativa_tipo in ('RESPONSAVEL','ATESTADO')
    and status in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA')
    and char_length(coalesce(motivo,''))           <= 2000
    and char_length(coalesce(aluno_nome,''))       between 1 and 120
    and char_length(coalesce(responsavel_nome,'')) <= 120
    and char_length(coalesce(atestado_path,''))    <= 200
    and coalesce(aluno_ra,'') ~ '^[0-9]{1,10}$'
  );

drop policy if exists "site atualiza status atraso" on public.atrasos;
create policy "site atualiza status atraso" on public.atrasos
  for update to anon
  using (true)
  with check (status in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA'));

-- ------------------------------------------------------ push_subscriptions --
-- grava mas NAO le: sem policy de select, a chave publicavel nao baixa a lista
-- de endpoints dos aparelhos da secretaria
drop policy if exists "site inscreve push" on public.push_subscriptions;
create policy "site inscreve push" on public.push_subscriptions
  for insert to anon
  with check (char_length(endpoint) between 20 and 1000);

drop policy if exists "site atualiza push" on public.push_subscriptions;
create policy "site atualiza push" on public.push_subscriptions
  for update to anon
  using (true)
  with check (char_length(endpoint) between 20 and 1000);
```

Limites e armadilhas do Bloco A:

- **Não** tira a leitura de qualquer visitante e **não** impede que a policy de
  `update` altere colunas que não sejam `status` (RLS não limita coluna). Ele é um
  "piso de segurança" até o Bloco B entrar.
- `drop policy if exists` só remove policies com **exatamente** aqueles nomes: se
  as policies atuais tiverem outro nome, elas continuam valendo. Por isso o §6 é
  obrigatório — liste as policies antes e remova as antigas que ficarem soltas.
- A policy de `insert` **precisa** da policy de `select` para funcionar, porque o
  site usa `.select().single()` para receber a linha criada (`js/dados.js:971`,
  `1106`).

### Bloco B — plano recomendado (RPC + Supabase Auth)

Desenho: a chave publicável **deixa de falar com as tabelas** e passa a chamar
apenas RPCs `security definer`; a secretaria passa a ter sessão no **Supabase
Auth**, e é essa sessão que tem `select`/`update`. Com isso, "quem lê os dados"
deixa de ser "quem tem a chave".

```sql
-- =====================================================================
-- Item 5 / Bloco B: a chave publicavel so chama RPCs; a tabela e de quem
-- esta autenticado (secretaria com Supabase Auth)
-- =====================================================================

-- 1) corta o acesso direto da chave publicavel
revoke all on table public.ocorrencias, public.atrasos from anon;
revoke all on table public.push_subscriptions from anon;

-- 2) remove as policies antigas de anon (nomes conforme a lista do §6)
drop policy if exists "site le ocorrencias" on public.ocorrencias;
drop policy if exists "site cria ocorrencia" on public.ocorrencias;
drop policy if exists "site atualiza status ocorrencia" on public.ocorrencias;
drop policy if exists "site le atrasos" on public.atrasos;
drop policy if exists "site cria atraso" on public.atrasos;
drop policy if exists "site atualiza status atraso" on public.atrasos;

-- 3) leitura do painel: somente sessao autenticada
create policy "painel autenticado le ocorrencias" on public.ocorrencias
  for select to authenticated using (true);
create policy "painel autenticado le atrasos" on public.atrasos
  for select to authenticated using (true);

-- 4) troca de status por RPC: uma coluna, uma regra, sem update livre
create or replace function public.marcar_status_ocorrencia(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA') then
    raise exception 'status invalido';
  end if;
  update public.ocorrencias
     set status = p_status, atualizada_em = now()
   where id = p_id;
  if not found then
    raise exception 'ocorrencia nao encontrada';
  end if;
end;
$$;

create or replace function public.marcar_status_atraso(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('NOVA','LIDA','EM_ANDAMENTO','RESOLVIDA') then
    raise exception 'status invalido';
  end if;
  update public.atrasos
     set status = p_status, atualizada_em = now()
   where id = p_id;
  if not found then
    raise exception 'entrada atrasada nao encontrada';
  end if;
end;
$$;

-- enquanto o painel nao tiver login, deixe as duas tambem para anon
grant execute on function public.marcar_status_ocorrencia(uuid, text) to authenticated, anon;
grant execute on function public.marcar_status_atraso(uuid, text)     to authenticated, anon;

-- 5) escrita de quem nao tem login (professor/aluno) tambem por RPC
--    registrar_ocorrencia / registrar_atraso: ver o SQL do §3
--    (validam tipo, gravidade, tamanho e a existencia do aluno no banco)

-- 6) push: a inscricao e criada no painel (botao "Ativar notificacoes"),
--    entao depois do Auth ela pode exigir sessao
create policy "painel autenticado inscreve push" on public.push_subscriptions
  for insert to authenticated
  with check (char_length(endpoint) between 20 and 1000);
create policy "painel autenticado atualiza push" on public.push_subscriptions
  for update to authenticated
  using (true)
  with check (char_length(endpoint) between 20 and 1000);
```

Observações do Bloco B:

- As RPCs `security definer` rodam com os privilégios do dono da função, por isso
  continuam funcionando mesmo com as tabelas revogadas para `anon`. **Regra de
  ouro:** em toda função `security definer`, fixar `set search_path` (todas as
  propostas deste documento fazem isso) e liberar `execute` só a quem precisa.
- As RPCs de escrita (`registrar_ocorrencia`, `registrar_atraso`) continuam
  chamáveis por `anon` — é inevitável, porque quem registra é o navegador do
  professor/aluno, sem login. A diferença é que agora o banco **valida** (enums,
  tamanho, aluno existente) e a coluna `aluno_nome`/`aluno_ra` vem do banco, não
  do que a tela mandou.
- Mantive `grant execute ... to anon` nas RPCs de status por compatibilidade. Se o
  painel passar a exigir login (recomendado), troque para
  `revoke execute ... from anon` e deixe só `authenticated`: aí ninguém sem sessão
  muda status.
- **Auth da secretaria, na prática:** painel do Supabase → Authentication → Users →
  *Add user* (e-mail + senha forte), e no site
  `supabase.auth.signInWithPassword({ email, password })` no lugar do
  `USUARIOS.find(...)`; o logout passa a chamar `supabase.auth.signOut()`. O SDK
  guarda a sessão no `localStorage` (diferente do `sessionStorage` atual) — em
  computador compartilhado, **sair** passa a ser obrigatório.
- Se, no futuro, professores e alunos também tiverem conta no Auth, crie uma
  tabela de papéis (`perfis`: `user_id uuid` + `papel text`) e troque
  `to authenticated using (true)` por
  `using (exists (select 1 from public.perfis p where p.user_id = auth.uid() and p.papel = 'SECRETARIA'))`.
- **O que continua aberto** (honestidade): com as RPCs de escrita liberadas para
  `anon`, quem tem a chave ainda pode **criar** ocorrência/atraso falso (spam), e
  ainda pode mudar status se as RPCs de status ficarem para `anon`. Não existe
  rate limit nativo no Supabase; proteção real contra isso exige login de
  professor/aluno e/ou um proxy com limite.

### Bloco C — resumo de quem pode o quê (desenho recomendado)

| Tabela / recurso | `anon` (chave publicável) | `authenticated` (secretaria) | `service_role` (Edge Function) |
| --- | --- | --- | --- |
| `ocorrencias` | nada direto; só `execute` em `registrar_ocorrencia` e `marcar_status_ocorrencia` | `select` + troca de status via RPC | tudo (ignora RLS) |
| `atrasos` | nada direto; só `execute` em `registrar_atraso` e `marcar_status_atraso` | `select` + troca de status via RPC | tudo |
| `push_subscriptions` | nada (com Auth) ou `insert`/`update` (sem Auth) | `insert`/`update` do próprio aparelho | `select`/`delete` (limpeza das inscrições mortas) |
| `alunos` / `professores` (§3) | só `execute` nas RPCs de lista | `select` (se virar relatório) | tudo |
| `secretaria_usuarios` (§2) | nada (sem policy) | nada (só a RPC de login checa) | tudo |
| `storage.objects` → `atestados` (§4) | `insert` (upload do aluno) | `select` (URL assinada) | tudo |

No desenho recomendado, **nenhum** papel além de `service_role` tem `delete`.

### Erros comuns que este documento quer evitar

- Achar que o `guard` de `js/app.js` é controle de acesso — é navegação.
- Achar que RLS restringe **coluna** — não restringe (só linha/operação).
- Achar que bucket público é seguro porque o nome do arquivo é UUID.
- Achar que `drop policy if exists "nome"` limpa policies antigas com outro nome.
- Testar só pelo painel. O teste que vale é chamar a API **direto**, sem o site,
  com a chave publicável (receita no §6.3): se voltar dado sem login, a leitura
  está aberta.

## 6. Como confirmar o estado atual

### 6.1 CLI do Supabase (o comando pedido)

**Estado nesta máquina** (conferido agora): o CLI **não está instalado** — não
existe `supabase` no `PATH`, nem em `%APPDATA%\npm`, nem no `scoop`, nem no
`WinGet`; e também não há `SUPABASE_ACCESS_TOKEN` nem `SUPABASE_DB_PASSWORD` no
ambiente. Por isso o dump **não foi executado** (como combinado, não insisti).

Detalhe útil: o projeto **já ficou vinculado** alguma vez — existem
`supabase/.temp/project-ref` (com o ref do projeto) e
`supabase/.temp/linked-project.json`. Esse diretório está no `.gitignore` e pode
conter a URL de conexão do banco: **não versione**.

Comandos, na ordem (rodar na raiz do projeto, no PowerShell):

```powershell
# 1) instalar o CLI (escolha UMA das opções)
npm install --global supabase      # precisa de Node/npm
# ou: scoop install supabase       # ou: winget install Supabase.CLI

# 2) autenticar (abre o navegador; e o login da sua conta Supabase)
supabase login

# 3) vincular o projeto (o ref esta em supabase/.temp/project-ref)
supabase link --project-ref <PROJECT_REF>   # pede a senha do banco

# 4) gerar o dump SOMENTE do schema public (sem dados)
supabase db dump --schema public -f supabase/schema.sql

# 5) olhar o que interessa no arquivo gerado
Select-String -Path supabase/schema.sql -Pattern 'ROW LEVEL SECURITY|CREATE POLICY|GRANT|REVOKE|FUNCTION'
```

Avisos sobre o dump:

- `--schema public` grava **DDL, sem linhas de dados** — bom para não vazar
  conteúdo, mas **inclui o corpo das funções**. Se alguma função no banco tiver
  senha padrão escrita dentro dela, ela aparece no arquivo. **Revise antes de
  commitar** ou gere o dump em uma pasta ignorada pelo Git.
- A senha pedida no `link` é a do usuário **postgres do projeto** (Project
  Settings → Database), não a senha da aplicação.
- Hoje **não existe** nenhum dump nem `supabase/migrations/` no repositório:
  gerar esse arquivo é a forma de ter o registro das policies versionado.
- Alternativa sem CLI: usar o SQL Editor do painel com as consultas do 6.2 (o
  Schema Visualizer não lista policies).

### 6.2 Consultas de leitura (SQL Editor) — não alteram nada

```sql
-- RLS ligada ou desligada?
select c.relname as tabela, c.relrowsecurity as rls_ligada,
       c.relforcerowsecurity as rls_forcada
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
 order by c.relname;

-- todas as policies de tabela no schema public
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, cmd, policyname;

-- policies do Storage
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;

-- como esta o bucket?
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'atestados';

-- quem tem privilegio de tabela (o "segundo cadeado")
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated')
   and table_name in ('ocorrencias','atrasos','push_subscriptions','secretaria_usuarios','alunos','professores')
 order by table_name, grantee, privilege_type;

-- quais funcoes existem hoje (confirma verificar_senha/trocar_senha e mostra as novas)
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.proname;
```

Checklist do que olhar no resultado:

- `rls_ligada = false` em `ocorrencias`, `atrasos` ou `push_subscriptions`
  → **problema** (§5).
- Policy com `roles = {anon}` e `cmd = ALL`, ou `cmd = UPDATE`/`DELETE` com
  `qual = true` → permissiva demais.
- Policy de `select` em `push_subscriptions` para `anon` → endpoints expostos.
- `grantee = anon` com privilégio `DELETE`/`TRUNCATE` → revogar (§5).
- `public = true` no bucket `atestados` → §4.

### 6.3 O teste que vale mais que o painel

Chamar a API **direto**, sem passar pelo site, só com a chave publicável (a mesma
de `js/supabase-config.js`), e ver se volta dado:

```powershell
# troque <URL> e <CHAVE-PUBLICAVEL> pelos valores do js/supabase-config.js
Invoke-RestMethod -Uri "<URL>/rest/v1/ocorrencias?select=*&limit=5" `
  -Headers @{ apikey = "<CHAVE-PUBLICAVEL>" } | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "<URL>/rest/v1/push_subscriptions?select=*&limit=5" `
  -Headers @{ apikey = "<CHAVE-PUBLICAVEL>" } | ConvertTo-Json -Depth 3

# a API do Storage lista os atestados?
Invoke-RestMethod -Uri "<URL>/storage/v1/object/list/atestados" -Method Post `
  -Headers @{ apikey = "<CHAVE-PUBLICAVEL>"; "Content-Type" = "application/json" } `
  -Body '{"prefix":"","limit":10}'
```

Se qualquer um devolver dados, a leitura está aberta para quem tem a chave —
exatamente o cenário do §5 (e o do §4, no caso do Storage). **Faça esse teste antes
e depois** de cada correção: é a prova de que a policy mudou.

## 7. Ordem sugerida de execução

| # | Ação | Seção | Esforço | Por que nesta ordem |
| --- | --- | --- | --- | --- |
| 1 | **Trocar a senha da secretaria** (e ver se ela é reusada em outro sistema) | §2 | 5 min | a credencial já está exposta; não depende de nada |
| 2 | Rodar o dump/consultas do §6 e **guardar o resultado** | §6 | 30 min | sem ver as policies atuais, qualquer mudança é chute |
| 3 | Aplicar o **Bloco A** + `revoke` de delete/truncate | §5 | 30 min | fecha exclusão e `insert` de lixo **sem** tocar no site |
| 4 | Criar `secretaria_usuarios` + RPC + ajustar o `js/dados.js` | §2 | 1–2 h | tira a senha do repositório reaproveitando o padrão que já existe |
| 5 | Ligar o **Supabase Auth** da secretaria e aplicar o **Bloco B** | §5 | ~meio dia | é o passo que passa a proteger a **leitura** dos dados |
| 6 | Bucket privado + `createSignedUrl` | §4 | ~meio dia | só faz sentido depois do Auth (senão a assinatura fica aberta) |
| 7 | Listas de alunos/professores no banco + RPCs | §3 | 1–2 dias | maior mudança de código; depende das RPCs do §5 |
| 8 | Retenção/exclusão automática, aviso de privacidade, auditoria | §3, §4 | ~1 dia | fecha o ciclo da LGPD (dado não fica para sempre) |
| 9 | Rate limit/anti-spam (ou login para professor/aluno) | §5 | a definir | é o único jeito de barrar registro falso |

Sequência mínima para "hoje": **1 → 2 → 3 → 4**. Depois: 5 → 6 → 7 → 8.
O item 9 é decisão de produto (login para todos) e pode ficar para um segundo
momento, sem bloquear os outros.

## 8. Limitações deste documento

- **Não mediu o banco**: não houve CLI nem acesso ao painel nesta análise. Tudo o
  que o §5 diz sobre as policies atuais é **hipótese declarada**, marcada como
  "a confirmar" — não é constatação.
- **Não é teste de invasão**: é leitura de código. Nada foi explorado, nenhuma
  requisição foi disparada contra o projeto.
- **Não é parecer jurídico**: os artigos da LGPD citados são referência de leitura,
  não avaliação de conformidade. Conformidade precisa passar pela escola/DPO.
- **Não cobre o que não está no repositório**: secrets do projeto, configuração do
  Auth (domínio, e-mail, provedores), policies do Storage no painel, limites do
  plano (armazenamento, número de requisições), logs de acesso e backups.
- **Não garante que nada mais vaze**: por exemplo, o `x-webhook-secret` vazado
  permitiria disparar a Edge Function `enviar-push` (a função confere o header, não
  o remetente); e um atestado já copiado por link continua existindo onde foi
  copiado — tornar o bucket privado impede novos acessos, não desfaz os antigos.
- **Nenhum SQL deste documento foi executado**, nenhum arquivo do site foi
  alterado, e **nenhum segredo** (senha, chave publicável, chave `service_role`,
  chave privada VAPID) está escrito aqui.

Documentos relacionados: [`README.md`](../README.md) (o que o sistema é e o que
precisa existir no Supabase) e [`docs/FLUXO.md`](FLUXO.md) (o caminho do dado, do
formulário até o push).
