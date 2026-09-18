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

// ---- alunos de teste (fixos no código por enquanto) ----
// "turno" foi adicionado para alimentar o seletor em 3 etapas
// (turno -> sala/turma -> aluno) da tela de nova ocorrência do professor
const ALUNOS = [
  { id: "a1", nome: "Beatriz Rocha", ra: "2001", senha: "1234", turma: "9º B", turno: "Manhã", tipo: "ALUNO" },
  { id: "a2", nome: "Lucas Prado", ra: "2002", senha: "4321", turma: "8º A", turno: "Tarde", tipo: "ALUNO" },
];

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

  autenticarAluno(ra, senha) {
    return ALUNOS.find((a) => a.ra === ra && a.senha === senha) || null;
  },

  // ---- consultas usadas pelo seletor em 3 etapas da tela de
  //      nova ocorrência (turno -> sala/turma -> aluno) ----

  // lista os turnos que possuem alunos, em ordem alfabética
  listarTurnos() {
    return [...new Set(ALUNOS.map((a) => a.turno).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );
  },

  // lista as salas/turmas de um turno (sem repetir)
  listarSalas(turno) {
    return [...new Set(ALUNOS.filter((a) => a.turno === turno).map((a) => a.turma))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
  },

  // lista os alunos de uma sala/turma de um turno, em ordem alfabética
  listarAlunosPorSala(turno, turma) {
    return ALUNOS
      .filter((a) => a.turno === turno && a.turma === turma)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  },

  // usado pelo seletor para preencher automaticamente nome/RA/turma
  buscarAlunoPorRa(ra) {
    return ALUNOS.find((a) => a.ra === ra) || null;
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
