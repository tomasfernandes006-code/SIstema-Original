/* =====================================================================
   ROTEADOR — troca de tela dentro do arquivo central (index.html)
   ---------------------------------------------------------------------
   Antes cada tela era um arquivo .html separado (index.html,
   professor.html, nova-ocorrencia.html, etc.) e a navegação era feita
   trocando de página (window.location.href = "...").

   Agora todas as telas vivem dentro de index.html, como blocos
   <div class="view" id="view-NOME">. Este arquivo decide qual bloco
   fica visível a cada momento — e, o mais importante, aplica as
   MESMAS regras de acesso de antes: só é possível ver a tela de
   "nova ocorrência" se estiver logado como PROFESSOR, e só é
   possível ver "entrada atrasada" se estiver logado como ALUNO, e
   só é possível ver o "painel" se estiver logado como SECRETARIA.
   Se não estiver logado com o perfil certo, cai automaticamente na
   tela de login correspondente — exatamente como as páginas antigas
   faziam ao checar `Sessao.obter()` e redirecionar.
   ===================================================================== */

const VIEWS = {
  "index": {},
  "professor-login": {},
  "aluno-login": {},
  "secretaria-login": {},

  // só entra aqui se Sessao.obter().tipo === "PROFESSOR";
  // caso contrário, é mandado para a tela de login do professor
  "nova-ocorrencia": {
    guard: () => Sessao.obter()?.tipo === "PROFESSOR",
    guardRedirect: "professor-login",
    aoEntrar: () => prepararNovaOcorrencia(),
  },

  // só entra aqui se Sessao.obter().tipo === "ALUNO";
  // caso contrário, é mandado para a tela de login do aluno
  "entrada-atrasada": {
    guard: () => Sessao.obter()?.tipo === "ALUNO",
    guardRedirect: "aluno-login",
    aoEntrar: () => prepararEntradaAtrasada(),
  },

  // só entra aqui se Sessao.obter().tipo === "SECRETARIA";
  // caso contrário, é mandado para a tela de login da secretaria
  "painel": {
    guard: () => Sessao.obter()?.tipo === "SECRETARIA",
    guardRedirect: "secretaria-login",
  },

  "qrcode": {
    aoEntrar: () => prepararQrCode(),
  },
};

function showView(id) {
  const cfg = VIEWS[id];
  if (cfg && cfg.guard && !cfg.guard()) {
    id = cfg.guardRedirect;
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("ativo"));
  document.getElementById("view-" + id).classList.add("ativo");
  window.scrollTo(0, 0);
  const cfgFinal = VIEWS[id];
  if (cfgFinal && cfgFinal.aoEntrar) cfgFinal.aoEntrar();
}

/* =====================================================================
   TELA: LOGIN PROFESSOR (era professor.html)
   ===================================================================== */
(function () {
  const form = document.getElementById("pl-form-login");
  const mensagemErro = document.getElementById("pl-mensagem-erro");

  // o login é conferido no professores.json a cada tentativa, então
  // o envio do formulário precisa esperar a resposta (async / await)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ra = document.getElementById("pl-ra").value.trim();
    const senha = document.getElementById("pl-senha").value;

    if (!ra) {
      mensagemErro.textContent = "Informe o seu RA";
      mensagemErro.style.display = "block";
      return;
    }

    let professor;
    try {
      professor = await Dados.autenticarProfessor(ra, senha);
    } catch (erro) {
      // servidor fora do ar / endereço errado (não é senha errada)
      mensagemErro.textContent = erro.message;
      mensagemErro.style.display = "block";
      return;
    }

    if (!professor) {
      mensagemErro.textContent = Dados.professoresCarregados()
        ? "RA não encontrado ou senha incorreta."
        : "Não foi possível carregar a lista de professores (professores.json).";
      mensagemErro.style.display = "block";
      return;
    }

    mensagemErro.style.display = "none";
    Sessao.salvar(professor);
    // só depois de logar como professor é que a tela de nova
    // ocorrência é liberada (ver "guard" em VIEWS acima)
    showView("nova-ocorrencia");
  });
})();

/* =====================================================================
   TELA: LOGIN ALUNO (era aluno.html)
   ===================================================================== */
(function () {
  const form = document.getElementById("al-form-login");
  const mensagemErro = document.getElementById("al-mensagem-erro");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // O acesso do aluno é conferido no SERVIDOR (POST /login/aluno): o
    // RA precisa existir na lista de alunos do servidor (que devolve
    // sozinho o nome, a sala e o turno) e a senha precisa ser
    // exatamente "@Coronel2026".
    // RA inexistente ou senha errada = login bloqueado.
    const ra = document.getElementById("al-ra").value.trim();
    const senha = document.getElementById("al-senha").value;

    if (!ra) {
      mensagemErro.textContent = "Informe o seu RA";
      mensagemErro.style.display = "block";
      return;
    }

    let aluno;
    try {
      aluno = await Dados.autenticarAluno(ra, senha);
    } catch (erro) {
      // servidor fora do ar / endereço errado (não é RA/senha errados)
      mensagemErro.textContent = erro.message;
      mensagemErro.style.display = "block";
      return;
    }

    if (!aluno) {
      mensagemErro.textContent = Dados.alunosCarregados()
        ? "RA não encontrado ou senha incorreta."
        : "Não foi possível carregar a lista de alunos (GET /alunos).";
      mensagemErro.style.display = "block";
      return;
    }

    mensagemErro.style.display = "none";
    Sessao.salvar(aluno);
    // só depois de logar como aluno é que a tela de entrada
    // atrasada é liberada (ver "guard" em VIEWS acima)
    showView("entrada-atrasada");
  });
})();

/* =====================================================================
   TELA: LOGIN SECRETARIA (era secretaria.html)
   ===================================================================== */
(function () {
  const form = document.getElementById("sl-form-login");
  const mensagemErro = document.getElementById("sl-mensagem-erro");

  // o login agora é conferido no SERVIDOR (POST /login/secretaria), então
  // o envio do formulário precisa esperar a resposta (async / await)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = document.getElementById("sl-usuario").value.trim();
    const senha = document.getElementById("sl-senha").value.trim();

    let conta;
    try {
      conta = await Dados.autenticarSecretaria(usuario, senha);
    } catch (erro) {
      // servidor fora do ar / endereço errado (não é usuário/senha errados)
      mensagemErro.textContent = erro.message;
      mensagemErro.style.display = "block";
      return;
    }

    if (!conta) {
      mensagemErro.textContent = "Usuário ou senha inválidos";
      mensagemErro.style.display = "block";
      return;
    }

    mensagemErro.style.display = "none";
    Sessao.salvar(conta);
    // só depois de logar como secretaria é que o painel é
    // liberado (ver "guard" em VIEWS acima)
    showView("painel");
  });
})();

/* =====================================================================
   TELA: NOVA OCORRÊNCIA (era nova-ocorrencia.html)
   — só é alcançável depois do login de professor, ver VIEWS.guard
   ===================================================================== */
function prepararNovaOcorrencia() {
  const sessao = Sessao.obter();
  document.getElementById("oc-nome-professor").textContent = `Prof(a). ${sessao.nome}`;
  // recomeça o seletor em 3 etapas (turno -> sala -> aluno) do zero
  // toda vez que a tela é aberta
  if (window.prepararSeletorAlunos) window.prepararSeletorAlunos();
  // relê a lista de alunos no servidor (GET /alunos): quando ela chegar,
  // o evento "alunos:carregados" (lá embaixo) remonta o seletor
  Dados.carregarAlunos();
}

(function () {
  document.getElementById("oc-botao-sair").addEventListener("click", () => {
    Sessao.encerrar();
    showView("index");
  });

  let tipoSelecionado = "INDISCIPLINA";
  let gravidadeSelecionada = "LEVE";

  document.querySelectorAll("#oc-pastilhas-tipo .pastilha").forEach((botao) => {
    botao.addEventListener("click", () => {
      document.querySelectorAll("#oc-pastilhas-tipo .pastilha").forEach((b) => b.classList.remove("ativa"));
      botao.classList.add("ativa");
      tipoSelecionado = botao.dataset.tipo;
    });
  });

  document.querySelectorAll("#oc-opcoes-gravidade .gravidade-btn").forEach((botao) => {
    botao.addEventListener("click", () => {
      document.querySelectorAll("#oc-opcoes-gravidade .gravidade-btn").forEach((b) => b.classList.remove("ativa"));
      botao.classList.add("ativa");
      gravidadeSelecionada = botao.dataset.gravidade;
    });
  });

  /* ---------------------------------------------------------------
     SELETOR DO ALUNO EM 3 ETAPAS (turno -> sala/turma -> aluno)
     O professor não digita mais nome nem RA: escolhe o turno,
     depois a sala daquele turno e, por fim, o aluno daquela sala.
     Ao escolher o aluno, nome/RA/turma são preenchidos sozinhos e
     ficam bloqueados para edição.
     --------------------------------------------------------------- */
  const seletorTurno = document.getElementById("oc-turno");
  const seletorSala = document.getElementById("oc-sala");
  const seletorAluno = document.getElementById("oc-aluno");
  const campoAlunoNome = document.getElementById("oc-aluno-nome");
  const campoAlunoRa = document.getElementById("oc-aluno-ra");
  const campoTurma = document.getElementById("oc-turma");

  const TEXTO_TURNO_VAZIO = "Selecione o turno";
  const TEXTO_SALA_VAZIA = "Escolha o turno primeiro";
  const TEXTO_ALUNO_VAZIO = "Escolha a sala primeiro";

  // troca as <option> de um <select>, sempre começando por uma vazia
  function preencherOpcoes(select, textoVazio, opcoes) {
    select.innerHTML = "";
    const vazia = document.createElement("option");
    vazia.value = "";
    vazia.textContent = textoVazio;
    select.appendChild(vazia);
    opcoes.forEach(({ valor, texto }) => {
      const opcao = document.createElement("option");
      opcao.value = valor;
      opcao.textContent = texto;
      select.appendChild(opcao);
    });
  }

  // limpa os campos que são preenchidos automaticamente
  function limparAlunoEscolhido() {
    campoAlunoNome.value = "";
    campoAlunoRa.value = "";
    campoTurma.value = "";
  }

  function limparSeletorSala() {
    seletorSala.disabled = true;
    preencherOpcoes(seletorSala, TEXTO_SALA_VAZIA, []);
  }

  function limparSeletorAluno() {
    seletorAluno.disabled = true;
    preencherOpcoes(seletorAluno, TEXTO_ALUNO_VAZIO, []);
    limparAlunoEscolhido();
  }

  // volta o seletor para o estado inicial (usado ao abrir a tela e
  // depois de enviar uma ocorrência)
  function prepararSeletorAlunos() {
    preencherOpcoes(
      seletorTurno,
      TEXTO_TURNO_VAZIO,
      Dados.listarTurnos().map((turno) => ({ valor: turno, texto: turno }))
    );
    seletorTurno.value = "";
    limparSeletorSala();
    limparSeletorAluno();
  }

  // etapa 1 -> etapa 2: carrega as salas/turmas do turno escolhido
  seletorTurno.addEventListener("change", () => {
    limparSeletorAluno();

    const turno = seletorTurno.value;
    if (!turno) {
      limparSeletorSala();
      return;
    }

    const salas = Dados.listarSalas(turno);
    preencherOpcoes(
      seletorSala,
      salas.length ? "Selecione a sala / turma" : "Nenhuma sala neste turno",
      salas.map((sala) => ({ valor: sala, texto: sala }))
    );
    seletorSala.disabled = salas.length === 0;
  });

  // etapa 2 -> etapa 3: carrega os alunos da sala escolhida
  seletorSala.addEventListener("change", () => {
    limparAlunoEscolhido();
    seletorAluno.value = "";

    const sala = seletorSala.value;
    if (!sala) {
      limparSeletorAluno();
      return;
    }

    const alunos = Dados.listarAlunosPorSala(seletorTurno.value, sala);
    preencherOpcoes(
      seletorAluno,
      alunos.length ? "Selecione o aluno" : "Nenhum aluno nesta sala",
      alunos.map((aluno) => ({ valor: aluno.ra, texto: aluno.nome }))
    );
    seletorAluno.disabled = alunos.length === 0;
  });

  // etapa 3: preenche automaticamente nome, RA e turma do aluno
  seletorAluno.addEventListener("change", () => {
    const aluno = seletorAluno.value ? Dados.buscarAlunoPorRa(seletorAluno.value) : null;

    if (!aluno) {
      limparAlunoEscolhido();
      return;
    }

    campoAlunoNome.value = aluno.nome;
    campoAlunoRa.value = aluno.ra;
    campoTurma.value = aluno.sala || aluno.turma || "";
  });

  prepararSeletorAlunos();

  // exposto para prepararNovaOcorrencia() poder recomeçar o seletor
  // do zero sempre que a tela de nova ocorrência for aberta
  window.prepararSeletorAlunos = prepararSeletorAlunos;

  // quando a lista de alunos chegar do servidor (GET /alunos), se o
  // professor ainda não escolheu nada, o seletor é montado com ela
  window.addEventListener("alunos:carregados", () => {
    if (!seletorTurno.value) prepararSeletorAlunos();
  });

  const form = document.getElementById("oc-form-ocorrencia");
  const mensagemErro = document.getElementById("oc-mensagem-erro");
  const mensagemSucesso = document.getElementById("oc-mensagem-sucesso");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    mensagemErro.style.display = "none";

    const sessao = Sessao.obter();
    // o aluno vem do seletor em 3 etapas — nada é digitado à mão
    const aluno = seletorAluno.value ? Dados.buscarAlunoPorRa(seletorAluno.value) : null;
    const detalhes = document.getElementById("oc-detalhes").value.trim();

    if (!aluno) {
      mensagemErro.textContent = "Selecione o turno, a sala e o aluno";
      mensagemErro.style.display = "block";
      return;
    }

    // a ocorrência agora é gravada no SERVIDOR (POST /ocorrencias):
    // o formulário só é limpo depois que o servidor confirmar
    try {
      await Dados.criarOcorrencia({
        professorId: sessao.id,
        professorNome: sessao.nome,
        alunoNome: aluno.nome,
        alunoRa: aluno.ra,
        turma: aluno.sala || aluno.turma || "",
        tipo: tipoSelecionado,
        gravidade: gravidadeSelecionada,
        detalhes,
      });
    } catch (erro) {
      mensagemErro.textContent = erro.message;
      mensagemErro.style.display = "block";
      return;
    }

    form.reset();
    prepararSeletorAlunos();
    tipoSelecionado = "INDISCIPLINA";
    gravidadeSelecionada = "LEVE";
    document.querySelectorAll("#oc-pastilhas-tipo .pastilha").forEach((b, i) => b.classList.toggle("ativa", i === 0));
    document.querySelectorAll("#oc-opcoes-gravidade .gravidade-btn").forEach((b, i) => b.classList.toggle("ativa", i === 0));

    mensagemSucesso.style.display = "block";
    setTimeout(() => (mensagemSucesso.style.display = "none"), 3000);
    seletorTurno.focus();
  });
})();

/* =====================================================================
   TELA: ENTRADA ATRASADA (era entrada-atrasada.html)
   — só é alcançável depois do login de aluno, ver VIEWS.guard
   ===================================================================== */
function prepararEntradaAtrasada() {
  const sessao = Sessao.obter();
  document.getElementById("atr-nome-aluno").textContent = sessao.nome;
  document.getElementById("atr-aluno-nome").value = sessao.nome;
  document.getElementById("atr-aluno-ra").value = sessao.ra;

  // sala e turno vêm SEMPRE do alunos.json (identificados pelo RA no
  // login): o aluno não escolhe nem altera esses dados, só vê a sala
  const campoTurmaAtraso = document.getElementById("atr-turma");
  campoTurmaAtraso.value = sessao.sala || sessao.turma || "";
  campoTurmaAtraso.readOnly = true;
}

(function () {
  document.getElementById("atr-botao-sair").addEventListener("click", () => {
    Sessao.encerrar();
    showView("index");
  });

  const form = document.getElementById("atr-form-entrada-atrasada");
  const mensagemErro = document.getElementById("atr-mensagem-erro");
  const mensagemSucesso = document.getElementById("atr-mensagem-sucesso");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    mensagemErro.style.display = "none";

    const sessao = Sessao.obter();
    // a sala/turma NUNCA vem do que o aluno digitou: vem da lista de
    // alunos do servidor, identificada pelo RA na hora do login
    const turma = sessao.sala || sessao.turma || "";
    const motivo = document.getElementById("atr-motivo").value.trim();

    if (!motivo) {
      mensagemErro.textContent = "Conte o motivo do seu atraso";
      mensagemErro.style.display = "block";
      return;
    }

    // o atraso agora é gravado no SERVIDOR (POST /atrasos): o formulário
    // só é limpo depois que o servidor confirmar
    try {
      await Dados.criarEntradaAtrasada({
        alunoId: sessao.id,
        alunoNome: sessao.nome,
        alunoRa: sessao.ra,
        turma,
        motivo,
      });
    } catch (erro) {
      mensagemErro.textContent = erro.message;
      mensagemErro.style.display = "block";
      return;
    }

    form.reset();
    document.getElementById("atr-aluno-nome").value = sessao.nome;
    document.getElementById("atr-aluno-ra").value = sessao.ra;
    document.getElementById("atr-turma").value = sessao.sala || sessao.turma || "";

    mensagemSucesso.style.display = "block";
    setTimeout(() => (mensagemSucesso.style.display = "none"), 3000);
    document.getElementById("atr-motivo").focus();
  });
})();

/* =====================================================================
   TELA: PAINEL DA SECRETARIA (era painel.html)
   Dashboard moderno com sidebar, cards, gráficos e tabelas
   — só é alcançável depois do login de secretaria, ver VIEWS.guard
   ===================================================================== */
(function () {
  document.getElementById("pn-botao-sair").addEventListener("click", () => {
    Sessao.encerrar();
    showView("index");
  });

  const ROTULO_TIPO = {
    INDISCIPLINA: "Indisciplina",
    ATRASO: "Atraso",
    MATERIAL: "Sem material",
    SAUDE: "Saúde",
    OUTRO: "Outro",
  };

  const CORES_TIPO = {
    INDISCIPLINA: "#5B9BFF",
    ATRASO: "#E4A430",
    MATERIAL: "#34C77B",
    SAUDE: "#E5484D",
    OUTRO: "#B9C4E0",
  };

  const ESTILO_GRAVIDADE = {
    LEVE: "background: rgba(183,199,227,0.6); color:#1E2A45;",
    MODERADA: "background: rgba(217,164,65,0.75); color:#1E2A45;",
    GRAVE: "background:#B4232A; color:#fff;",
  };

  const ESTILO_STATUS = {
    NOVA: "border-color:#C1443C; color:#9C332C;",
    LIDA: "border-color:#D9A441; color:#1E2A45;",
    EM_ANDAMENTO: "border-color:#3D4A66; color:#3D4A66;",
    RESOLVIDA: "border-color:#B7C7E3; color:rgba(61,74,102,0.6);",
  };

  function formatarHora(iso) {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function formatarDataCurta(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function escapar(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
  }

  function ehMesmoDia(iso, dataRef) {
    const d = new Date(iso);
    return d.getFullYear() === dataRef.getFullYear() &&
           d.getMonth() === dataRef.getMonth() &&
           d.getDate() === dataRef.getDate();
  }

  let filtroAtual = "abertas"; // "abertas" | "todas"

  /* ---------------------------------------------------------------
     DADOS DO PAINEL
     ---------------------------------------------------------------
     Agora as listas vêm do SERVIDOR (GET /ocorrencias e GET /atrasos)
     e ficam guardadas nestas duas variáveis. Toda vez que o painel
     precisa se desenhar, primeiro ele atualiza as duas com
     carregarDados() e só depois desenha (é o que renderizar() faz).
     Assim cards, gráficos e tabelas usam sempre a mesma "foto" dos
     dados, sem disparar uma consulta por gráfico/tabela.
     --------------------------------------------------------------- */
  let ocorrenciasDoPainel = [];
  let atrasosDoPainel = [];

  async function carregarDados() {
    const [ocorrencias, atrasos] = await Promise.all([
      Dados.listarOcorrencias(),
      Dados.listarEntradasAtrasadas(),
    ]);
    ocorrenciasDoPainel = ocorrencias;
    atrasosDoPainel = atrasos;
  }

  let idsConhecidosOcorrencias = new Set();
  let idsConhecidosAtrasos = new Set();
  let primeiraRenderizacaoOcorrencias = true;
  let primeiraRenderizacaoAtrasos = true;

  /* ---------------------------------------------------------------
     NAVEGAÇÃO DA SIDEBAR
     --------------------------------------------------------------- */
  function alternarPainel(nome) {
    document.querySelectorAll(".sidebar-item[data-painel]").forEach((b) => b.classList.remove("ativo"));
    document.querySelector(`.sidebar-item[data-painel="${nome}"]`)?.classList.add("ativo");

    document.getElementById("pn-secao-dashboard").style.display = nome === "dashboard" ? "" : "none";
    document.getElementById("pn-secao-ocorrencias").style.display = nome === "ocorrencias" ? "" : "none";
    document.getElementById("pn-secao-atrasos").style.display = nome === "atrasos" ? "" : "none";
  }

  document.querySelectorAll(".sidebar-item[data-painel]").forEach((botao) => {
    botao.addEventListener("click", () => alternarPainel(botao.dataset.painel));
  });

  /* ---------------------------------------------------------------
     DASHBOARD — CARDS DE ESTATÍSTICAS
     --------------------------------------------------------------- */
  function renderizarCards() {
    const hoje = new Date();
    const ocorrencias = ocorrenciasDoPainel;
    const atrasos = atrasosDoPainel;

    const ocorrenciasHoje = ocorrencias.filter((o) => ehMesmoDia(o.criadaEm, hoje)).length;
    const atrasosHoje = atrasos.filter((a) => ehMesmoDia(a.criadaEm, hoje)).length;

    const totalAlunos = Dados.listarAlunos().length;
    const alunosComOcorrencia = new Set(ocorrencias.map((o) => o.alunoRa)).size;
    const alunosSemOcorrencia = Math.max(0, totalAlunos - alunosComOcorrencia);
    const percentualSemOcorrencia = totalAlunos > 0
      ? Math.round((alunosSemOcorrencia / totalAlunos) * 100)
      : 0;

    document.getElementById("pn-stat-ocorrencias-hoje").textContent = ocorrenciasHoje;
    document.getElementById("pn-stat-atrasos-hoje").textContent = atrasosHoje;
    document.getElementById("pn-stat-total-alunos").textContent = totalAlunos;
    document.getElementById("pn-stat-sem-ocorrencia").textContent = `${percentualSemOcorrencia}%`;
  }

  /* ---------------------------------------------------------------
     DASHBOARD — GRÁFICO DE OCORRÊNCIAS (ÚLTIMOS 7 DIAS)
     ================================================================
     Mesma estrutura visual do gráfico "Entradas atrasadas · últimos 7
     dias" (barras), mas usando como fonte os registros de ocorrências:
     conta quantas ocorrências foram registradas em cada um dos últimos
     7 dias. Os números mudam automaticamente quando uma nova ocorrência
     é registrada (renderizar() é chamado pelo evento "ocorrencias:mudou"
     e pelos botões de status da listagem).
     --------------------------------------------------------------- */
  function renderizarGraficoTipos() {
    const container = document.getElementById("pn-grafico-tipos");
    const ocorrencias = ocorrenciasDoPainel;

    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dias.push(d);
    }

    const contagem = dias.map((dia) => ({
      dia,
      rotulo: dia.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      total: ocorrencias.filter((o) => ehMesmoDia(o.criadaEm, dia)).length,
    }));

    const maximo = Math.max(1, ...contagem.map((c) => c.total));

    container.innerHTML = contagem.map((c) => `
      <div class="barra-coluna">
        <span class="barra-valor">${c.total}</span>
        <div class="barra-preenchimento" style="height:${Math.max(4, (c.total / maximo) * 100)}%; background:var(--amber);"></div>
        <span class="barra-rotulo">${c.rotulo}</span>
      </div>
    `).join("");
  }

  /* ---------------------------------------------------------------
     DASHBOARD — GRÁFICO DE ENTRADAS ATRASADAS (ÚLTIMOS 7 DIAS)
     --------------------------------------------------------------- */
  function renderizarGraficoAtrasos() {
    const container = document.getElementById("pn-grafico-atrasos");
    const atrasos = atrasosDoPainel;

    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dias.push(d);
    }

    const contagem = dias.map((dia) => ({
      dia,
      rotulo: dia.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      total: atrasos.filter((a) => ehMesmoDia(a.criadaEm, dia)).length,
    }));

    const maximo = Math.max(1, ...contagem.map((c) => c.total));

    container.innerHTML = contagem.map((c) => `
      <div class="barra-coluna">
        <span class="barra-valor">${c.total}</span>
        <div class="barra-preenchimento" style="height:${Math.max(4, (c.total / maximo) * 100)}%; background:var(--amber);"></div>
        <span class="barra-rotulo">${c.rotulo}</span>
      </div>
    `).join("");
  }

  /* ---------------------------------------------------------------
     DASHBOARD — TABELA DE ÚLTIMAS OCORRÊNCIAS
     --------------------------------------------------------------- */
  function renderizarTabelaOcorrencias() {
    const container = document.getElementById("pn-tabela-ocorrencias");
    const ocorrencias = ocorrenciasDoPainel.slice(0, 5);

    if (ocorrencias.length === 0) {
      container.innerHTML = `<div class="tabela-vazio">Nenhuma ocorrência registrada ainda.</div>`;
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Aluno</th>
            <th>Tipo</th>
            <th>Data</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${ocorrencias.map((o) => `
            <tr>
              <td class="tabela-nome">${escapar(o.alunoNome)}</td>
              <td><span class="tabela-tipo">${ROTULO_TIPO[o.tipo] || o.tipo}</span></td>
              <td class="tabela-hora">${formatarDataCurta(o.criadaEm)}</td>
              <td><span class="tag-status" style="${ESTILO_STATUS[o.status]}">${o.status.replace("_", " ")}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  /* ---------------------------------------------------------------
     DASHBOARD — TABELA DE ÚLTIMAS ENTRADAS ATRASADAS
     --------------------------------------------------------------- */
  function renderizarTabelaAtrasos() {
    const container = document.getElementById("pn-tabela-atrasos");
    const atrasos = atrasosDoPainel.slice(0, 5);

    if (atrasos.length === 0) {
      container.innerHTML = `<div class="tabela-vazio">Nenhuma entrada atrasada registrada ainda.</div>`;
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Aluno</th>
            <th>Data</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${atrasos.map((a) => `
            <tr>
              <td class="tabela-nome">${escapar(a.alunoNome)}</td>
              <td class="tabela-hora">${formatarDataCurta(a.criadaEm)}</td>
              <td><span class="tag-status" style="${ESTILO_STATUS[a.status]}">${a.status.replace("_", " ")}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderizarDashboard() {
    renderizarCards();
    renderizarGraficoTipos();
    renderizarGraficoAtrasos();
    renderizarTabelaOcorrencias();
    renderizarTabelaAtrasos();
  }

  /* ---------------------------------------------------------------
     LISTA DE OCORRÊNCIAS (seção completa)
     --------------------------------------------------------------- */
  function renderizarOcorrencias() {
    // a "foto" dos dados já foi atualizada por carregarDados()
    const todas = ocorrenciasDoPainel;
    const lista = filtroAtual === "abertas"
      ? todas.filter((o) => o.status !== "RESOLVIDA")
      : todas;
    const container = document.getElementById("pn-lista-ocorrencias");

    // detecta ocorrencias novas (lançadas em outro aparelho) para notificar
    if (!primeiraRenderizacaoOcorrencias) {
      todas.forEach((o) => {
        if (!idsConhecidosOcorrencias.has(o.id)) {
          idsConhecidosOcorrencias.add(o.id);
          Notificacoes.tocarAlerta();
          Notificacoes.notificar("Nova ocorrência", `${o.alunoNome} (RA ${o.alunoRa}) — ${ROTULO_TIPO[o.tipo] || o.tipo}`);
        }
      });
    } else {
      todas.forEach((o) => idsConhecidosOcorrencias.add(o.id));
      primeiraRenderizacaoOcorrencias = false;
    }

    if (lista.length === 0) {
      container.innerHTML = `
        <div class="folha vazio">
          <p class="vazio-titulo">Nenhuma ocorrência por aqui</p>
          <p class="vazio-sub">Quando um professor enviar, ela aparece aqui na hora.</p>
        </div>`;
      return;
    }

    container.innerHTML = lista.map((o) => `
      <article class="folha cartao-ocorrencia">
        <div class="linha-topo-cartao">
          <div>
            <p class="nome-aluno">${escapar(o.alunoNome)}</p>
            <p class="meta-aluno">RA ${escapar(o.alunoRa)}${o.turma ? " · Turma " + escapar(o.turma) : ""}</p>
          </div>
          <span class="tag-gravidade" style="${ESTILO_GRAVIDADE[o.gravidade]}">${o.gravidade}</span>
        </div>

        <div class="linha-tags">
          <span class="tag-tipo">${ROTULO_TIPO[o.tipo] || o.tipo}</span>
          <span class="tag-hora">${formatarHora(o.criadaEm)} · prof(a). ${escapar(o.professorNome)}</span>
        </div>

        ${o.detalhes ? `<p class="detalhes-ocorrencia">${escapar(o.detalhes)}</p>` : ""}

        <div class="linha-acoes">
          <span class="tag-status" style="${ESTILO_STATUS[o.status]}">${o.status.replace("_", " ")}</span>
          <div class="acoes-direita">
            ${o.status === "NOVA" ? `<button class="botao-mini botao-mini-clara" onclick="mudarStatusOcorrencia('${o.id}', 'LIDA')">Marcar como vista</button>` : ""}
            ${o.status !== "RESOLVIDA" ? `<button class="botao-mini botao-mini-escura" onclick="mudarStatusOcorrencia('${o.id}', 'RESOLVIDA')">Marcar como resolvida</button>` : ""}
          </div>
        </div>
      </article>
    `).join("");
  }

  /* ---------------------------------------------------------------
     LISTA DE ENTRADAS ATRASADAS (seção completa)
     --------------------------------------------------------------- */
  function renderizarAtrasos() {
    // a "foto" dos dados já foi atualizada por carregarDados()
    const todas = atrasosDoPainel;
    const lista = filtroAtual === "abertas"
      ? todas.filter((ent) => ent.status !== "RESOLVIDA")
      : todas;
    const container = document.getElementById("pn-lista-atrasos");

    // detecta entradas atrasadas novas (lançadas em outro aparelho) para notificar
    if (!primeiraRenderizacaoAtrasos) {
      todas.forEach((ent) => {
        if (!idsConhecidosAtrasos.has(ent.id)) {
          idsConhecidosAtrasos.add(ent.id);
          Notificacoes.tocarAlerta();
          Notificacoes.notificar("Nova entrada atrasada", `${ent.alunoNome} (RA ${ent.alunoRa}) registrou um atraso`);
        }
      });
    } else {
      todas.forEach((ent) => idsConhecidosAtrasos.add(ent.id));
      primeiraRenderizacaoAtrasos = false;
    }

    if (lista.length === 0) {
      container.innerHTML = `
        <div class="folha vazio">
          <p class="vazio-titulo">Nenhuma entrada atrasada por aqui</p>
          <p class="vazio-sub">Quando um aluno registrar um atraso, ele aparece aqui na hora.</p>
        </div>`;
      return;
    }

    container.innerHTML = lista.map((ent) => `
      <article class="folha cartao-ocorrencia">
        <div class="linha-topo-cartao">
          <div>
            <p class="nome-aluno">${escapar(ent.alunoNome)}</p>
            <p class="meta-aluno">RA ${escapar(ent.alunoRa)}${ent.turma ? " · Turma " + escapar(ent.turma) : ""}</p>
          </div>
        </div>

        <div class="linha-tags">
          <span class="tag-tipo">Entrada atrasada</span>
          <span class="tag-hora">${formatarHora(ent.criadaEm)}</span>
        </div>

        <p class="detalhes-ocorrencia">${escapar(ent.motivo)}</p>

        <div class="linha-acoes">
          <span class="tag-status" style="${ESTILO_STATUS[ent.status]}">${ent.status.replace("_", " ")}</span>
          <div class="acoes-direita">
            ${ent.status === "NOVA" ? `<button class="botao-mini botao-mini-clara" onclick="mudarStatusAtraso('${ent.id}', 'LIDA')">Marcar como vista</button>` : ""}
            ${ent.status !== "RESOLVIDA" ? `<button class="botao-mini botao-mini-escura" onclick="mudarStatusAtraso('${ent.id}', 'RESOLVIDA')">Marcar como resolvida</button>` : ""}
          </div>
        </div>
      </article>
    `).join("");
  }

  // atualiza as listas no servidor e redesenha o painel inteiro.
  // Agora é async porque GET /ocorrencias e GET /atrasos são chamadas
  // de rede: quem chama sem await (nos listeners de evento) só perde
  // a espera, o desenho continua acontecendo normalmente.
  async function renderizar() {
    try {
      await carregarDados();
    } catch (erro) {
      console.error("Não foi possível carregar os dados do painel.", erro);
    }
    renderizarOcorrencias();
    renderizarAtrasos();
    renderizarDashboard();
  }

  // os botões "marcar como vista/resolvida" agora gravam no SERVIDOR
  // (PATCH /ocorrencias/:id e PATCH /atrasos/:id) antes de redesenhar
  window.mudarStatusOcorrencia = async function (id, status) {
    try {
      await Dados.atualizarStatus(id, status);
    } catch (erro) {
      console.error("Não foi possível mudar o status da ocorrência.", erro);
    }
    renderizar();
  };

  window.mudarStatusAtraso = async function (id, status) {
    try {
      await Dados.atualizarStatusEntradaAtrasada(id, status);
    } catch (erro) {
      console.error("Não foi possível mudar o status da entrada atrasada.", erro);
    }
    renderizar();
  };

  document.querySelectorAll(".filtro-btn").forEach((botao) => {
    botao.addEventListener("click", () => {
      document.querySelectorAll(".filtro-btn").forEach((b) => b.classList.remove("ativo"));
      botao.classList.add("ativo");
      filtroAtual = botao.dataset.filtro;
      renderizar();
    });
  });

  document.getElementById("pn-botao-notificacao").addEventListener("click", async () => {
    const ok = await Notificacoes.pedirPermissao();
    const botao = document.getElementById("pn-botao-notificacao");
    botao.textContent = ok ? "🔔 Notificações ativas" : "Permissão negada";
  });

  // A camada de dados (js/dados.js) dispara estes eventos sempre que o
  // servidor tiver novidade — inclusive quando o registro foi feito em
  // OUTRO aparelho (o celular do professor, por exemplo). Como cada
  // renderização já vai buscar tudo no servidor, quem é avisado só
  // precisa pedir um novo desenho do painel.
  Dados.aoMudar(renderizar);
  Dados.aoMudarEntradasAtrasadas(renderizar);
  // A lista de alunos (GET /alunos) também vem do servidor: quando ela
  // chegar, os cards de "total de alunos" precisam ser recalculados.
  window.addEventListener("alunos:carregados", () => renderizarCards());
  renderizar();
})();

/* =====================================================================
   TELA: GERAR QR CODE (era qrcode.html)
   ===================================================================== */
let qrcodeGerado = false;
function prepararQrCode() {
  const campoUrl = document.getElementById("qr-url");
  if (!qrcodeGerado) {
    // por padrao sugere o endereco atual deste arquivo (index.html);
    // troque pelo IP do computador na rede da escola, ou pelo endereco
    // final quando publicar o site
    campoUrl.value = window.location.href.split("#")[0];
    campoUrl.addEventListener("input", gerarQrCode);
    qrcodeGerado = true;
  }
  gerarQrCode();
}

function gerarQrCode() {
  const campoUrl = document.getElementById("qr-url");
  const alvo = document.getElementById("qr-qrcode-canvas");
  alvo.innerHTML = "";
  new QRCode(alvo, {
    text: campoUrl.value,
    width: 220,
    height: 220,
    colorDark: "#1E2A45",
    colorLight: "#ffffff",
  });
}
