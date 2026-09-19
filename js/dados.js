/* =====================================================================
   CAMADA DE DADOS (SIMULADA)
   ---------------------------------------------------------------------
   AVISO IMPORTANTE:
   Isso NÃO é um banco de dados de verdade. É só o localStorage do
   navegador, então:
     - só funciona DENTRO DO MESMO NAVEGADOR/computador
     - o celular do professor e o computador da secretaria NÃO veem
       os dados um do outro (cada aparelho tem seu próprio localStorage)
     - se limpar os dados do navegador, perde tudo

   Isso serve pra você testar o fluxo completo sozinho, no mesmo
   computador, abrindo abas diferentes.

   Para funcionar de verdade entre aparelhos diferentes, os dados
   precisam morar num servidor compartilhado (backend + banco real).
   Todas as funções abaixo foram escritas com nomes e formatos que
   IMITAM uma API, então quando o backend existir, basta trocar o
   "corpo" de cada função por uma chamada fetch(...) — o resto do
   site (as telas) não precisa mudar nada.
   ===================================================================== */

const CHAVE_OCORRENCIAS = "livro-ocorrencias:dados";
const CHAVE_ENTRADAS_ATRASADAS = "livro-ocorrencias:entradas-atrasadas";

// ---- usuários de teste (fixos no código por enquanto) ----
const USUARIOS = [
  { id: "p1", nome: "Ana Souza", matricula: "1001", pin: "1234", tipo: "PROFESSOR" },
  { id: "p2", nome: "Carlos Lima", matricula: "1002", pin: "5678", tipo: "PROFESSOR" },
  { id: "s1", nome: "Secretaria Central", usuario: "secretaria", senha: "1234", tipo: "SECRETARIA" },
];

/* ---------------------------------------------------------------------
   ALUNOS — TODOS ficam em UM ÚNICO arquivo: alunos.json
   ---------------------------------------------------------------------
   O arquivo alunos.json fica na raiz do projeto (do lado do
   index.html) e é a ÚNICA fonte de dados dos alunos: nenhum aluno
   fica fixo aqui no código.

   Cada aluno do alunos.json tem exatamente estes campos:

     {
       "RA":    "2001",            <- não pode ficar vazio nem repetir
       "nome":  "Beatriz Rocha",   <- não pode ficar vazio
       "sala":  "9º B",            <- não pode ficar vazio
       "turno": "Manhã"            <- não pode ficar vazio
     }

   Para adicionar, remover ou corrigir um aluno, edite SOMENTE o
   alunos.json — o sistema lê o arquivo sozinho, sem precisar mexer
   no código. As validações pedidas (RA vazio/duplicado, nome vazio,
   sala vazia e turno vazio) estão em validarAlunos() logo abaixo.
   --------------------------------------------------------------------- */
const ARQUIVO_ALUNOS = "alunos.json";

// senha fixa de TODOS os alunos (a mesma para todos; o login do aluno
// exige o RA existente no alunos.json + esta senha exata)
const SENHA_ALUNOS = "@Coronel2026";

let ALUNOS = [];              // lista já validada, vinda do alunos.json
let alunosProntos = false;    // true quando o arquivo foi lido sem erro
let problemasDosAlunos = [];  // problemas de validação encontrados no arquivo
let promessaAlunos = null;    // controla a leitura (evita ler o arquivo 2x)

// devolve o valor como texto, sem espaços nas pontas ("" se não for texto)
function comoTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

// aplica as validações em cada aluno lido do arquivo:
//   - RA não pode ficar vazio e não pode repetir
//   - nome, sala e turno não podem ficar vazios
// Alunos inválidos são IGNORADOS e o motivo é registrado em
// problemasDosAlunos (também aparece no console do navegador).
function validarAlunos(listaBruta) {
  const validos = [];
  const problemas = [];
  const rasJaVistos = new Set();

  listaBruta.forEach((item, indice) => {
    const onde = `alunos.json (aluno nº ${indice + 1})`;

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

// converte o aluno lido do arquivo para o formato usado pelas telas
// e pela sessão (o RA vira o "id" do aluno: id = "aluno-2001")
function montarAluno(alunoDoArquivo) {
  return {
    id: "aluno-" + alunoDoArquivo.RA,
    tipo: "ALUNO",
    ra: alunoDoArquivo.RA,
    nome: alunoDoArquivo.nome,
    sala: alunoDoArquivo.sala,
    turno: alunoDoArquivo.turno,
    // "turma" guarda o mesmo valor de "sala": as ocorrências, o painel e
    // a tela de nova ocorrência já usavam o nome "turma" para esse campo.
    turma: alunoDoArquivo.sala,
  };
}

// lê o alunos.json de verdade. Se o arquivo não existir (ou o navegador
// não deixar ler), dispara um erro claro no console e a lista fica vazia.
//
// Tenta de várias formas, na ordem:
//   1. fetch() nos caminhos mais prováveis (relativo à página e à raiz) —
//      cobre Live Server, GitHub Pages, python -m http.server etc.;
//   2. XMLHttpRequest() — alguns navegadores (ex.: Firefox) permitem
//      ler arquivos da mesma pasta pelo XHR mesmo em file://.
// Se nada funcionar (ex.: Chrome abrindo direto pelo disco), o erro
// explica exatamente o que fazer.
async function carregarAlunosDoArquivo() {
  const caminhos = [
    ARQUIVO_ALUNOS,
    "./" + ARQUIVO_ALUNOS,
    new URL(ARQUIVO_ALUNOS, window.location.href).href, // caminho absoluto na mesma pasta do index.html
  ];

  let ultimoErro = null;
  let conteudo = null;

  for (const caminho of caminhos) {
    // ---- tentativa 1: fetch (funciona em qualquer servidor HTTP) ----
    try {
      const resposta = await fetch(caminho, { cache: "no-store" });
      if (!resposta.ok) throw new Error(`o servidor respondeu ${resposta.status}`);
      conteudo = await resposta.json();
      break;
    } catch (erro) {
      ultimoErro = erro;
    }

    // ---- tentativa 2: XMLHttpRequest (alguns navegadores permitem
    //      ler a pasta do projeto pelo XHR mesmo com a página aberta
    //      direto do disco, via file://) ----
    try {
      const texto = await new Promise((resolver, falhar) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", caminho, true);
        xhr.overrideMimeType("application/json");
        xhr.onload = () =>
          xhr.status === 0 || xhr.status === 200
            ? resolver(xhr.responseText)
            : falhar(new Error(`XHR respondeu ${xhr.status}`));
        xhr.onerror = () => falhar(new Error("XHR bloqueado pelo navegador"));
        xhr.send();
      });
      conteudo = JSON.parse(texto);
      break;
    } catch (erro) {
      ultimoErro = erro;
    }
  }

  try {
    if (conteudo === null) {
      throw ultimoErro || new Error("arquivo não encontrado");
    }
    if (!Array.isArray(conteudo)) {
      throw new Error("o conteúdo precisa ser uma lista (array) de alunos");
    }

    const { validos, problemas } = validarAlunos(conteudo);
    ALUNOS = validos.map(montarAluno);
    problemasDosAlunos = problemas;
    alunosProntos = true;

    if (problemas.length) {
      console.warn(
        `alunos.json: ${problemas.length} problema(s) encontrado(s):\n- ` +
          problemas.join("\n- ")
      );
    }
  } catch (erro) {
    ALUNOS = [];
    problemasDosAlunos = [];
    alunosProntos = false;
    console.error(
      "Não foi possível ler o arquivo alunos.json.\n" +
        "Confira se o arquivo existe na MESMA pasta do index.html.\n" +
        (window.location.protocol === "file:"
          ? "A página está aberta direto do disco (file://) e o navegador " +
            "bloqueia a leitura de arquivos locais. Abra o sistema por um " +
            "servidor para o login funcionar: extensão Live Server do VS " +
            "Code, \"python -m http.server\" nesta pasta, ou GitHub Pages."
          : "Se estiver usando um servidor, confira se ele serve a pasta do projeto."),
      erro
    );
  } finally {
    // avisa as telas que a lista de alunos (re)carregou
    window.dispatchEvent(new CustomEvent("alunos:carregados"));
  }

  return ALUNOS;
}

// garante que o arquivo já foi lido antes de responder (usado no login)
function garantirAlunosCarregados() {
  if (alunosProntos) return Promise.resolve(ALUNOS);
  if (!promessaAlunos) {
    promessaAlunos = carregarAlunosDoArquivo().then((lista) => {
      // se deu erro, libera para tentar de novo no próximo login
      if (!alunosProntos) promessaAlunos = null;
      return lista;
    });
  }
  return promessaAlunos;
}

function lerOcorrencias() {
  try {
    const bruto = localStorage.getItem(CHAVE_OCORRENCIAS);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

function salvarOcorrencias(lista) {
  localStorage.setItem(CHAVE_OCORRENCIAS, JSON.stringify(lista));
  // dispara um evento próprio (além do "storage" nativo) pra atualizar
  // a mesma aba que acabou de salvar, sem precisar recarregar a página
  window.dispatchEvent(new CustomEvent("ocorrencias:mudou"));
}

function lerEntradasAtrasadas() {
  try {
    const bruto = localStorage.getItem(CHAVE_ENTRADAS_ATRASADAS);
    return bruto ? JSON.parse(bruto) : [];
  } catch {
    return [];
  }
}

function salvarEntradasAtrasadas(lista) {
  localStorage.setItem(CHAVE_ENTRADAS_ATRASADAS, JSON.stringify(lista));
  // mesmo esquema do "ocorrencias:mudou": evento próprio pra esta aba +
  // evento nativo "storage" pra outras abas do mesmo navegador
  window.dispatchEvent(new CustomEvent("entradas-atrasadas:mudou"));
}

const Dados = {
  autenticarProfessor(matricula, pin) {
    return USUARIOS.find(
      (u) => u.tipo === "PROFESSOR" && u.matricula === matricula && u.pin === pin
    ) || null;
  },

  autenticarSecretaria(usuario, senha) {
    return USUARIOS.find(
      (u) => u.tipo === "SECRETARIA" && u.usuario === usuario && u.senha === senha
    ) || null;
  },

  /* ---------------------------------------------------------------
     ALUNOS — tudo vem do alunos.json (ver carregarAlunosDoArquivo)
     O acesso do aluno é feito pelo RA + senha fixa: o RA precisa
     existir no alunos.json e a senha precisa ser exatamente
     "@Coronel2026" (SENHA_ALUNOS, no topo deste arquivo). Nome, sala
     e turno são identificados automaticamente a partir do alunos.json.
     RA inexistente ou senha errada = login negado.
     --------------------------------------------------------------- */
  async autenticarAluno(ra, senha) {
    const raDigitado = comoTexto(ra);
    if (!raDigitado) return null;
    // senha precisa ser EXATAMENTE igual (sem cortar espaços): "@Coronel2026"
    if (String(senha ?? "") !== SENHA_ALUNOS) return null;

    await garantirAlunosCarregados();

    const aluno = ALUNOS.find((a) => a.ra === raDigitado);
    return aluno ? { ...aluno } : null;
  },

  // força uma nova leitura do alunos.json (a lista é lida sozinha na
  // abertura do sistema; isto serve para recarregar sem fechar a página)
  carregarAlunos() {
    alunosProntos = false;
    promessaAlunos = null;
    return garantirAlunosCarregados();
  },

  // true quando o alunos.json foi lido com sucesso
  alunosCarregados() {
    return alunosProntos;
  },

  // problemas de validação encontrados no alunos.json (RA vazio,
  // RA duplicado, nome/sala/turno vazios)
  problemasAlunos() {
    return problemasDosAlunos.slice();
  },

  // lista todos os alunos válidos do alunos.json
  listarAlunos() {
    return ALUNOS.slice();
  },

  // ---- consultas usadas pelo seletor em 3 etapas da tela de
  //      nova ocorrência (turno -> sala -> aluno) ----
  //      Todas leem exclusivamente a lista vinda do alunos.json.

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

  // usado para identificar o aluno pelo RA (nome, sala e turno vêm do
  // alunos.json) e para preencher os campos automaticamente
  buscarAlunoPorRa(ra) {
    const raBuscado = comoTexto(ra);
    if (!raBuscado) return null;
    return ALUNOS.find((a) => a.ra === raBuscado) || null;
  },

  criarOcorrencia({ professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes }) {
    const lista = lerOcorrencias();
    const nova = {
      id: String(Date.now()) + Math.floor(Math.random() * 1000),
      professorId,
      professorNome,
      alunoNome,
      alunoRa,
      turma: turma || null,
      tipo,
      gravidade,
      detalhes: detalhes || "",
      status: "NOVA",
      criadaEm: new Date().toISOString(),
      atualizadaEm: new Date().toISOString(),
    };
    lista.unshift(nova);
    salvarOcorrencias(lista);
    return nova;
  },

  listarOcorrencias({ apenasAbertas } = {}) {
    const lista = lerOcorrencias();
    if (!apenasAbertas) return lista;
    return lista.filter((o) => o.status !== "RESOLVIDA");
  },

  atualizarStatus(id, novoStatus) {
    const lista = lerOcorrencias();
    const item = lista.find((o) => o.id === id);
    if (!item) return null;
    item.status = novoStatus;
    item.atualizadaEm = new Date().toISOString();
    salvarOcorrencias(lista);
    return item;
  },

  // chama callback toda vez que os dados mudarem — seja nesta aba
  // (evento customizado) ou em outra aba do MESMO navegador (evento
  // nativo "storage"). Isso é o que dá a sensação de "tempo real"
  // sem precisar de servidor - mas repare que só funciona entre
  // abas do mesmo navegador, não entre aparelhos diferentes.
  aoMudar(callback) {
    window.addEventListener("ocorrencias:mudou", callback);
    window.addEventListener("storage", (e) => {
      if (e.key === CHAVE_OCORRENCIAS) callback();
    });
  },

  criarEntradaAtrasada({ alunoId, alunoNome, alunoRa, turma, motivo }) {
    const lista = lerEntradasAtrasadas();
    const nova = {
      id: String(Date.now()) + Math.floor(Math.random() * 1000),
      alunoId,
      alunoNome,
      alunoRa,
      turma: turma || null,
      motivo,
      status: "NOVA",
      criadaEm: new Date().toISOString(),
      atualizadaEm: new Date().toISOString(),
    };
    lista.unshift(nova);
    salvarEntradasAtrasadas(lista);
    return nova;
  },

  listarEntradasAtrasadas({ apenasAbertas } = {}) {
    const lista = lerEntradasAtrasadas();
    if (!apenasAbertas) return lista;
    return lista.filter((e) => e.status !== "RESOLVIDA");
  },

  atualizarStatusEntradaAtrasada(id, novoStatus) {
    const lista = lerEntradasAtrasadas();
    const item = lista.find((e) => e.id === id);
    if (!item) return null;
    item.status = novoStatus;
    item.atualizadaEm = new Date().toISOString();
    salvarEntradasAtrasadas(lista);
    return item;
  },

  // igual ao aoMudar acima, mas pra fila de entradas atrasadas
  aoMudarEntradasAtrasadas(callback) {
    window.addEventListener("entradas-atrasadas:mudou", callback);
    window.addEventListener("storage", (e) => {
      if (e.key === CHAVE_ENTRADAS_ATRASADAS) callback();
    });
  },
};

// lê o alunos.json assim que o sistema abre (é a única fonte de dados
// dos alunos). O login do aluno espera essa leitura terminar.
garantirAlunosCarregados();
