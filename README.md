# Sistema de Ocorrências

Sistema escolar para registrar **ocorrências disciplinares** (professor) e
**entradas atrasadas** (aluno) e acompanhar tudo em um **painel da secretaria**,
com atualização em tempo real e notificação push no celular/desktop da
secretaria.

É um site **100% estático** (HTML + CSS + JavaScript, sem build e sem servidor
próprio). Os dados ficam no **Supabase** (Postgres + Storage) e o site pode ser
publicado no **GitHub Pages** ou rodar em qualquer servidor HTTP local.

## O que é o sistema

Todas as telas vivem no mesmo `index.html` (blocos `<div class="view" id="view-...">`)
e o `js/app.js` mostra uma de cada vez, guardando a tela atual no **hash** da URL
(ex.: `#/painel/atrasos`) — por isso F5 e o botão voltar do navegador funcionam.

| Rota | Tela | Quem entra |
| --- | --- | --- |
| `#/` | portal com os acessos | qualquer visitante |
| `#/professor-login` | login do professor (RA + senha) | professor |
| `#/aluno-login` | login do aluno (RA + senha) | aluno |
| `#/professor-trocar-senha` | trocar a senha do professor | professor |
| `#/aluno-trocar-senha` | trocar a senha do aluno | aluno |
| `#/secretaria-login` | login da secretaria (usuário + senha) | secretaria |
| `#/nova-ocorrencia` | registrar ocorrência | só com sessão de **PROFESSOR** |
| `#/entrada-atrasada` | registrar entrada atrasada (com atestado) | só com sessão de **ALUNO** |
| `#/painel` | painel: `dashboard`, `ocorrencias`, `atrasos` | só com sessão de **SECRETARIA** |
| `#/qrcode` | gerar QR Code do endereço do sistema | qualquer visitante |

Regras de acesso: as telas de nova ocorrência, entrada atrasada e painel têm
`guard` (ver `VIEWS` em `js/app.js`). Sem a sessão do tipo certo, o sistema cai
na tela de login correspondente. A sessão é guardada em `sessionStorage`
(`js/sessao.js`, chave `livro-ocorrencias:sessao`) — fechar o navegador encerra.

O que o sistema faz, em resumo:

- **Login** — professor e aluno entram com RA + senha; a senha é conferida
  **dentro do banco**, pela função `verificar_senha` (o hash nunca passa pelo
  navegador). O RA precisa existir em `professores.json` / `alunos.json`, que
  são a única fonte de nomes, salas e turnos. A secretaria entra com usuário e
  senha **fixos no código** (`js/dados.js` → `USUARIOS`), sem consultar o banco.
- **Ocorrência** — tipo (`INDISCIPLINA`, `ATRASO`, `MATERIAL`, `SAUDE`, `OUTRO`),
  gravidade (`LEVE`, `MODERADA`, `GRAVE`), detalhes e a situação
  (`NOVA`, `LIDA`, `EM_ANDAMENTO`, `RESOLVIDA`), gravada na tabela `ocorrencias`.
- **Entrada atrasada** — motivo, justificativa, responsável e, se for o caso, o
  **atestado** (foto ou PDF) que sobe para o bucket `atestados` do Supabase
  Storage; na tabela `atrasos` fica só o caminho do arquivo.
- **Painel** — cards, gráficos da semana, tabelas, filtro `Em aberto / Todas`,
  botões "marcar como vista/resolvida" (gravam o `status` no banco), relatórios
  em PDF e um botão "Ativar notificações" (Web Push).
- **Tempo real** — o painel assina as tabelas `ocorrencias` e `atrasos` pelo
  Supabase Realtime: o que é registrado em outro aparelho aparece na hora, com
  alerta sonoro e notificação do navegador.
- **Push** — um Database Webhook do Supabase chama a Edge Function
  `enviar-push`, que avisa todos os aparelhos inscritos da secretaria.
- **Semana atual** — ocorrências e atrasos só aparecem de segunda-feira 00:00
  até agora (ver `inicioDaSemana()` em `js/dados.js`). O que é de semanas
  anteriores continua gravado no banco, mas não é lido pelo site.

## Tecnologias

Não existe `package.json`, etapa de build, npm install nem framework: tudo é
arquivo estático que o navegador lê direto.

| Camada | O que é | Onde |
| --- | --- | --- |
| Página | HTML único com todas as telas | `index.html` |
| Estilo | CSS puro (sem framework) | `css/estilo.css` |
| Lógica | JavaScript em módulos (`type="module"`) | `js/app.js`, `js/dados.js`, `js/*.js` |
| SDK do banco | `@supabase/supabase-js` v2, via CDN jsDelivr (ESM) | `js/supabase-config.js` |
| Banco | Supabase (Postgres) — tabelas + RPC | `js/dados.js` |
| Login | RPC `verificar_senha` / `trocar_senha` | `js/dados.js` |
| Arquivos | Supabase Storage, bucket `atestados` | `js/dados.js` (`enviarAtestado`) |
| Tempo real | Supabase Realtime (`postgres_changes`) | `js/dados.js` (`aoMudar`, `aoMudarEntradasAtrasadas`) |
| Push | Web Push com chave VAPID + Service Worker | `js/push.js`, `sw.js`, `supabase/functions/enviar-push/index.ts` |
| Servidor do push | Edge Function (Deno) com `npm:web-push` e `npm:@supabase/supabase-js` | `supabase/functions/enviar-push/index.ts` |
| PDF | jsPDF 2.5.1 + jspdf-autotable 3.8.2 (CDN) | `index.html`, `js/relatorios.js` |
| QR Code | qrcodejs 1.0.0 (CDN) | `index.html`, `js/app.js` |
| Fontes | Google Fonts (Inter, IBM Plex Mono) | `index.html` |
| App instalável | Web App Manifest | `manifest.json` |
| Hospedagem | GitHub Pages (estático, com HTTPS) | — |
| Automação | GitHub Actions: consulta o banco a cada 3 dias ("manter Supabase ativo") | `.github/workflows/keep-supabase-alive.yml` |
| Sessão | `sessionStorage` + roteador por hash | `js/sessao.js`, `js/app.js` |

## Estrutura de pastas

```
Sistema-Original/
├── index.html                 todas as telas (views) do sistema
├── alunos.json                lista de alunos (RA, nome, sala, turno)
├── professores.json           lista de professores (RA, nome)
├── manifest.json              manifest do app instalável (PWA)
├── sw.js                      service worker das notificações push
├── css/
│   └── estilo.css             todo o estilo
├── js/
│   ├── supabase-config.js     URL e chave publicável do Supabase + createClient
│   ├── dados.js               camada de dados (Supabase, JSONs, Storage, Realtime)
│   ├── app.js                 roteador das telas + lógica de cada tela
│   ├── push.js                inscrição Web Push (VAPID) e gravação no Supabase
│   ├── notificacoes.js        permissão, notificação local e alerta sonoro
│   ├── relatorios.js          relatórios em PDF da semana (jsPDF + AutoTable)
│   └── sessao.js              sessão em sessionStorage
├── assets/
│   └── icone-ocorrencia.svg   ícone do sistema/notificações
├── supabase/
│   ├── config.toml            configuração da função (verify_jwt = false)
│   ├── functions/
│   │   └── enviar-push/index.ts   Edge Function que envia o Web Push
│   └── .temp/                 gerado pelo CLI do Supabase (ignorado no Git)
├── docs/
│   ├── FLUXO.md               diagrama do fluxo de dados (Mermaid)
│   ├── SEGURANCA.md           segurança/LGPD: diagnóstico e plano de correção
│   └── DOCUMENTACAO.md        documentação geral (quando existir)
├── .github/workflows/
│   └── keep-supabase-alive.yml    consulta o banco a cada 3 dias
└── .gitignore                 node_modules/, supabase/.temp/, .firebase/, __temp_*.js, servidor/banco.db
```

Observações sobre arquivos que **não** fazem parte do sistema em uso:

- `supabase/.temp/` — pastas geradas pelo CLI do Supabase; estão no `.gitignore`.
- `.firebase/` — resto da hospedagem antiga no Firebase (a hospedagem real hoje
  é o GitHub Pages); está no `.gitignore` e não é usado por nenhuma tela.
- `servidor/banco.db` — arquivo do antigo servidor local que não existe mais;
  segue apenas listado no `.gitignore`.

## Como rodar localmente

**Não abra o `index.html` por `file://` (clique duplo no arquivo).** O sistema é
um módulo ES e lê `alunos.json` / `professores.json` com `fetch`; além disso o
service worker, as notificações push e o `crypto.randomUUID()` só funcionam em
**contexto seguro** (`https://` ou `http://localhost`). Aberto direto do disco, o
login não carrega as listas e o console explica o motivo — a mensagem do próprio
código (`js/dados.js`) pede: *"Abra o sistema por https:// ou por localhost"*.

Passo a passo:

1. Abra a pasta do projeto em um **servidor HTTP local**. Duas formas citadas no
   próprio código:
   - **VS Code + extensão Live Server**: clique com o botão direito no
     `index.html` → *Open with Live Server* (ou o botão **Go Live**).
   - **Python**: dentro da pasta do projeto, rode
     `python -m http.server 8000` e abra `http://localhost:8000/`.
2. Abra o endereço no navegador. O portal (`#/`) traz os acessos; também dá para
   entrar direto por uma rota, ex.: `http://localhost:8000/#/professor-login`.
3. Entre com um usuário que exista no projeto:
   - **Secretaria**: o usuário e a senha fixos em `js/dados.js` (lista
     `USUARIOS`, sem consulta ao Supabase) — o valor da senha **não** é
     reproduzido nesta documentação (risco e plano em
     [docs/SEGURANCA.md](docs/SEGURANCA.md));
   - **Professor**: um RA do `professores.json` (hoje `1001` e `1002`) + a senha
     conferida pelo banco (senha própria do professor ou a padrão — o valor
     padrão não está no código: *a confirmar no painel do Supabase*);
   - **Aluno**: um RA do `alunos.json` (hoje `2001` a `2006`) + a senha conferida
     pelo banco (mesma observação acima).
4. Para testar o **painel** e as notificações, o navegador precisa conseguir
   falar com o Supabase. Se o projeto estiver pausado/sem internet, o sistema
   mostra o aviso *"Sistema temporariamente indisponível. Avise a secretaria ou
   tente novamente em alguns minutos."* (o erro técnico continua no console).

Para **adicionar/remover aluno ou professor**, edite somente `alunos.json` /
`professores.json`: o `professores.json` é relido a cada tentativa de login do
professor e o `alunos.json` é relido na abertura do sistema e sempre que a tela
de nova ocorrência é aberta (`Dados.carregarAlunos()` em `js/app.js`) — não é
preciso mexer no código.

## Como publicar no GitHub Pages

O site é estático, então não existe etapa de build: publicar é apontar o Pages
para a branch que tem os arquivos.

1. Envie o projeto para o GitHub (`git push` da branch desejada, por exemplo
   `main`).
2. No repositório, abra **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**, selecione a branch (ex.:
   `main`) e a pasta **`/ (root)`**, e clique em **Save**.
4. Aguarde a publicação e abra `https://USUARIO.github.io/REPO/` — o sistema
   começa no portal, e as rotas continuam funcionando com `#` (ex.:
   `https://USUARIO.github.io/REPO/#/painel`).
5. O Pages já entrega **HTTPS**, que é justamente o contexto exigido pelo service
   worker, pelo push e pelo `crypto.randomUUID()`.

Cuidados depois de publicar:

- **URL usada pela notificação**: a Edge Function monta o link do push a partir
  da constante `URL_DESTINO` em `supabase/functions/enviar-push/index.ts` — hoje
  `https://tomasfernandes006-code.github.io/SIstema-Original/#/painel`. Se o
  endereço do site mudar (outro usuário/repositório), atualize essa constante e
  faça o deploy da função de novo, senão a notificação abre o endereço antigo.
- **Manter o Supabase ativo**: o workflow
  `.github/workflows/keep-supabase-alive.yml` roda no GitHub (Actions) e consulta
  a API REST do banco a cada 3 dias (`cron: "0 12 */3 * *"`), falhando se o
  banco não responder com HTTP 2xx. Ele já traz a URL e a chave publicável do
  projeto no próprio arquivo (as mesmas de `js/supabase-config.js`).
- **QR Code**: a tela `#/qrcode` gera o QR do endereço atual, útil para abrir o
  sistema no celular dos professores/alunos.
- **App instalável**: por causa do `manifest.json`, o site pode ser "instalado"
  no celular/desktop; o `start_url` é `./#/painel`.

## O que deve existir no Supabase

O site acessa o Supabase pela chave publicável que está em
`js/supabase-config.js`. Tudo que ele usa hoje está listado abaixo, com o ponto
do código que depende de cada item. Onde o valor exato não aparece em nenhum
arquivo do projeto, está escrito **a confirmar no painel do Supabase**.

### 1) Tabelas

| Tabela | Para que serve | Colunas usadas pelo código |
| --- | --- | --- |
| `ocorrencias` | uma linha por ocorrência registrada pelo professor | `id`, `professor_id`, `professor_nome`, `aluno_nome`, `aluno_ra`, `turma`, `tipo`, `gravidade`, `detalhes`, `status`, `criada_em`, `atualizada_em` |
| `atrasos` | uma linha por entrada atrasada registrada pelo aluno | `id`, `aluno_id`, `aluno_nome`, `aluno_ra`, `turma`, `motivo`, `justificativa_tipo`, `responsavel_nome`, `atestado_path`, `atestado_nome_arquivo`, `status`, `criada_em`, `atualizada_em` |
| `push_subscriptions` | uma linha por aparelho/navegador inscrito nas notificações da secretaria | `endpoint`, `subscription`, `atualizado_em` |

Detalhes que o código deixa claro (`js/dados.js` e `js/push.js`):

- O **`id` é gerado pelo banco** — o site nunca manda `id` no insert.
- **`status`** começa como `NOVA` no cadastro e é atualizado pelo painel com
  `LIDA`, `EM_ANDAMENTO` ou `RESOLVIDA` (botões "marcar como vista/resolvida",
  via `update({ status, atualizada_em })`). Se vier nulo, o site assume `NOVA`.
- **`criada_em` / `atualizada_em`** são gravadas pelo próprio site em ISO
  (`new Date().toISOString()`). O `criada_em` é o campo usado para ordenar (mais
  recente em cima) e para o filtro da semana atual; os registros antigos
  continuam na tabela, só não são mais lidos.
- **`tipo`** recebe um destes valores: `INDISCIPLINA`, `ATRASO`, `MATERIAL`,
  `SAUDE`, `OUTRO`. **`gravidade`**: `LEVE`, `MODERADA`, `GRAVE`.
- Em `atrasos`, **`atestado_path`** guarda só o **caminho** dentro do bucket
  `atestados` (a URL pública é montada na hora com `getPublicUrl`);
  `atestado_nome_arquivo` guarda o nome original mostrado como link.
- Em `push_subscriptions`, o **`endpoint` é a chave** da linha: a inscrição é
  gravada com `upsert(..., { onConflict: "endpoint" })`, e `subscription` guarda
  o JSON completo da inscrição push (`subscription.toJSON()`).
- Tipos exatos das colunas, valores padrão, chaves e demais constraints:
  *a confirmar no painel do Supabase*.
- **Políticas de RLS**: o navegador usa a chave publicável (anon), então essas
  tabelas precisam permitir `select`, `insert` e `update` para essa chave (é o
  que o site faz: ler as duas listas, inserir, e atualizar só o `status`). As
  políticas exatas: *a confirmar no painel do Supabase*.
- A tabela onde ficam as **senhas próprias** de alunos e professores não aparece
  em nenhum arquivo do projeto: ela é usada apenas por dentro das funções
  `verificar_senha` / `trocar_senha`. Nome, colunas e formato do hash:
  *a confirmar no painel do Supabase*.

### 2) Funções (RPC)

| Função | Como o site chama (`supabase.rpc`) | O que o retorno significa para a tela |
| --- | --- | --- |
| `verificar_senha` | `verificar_senha({ p_tipo, p_ra, p_senha })` — `p_tipo` é `ALUNO` ou `PROFESSOR` | `true` = senha confere (o login continua pelo `alunos.json` / `professores.json`); `false` = senha errada (login negado, mensagem de "senha incorreta"); erro = falha técnica (a tela mostra o aviso de sistema indisponível) |
| `trocar_senha` | `trocar_senha({ p_tipo, p_ra, p_senha_atual, p_nova_senha })` | `true` = nova senha gravada; `false` = senha atual incorreta |

Como as funções são usadas (`js/dados.js`):

- `verificar_senha` é chamada por `autenticarProfessor` e por `autenticarAluno`;
  é ela que resolve sozinha entre a **senha própria** (a que foi trocada no
  sistema) e a **senha padrão**. Por isso o hash nunca passa pelo navegador e a
  senha padrão não existe em nenhum arquivo do site (*a confirmar no painel do
  Supabase*).
- `trocar_senha` é chamada por `trocarSenhaProfessor` e `trocarSenhaAluno`,
  **depois** de conferir a senha atual com as mesmas regras do login. Enquanto a
  gravação não dá certo, a senha antiga continua valendo.
- O corpo (definição SQL) das duas funções fica no banco; para editar ou conferir
  os parâmetros exatos, use **Database → Functions** no painel do Supabase
  (*a confirmar no painel do Supabase*).

### 3) Realtime (atualização do painel sem recarregar)

O painel da secretaria assina as duas tabelas em tempo real
(`js/dados.js` → `aoMudar` e `aoMudarEntradasAtrasadas`), assim:

```js
supabase.channel("ocorrencias-1")
  .on("postgres_changes", { event: "*", schema: "public", table: "ocorrencias" }, ...)
  .subscribe();
```

Para isso funcionar:

- as tabelas **`ocorrencias` e `atrasos`** precisam estar habilitadas na
  replicação do Realtime (no painel: **Database → Replication / Publications**,
  publicação `supabase_realtime`). Sem isso o painel só se atualiza quando algo
  acontece dentro dele mesmo (trocar de seção, mudar filtro, marcar status);
- o evento usado é `*` (insert, update e delete) no schema `public`;
- cada entrada no painel abre canais com nome único (`ocorrencias-1`,
  `ocorrencias-2`, ...) e o botão **Sair** fecha os canais;
- limites/versão do Realtime e demais ajustes: *a confirmar no painel do
  Supabase*.

### 4) Storage: bucket `atestados`

- O bucket se chama **`atestados`** e recebe o arquivo direto do navegador
  (`js/dados.js` → `supabase.storage.from("atestados").upload(caminho, conteudo, { contentType })`).
- Ele precisa ser **público**: o painel monta o link do atestado com
  `getPublicUrl(caminho)` e abre a foto/PDF sem login. Bucket privado = link não
  abre.
- O nome do arquivo é gerado pelo site: `<uuid>.<extensão>`. Imagens são
  redimensionadas em um `<canvas>` para no máximo 1600px de largura em JPEG
  (qualidade 0.85) antes de subir; PDF sobe como está.
- O site recusa arquivos acima de **10 MB** e aceita apenas imagem ou PDF
  (mensagens de validação do formulário). O tamanho máximo configurado no bucket
  é outro ajuste: *a confirmar no painel do Supabase*.
- Como o upload usa a chave publicável, o bucket precisa permitir **insert** (e
  leitura pública) pelas políticas de `storage.objects`. As políticas exatas:
  *a confirmar no painel do Supabase*.

### 5) Database Webhook (avisar a secretaria por push)

- Precisa existir um **Database Webhook em `INSERT`** nas tabelas `ocorrencias` e
  `atrasos`, apontando para a Edge Function **`enviar-push`**.
- A função entende o **corpo padrão do webhook do Supabase**, com `type`, `table`
  e `record`: ela escolhe a mensagem por `payload.table` e monta o texto com
  `payload.record` (ex.: `aluno_nome`, `aluno_ra`, `tipo`).
- Segurança: a função responde **401 "Não autorizado"** se o header
  `x-webhook-secret` não for igual ao secret `WEBHOOK_SECRET`. Portanto o webhook
  precisa mandar esse header, com o mesmo valor (no painel, nos *HTTP Headers* do
  webhook). O valor do secret: *a confirmar no painel do Supabase*.
- A função está configurada com `verify_jwt = false` (`supabase/config.toml`),
  então o webhook não precisa de JWT da plataforma.
- Nome/URL exatos da função no seu projeto: *a confirmar no painel do Supabase*
  (em **Edge Functions**).

### 6) Secrets da Edge Function `enviar-push`

| Secret | Para que serve |
| --- | --- |
| `WEBHOOK_SECRET` | conferido contra o header `x-webhook-secret` de cada chamada do webhook; sem bater, a função devolve 401 |
| `VAPID_SUBJECT` | identifica o emissor do Web Push (obrigatório para o `web-push`) |
| `VAPID_PUBLIC_KEY` | chave pública VAPID — tem de ser **a mesma** que está em `js/push.js` |
| `VAPID_PRIVATE_KEY` | chave privada VAPID, só no servidor, nunca no site |

Mais detalhes do que o código mostra (`supabase/functions/enviar-push/index.ts`):

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são preenchidos **automaticamente**
  pelo ambiente das Edge Functions. A função usa a chave de serviço para ler
  todas as linhas de `push_subscriptions` e apagar as inscrições mortas,
  ignorando as políticas de RLS (por isso essa chave não pode ficar no site).
- Para cada linha, a função envia o corpo JSON `{ title, body, url }` com o
  `web-push`. Inscrições que o serviço de push recusar com **404 ou 410** são
  apagadas da tabela (`delete().eq("endpoint", ...)`) — é a limpeza de aparelhos
  que desinstalaram/limparam o navegador.
- O `url` enviado é fixo no arquivo (`URL_DESTINO`, hoje
  `https://tomasfernandes006-code.github.io/SIstema-Original/#/painel`).
- O nome da função é dado pela pasta (`supabase/functions/enviar-push`), e o
  `config.toml` do projeto só traz `[functions.enviar-push] verify_jwt = false`.
  Como os secrets foram gravados e como a função foi publicada (CLI ou painel) e
  como o par de chaves VAPID foi gerado: *a confirmar no painel do Supabase*.
- No site, quem cria a inscrição é o `js/push.js` (`ativarPush()`): pede a
  permissão, registra o `sw.js` com escopo `./`, cria a inscrição
  (`pushManager.subscribe`) com a chave VAPID pública e faz upsert em
  `push_subscriptions`. O botão **🔔 Ativar notificações** do painel chama essa
  função; se a permissão já foi concedida antes, o painel reativa sozinho ao
  entrar (`iniciarPainel`).
- Quem mostra a notificação é o **Service Worker** `sw.js`, e o clique foca uma
  aba já aberta ou abre a rota do painel.

### 7) Como conferir se está tudo no lugar

1. **Login do aluno/professor** funciona → a função `verificar_senha` existe.
2. **Registrar uma ocorrência** e vê-la no painel → tabela `ocorrencias` liberada
   para o site (insert + select).
3. **Registrar uma entrada atrasada com atestado** e abrir o link no painel →
   bucket `atestados` público e com upload permitido + coluna `atestado_path`.
4. **Painel aberto em dois aparelhos**: registrar em um e ver aparecer no outro
   sem recarregar → Realtime habilitado nas duas tabelas.
5. **Botão 🔔 Ativar notificações** no painel → aparece uma linha em
   `push_subscriptions`.
6. Registrar em outro aparelho com o painel aberto → a **notificação push** chega
   → Database Webhook + Edge Function + secrets + service worker no lugar
   (inclusive o header `x-webhook-secret`).
7. **Actions** do repositório com o workflow `Manter Supabase ativo` verde → a
   chave publicável e a API REST estão respondendo.

Se alguma tela mostrar **"Sistema temporariamente indisponível. Avise a secretaria
ou tente novamente em alguns minutos."**, significa que o site não conseguiu
falar com o banco (projeto pausado, sem internet ou erro do servidor) — o erro
técnico completo continua no console do navegador. Senha errada continua sendo
tratada como senha errada.

## Fluxo dos dados

O diagrama completo (professor/aluno → Supabase → Webhook → Edge Function →
Service Worker → secretaria, com o Realtime atualizando o painel) está em
**[docs/FLUXO.md](docs/FLUXO.md)**.

## Observações (fatos que o código deixa claro)

- A **secretaria não passa pelo Supabase**: usuário e senha são fixos em
  `js/dados.js` (lista `USUARIOS`; o valor da senha não é reproduzido nesta
  documentação — risco e plano em [docs/SEGURANCA.md](docs/SEGURANCA.md)) e o
  login dela é local.
- **`alunos.json` e `professores.json` são servidos pelo próprio site**: qualquer
  pessoa com o endereço consegue abrir os dois arquivos e ler RAs, nomes, salas e
  turnos (não há controle de acesso a eles).
- **O sistema não usa o Supabase Auth** (`supabase.auth` não aparece em nenhum
  arquivo): o controle de acesso é a sessão do próprio site (`sessionStorage`,
  `js/sessao.js`) junto com as regras `guard` de `js/app.js`, e quem confere senha
  são as funções `verificar_senha` / `trocar_senha`.
- **O `<title>` do `index.html` está vazio**: hoje a aba do navegador mostra o
  endereço da página. O nome do app instalável vem do `manifest.json`
  ("Sistema de Ocorrências").
- **Sem build e sem dependências para instalar**: não existe `package.json`. O
  que vem de fora são arquivos de CDN carregados no `index.html`
  (`@supabase/supabase-js` v2, jsPDF 2.5.1, jspdf-autotable 3.8.2, qrcodejs
  1.0.0, Google Fonts) e a Edge Function, que importa `npm:web-push@3.6.7` e
  `npm:@supabase/supabase-js@2` pelo próprio código.
- **Segurança e LGPD** (o que está exposto hoje e o plano de correção — senha da
  secretaria no JavaScript, `alunos.json`/`professores.json` públicos, bucket
  `atestados` público e as políticas de RLS que faltam): veja
  **[docs/SEGURANCA.md](docs/SEGURANCA.md)**.
