const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------
// BANCO DE DADOS (arquivo local "banco.db", criado automaticamente)
// ---------------------------------------------------------------
const db = new Database(path.join(__dirname, "banco.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS ocorrencias (
    id TEXT PRIMARY KEY,
    professorId TEXT,
    professorNome TEXT,
    alunoNome TEXT,
    alunoRa TEXT,
    turma TEXT,
    tipo TEXT,
    gravidade TEXT,
    detalhes TEXT,
    status TEXT,
    criadaEm TEXT,
    atualizadaEm TEXT
  );

  CREATE TABLE IF NOT EXISTS entradas_atrasadas (
    id TEXT PRIMARY KEY,
    alunoId TEXT,
    alunoNome TEXT,
    alunoRa TEXT,
    turma TEXT,
    motivo TEXT,
    status TEXT,
    criadaEm TEXT,
    atualizadaEm TEXT
  );
`);

// ---------------------------------------------------------------
// USUÁRIOS (professor / secretaria) — os mesmos de antes, fixos
// ---------------------------------------------------------------
const USUARIOS = [
  { id: "p1", nome: "Ana Souza", matricula: "1001", pin: "1234", tipo: "PROFESSOR" },
  { id: "p2", nome: "Carlos Lima", matricula: "1002", pin: "5678", tipo: "PROFESSOR" },
  { id: "s1", nome: "Secretaria Central", usuario: "secretaria", senha: "1234", tipo: "SECRETARIA" },
];

const SENHA_ALUNOS = "@Coronel2026";

// ---------------------------------------------------------------
// ALUNOS — lidos do alunos.json (coloque uma cópia dele do lado
// deste arquivo servidor.js)
// ---------------------------------------------------------------
function lerAlunos() {
  const caminho = path.join(__dirname, "alunos.json");
  const conteudo = fs.readFileSync(caminho, "utf8");
  return JSON.parse(conteudo);
}

// ---------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------
app.post("/login/professor", (req, res) => {
  const { matricula, pin } = req.body;
  const professor = USUARIOS.find(
    (u) => u.tipo === "PROFESSOR" && u.matricula === matricula && u.pin === pin
  );
  if (!professor) return res.status(401).json({ erro: "Matrícula ou PIN inválidos" });
  res.json(professor);
});

app.post("/login/secretaria", (req, res) => {
  const { usuario, senha } = req.body;
  const conta = USUARIOS.find(
    (u) => u.tipo === "SECRETARIA" && u.usuario === usuario && u.senha === senha
  );
  if (!conta) return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  res.json(conta);
});

app.post("/login/aluno", (req, res) => {
  const { ra, senha } = req.body;
  if (senha !== SENHA_ALUNOS) return res.status(401).json({ erro: "RA ou senha inválidos" });

  const alunos = lerAlunos();
  const aluno = alunos.find((a) => String(a.RA) === String(ra));
  if (!aluno) return res.status(401).json({ erro: "RA ou senha inválidos" });

  res.json({
    id: "aluno-" + aluno.RA,
    tipo: "ALUNO",
    ra: aluno.RA,
    nome: aluno.nome,
    sala: aluno.sala,
    turno: aluno.turno,
    turma: aluno.sala,
  });
});

// ---------------------------------------------------------------
// ALUNOS
// ---------------------------------------------------------------
app.get("/alunos", (req, res) => {
  res.json(lerAlunos());
});

// ---------------------------------------------------------------
// OCORRÊNCIAS
// ---------------------------------------------------------------
app.get("/ocorrencias", (req, res) => {
  const lista = db.prepare("SELECT * FROM ocorrencias ORDER BY criadaEm DESC").all();
  res.json(lista);
});

app.post("/ocorrencias", (req, res) => {
  const { professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes } = req.body;
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

  db.prepare(`
    INSERT INTO ocorrencias (id, professorId, professorNome, alunoNome, alunoRa, turma, tipo, gravidade, detalhes, status, criadaEm, atualizadaEm)
    VALUES (@id, @professorId, @professorNome, @alunoNome, @alunoRa, @turma, @tipo, @gravidade, @detalhes, @status, @criadaEm, @atualizadaEm)
  `).run(nova);

  res.json(nova);
});

app.patch("/ocorrencias/:id", (req, res) => {
  const { status } = req.body;
  const atualizadaEm = new Date().toISOString();

  const resultado = db.prepare(
    "UPDATE ocorrencias SET status = ?, atualizadaEm = ? WHERE id = ?"
  ).run(status, atualizadaEm, req.params.id);

  if (resultado.changes === 0) return res.status(404).json({ erro: "Ocorrência não encontrada" });

  const item = db.prepare("SELECT * FROM ocorrencias WHERE id = ?").get(req.params.id);
  res.json(item);
});

// ---------------------------------------------------------------
// ENTRADAS ATRASADAS
// ---------------------------------------------------------------
app.get("/atrasos", (req, res) => {
  const lista = db.prepare("SELECT * FROM entradas_atrasadas ORDER BY criadaEm DESC").all();
  res.json(lista);
});

app.post("/atrasos", (req, res) => {
  const { alunoId, alunoNome, alunoRa, turma, motivo } = req.body;
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

  db.prepare(`
    INSERT INTO entradas_atrasadas (id, alunoId, alunoNome, alunoRa, turma, motivo, status, criadaEm, atualizadaEm)
    VALUES (@id, @alunoId, @alunoNome, @alunoRa, @turma, @motivo, @status, @criadaEm, @atualizadaEm)
  `).run(nova);

  res.json(nova);
});

app.patch("/atrasos/:id", (req, res) => {
  const { status } = req.body;
  const atualizadaEm = new Date().toISOString();

  const resultado = db.prepare(
    "UPDATE entradas_atrasadas SET status = ?, atualizadaEm = ? WHERE id = ?"
  ).run(status, atualizadaEm, req.params.id);

  if (resultado.changes === 0) return res.status(404).json({ erro: "Entrada atrasada não encontrada" });

  const item = db.prepare("SELECT * FROM entradas_atrasadas WHERE id = ?").get(req.params.id);
  res.json(item);
});

// ---------------------------------------------------------------
app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});