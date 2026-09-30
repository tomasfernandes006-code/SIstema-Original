// Cloud Functions (v2) que avisam a secretaria por push quando chega uma
// ocorrência nova ou uma entrada atrasada nova.
//
// Como funciona: as funções reagem à CRIAÇÃO de documentos no Firestore
// (onDocumentCreated). Ao criar um documento, elas leem TODOS os tokens
// guardados na coleção "tokensPush" (gravados pelo js/push.js do site) e
// mandam UMA notificação para cada token com sendEachForMulticast.
//
// As mensagens vão SÓ com "data" (sem bloco "notification") — de propósito,
// para que o service worker (firebase-messaging-sw.js) trate tudo no
// background e monte o showNotification com os campos title/body/url.
//
// A região é southamerica-east1 (São Paulo), a mesma do Firestore.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const logger = require("firebase-functions/logger");

initializeApp();

const REGIAO = "southamerica-east1";
const URL_DESTINO = "/#/painel";

const db = getFirestore();

// Manda a notificação para todos os tokens da coleção "tokensPush".
// Os tokens que o FCM recusar como "não registrados" são apagados da
// coleção, para não acumular lixo de aparelhos que desinstalaram o app
// ou limparam os dados do navegador.
async function enviarParaTodosOsTokens(title, body) {
  const snapshot = await db.collection("tokensPush").get();
  const tokens = snapshot.docs.map((documento) => documento.id).filter(Boolean);

  if (tokens.length === 0) {
    logger.info("Nenhum token em tokensPush; nada para enviar.");
    return;
  }

  const resposta = await getMessaging().sendEachForMulticast({
    tokens,
    // só "data": o contentor do service worker monta o showNotification
    data: { title, body, url: URL_DESTINO },
  });

  logger.info(`Push enviado: ${resposta.successCount} sucesso(s), ${resposta.failureCount} falha(s).`);

  // apaga os tokens inválidos (aparelho que não existe mais)
  const apagamentos = [];
  resposta.responses.forEach((resultado, indice) => {
    if (!resultado.success) {
      const codigo = resultado.error?.code || "";
      if (codigo.includes("registration-token-not-registered")) {
        apagamentos.push(db.collection("tokensPush").doc(tokens[indice]).delete());
      } else {
        logger.warn(`Falha ao enviar para um token: ${codigo || resultado.error?.message}`);
      }
    }
  });

  if (apagamentos.length) await Promise.all(apagamentos);
}

// Nova ocorrência criada em "ocorrencias/{id}"
exports.novaOcorrencia = onDocumentCreated(
  { document: "ocorrencias/{id}", region: REGIAO },
  async (event) => {
    const dados = event.data?.data();
    if (!dados) return;

    const title = "Nova ocorrência";
    const body = `${dados.alunoNome} (RA ${dados.alunoRa}) — ${dados.tipo}`;

    await enviarParaTodosOsTokens(title, body);
  }
);

// Nova entrada atrasada criada em "atrasos/{id}"
exports.novaEntradaAtrasada = onDocumentCreated(
  { document: "atrasos/{id}", region: REGIAO },
  async (event) => {
    const dados = event.data?.data();
    if (!dados) return;

    const title = "Nova entrada atrasada";
    const body = `${dados.alunoNome} (RA ${dados.alunoRa}) registrou um atraso`;

    await enviarParaTodosOsTokens(title, body);
  }
);