import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, query, orderBy, onSnapshot, where
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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

// ---- usuários fixos no código ----
// Só a SECRETARIA continua aqui. Os PROFESSORES ficam exclusivamente
// no arquivo professores.json (ver seção PROFESSORES logo abaixo).
const USUARIOS = [
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

// senha PADRÃO dos alunos (a mesma para todos). O login do aluno exige o
// RA existente no alunos.json + a senha correta: alunos que têm senha
// própria cadastrada na coleção "senhasAlunos" do Firestore (campo
// "senhaHash") são conferidos pelo hash, e só quem NÃO tem documento lá
// é que usa esta senha padrão exata (ver autenticarAluno).
const SENHA_ALUNOS = "@Coronel2026";

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
   mudança já vale na hora, sem precisar reiniciar o sistema. (Se
   estiver usando o servidor em servidor/, ele lê este mesmo arquivo.)
   --------------------------------------------------------------------- */
const ARQUIVO_PROFESSORES = "professores.json";

// senha PADRÃO dos professores (a mesma para todos). O login do professor
// exige o RA existente no professores.json + a senha correta: professores
// que têm senha própria cadastrada na coleção "senhasProfessores" do
// Firestore (campo "senhaHash") são conferidos pelo hash, e só quem NÃO tem
// documento lá é que usa esta senha padrão exata (ver autenticarProfessor).
const SENHA_PROFESSORES = "Professor2026@";

let PROFESSORES = [];              // lista já validada, vinda do professores.json
let professoresProntos = false;    // true quando o arquivo foi lido sem erro
let problemasDosProfessores = [];  // problemas de validação encontrados no arquivo
let promessaProfessores = null;    // controla a leitura (evita ler o arquivo 2x)

// devolve o valor como texto, sem espaços nas pontas ("" se não for texto)
function comoTexto(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

// calcula o hash SHA-256 de um texto e devolve em hexadecimal minúsculo
// (ex.: 64 caracteres). É exatamente o formato esperado no campo
// "senhaHash" dos documentos da coleção "senhasAlunos" do Firestore.
// Usa a Web Crypto API do navegador (crypto.subtle.digest), que só existe
// em contexto seguro (https:// ou localhost) — em file:// a chamada não
// tem como funcionar e o erro abaixo explica o motivo.
async function gerarHashSha256(texto) {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || !webCrypto.subtle) {
    throw new Error(
      "Não foi possível calcular o hash da senha (crypto.subtle indisponível). " +
        "Abra o sistema por https:// ou por localhost."
    );
  }
  const bytes = new TextEncoder().encode(String(texto));
  const digest = await webCrypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
// relatórios (continuam gravados no Firebase, só ficam escondidos).

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

// lê a coleção "ocorrencias" no Firestore, da mais recente para a mais antiga
// (orderBy "criadaEm" desc: a ocorrência nova aparece em cima na tela).
// Cada documento vira { id: <id do documento>, ...campos gravados } — esse
// "id" é o que os botões de status usam para achar o documento no updateDoc.
async function lerOcorrencias() {
  const resultado = await getDocs(
    query(
      collection(db, "ocorrencias"),
      where("criadaEm", ">=", limiteDeRetencaoISO()),
      orderBy("criadaEm", "desc")
    )
  );
  return resultado.docs.map((documento) => ({ ...documento.data(), id: documento.id }));
}

// avisa quem estiver escutando (ver aoMudar) que a coleção desta aba mudou,
// pra tela se redesenhar sem precisar recarregar a página
function avisarMudancaOcorrencias() {
  window.dispatchEvent(new CustomEvent("ocorrencias:mudou"));
}

// mesma coisa da coleção "ocorrencias", agora para a coleção "atrasos"
async function lerEntradasAtrasadas() {
  const resultado = await getDocs(
    query(
      collection(db, "atrasos"),
      where("criadaEm", ">=", limiteDeRetencaoISO()),
      orderBy("criadaEm", "desc")
    )
  );
  return resultado.docs.map((documento) => ({ ...documento.data(), id: documento.id }));
}

// mesmo esquema do "ocorrencias:mudou": evento próprio pra esta aba
function avisarMudancaEntradasAtrasadas() {
  window.dispatchEvent(new CustomEvent("entradas-atrasadas:mudou"));
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
       - o campo "senhaHash" (SHA-256) do documento de ID = RA na
         coleção "senhasProfessores" do Firestore, QUANDO esse documento
         existe (senha própria do professor — a senha padrão não vale); ou
       - a senha padrão "Professor2026@" (SENHA_PROFESSORES, no topo
         deste arquivo), quando não existe documento para o RA.
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
    // (nem no hash, nem na comparação com a senha padrão SENHA_PROFESSORES)
    const senhaDigitada = String(senha ?? "");

    // Senha própria do professor: existe um documento por RA na coleção
    // "senhasProfessores" do Firestore (ID do documento = RA). Se esse
    // documento existir, a senha digitada é conferida contra o campo
    // "senhaHash" dele (SHA-256) em vez da senha padrão; se não existir,
    // vale a comparação original com SENHA_PROFESSORES. Se a consulta ao
    // Firestore falhar (sem rede, regras de acesso etc.), o aviso vai para
    // o console e o login segue usando a senha padrão, pra não derrubar o
    // acesso de todos.
    let documentoDeSenha = null;
    try {
      const documento = await getDoc(doc(db, "senhasProfessores", raDigitado));
      if (documento.exists()) documentoDeSenha = documento.data() || {};
    } catch (erro) {
      console.warn(
        `Não foi possível consultar a senha própria do professor (RA ${raDigitado}) ` +
          `na coleção "senhasProfessores"; usando a senha padrão SENHA_PROFESSORES.`,
        erro
      );
    }

    if (documentoDeSenha) {
      // o professor tem senha própria: só entra com a senha que gera o
      // hash gravado em "senhaHash" (a senha padrão NÃO é aceita nesse caso)
      const senhaHash = comoTexto(documentoDeSenha.senhaHash).toLowerCase();
      if (!senhaHash) return null; // documento sem "senhaHash": login negado
      const hashDigitado = await gerarHashSha256(senhaDigitada);
      if (hashDigitado !== senhaHash) return null;
    } else if (senhaDigitada !== SENHA_PROFESSORES) {
      return null;
    }

    const professor = PROFESSORES.find((p) => p.ra === raDigitado);
    return professor ? { ...professor } : null;
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

  autenticarSecretaria(usuario, senha) {
    return USUARIOS.find(
      (u) => u.tipo === "SECRETARIA" && u.usuario === usuario && u.senha === senha
    ) || null;
  },

  /* ---------------------------------------------------------------
     ALUNOS — tudo vem do alunos.json (ver carregarAlunosDoArquivo)
     O acesso do aluno é feito pelo RA + senha: o RA precisa existir
     no alunos.json e a senha precisa bater. Nome, sala e turno são
     identificados automaticamente a partir do alunos.json.
     A senha conferida é:
       - o campo "senhaHash" (SHA-256) do documento de ID = RA na
         coleção "senhasAlunos" do Firestore, QUANDO esse documento
         existe (senha própria do aluno — a senha padrão não vale); ou
       - a senha padrão "@Coronel2026" (SENHA_ALUNOS, no topo deste
         arquivo), quando não existe documento para o RA.
     RA inexistente ou senha errada = login negado.
     --------------------------------------------------------------- */
  async autenticarAluno(ra, senha) {
    const raDigitado = comoTexto(ra);
    if (!raDigitado) return null;
    // a senha digitada é usada EXATAMENTE como veio, sem cortar espaços
    // (nem no hash, nem na comparação com a senha padrão SENHA_ALUNOS)
    const senhaDigitada = String(senha ?? "");

    // Senha própria do aluno: existe um documento por RA na coleção
    // "senhasAlunos" do Firestore (ID do documento = RA). Se esse documento
    // existir, a senha digitada é conferida contra o campo "senhaHash" dele
    // (SHA-256) em vez da senha padrão; se não existir, vale a comparação
    // original com SENHA_ALUNOS. Se a consulta ao Firestore falhar (sem
    // rede, regras de acesso etc.), o aviso vai para o console e o login
    // segue usando a senha padrão, pra não derrubar o acesso de todos.
    let documentoDeSenha = null;
    try {
      const documento = await getDoc(doc(db, "senhasAlunos", raDigitado));
      if (documento.exists()) documentoDeSenha = documento.data() || {};
    } catch (erro) {
      console.warn(
        `Não foi possível consultar a senha própria do aluno (RA ${raDigitado}) ` +
          `na coleção "senhasAlunos"; usando a senha padrão SENHA_ALUNOS.`,
        erro
      );
    }

    if (documentoDeSenha) {
      // o aluno tem senha própria: só entra com a senha que gera o hash
      // gravado em "senhaHash" (a senha padrão NÃO é aceita nesse caso)
      const senhaHash = comoTexto(documentoDeSenha.senhaHash).toLowerCase();
      if (!senhaHash) return null; // documento sem "senhaHash": login negado
      const hashDigitado = await gerarHashSha256(senhaDigitada);
      if (hashDigitado !== senhaHash) return null;
    } else if (senhaDigitada !== SENHA_ALUNOS) {
      return null;
    }

    await garantirAlunosCarregados();

    const aluno = ALUNOS.find((a) => a.ra === raDigitado);
    return aluno ? { ...aluno } : null;
  },

  /* ---------------------------------------------------------------
     TROCA DE SENHA DO ALUNO
     Confere a senha atual com autenticarAluno e, se estiver certa,
     grava o SHA-256 da nova senha em senhasAlunos/{RA}.senhaHash —
     o mesmo formato que o login lê (ver autenticarAluno). Enquanto
     a gravação não dá certo, a senha antiga continua valendo.
       - senha atual errada ou RA inválido -> lança
         Error("senha atual incorreta")
       - falha técnica (Firestore fora do ar, crypto.subtle
         indisponível etc.) -> sobe Error com contexto, para a tela
         mostrar o problema real (não é "senha atual incorreta")
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

    // 2) grava a nova senha: só o campo "senhaHash" no documento
    // senhasAlunos/{RA}. O merge: true preserva outros campos que o
    // documento já tenha, e o setDoc cria o documento quando ele ainda
    // não existe (aluno que até então usava a senha padrão).
    const senhaHash = await gerarHashSha256(String(novaSenha ?? ""));
    try {
      await setDoc(doc(db, "senhasAlunos", raDigitado), { senhaHash }, { merge: true });
    } catch (erro) {
      throw new Error(
        `Não foi possível salvar a nova senha do aluno (RA ${raDigitado}) no Firestore: ${erro.message}`,
        { cause: erro }
      );
    }

    return { ra: raDigitado, senhaAlterada: true };
  },

  /* ---------------------------------------------------------------
     TROCA DE SENHA DO PROFESSOR
     Confere a senha atual com autenticarProfessor e, se estiver certa,
     grava o SHA-256 da nova senha em senhasProfessores/{RA}.senhaHash —
     o mesmo formato que o login lê (ver autenticarProfessor). Enquanto
     a gravação não dá certo, a senha antiga continua valendo.
       - senha atual errada ou RA inválido -> lança
         Error("senha atual incorreta")
       - falha técnica (Firestore fora do ar, crypto.subtle
         indisponível etc.) -> sobe Error com contexto, para a tela
         mostrar o problema real (não é "senha atual incorreta")
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

    // 2) grava a nova senha: só o campo "senhaHash" no documento
    // senhasProfessores/{RA}. O merge: true preserva outros campos que o
    // documento já tenha, e o setDoc cria o documento quando ele ainda
    // não existe (professor que até então usava a senha padrão).
    const senhaHash = await gerarHashSha256(String(novaSenha ?? ""));
    try {
      await setDoc(doc(db, "senhasProfessores", raDigitado), { senhaHash }, { merge: true });
    } catch (erro) {
      throw new Error(
        `Não foi possível salvar a nova senha do professor (RA ${raDigitado}) no Firestore: ${erro.message}`,
        { cause: erro }
      );
    }

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

  // grava uma ocorrência nova na coleção "ocorrencias" do Firestore
  // (o addDoc gera o id do documento automaticamente)
  async criarOcorrencia({ professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes }) {
    const nova = {
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
    const referencia = await addDoc(collection(db, "ocorrencias"), nova);
    avisarMudancaOcorrencias();
    // devolve a ocorrência já com o id do documento criado no Firestore
    return { id: referencia.id, ...nova };
  },

  async listarOcorrencias({ apenasAbertas } = {}) {
    const limite = limiteDeRetencaoISO();
    // só a semana atual: o que foi criado antes da segunda 00:00 fica de fora
    const lista = (await lerOcorrencias()).filter((o) => (o.criadaEm || "") >= limite);
    if (!apenasAbertas) return lista;
    return lista.filter((o) => o.status !== "RESOLVIDA");
  },

  // muda só o campo "status" do documento correspondente na coleção
  // "ocorrencias" (o id é o id do documento no Firestore)
  async atualizarStatus(id, novoStatus) {
    await updateDoc(doc(db, "ocorrencias", id), { status: novoStatus });
    avisarMudancaOcorrencias();
    return { id, status: novoStatus };
  },

  // escuta a coleção "ocorrencias" EM TEMPO REAL (onSnapshot do Firestore):
  // agora a novidade chega em qualquer aparelho, não só na mesma aba.
  // O PRIMEIRO snapshot é ignorado de propósito — quem chamou já faz o
  // primeiro desenho do painel por conta própria, então avisar nesse
  // instante só tocaria alerta/notificação à toa ao abrir a tela. Do
  // segundo snapshot em diante, qualquer mudança chama callback().
  // Devolve a função que cancela a escuta (o unsubscribe do onSnapshot).
  aoMudar(callback) {
    let primeiroSnapshot = true;
    return onSnapshot(
      query(collection(db, "ocorrencias"), where("criadaEm", ">=", limiteDeRetencaoISO())),
      () => {
        if (primeiroSnapshot) {
          primeiroSnapshot = false;
          return;
        }
        callback();
      },
      (erro) => console.error('Falha ao escutar em tempo real a coleção "ocorrencias".', erro)
    );
  },

  // grava uma entrada atrasada nova na coleção "atrasos" do Firestore
  // (o addDoc gera o id do documento automaticamente)
  async criarEntradaAtrasada({ alunoId, alunoNome, alunoRa, turma, motivo }) {
    const nova = {
      alunoId,
      alunoNome,
      alunoRa,
      turma: turma || null,
      motivo,
      status: "NOVA",
      criadaEm: new Date().toISOString(),
      atualizadaEm: new Date().toISOString(),
    };
    const referencia = await addDoc(collection(db, "atrasos"), nova);
    avisarMudancaEntradasAtrasadas();
    // devolve a entrada atrasada já com o id do documento criado no Firestore
    return { id: referencia.id, ...nova };
  },

  async listarEntradasAtrasadas({ apenasAbertas } = {}) {
    const limite = limiteDeRetencaoISO();
    // só a semana atual: o que foi criado antes da segunda 00:00 fica de fora
    const lista = (await lerEntradasAtrasadas()).filter((e) => (e.criadaEm || "") >= limite);
    if (!apenasAbertas) return lista;
    return lista.filter((e) => e.status !== "RESOLVIDA");
  },

  // muda só o campo "status" do documento correspondente na coleção "atrasos"
  async atualizarStatusEntradaAtrasada(id, novoStatus) {
    await updateDoc(doc(db, "atrasos", id), { status: novoStatus });
    avisarMudancaEntradasAtrasadas();
    return { id, status: novoStatus };
  },

  // igual ao aoMudar acima, mas pra fila de entradas atrasadas: escuta a
  // coleção "atrasos" em tempo real, ignorando o primeiro snapshot
  aoMudarEntradasAtrasadas(callback) {
    let primeiroSnapshot = true;
    return onSnapshot(
      query(collection(db, "atrasos"), where("criadaEm", ">=", limiteDeRetencaoISO())),
      () => {
        if (primeiroSnapshot) {
          primeiroSnapshot = false;
          return;
        }
        callback();
      },
      (erro) => console.error('Falha ao escutar em tempo real a coleção "atrasos".', erro)
    );
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
