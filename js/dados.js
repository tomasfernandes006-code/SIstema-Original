import { supabase } from "./supabase-config.js";

/* =====================================================================
   CAMADA DE DADOS (SUPABASE)
   ---------------------------------------------------------------------
   ONDE OS DADOS MORAM HOJE:
     - alunos e professores vêm dos arquivos alunos.json e
       professores.json (ver as seções logo abaixo);
     - ocorrências e entradas atrasadas ficam nas tabelas "ocorrencias"
       e "atrasos" do Supabase, e os atestados no Storage (bucket
       "atestados");
     - a conferência de senha e a troca de senha são feitas DENTRO do
       banco, pelas funções verificar_senha e trocar_senha (chamadas
       por RPC em autenticarAluno / autenticarProfessor), então o hash
       das senhas nunca passa pelo navegador.

   Todas as funções abaixo têm nomes e formatos de API, então quem
   consome os dados (as telas) não precisa saber de onde eles vêm.
   ===================================================================== */

const CHAVE_OCORRENCIAS = "livro-ocorrencias:dados";
const CHAVE_ENTRADAS_ATRASADAS = "livro-ocorrencias:entradas-atrasadas";

// tipos de atestado aceitos no upload -> extensão do arquivo no bucket.
// É a ÚNICA fonte da extensão e do contentType (nunca o nome do arquivo).
const TIPOS_ATESTADO_ACEITOS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

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

// A senha do aluno NÃO é mais conferida aqui: quem decide se vale a senha
// própria do aluno (gravada no Supabase) ou a senha padrão é o BANCO, pela
// função verificar_senha (chamada por supabase.rpc em autenticarAluno).
// Por isso não existem mais SENHA_ALUNOS nem gerarHashSha256 neste arquivo.

let ALUNOS = [];              // lista já validada, vinda do alunos.json
let alunosProntos = false;    // true quando o arquivo foi lido sem erro
let problemasDosAlunos = [];  // problemas de validação encontrados no arquivo
let promessaAlunos = null;    // controla a leitura (evita ler o arquivo 2x)

/* ---------------------------------------------------------------------
   PROFESSORES — TODOS ficam em UM ÚNICO arquivo: professores.json
   ---------------------------------------------------------------------
   O arquivo professores.json fica na raiz do projeto (do lado do
   index.html) e é a ÚNICA fonte de dados dos professores: nenhum
   professor fica fixo aqui no código.

   Cada professor do professores.json tem exatamente estes campos:

     {
       "RA":   "1001",           <- identificador único do professor: não
                                    pode ficar vazio nem repetir
       "nome": "Ana Souza"       <- não pode ficar vazio
     }

   No login o professor informa o RA e a senha: o nome do professor é
   identificado automaticamente a partir do RA.

   Para adicionar, remover ou corrigir um professor, edite SOMENTE o
   professores.json — o login relê o arquivo a cada tentativa, então a
   mudança já vale na hora, sem precisar reiniciar o sistema. O site lê
   este arquivo direto, sem backend no meio (GitHub Pages / Live Server).
   --------------------------------------------------------------------- */
const ARQUIVO_PROFESSORES = "professores.json";

// A senha do professor NÃO é mais conferida aqui: quem decide se vale a
// senha própria do professor (gravada no Supabase) ou a senha padrão é o
// BANCO, pela função verificar_senha (chamada por supabase.rpc em
// autenticarProfessor). Por isso não existem mais SENHA_PROFESSORES nem
// gerarHashSha256 neste arquivo.

let PROFESSORES = [];              // lista já validada, vinda do professores.json
let professoresProntos = false;    // true quando o arquivo foi lido sem erro
let problemasDosProfessores = [];  // problemas de validação encontrados no arquivo
let promessaProfessores = null;    // controla a leitura (evita ler o arquivo 2x)

// devolve o valor como texto, sem espaços nas pontas ("" se não for texto)
function comoTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

// O hash SHA-256 das senhas saiu daqui: ele era calculado no navegador
// (crypto.subtle) e comparado com o campo "senhaHash" gravado no banco.
// Agora a conferência é feita dentro do Supabase, pela função
// verificar_senha (ver autenticarAluno/autenticarProfessor), e a gravação
// de uma nova senha pela função trocar_senha — o hash nunca passa pelo
// navegador.

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

// aplica as validações em cada professor lido do arquivo:
//   - RA não pode ficar vazio e não pode repetir
//   - nome não pode ficar vazio
// Professores inválidos são IGNORADOS e o motivo é registrado em
// problemasDosProfessores (também aparece no console do navegador).
function validarProfessores(listaBruta) {
  const validos = [];
  const problemas = [];
  const rasJaVistos = new Set();

  listaBruta.forEach((item, indice) => {
    const onde = `professores.json (professor nº ${indice + 1})`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problemas.push(
        `${onde}: não é um professor válido (precisa ter os campos RA e nome) — ignorado.`
      );
      return;
    }

    const professor = {
      RA: comoTexto(item.RA),
      nome: comoTexto(item.nome),
    };

    const vazios = [];
    if (!professor.RA) vazios.push("RA");
    if (!professor.nome) vazios.push("nome");

    if (vazios.length) {
      problemas.push(
        `${onde}${professor.RA ? " (RA " + professor.RA + ")" : ""}: campo(s) vazio(s): ` +
          `${vazios.join(", ")} — professor ignorado.`
      );
      return;
    }

    if (rasJaVistos.has(professor.RA)) {
      problemas.push(`${onde} (${professor.nome}): RA ${professor.RA} duplicado — professor ignorado.`);
      return;
    }

    rasJaVistos.add(professor.RA);
    validos.push(professor);
  });

  return { validos, problemas };
}

// converte o professor lido do arquivo para o formato usado pelas telas
// e pela sessão (o RA vira o "id" do professor: id = "professor-1001" e
// o nome é identificado automaticamente a partir do RA)
function montarProfessor(professorDoArquivo) {
  return {
    id: "professor-" + professorDoArquivo.RA,
    tipo: "PROFESSOR",
    ra: professorDoArquivo.RA,
    nome: professorDoArquivo.nome,
  };
}

// lê o professores.json de verdade (mesma estratégia usada no
// alunos.json: fetch e, se precisar, XMLHttpRequest). Como roda de novo
// a cada login, editar o arquivo já vale sem reiniciar o sistema.
async function carregarProfessoresDoArquivo() {
  const caminhos = [
    ARQUIVO_PROFESSORES,
    "./" + ARQUIVO_PROFESSORES,
    new URL(ARQUIVO_PROFESSORES, window.location.href).href, // mesma pasta do index.html
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
      throw new Error("o conteúdo precisa ser uma lista (array) de professores");
    }

    const { validos, problemas } = validarProfessores(conteudo);
    PROFESSORES = validos.map(montarProfessor);
    problemasDosProfessores = problemas;
    professoresProntos = true;

    if (problemas.length) {
      console.warn(
        `professores.json: ${problemas.length} problema(s) encontrado(s):\n- ` +
          problemas.join("\n- ")
      );
    }
  } catch (erro) {
    PROFESSORES = [];
    problemasDosProfessores = [];
    professoresProntos = false;
    console.error(
      "Não foi possível ler o arquivo professores.json.\n" +
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
    // avisa as telas que a lista de professores (re)carregou
    window.dispatchEvent(new CustomEvent("professores:carregados"));
  }

  return PROFESSORES;
}

// garante que o arquivo já foi lido antes de responder (usado no login)
function garantirProfessoresCarregados() {
  if (professoresProntos) return Promise.resolve(PROFESSORES);
  if (!promessaProfessores) {
    promessaProfessores = carregarProfessoresDoArquivo().then((lista) => {
      // se deu erro, libera para tentar de novo no próximo login
      if (!professoresProntos) promessaProfessores = null;
      return lista;
    });
  }
  return promessaProfessores;
}

// A contagem recomeça TODA SEGUNDA-FEIRA: ocorrências e entradas atrasadas
// só valem para a semana atual (de segunda 00:00 até agora). Registros de
// semanas anteriores não são mais lidos, então somem do painel e dos
// relatórios (continuam gravados no Supabase, só ficam escondidos).

// segunda-feira desta semana, às 00:00 (horário do computador)
function inicioDaSemana(referencia = new Date()) {
  const inicio = new Date(referencia);
  inicio.setHours(0, 0, 0, 0);
  const diasDesdeSegunda = (inicio.getDay() + 6) % 7; // segunda = 0 ... domingo = 6
  inicio.setDate(inicio.getDate() - diasDesdeSegunda);
  return inicio;
}

// data-limite em ISO (mesmo formato do campo "criadaEm"): tudo que foi
// criado antes disso é de uma semana anterior
function limiteDeRetencaoISO() {
  return inicioDaSemana().toISOString();
}

// Converte uma linha da tabela "ocorrencias" (colunas em snake_case) para o
// formato usado pelas telas (camelCase). As datas são normalizadas com
// new Date(x).toISOString(), porque o resto do sistema compara "criadaEm"
// como texto (ver limiteDeRetencaoISO).
function deLinhaOcorrencia(linha) {
  const ocorrencia = {
    id: linha.id,
    professorId: linha.professor_id ?? null,
    professorNome: linha.professor_nome ?? null,
    alunoNome: linha.aluno_nome ?? null,
    alunoRa: linha.aluno_ra ?? null,
    turma: linha.turma ?? null,
    tipo: linha.tipo ?? null,
    gravidade: linha.gravidade ?? null,
    detalhes: linha.detalhes ?? "",
    status: linha.status ?? "NOVA",
  };
  if (linha.criada_em) ocorrencia.criadaEm = new Date(linha.criada_em).toISOString();
  if (linha.atualizada_em) {
    ocorrencia.atualizadaEm = new Date(linha.atualizada_em).toISOString();
  }
  return ocorrencia;
}

// mesma coisa da "ocorrencias", agora para uma linha da tabela "atrasos"
function deLinhaAtraso(linha) {
  const entrada = {
    id: linha.id,
    alunoId: linha.aluno_id ?? null,
    alunoNome: linha.aluno_nome ?? null,
    alunoRa: linha.aluno_ra ?? null,
    turma: linha.turma ?? null,
    motivo: linha.motivo ?? "",
    justificativaTipo: linha.justificativa_tipo ?? null,
    responsavelNome: linha.responsavel_nome ?? null,
    atestadoPath: linha.atestado_path ?? null,
    atestadoNomeArquivo: linha.atestado_nome_arquivo ?? null,
    status: linha.status ?? "NOVA",
  };
  if (linha.criada_em) entrada.criadaEm = new Date(linha.criada_em).toISOString();
  if (linha.atualizada_em) {
    entrada.atualizadaEm = new Date(linha.atualizada_em).toISOString();
  }
  // o link do atestado é gerado no clique (Dados.gerarLinkAtestado)
  return entrada;
}

// lê a tabela "ocorrencias" no Supabase, da mais recente para a mais antiga
// (order "criada_em" desc: a ocorrência nova aparece em cima na tela).
// Cada linha vira { id: <id da linha>, ...campos em camelCase } — esse "id" é
// o que os botões de status usam para achar a linha no update.
async function lerOcorrencias() {
  const { data, error } = await supabase
    .from("ocorrencias")
    .select("*")
    .gte("criada_em", limiteDeRetencaoISO())
    .order("criada_em", { ascending: false });

  if (error) {
    throw new Error(`Não foi possível ler as ocorrências no Supabase: ${error.message}`, {
      cause: error,
    });
  }

  return (data || []).map(deLinhaOcorrencia);
}

// contador usado só para dar um NOME ÚNICO a cada canal de tempo real: o
// Supabase agrupa os canais pelo nome, então duas escutas abertas ao mesmo
// tempo (ex.: dois painéis, ou uma religação da tela) precisam de nomes
// diferentes para não caírem no mesmo canal.
let contadorCanaisTempoReal = 0;

// avisa quem estiver escutando (ver aoMudar) que a coleção desta aba mudou,
// pra tela se redesenhar sem precisar recarregar a página
function avisarMudancaOcorrencias() {
  window.dispatchEvent(new CustomEvent("ocorrencias:mudou"));
}

// mesma coisa da tabela "ocorrencias", agora para a tabela "atrasos"
async function lerEntradasAtrasadas() {
  const { data, error } = await supabase
    .from("atrasos")
    .select("*")
    .gte("criada_em", limiteDeRetencaoISO())
    .order("criada_em", { ascending: false });

  if (error) {
    throw new Error(`Não foi possível ler as entradas atrasadas no Supabase: ${error.message}`, {
      cause: error,
    });
  }

  return (data || []).map(deLinhaAtraso);
}

// mesmo esquema do "ocorrencias:mudou": evento próprio pra esta aba
function avisarMudancaEntradasAtrasadas() {
  window.dispatchEvent(new CustomEvent("entradas-atrasadas:mudou"));
}

/* ---------------------------------------------------------------------
   ANEXO DO ATESTADO (Supabase Storage, bucket público "atestados")
   ---------------------------------------------------------------------
   O arquivo escolhido no formulário (foto ou PDF) sobe para o bucket e o
   que fica guardado no banco é só o CAMINHO dele (coluna atestado_path).
   A URL pública é montada depois, em deLinhaAtraso, a partir do caminho.
   --------------------------------------------------------------------- */

// extensão do arquivo (sem o ponto, em minúsculas): vem SEMPRE do mapa
// TIPOS_ATESTADO_ACEITOS, a partir do tipo MIME — nunca do nome do arquivo.
function extensaoDoAtestado(arquivo) {
  return TIPOS_ATESTADO_ACEITOS[arquivo.type];
}

// nome único do arquivo dentro do bucket. O crypto.randomUUID() só existe
// em contexto seguro (https:// ou localhost), o mesmo requisito que o resto
// do sistema já documenta.
function gerarNomeDoAtestado(extensao) {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error(
      "Não foi possível gerar o nome do arquivo do atestado " +
        "(crypto.randomUUID indisponível). Abra o sistema por https:// ou por localhost."
    );
  }
  return `${crypto.randomUUID()}.${extensao}`;
}

// redimensiona a imagem para no máximo 1600px de largura e converte para
// JPEG (qualidade 0.85), devolvendo um Blob. Se a imagem não puder ser
// aberta ou desenhada, devolve null — quem chamou decide o que fazer
// (o arquivo original é enviado mesmo assim).
function redimensionarImagemAtestado(arquivo) {
  return new Promise((resolve) => {
    const leitor = new FileReader();
    leitor.onerror = () => resolve(null);
    leitor.onload = () => {
      const imagem = new Image();
      imagem.onerror = () => resolve(null);
      imagem.onload = () => {
        try {
          const larguraMaxima = 1600;
          const escala = Math.min(1, larguraMaxima / imagem.width);
          const largura = Math.max(1, Math.round(imagem.width * escala));
          const altura = Math.max(1, Math.round(imagem.height * escala));

          const canvas = document.createElement("canvas");
          canvas.width = largura;
          canvas.height = altura;
          canvas.getContext("2d").drawImage(imagem, 0, 0, largura, altura);

          canvas.toBlob((blob) => resolve(blob || null), "image/jpeg", 0.85);
        } catch {
          resolve(null);
        }
      };
      imagem.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

const Dados = {
  inicioDaSemana,

  /* ---------------------------------------------------------------
     PROFESSORES — tudo vem do professores.json
     (ver carregarProfessoresDoArquivo). O professor entra com o RA
     (identificador único) e a senha: o RA precisa existir no
     professores.json e a senha precisa bater. O NOME do professor é
     identificado automaticamente a partir do RA.
     A senha conferida é:
       - quem decide é o banco, pela função verificar_senha (RPC): ela
         recebe p_tipo "PROFESSOR", p_ra e p_senha e devolve true/false,
         resolvendo sozinha entre senha própria ou senha padrão.
     RA inexistente ou senha errada = login negado.
     --------------------------------------------------------------- */
  async autenticarProfessor(ra, senha) {
    // relê o arquivo a cada tentativa: assim adicionar, remover ou
    // alterar um professor já vale no login seguinte, sem reiniciar
    PROFESSORES = [];
    professoresProntos = false;
    promessaProfessores = null;

    await garantirProfessoresCarregados();

    const raDigitado = comoTexto(ra);
    if (!raDigitado) return null;
    // a senha digitada é usada EXATAMENTE como veio, sem cortar espaços
    // (a conferência agora é feita pelo banco, pela função verificar_senha)
    const senhaDigitada = String(senha ?? "");

    // Senha do professor: quem confere é o BANCO, pela função verificar_senha
    // (RPC). Ela recebe o tipo, o RA e a senha digitada e resolve sozinha se
    // vale a senha própria do professor (gravada no Supabase) ou a senha
    // padrão — assim o hash das senhas nunca chega ao navegador.
    //   true  -> a senha confere: seguimos para a busca no professores.json
    //   false -> senha errada (login negado)
    const { data: token, error } = await supabase.rpc("entrar_app", {
      p_tipo: "PROFESSOR",
      p_ra: raDigitado,
      p_senha: senhaDigitada,
    });

    if (error) {
      // falha técnica (Supabase fora do ar, função inexistente etc.): sobe o
      // erro para a tela mostrar o problema real, em vez de acusar senha errada
      throw new Error(
        `Não foi possível conferir a senha do professor (RA ${raDigitado}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    if (!token) return null;

    const professor = PROFESSORES.find((p) => p.ra === raDigitado);
    return professor ? { ...professor, token } : null;
  },

  // força uma nova leitura do professores.json (a lista já é relida a
  // cada login; isto serve para recarregar sem fechar a página)
  carregarProfessores() {
    PROFESSORES = [];
    professoresProntos = false;
    promessaProfessores = null;
    return garantirProfessoresCarregados();
  },

  // true quando o professores.json foi lido com sucesso
  professoresCarregados() {
    return professoresProntos;
  },

  // problemas de validação encontrados no professores.json (RA/nome
  // vazios ou RA duplicado)
  problemasProfessores() {
    return problemasDosProfessores.slice();
  },

  // lista todos os professores válidos do professores.json
  listarProfessores() {
    return PROFESSORES.slice();
  },

  async autenticarSecretaria(usuario, senha) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(usuario ?? "").trim(),
      password: String(senha ?? ""),
    });

    if (error) {
      // credenciais erradas (e-mail/senha inválidos) -> login negado
      if (error.code === "invalid_credentials" || error.status === 400) return null;
      throw new Error(
        `Não foi possível conferir o login da secretaria no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    return { id: data.user.id, nome: "Secretaria Central", tipo: "SECRETARIA" };
  },

  async temSessaoSecretaria() {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  },

  async sairSecretaria() {
    await supabase.auth.signOut();
  },

  /* ---------------------------------------------------------------
     ALUNOS — tudo vem do alunos.json (ver carregarAlunosDoArquivo)
     O acesso do aluno é feito pelo RA + senha: o RA precisa existir
     no alunos.json e a senha precisa bater. Nome, sala e turno são
     identificados automaticamente a partir do alunos.json.
     A senha conferida é:
       - quem decide é o banco, pela função verificar_senha (RPC): ela
         recebe p_tipo "ALUNO", p_ra e p_senha e devolve true/false,
         resolvendo sozinha entre senha própria ou senha padrão.
     RA inexistente ou senha errada = login negado.
     --------------------------------------------------------------- */
  async autenticarAluno(ra, senha) {
    const raDigitado = comoTexto(ra);
    if (!raDigitado) return null;
    // a senha digitada é usada EXATAMENTE como veio, sem cortar espaços
    // (a conferência agora é feita pelo banco, pela função verificar_senha)
    const senhaDigitada = String(senha ?? "");

    // Senha do aluno: quem confere é o BANCO, pela função verificar_senha
    // (RPC). Ela recebe o tipo, o RA e a senha digitada e resolve sozinha se
    // vale a senha própria do aluno (gravada no Supabase) ou a senha padrão —
    // assim o hash das senhas nunca chega ao navegador.
    //   true  -> a senha confere: seguimos para a busca no alunos.json
    //   false -> senha errada (login negado)
    const { data: token, error } = await supabase.rpc("entrar_app", {
      p_tipo: "ALUNO",
      p_ra: raDigitado,
      p_senha: senhaDigitada,
    });

    if (error) {
      // falha técnica (Supabase fora do ar, função inexistente etc.): sobe o
      // erro para a tela mostrar o problema real, em vez de acusar senha errada
      throw new Error(
        `Não foi possível conferir a senha do aluno (RA ${raDigitado}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    if (!token) return null;

    await garantirAlunosCarregados();

    const aluno = ALUNOS.find((a) => a.ra === raDigitado);
    return aluno ? { ...aluno, token } : null;
  },

  /* ---------------------------------------------------------------
     TROCA DE SENHA DO ALUNO
     Confere a senha atual com autenticarAluno e, se estiver certa,
     grava a nova senha pela função trocar_senha (RPC) do banco — a
     mesma conferência que o login usa (ver autenticarAluno). Enquanto
     a gravação não dá certo, a senha antiga continua valendo.
       - senha atual errada ou RA inválido -> lança
         Error("senha atual incorreta")
       - falha técnica (Supabase fora do ar etc.) -> sobe Error com
         contexto, para a tela mostrar o problema real (não é
         "senha atual incorreta")
       - sucesso -> devolve { ra, senhaAlterada: true }
     --------------------------------------------------------------- */
  async trocarSenhaAluno(ra, senhaAtual, novaSenha) {
    const raDigitado = comoTexto(ra);

    // 1) valida a senha atual com as MESMAS regras do login
    let aluno;
    try {
      aluno = await Dados.autenticarAluno(raDigitado, senhaAtual);
    } catch (erro) {
      // não é senha errada: deu problema na própria conferência
      throw new Error(
        `Não foi possível conferir a senha atual do aluno (RA ${
          raDigitado || "não informado"
        }): ${erro.message}`,
        { cause: erro }
      );
    }

    if (!aluno) {
      // RA inexistente ou senha atual incorreta
      throw new Error("senha atual incorreta");
    }

    // 2) grava a nova senha: quem grava é o BANCO, pela função trocar_senha
    // (RPC), que recebe o tipo, o RA, a senha atual e a nova senha e atualiza
    // a senha própria do aluno (o hash nunca passa pelo navegador).
    const { data: trocou, error } = await supabase.rpc("trocar_senha", {
      p_tipo: "ALUNO",
      p_ra: raDigitado,
      p_senha_atual: String(senhaAtual ?? ""),
      p_nova_senha: String(novaSenha ?? ""),
    });

    if (error) {
      throw new Error(
        `Não foi possível salvar a nova senha do aluno (RA ${raDigitado}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    if (trocou === false) throw new Error("senha atual incorreta");

    return { ra: raDigitado, senhaAlterada: true };
  },

  /* ---------------------------------------------------------------
     TROCA DE SENHA DO PROFESSOR
     Confere a senha atual com autenticarProfessor e, se estiver certa,
     grava a nova senha pela função trocar_senha (RPC) do banco — a
     mesma conferência que o login usa (ver autenticarProfessor). Enquanto
     a gravação não dá certo, a senha antiga continua valendo.
       - senha atual errada ou RA inválido -> lança
         Error("senha atual incorreta")
       - falha técnica (Supabase fora do ar etc.) -> sobe Error com
         contexto, para a tela mostrar o problema real (não é
         "senha atual incorreta")
       - sucesso -> devolve { ra, senhaAlterada: true }
     --------------------------------------------------------------- */
  async trocarSenhaProfessor(ra, senhaAtual, novaSenha) {
    const raDigitado = comoTexto(ra);

    // 1) valida a senha atual com as MESMAS regras do login
    let professor;
    try {
      professor = await Dados.autenticarProfessor(raDigitado, senhaAtual);
    } catch (erro) {
      // não é senha errada: deu problema na própria conferência
      throw new Error(
        `Não foi possível conferir a senha atual do professor (RA ${
          raDigitado || "não informado"
        }): ${erro.message}`,
        { cause: erro }
      );
    }

    if (!professor) {
      // RA inexistente ou senha atual incorreta
      throw new Error("senha atual incorreta");
    }

    // 2) grava a nova senha: quem grava é o BANCO, pela função trocar_senha
    // (RPC), que recebe o tipo, o RA, a senha atual e a nova senha e atualiza
    // a senha própria do professor (o hash nunca passa pelo navegador).
    const { data: trocou, error } = await supabase.rpc("trocar_senha", {
      p_tipo: "PROFESSOR",
      p_ra: raDigitado,
      p_senha_atual: String(senhaAtual ?? ""),
      p_nova_senha: String(novaSenha ?? ""),
    });

    if (error) {
      throw new Error(
        `Não foi possível salvar a nova senha do professor (RA ${raDigitado}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    if (trocou === false) throw new Error("senha atual incorreta");

    return { ra: raDigitado, senhaAlterada: true };
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

  // grava uma ocorrência nova na tabela "ocorrencias" do Supabase (o id da
  // linha é gerado pelo próprio banco)
  async criarOcorrencia({ professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes, token }) {
    const agoraISO = new Date().toISOString();
    const { error } = await supabase.rpc("criar_ocorrencia", {
      p_token: token ?? "",
      p_professor_nome: professorNome,
      p_aluno_nome: alunoNome,
      p_aluno_ra: alunoRa,
      p_turma: turma || null,
      p_tipo: tipo,
      p_gravidade: gravidade,
      p_detalhes: detalhes || "",
    });

    if (error) {
      if (String(error.message || "").includes("Sessão expirada")) {
        throw new Error("Sua sessão expirou. Saia e entre novamente.");
      }
      throw new Error(`Não foi possível gravar a ocorrência no Supabase: ${error.message}`, {
        cause: error,
      });
    }

    avisarMudancaOcorrencias();
    return null;
  },

  async listarOcorrencias({ apenasAbertas } = {}) {
    const limite = limiteDeRetencaoISO();
    // só a semana atual: o que foi criado antes da segunda 00:00 fica de fora
    const lista = (await lerOcorrencias()).filter((o) => (o.criadaEm || "") >= limite);
    if (!apenasAbertas) return lista;
    return lista.filter((o) => o.status !== "RESOLVIDA");
  },

  // muda só a coluna "status" (e "atualizada_em") da linha correspondente na
  // tabela "ocorrencias" (o id é o id da linha no Supabase)
  async atualizarStatus(id, novoStatus) {
    const { error } = await supabase
      .from("ocorrencias")
      .update({ status: novoStatus, atualizada_em: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      throw new Error(
        `Não foi possível mudar o status da ocorrência (id ${id}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    avisarMudancaOcorrencias();
    return { id, status: novoStatus };
  },

  // escuta a tabela "ocorrencias" EM TEMPO REAL (postgres_changes do Supabase
  // Realtime): a novidade chega em qualquer aparelho, não só na mesma aba.
  // Cada chamada abre um canal com nome único e devolve a função que cancela
  // a escuta (removeChannel).
  aoMudar(callback) {
    const canal = supabase
      .channel(`ocorrencias-${++contadorCanaisTempoReal}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ocorrencias" },
        () => callback()
      )
      .subscribe();

    return () => supabase.removeChannel(canal);
  },

  /* ---------------------------------------------------------------
     ANEXO DO ATESTADO — envia o arquivo para o Storage e devolve o
     CAMINHO dele dentro do bucket público "atestados" (é esse caminho
     que vai para a coluna atestado_path).
       - aceita imagem ou PDF; qualquer outro tipo -> lança Error
       - acima de 10 MB -> lança Error com mensagem clara
       - imagem: é redimensionada no canvas (máx. 1600px de largura,
         JPEG qualidade 0.85) antes de subir; se a imagem não puder ser
         aberta, o arquivo original é enviado mesmo assim
       - PDF: sobe como está, sem passar pelo canvas
       - sucesso -> devolve o caminho do arquivo no bucket
     --------------------------------------------------------------- */
  async enviarAtestado(arquivo, token) {
    if (!arquivo) throw new Error("Selecione o arquivo do atestado");

    const ehPdf = arquivo.type === "application/pdf";
    const ehImagem = String(arquivo.type || "").startsWith("image/");
    if (!ehPdf && !ehImagem) {
      throw new Error("O atestado precisa ser uma foto (jpg, png...) ou um arquivo PDF");
    }

    // 10 MB
    if (arquivo.size > 10 * 1024 * 1024) {
      throw new Error(
        "O arquivo do atestado passa de 10 MB. Envie uma foto ou um PDF menor."
      );
    }

    let conteudo = arquivo;
    // a extensão vem do mapa de tipos aceitos, nunca do nome do arquivo
    let extensao = extensaoDoAtestado(arquivo);
    let contentType = arquivo.type;

    if (ehImagem) {
      const redimensionada = await redimensionarImagemAtestado(arquivo);
      if (redimensionada) {
        conteudo = redimensionada;
        extensao = TIPOS_ATESTADO_ACEITOS["image/jpeg"];
        contentType = "image/jpeg";
      } else if (!TIPOS_ATESTADO_ACEITOS[contentType]) {
        // não deu para redimensionar e o tipo fora dos aceitos (HEIC,
        // HEIF, TIFF...): manda uma mensagem clara em vez de subir um
        // arquivo que o navegador nem conseguiu ler
        throw new Error(
          "Não consegui ler essa foto. Tire a foto de novo pela câmera do celular ou envie o atestado em PDF."
        );
      }
    }

    // reserva o nome do arquivo no banco (ligado ao token da sessão) e usa
    // o nome devolvido como caminho do upload
    const { data: caminho, error: erroReserva } = await supabase.rpc("reservar_atestado", {
      p_token: token ?? "",
      p_extensao: extensao,
    });

    if (erroReserva) {
      const mensagemReserva = String(erroReserva.message || "");
      if (mensagemReserva.includes("Sessão expirada")) {
        throw new Error("Sua sessão expirou. Saia e entre novamente.");
      }
      if (mensagemReserva.includes("Muitos envios")) {
        throw new Error("Muitos envios seguidos. Espere alguns minutos e tente de novo.");
      }
      throw new Error(`Não foi possível reservar o atestado no Supabase: ${erroReserva.message}`, {
        cause: erroReserva,
      });
    }

    const { error } = await supabase.storage
      .from("atestados")
      .upload(caminho, conteudo, { contentType });

    if (error) {
      const status = error.status ?? error.statusCode;
      const mensagem = String(error.message || "").toLowerCase();

      // recusa do Storage por tamanho ou por tipo: mensagem amigável SEM
      // cause e SEM a palavra "Supabase" (senão a tela mostra o aviso de
      // sistema indisponível em vez da mensagem acima)
      if (
        status === 413 ||
        mensagem.includes("exceeded") ||
        mensagem.includes("too large") ||
        mensagem.includes("maximum allowed size")
      ) {
        throw new Error("O arquivo é grande demais. Envie uma foto ou PDF de até 10 MB.");
      }

      if (status === 415 || mensagem.includes("mime type")) {
        throw new Error("Esse tipo de arquivo não é aceito. Envie JPG, PNG, WEBP ou PDF.");
      }

      if (status === 403 || mensagem.includes("row-level security")) {
        throw new Error(
          "Não foi possível enviar o arquivo agora. Saia, entre de novo e tente outra vez."
        );
      }

      throw new Error(`Não foi possível enviar o atestado para o Supabase: ${error.message}`, {
        cause: error,
      });
    }

    return caminho;
  },

  // gera um link temporário (URL assinada) para abrir o atestado
  async gerarLinkAtestado(caminho) {
    if (!caminho) throw new Error("Atestado sem arquivo.");

    const { data, error } = await supabase.storage
      .from("atestados")
      .createSignedUrl(caminho, 120);

    if (error || !data?.signedUrl) {
      throw new Error("Não foi possível gerar o link do atestado.", { cause: error });
    }

    return data.signedUrl;
  },

  // grava uma entrada atrasada nova na tabela "atrasos" do Supabase (o id da
  // linha é gerado pelo próprio banco). A foto do atestado NÃO é gravada
  // aqui: o que chega é o caminho do arquivo (atestadoPath, vindo de
  // enviarAtestado), que vai para a coluna atestado_path.
  async criarEntradaAtrasada({ alunoId, alunoNome, alunoRa, turma, motivo, justificativaTipo, responsavelNome, atestadoPath, atestadoNomeArquivo, token }) {
    const agoraISO = new Date().toISOString();
    const { error } = await supabase.rpc("criar_atraso", {
      p_token: token ?? "",
      p_aluno_nome: alunoNome,
      p_turma: turma || null,
      p_motivo: motivo,
      p_justificativa_tipo: justificativaTipo,
      p_responsavel_nome: responsavelNome || null,
      p_atestado_path: atestadoPath || null,
      p_atestado_nome_arquivo: atestadoNomeArquivo || null,
    });

    if (error) {
      if (String(error.message || "").includes("Sessão expirada")) {
        throw new Error("Sua sessão expirou. Saia e entre novamente.");
      }
      throw new Error(`Não foi possível gravar a entrada atrasada no Supabase: ${error.message}`, {
        cause: error,
      });
    }

    avisarMudancaEntradasAtrasadas();
    return null;
  },

  async listarEntradasAtrasadas({ apenasAbertas } = {}) {
    const limite = limiteDeRetencaoISO();
    // só a semana atual: o que foi criado antes da segunda 00:00 fica de fora
    const lista = (await lerEntradasAtrasadas()).filter((e) => (e.criadaEm || "") >= limite);
    if (!apenasAbertas) return lista;
    return lista.filter((e) => e.status !== "RESOLVIDA");
  },

  // muda só a coluna "status" (e "atualizada_em") da linha correspondente na
  // tabela "atrasos"
  async atualizarStatusEntradaAtrasada(id, novoStatus) {
    const { error } = await supabase
      .from("atrasos")
      .update({ status: novoStatus, atualizada_em: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      throw new Error(
        `Não foi possível mudar o status da entrada atrasada (id ${id}) no Supabase: ${error.message}`,
        { cause: error }
      );
    }

    avisarMudancaEntradasAtrasadas();
    return { id, status: novoStatus };
  },

  // igual ao aoMudar acima, mas para a tabela "atrasos": abre um canal de
  // tempo real com nome único e devolve a função que cancela a escuta
  aoMudarEntradasAtrasadas(callback) {
    const canal = supabase
      .channel(`atrasos-${++contadorCanaisTempoReal}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atrasos" },
        () => callback()
      )
      .subscribe();

    return () => supabase.removeChannel(canal);
  },
};

// lê o alunos.json assim que o sistema abre (é a única fonte de dados
// dos alunos). O login do aluno espera essa leitura terminar.
garantirAlunosCarregados();

// mesma coisa para o professores.json (única fonte de dados dos
// professores). Além disso, o login do professor relê o arquivo a cada
// tentativa, então editar o arquivo vale na hora, sem reiniciar nada.
garantirProfessoresCarregados();

// o dados.js agora é um módulo (type="module" no index.html), então o
// "Dados" deixaria de ser global e o app.js não o encontraria. Esta linha
// devolve o objeto para o escopo global, como era antes dos módulos.
window.Dados = Dados;