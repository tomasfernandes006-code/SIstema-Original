// Supabase Edge Function (Deno) que avisa a secretaria por push (Web Push)
// quando chega uma ocorrência nova ou uma entrada atrasada nova.
//
// Como funciona: um Database Webhook do Supabase chama esta função a cada
// INSERT nas tabelas "ocorrencias" e "atrasos". A função:
//   1) confere o segredo enviado no header x-webhook-secret;
//   2) monta o título/corpo conforme a tabela do INSERT;
//   3) lê TODAS as inscrições guardadas em "push_subscriptions";
//   4) manda a mensagem (JSON {title, body, url}) para cada inscrição;
//   5) apaga as inscrições que o serviço de push recusou (statusCode 404/410).
//
// Segredos e chaves vêm das variáveis de ambiente da função (supabase secrets):
//   WEBHOOK_SECRET, VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são preenchidos pelo próprio
// ambiente das Edge Functions.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_DESTINO = "https://tomasfernandes006-code.github.io/SIstema-Original/#/painel";

// Cliente com a chave de serviço: lê e apaga linhas de push_subscriptions
// ignorando as políticas de RLS (é uma função do servidor).
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Chave privada VAPID fica só aqui no servidor, nunca no site.
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "",
  Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
  Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
);

// Manda a mensagem para todas as inscrições de push_subscriptions.
// As inscrições que o serviço de push recusar como "não registradas"
// (statusCode 404 ou 410) são apagadas da tabela, para não acumular lixo de
// aparelhos que desinstalaram o app ou limparam os dados do navegador.
async function enviarParaTodasAsInscricoes(title: string, body: string) {
  const { data, error } = await supabase.from("push_subscriptions").select("*");

  if (error) {
    console.error("Não foi possível ler push_subscriptions:", error.message);
    return;
  }

  const linhas = data ?? [];
  const corpo = JSON.stringify({ title, body, url: URL_DESTINO });

  for (const linha of linhas) {
    try {
      await webpush.sendNotification(linha.subscription, corpo);
    } catch (erro) {
      const statusCode = (erro as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // inscrição morta: apaga a linha
        const { error: erroApagar } = await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", linha.endpoint);
        if (erroApagar) {
          console.error("Não foi possível apagar a inscrição:", erroApagar.message);
        }
      } else {
        console.warn(`Falha ao enviar push para ${linha.endpoint}:`, erro);
      }
    }
  }
}

Deno.serve(async (req) => {
  // 1) segredo do webhook: sem ele, ninguém de fora dispara notificações
  const segredo = req.headers.get("x-webhook-secret");
  if (segredo !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Não autorizado", { status: 401 });
  }

  // 2) corpo do webhook: { type, table, record }
  let payload: { type?: string; table?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const record = payload.record ?? {};

  let title: string;
  let body: string;

  if (payload.table === "ocorrencias") {
    title = "Nova ocorrência";
    body = `${record.aluno_nome} (RA ${record.aluno_ra}) — ${record.tipo}`;
  } else if (payload.table === "atrasos") {
    title = "Nova entrada atrasada";
    body = `${record.aluno_nome} (RA ${record.aluno_ra}) registrou um atraso`;
  } else {
    // tabela sem notificação: nada a fazer, mas responde ok
    return new Response("ok", { status: 200 });
  }

  await enviarParaTodasAsInscricoes(title, body);

  return new Response("ok", { status: 200 });
});
