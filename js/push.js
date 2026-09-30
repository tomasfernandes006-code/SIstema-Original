// Módulo de notificações push (Firebase Cloud Messaging).
// Responsabilidade única: pedir permissão, registrar o service worker,
// obter o token do FCM e guardar esse token no Firestore para que o
// servidor possa mandar as notificações para a secretaria.
import { db, messaging } from "./firebase-config.js";
import { getToken } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Chave pública VAPID (Web Push) do projeto Firebase:
// Console do Firebase > Configurações do projeto > Cloud Messaging >
// "Web Push certificates" > copie a chave e cole aqui.
const VAPID_KEY = "COLE_AQUI_A_SUA_VAPID_KEY";

/**
 * Ativa as notificações push para a secretaria:
 *   1) pede a permissão de notificação no navegador;
 *   2) registra o service worker firebase-messaging-sw.js;
 *   3) obtém o token do FCM com getToken(messaging, { vapidKey });
 *   4) grava o token na coleção "tokensPush" (id do documento = token).
 * Devolve o token (string) em caso de sucesso, ou null se algo impedir.
 */
export async function ativarPush() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;

  // 1) permissão do navegador
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return null;

  // sem instância de messaging (ambiente sem suporte) não há o que fazer
  if (!messaging) return null;

  // 2) registra o service worker na raiz (mesmo escopo do app)
  const registro = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/",
  });

  // 3) token do FCM para este dispositivo/navegador
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registro,
  });
  if (!token) return null;

  // 4) grava/atualiza no Firestore: id do documento = token
  await setDoc(doc(db, "tokensPush", token), {
    token,
    tipo: "SECRETARIA",
    atualizadoEm: new Date().toISOString(),
  });

  return token;
}