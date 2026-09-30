// Service worker do Firebase Cloud Messaging.
// Usa a versão compat 10.7.0 (importScripts não suporta módulos ES).
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

// Mesma configuração de js/firebase-config.js
const firebaseConfig = {
  apiKey: "AIzaSyCguKS7OEZAxMXknZwNgBBUi28q6hL1ttg",
  authDomain: "sistema-original.firebaseapp.com",
  projectId: "sistema-original",
  storageBucket: "sistema-original.firebasestorage.app",
  messagingSenderId: "772648678837",
  appId: "1:772648678837:web:d024aa65fb67c573df15fc",
  measurementId: "G-FR6C45EWQK"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// As mensagens chegam apenas com o campo "data" (sem "notification"),
// então tratamos tudo aqui no background.
messaging.onBackgroundMessage((message) => {
  const data = (message && message.data) || {};
  const title = data.title || "Nova notificação";
  const body = data.body || "";
  const url = data.url || "/#/painel";

  self.registration.showNotification(title, {
    body: body,
    icon: "assets/icone-ocorrencia.svg",
    badge: "assets/icone-ocorrencia.svg",
    data: { url: url }
  });
});

// Ao clicar na notificação: foca uma aba já aberta ou abre "/#/painel".
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/#/painel";

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