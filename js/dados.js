/* =====================================================================
   CAMADA DE DADOS (API)
   ---------------------------------------------------------------------
   AGORA OS DADOS MORAM NO SERVIDOR. Antes tudo era guardado no
   localStorage do navegador, então:
     - o celular do professor e o computador da secretaria NÃO viam
       os dados um do outro (cada aparelho tinha o seu próprio "banco")
     - se limpasse os dados do navegador, perdia tudo

   Agora este arquivo só conversa com o servidor (Express + SQLite)
   por fetch(). O servidor é a ÚNICA fonte dos dados: tudo o que um
   aparelho envia aparece no outro, de verdade.

   ANTES DE ABRIR O SISTEMA, suba o servidor (numa janela separada):

       cd servidor
       node servidor.js          ->  http://localhost:3000

   (o servidor precisa de um alunos.json do lado dele; ele é a lista
   de alunos que a rota GET /alunos devolve)

   Rotas usadas por este arquivo:
     POST   /login/professor   { matricula, pin }
     POST   /login/secretaria  { usuario, senha }
     POST   /login/aluno       { ra, senha }
     GET    /alunos
     GET    /ocorrencias
     POST   /ocorrencias       { professorId, professorNome, alunoNome,
                                 alunoRa, turma, tipo, gravidade, detalhes }
     PATCH  /ocorrencias/:id   { status }
     GET    /atrasos
     POST   /atrasos           { alunoId, alunoNome, alunoRa, turma, motivo }
     PATCH  /atrasos/:id       { status }

   Os nomes das funções do objeto Dados são EXATAMENTE os mesmos de
   antes — só o "corpo" de cada uma mudou. As que precisam esperar a
   resposta do servidor agora são async (devolvem Promise), e quem
   chama precisa usar await.
   ===================================================================== */

// endereço do servidor (o mesmo de servidor/servidor.js)
const API_URL = "http://localhost:3000";

// de quanto em quanto tempo o site pergunta ao servidor se apareceu
// novidade. É isso que substitui o antigo evento "storage" do
// localStorage: agora a ocorrência lançada no celular do professor
// aparece sozinha no painel da secretaria, em outro computador.
const INTERVALO_ATUALIZACAO = 5000;

/* ---------------------------------------------------------------------
   ALUNOS — quem manda é a rota GET /alunos
   ---------------------------------------------------------------------
   O servidor lê o alunos.json que fica na pasta dele e devolve a
   lista crua. Cada aluno tem exatamente estes campos:

     {
       "RA":    "2001",           <- não pode ficar vazio nem repetir
       "nome":  "Chloe",          <- não pode ficar vazio
       "sala":  "9º B",           <- não pode ficar vazio
       "turno": "Manhã"           <- não pode ficar vazio
     }

   Para adicionar, remover ou corrigir um aluno, edite SOMENTE o
   alunos.json que está na pasta do servidor — o sistema lê o arquivo
   sozinho, sem precisar mexer no código. As validações pedidas (RA
   vazio/duplicado, nome vazio, sala vazia e turno vazio) continuam
   aqui em validarAlunos(), logo abaixo.

   A lista é lida uma vez e guardada na memória (variável ALUNOS) para
   o seletor em 3 etapas (turno -> sala -> aluno) montar as opções na
   hora, sem esperar o servidor a cada clique. O evento
   "alunos:carregados" avisa as telas quando a lista (re)chegou.
   --------------------------------------------------------------------- */

let ALUNOS = [];              // lista já validada, vinda de GET /alunos
let alunosProntos = false;    // true quando o servidor respondeu sem erro
let problemasDosAlunos = [];  // problemas de validação encontrados na lista
let promessaAlunos = null;    // controla a leitura (evita pedir 2x)

// devolve o valor como texto, sem espaços nas pontas ("" se não for texto)
function comoTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

/* ---------------------------------------------------------------------
   ERRO DE REQUISIÇÃO
   ---------------------------------------------------------------------
   Erro que carrega junto o status HTTP devolvido pelo servidor. Isso
   permite diferenciar dois casos bem diferentes:
     - status 0   -> o servidor nem respondeu (está fora do ar /
                     endereço errado / sem internet)
     - status 401 -> o servidor respondeu "usuário ou senha inválidos"
                     (é só login negado, não é erro de rede)
   --------------------------------------------------------------------- */
class ErroDeRequisicao extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = "ErroDeRequisicao";
    this.status = status;
  }
}

/* ---------------------------------------------------------------------
   CHAMADA GENÉRICA AO SERVIDOR
   --------------------------------------------------------------------- */
// Faz a chamada e devolve o JSON já convertido.
//   caminho: "/ocorrencias", "/login/aluno", ...
//   metodo:  "GET" | "POST" | "PATCH" (padrão "GET")
//   corpo:   objeto que vira o corpo JSON (nos POST/PATCH)
// Se o servidor responder com erro, lança ErroDeRequisicao com a
// mensagem que ele mandou (ex.: { erro: "Matrícula ou PIN inválidos" }).
async function requisitar(caminho, { metodo = "GET", corpo } = {}) {
  let resposta;
  try {
    resposta = await fetch(API_URL + caminho, {
      method: metodo,
      cache: "no-store",
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (erro) {
    // não chegou nem a falar com o servidor
    throw new ErroDeRequisicao(
      `Não foi possível falar com o servidor (${API_URL}). ` +
        "Confira se ele está rodando: cd servidor; node servidor.js",
      0
    );
  }

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null; // resposta sem corpo JSON (não deveria acontecer aqui)
  }

  if (!resposta.ok) {
    const mensagem =
      (dados && (dados.erro || dados.mensagem)) ||
      `O servidor respondeu ${resposta.status}`;
    throw new ErroDeRequisicao(mensagem, resposta.status);
  }

  return dados;
}

// usado pelos três logins: o servidor devolve o usuário já pronto
// (id, nome, tipo...) ou responde 401 quando os dados não batem.
// 401 = login negado -> devolvemos null (o mesmo "null" de antes).
// Qualquer outro problema (servidor fora do ar) é lançado para a tela
// poder avisar que o problema é de conexão, e não de senha.
async function autenticar(caminho, corpo) {
  try {
    const conta = await requisitar(caminho, { metodo: "POST", corpo });
    return conta && conta.id ? conta : null;
  } catch (erro) {
    if (erro.status === 401) return null;
    throw erro;
  }
}

/* ---------------------------------------------------------------------
   VALIDAÇÃO E CONVERSÃO DOS ALUNOS
   --------------------------------------------------------------------- */
// aplica as validações em cada aluno devolvido por GET /alunos:
//   - RA não pode ficar vazio e não pode repetir
//   - nome, sala e turno não podem ficar vazios
// Alunos inválidos são IGNORADOS e o motivo é registrado em
// problemasDosAlunos (também aparece no console do navegador).
function validarAlunos(listaBruta) {
  const validos = [];
  const problemas = [];
  const rasJaVistos = new Set();

  listaBruta.forEach((item, indice) => {
    const onde = `GET /alunos (aluno nº ${indice + 1})`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problemas.push(
        `${onde}: não é um aluno válido (precisa ter os campos RA, nome, sala e turno) — ignorado.`
      );
      return;
    }

    const aluno = {
      RA: comoTexto(item.RA),
      nome: comoTexto(item.nome),
      sala: comoTexto(item.sala),
      turno: comoTexto(item.turno),
    };

    const vazios = [];
    if (!aluno.RA) vazios.push("RA");
    if (!aluno.nome) vazios.push("nome");
    if (!aluno.sala) vazios.push("sala");
    if (!aluno.turno) vazios.push("turno");

    if (vazios.length) {
      problemas.push(
        `${onde}${aluno.RA ? " (RA " + aluno.RA + ")" : ""}: campo(s) vazio(s): ` +
          `${vazios.join(", ")} — aluno ignorado.`
      );
      return;
    }

    if (rasJaVistos.has(aluno.RA)) {
      problemas.push(`${onde} (${aluno.nome}): RA ${aluno.RA} duplicado — aluno ignorado.`);
      return;
    }

    rasJaVistos.add(aluno.RA);
    validos.push(aluno);
  });

  return { validos, problemas };
}

// converte o aluno recebido do servidor para o formato usado pelas
// telas e pela sessão (o RA vira o "id" do aluno: id = "aluno-2001")
function montarAluno(alunoDoServidor) {
  return {
    id: "aluno-" + alunoDoServidor.RA,
    tipo: "ALUNO",
    ra: alunoDoServidor.RA,
    nome: alunoDoServidor.nome,
    sala: alunoDoServidor.sala,
    turno: alunoDoServidor.turno,
    // "turma" guarda o mesmo valor de "sala": as ocorrências, o painel e
    // a tela de nova ocorrência já usavam o nome "turma" para esse campo.
    turma: alunoDoServidor.sala,
  };
}

/* ---------------------------------------------------------------------
   LEITURA DA LISTA DE ALUNOS
   --------------------------------------------------------------------- */
// busca a lista de alunos no servidor (GET /alunos), valida e guarda
// na memória. Se o servidor estiver fora do ar, a lista fica vazia e o
// erro explica o que fazer no console.
async function carregarAlunosDoServidor() {
  try {
    const conteudo = await requisitar("/alunos");
    if (!Array.isArray(conteudo)) {
      throw new Error("o servidor precisa devolver uma lista (array) de alunos");
    }

    const { validos, problemas } = validarAlunos(conteudo);
    ALUNOS = validos.map(montarAluno);
    problemasDosAlunos = problemas;
    alunosProntos = true;

    if (problemas.length) {
      console.warn(
        `GET /alunos: ${problemas.length} problema(s) encontrado(s):\n- ` +
          problemas.join("\n- ")
      );
    }
  } catch (erro) {
    ALUNOS = [];
    problemasDosAlunos = [];
    alunosProntos = false;
    console.error(
      "Não foi possível carregar a lista de alunos (GET /alunos).\n" +
        `Confira se o servidor está rodando em ${API_URL} ` +
        "(cd servidor; node servidor.js) e se existe um alunos.json na " +
        "pasta do servidor.js.",
      erro
    );
  } finally {
    // avisa as telas que a lista de alunos (re)carregou
    window.dispatchEvent(new CustomEvent("alunos:carregados"));
  }

  return ALUNOS;
}

// garante que a lista já foi lida antes de responder (usado no login
// do aluno e no seletor da tela de nova ocorrência)
function garantirAlunosCarregados() {
  if (alunosProntos) return Promise.resolve(ALUNOS);
  if (!promessaAlunos) {
    promessaAlunos = carregarAlunosDoServidor().then((lista) => {
      // se deu erro, libera para tentar de novo no próximo pedido
      if (!alunosProntos) promessaAlunos = null;
      return lista;
    });
  }
  return promessaAlunos;
}

/* ---------------------------------------------------------------------
   AVISO DE MUDANÇAS ("tempo real")
   ---------------------------------------------------------------------
   Antes, quem dava a sensação de tempo real era o localStorage: um
   evento "storage" avisava as OUTRAS ABAS do MESMO navegador. Isso
   não servia para o uso de verdade (celular do professor x computador
   da secretaria), porque cada aparelho tinha o seu próprio banco.

   Agora quem faz esse papel é uma consulta periódica ao servidor: de
   tempos em tempos o site pergunta as duas listas; se algo mudou,
   dispara os MESMOS eventos que as telas já escutavam
   ("ocorrencias:mudou" e "entradas-atrasadas:mudou"). Assim a
   ocorrência lançada no celular do professor aparece sozinha no
   painel da secretaria, em outro computador.

   A consulta só liga quando alguma tela realmente escuta (aoMudar /
   aoMudarEntradasAtrasadas), para não ficar batendo no servidor sem
   necessidade.
   --------------------------------------------------------------------- */
const ouvintesOcorrencias = new Set();
const ouvintesAtrasos = new Set();
let monitorLigado = false;
let assinaturaOcorrencias = null;   // "impressão digital" da última lista vista
let assinaturaAtrasos = null;

// resume a lista em id + status: se isso não mudou, nada de importante
// mudou (é o suficiente para saber que chegou registro novo ou que
// alguém marcou um status em outro aparelho)
function assinaturaDaLista(lista) {
  return JSON.stringify(lista.map((item) => [item.id, item.status]));
}

// avisa as telas agora (usado logo depois de gravar algo no servidor)
function avisarOcorrencias() {
  assinaturaOcorrencias = null; // a próxima verificação só registra a nova lista
  window.dispatchEvent(new CustomEvent("ocorrencias:mudou"));
}

function avisarAtrasos() {
  assinaturaAtrasos = null;
  window.dispatchEvent(new CustomEvent("entradas-atrasadas:mudou"));
}

async function verificarMudancas() {
  if (ouvintesOcorrencias.size) {
    try {
      const lista = await requisitar("/ocorrencias");
      const assinatura = assinaturaDaLista(lista);
      if (assinaturaOcorrencias !== null && assinatura !== assinaturaOcorrencias) {
        window.dispatchEvent(new CustomEvent("ocorrencias:mudou"));
      }
      assinaturaOcorrencias = assinatura;
    } catch {
      // servidor fora do ar / oscilou: tenta de novo no próximo ciclo
    }
  }

  if (ouvintesAtrasos.size) {
    try {
      const lista = await requisitar("/atrasos");
      const assinatura = assinaturaDaLista(lista);
      if (assinaturaAtrasos !== null && assinatura !== assinaturaAtrasos) {
        window.dispatchEvent(new CustomEvent("entradas-atrasadas:mudou"));
      }
      assinaturaAtrasos = assinatura;
    } catch {
      // idem acima
    }
  }
}

function ligarMonitoramento() {
  if (monitorLigado) return;
  monitorLigado = true;
  verificarMudancas();
  setInterval(verificarMudancas, INTERVALO_ATUALIZACAO);
}

/* =====================================================================
   OBJETO Dados — a "API" usada pelas telas
   =====================================================================
   Os nomes das funções continuam IDÊNTICOS aos de antes; o que mudou
   é que agora cada uma conversa com o servidor:
     - as funções marcadas com async devolvem Promise (chame com await)
     - o que era gravado só neste navegador agora é gravado no banco
       do servidor, e por isso aparece em todos os aparelhos
   ===================================================================== */
const Dados = {
  // endereço do servidor (útil para conferir no console do navegador)
  API_URL,

  /* ---------------------------------------------------------------
     LOGIN — conferido no servidor (as rotas POST /login/...).
     Devolvem o usuário logado ou null quando os dados não batem
     (o servidor responde 401). Se o servidor estiver fora do ar, a
     função lança um erro com a explicação, e a tela mostra a
     mensagem para o usuário.
     --------------------------------------------------------------- */
  async autenticarProfessor(matricula, pin) {
    return autenticar("/login/professor", { matricula, pin });
  },

  async autenticarSecretaria(usuario, senha) {
    return autenticar("/login/secretaria", { usuario, senha });
  },

  /* ---------------------------------------------------------------
     ALUNOS — tudo vem da rota GET /alunos (ver
     carregarAlunosDoServidor, acima). O acesso do aluno é feito pelo
     RA + senha fixa e é conferido pelo SERVIDOR (POST /login/aluno):
     o RA precisa existir na lista de alunos dele e a senha precisa
     ser exatamente "@Coronel2026". Nome, sala e turno são
     identificados automaticamente a partir dessa lista.
     RA inexistente ou senha errada = login negado (null).
     --------------------------------------------------------------- */
  async autenticarAluno(ra, senha) {
    const raDigitado = comoTexto(ra);
    if (!raDigitado) return null;
    // a senha vai como digitada (sem cortar espaços), igual a antes:
    // quem decide se está certa é o servidor
    return autenticar("/login/aluno", { ra: raDigitado, senha: String(senha ?? "") });
  },

  // força uma nova leitura da lista de alunos no servidor (a lista é
  // lida sozinha na abertura do sistema; isto serve para recarregar
  // sem fechar a página)
  async carregarAlunos() {
    alunosProntos = false;
    promessaAlunos = null;
    return garantirAlunosCarregados();
  },

  // true quando a lista de alunos foi lida com sucesso do servidor
  alunosCarregados() {
    return alunosProntos;
  },

  // problemas de validação encontrados na lista de alunos (RA vazio,
  // RA duplicado, nome/sala/turno vazios)
  problemasAlunos() {
    return problemasDosAlunos.slice();
  },

  // lista todos os alunos válidos vindos do servidor
  listarAlunos() {
    return ALUNOS.slice();
  },

  // ---- consultas usadas pelo seletor em 3 etapas da tela de
  //      nova ocorrência (turno -> sala -> aluno) ----
  //      Continuam síncronas de propósito: leem a lista que já está
  //      na memória (ALUNOS), sem esperar o servidor a cada clique.

  // lista os turnos que possuem alunos, em ordem alfabética
  listarTurnos() {
    return [...new Set(ALUNOS.map((a) => a.turno).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
  },

  // lista as salas de um turno (sem repetir)
  listarSalas(turno) {
    return [...new Set(ALUNOS.filter((a) => a.turno === turno).map((a) => a.sala))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  },

  // lista os alunos de uma sala de um turno, em ordem alfabética
  listarAlunosPorSala(turno, sala) {
    return ALUNOS
      .filter((a) => a.turno === turno && a.sala === sala)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  },

  // usado para identificar o aluno pelo RA (nome, sala e turno vêm da
  // lista do servidor) e para preencher os campos automaticamente
  buscarAlunoPorRa(ra) {
    const raBuscado = comoTexto(ra);
    if (!raBuscado) return null;
    return ALUNOS.find((a) => a.ra === raBuscado) || null;
  },

  /* ---------------------------------------------------------------
     OCORRÊNCIAS — tudo no servidor (/ocorrencias)
     --------------------------------------------------------------- */
  // grava uma ocorrência nova (POST /ocorrencias) e devolve o registro
  // criado, já com id, status "NOVA" e as datas (quem gera é o servidor)
  async criarOcorrencia({ professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes }) {
    const nova = await requisitar("/ocorrencias", {
      metodo: "POST",
      corpo: {
        professorId,
        professorNome,
        alunoNome,
        alunoRa,
        turma: turma || null,
        tipo,
        gravidade,
        detalhes: detalhes || "",
      },
    });
    // avisa as telas desta aba na hora (as outras são avisadas pelo
    // monitor, no próximo ciclo de verificação)
    avisarOcorrencias();
    return nova;
  },

  // lista as ocorrências do servidor (GET /ocorrencias), na ordem que
  // ele devolve: mais recentes primeiro
  async listarOcorrencias({ apenasAbertas } = {}) {
    const lista = await requisitar("/ocorrencias");
    if (!apenasAbertas) return lista;
    return lista.filter((o) => o.status !== "RESOLVIDA");
  },

  // muda o status de uma ocorrência (PATCH /ocorrencias/:id)
  async atualizarStatus(id, novoStatus) {
    const item = await requisitar(`/ocorrencias/${encodeURIComponent(id)}`, {
      metodo: "PATCH",
      corpo: { status: novoStatus },
    });
    avisarOcorrencias();
    return item;
  },

  // chama o callback toda vez que os dados mudarem. Antes isso vinha do
  // evento "storage" do localStorage (que só funcionava entre abas do
  // MESMO navegador); agora quem avisa é a consulta periódica ao
  // servidor (ver verificarMudancas, acima), então funciona também
  // entre aparelhos diferentes — que é o caso de verdade do sistema.
  aoMudar(callback) {
    ouvintesOcorrencias.add(callback);
    window.addEventListener("ocorrencias:mudou", callback);
    ligarMonitoramento();
  },

  /* ---------------------------------------------------------------
     ENTRADAS ATRASADAS — tudo no servidor (/atrasos)
     --------------------------------------------------------------- */
  // registra uma entrada atrasada nova (POST /atrasos) e devolve o
  // registro criado, já com id, status "NOVA" e as datas
  async criarEntradaAtrasada({ alunoId, alunoNome, alunoRa, turma, motivo }) {
    const nova = await requisitar("/atrasos", {
      metodo: "POST",
      corpo: {
        alunoId,
        alunoNome,
        alunoRa,
        turma: turma || null,
        motivo,
      },
    });
    avisarAtrasos();
    return nova;
  },

  // lista as entradas atrasadas do servidor (GET /atrasos), mais
  // recentes primeiro
  async listarEntradasAtrasadas({ apenasAbertas } = {}) {
    const lista = await requisitar("/atrasos");
    if (!apenasAbertas) return lista;
    return lista.filter((e) => e.status !== "RESOLVIDA");
  },

  // muda o status de uma entrada atrasada (PATCH /atrasos/:id)
  async atualizarStatusEntradaAtrasada(id, novoStatus) {
    const item = await requisitar(`/atrasos/${encodeURIComponent(id)}`, {
      metodo: "PATCH",
      corpo: { status: novoStatus },
    });
    avisarAtrasos();
    return item;
  },

  // igual ao aoMudar acima, mas para a fila de entradas atrasadas
  aoMudarEntradasAtrasadas(callback) {
    ouvintesAtrasos.add(callback);
    window.addEventListener("entradas-atrasadas:mudou", callback);
    ligarMonitoramento();
  },
};

// lê a lista de alunos no servidor assim que o sistema abre (é a única
// fonte de dados dos alunos). O login do aluno e o seletor da tela de
// nova ocorrência esperam essa leitura terminar.
garantirAlunosCarregados();