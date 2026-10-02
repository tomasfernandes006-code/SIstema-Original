// Módulo de notificações push (Web Push padrão, sem Firebase).
// Responsabilidade única: pedir permissão, registrar o service worker
// (sw.js), criar a inscrição push do navegador com a chave VAPID pública e
// guardar essa inscrição no Supabase para que o servidor possa mandar as
// notificações para a secretaria.
import { supabase } from "./supabase-config.js";

// Chave pública VAPID (Web Push) do servidor que envia as notificações.
// A chave privada correspondente fica só no servidor, nunca aqui no site.
const VAPID_PUBLICA = "BDPxs1z0JSD96MYZdWS212D2d9Qwg2xkNuoPRgTMa_7nhP_6souZmx-6s8Fcbh2oCk36PE944gp46WLsvSyYRp8";

// converte a chave VAPID de base64url (formato em que ela é publicada) para
// o Uint8Array que o pushManager.subscribe espera em applicationServerKey
function converterChaveBase64Url(chave) {
  const preenchimento = "=".repeat((4 - (chave.length % 4)) % 4);
  const base64 = (chave + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

/**
 * Ativa as notificações push para a secretaria:
 *   1) pede a permissão de notificação no navegador;
 *   2) registra o service worker sw.js na raiz (scope "/");
 *   3) cria a inscrição push deste navegador (pushManager.subscribe);
 *   4) grava/atualiza a inscrição na tabela "push_subscriptions" do
 *      Supabase, usando o endpoint como chave (onConflict "endpoint").
 * Devolve o endpoint (string) em caso de sucesso, ou null se algo impedir.
 */
export async function ativarPush() {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return null;
  }

  try {
    // 1) permissão do navegador
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") return null;

    // 2) service worker na raiz (mesmo escopo do app)
    const registro = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // 3) inscrição push deste dispositivo/navegador
    const assinatura = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: converterChaveBase64Url(VAPID_PUBLICA),
    });

    const endpoint = assinatura.endpoint;

    // 4) grava/atualiza no Supabase: o endpoint identifica o dispositivo
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          endpoint,
          subscription: assinatura.toJSON(),
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("Não foi possível salvar a inscrição push no Supabase.", error);
      return null;
    }

    return endpoint;
  } catch (erro) {
    // navegador sem suporte, service worker bloqueado, push desligado etc.
    console.error("Não foi possível ativar as notificações push.", erro);
    return null;
  }
}