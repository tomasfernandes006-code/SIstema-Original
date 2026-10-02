// Service worker das notificações push (Web Push padrão, sem Firebase).
// O servidor manda o corpo da mensagem como JSON: { title, body, url }.
self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    // corpo que não é JSON: cai nos valores padrão abaixo
    dados = {};
  }

  const title = dados.title || "Nova notificação";
  const body = dados.body || "";
  const url = dados.url || "./#/painel";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "assets/icone-ocorrencia.svg",
      badge: "assets/icone-ocorrencia.svg",
      data: { url: url },
    })
  );
});

// Ao clicar na notificação: foca uma aba já aberta ou abre "/#/painel".
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "./#/painel";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
