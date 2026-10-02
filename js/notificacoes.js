const Notificacoes = {
  async pedirPermissao() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const resposta = await Notification.requestPermission();
    return resposta === "granted";
  },

  notificar(titulo, corpo) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const opcoes = { body: corpo, icon: "assets/icone-ocorrencia.svg" };

    // caminho principal: mostrar pela registration do service worker,
    // que funciona também onde `new Notification` é bloqueado (ex.: Chrome
    // no Android). Se não houver service worker ou o showNotification
    // falhar, cai no fallback atual com `new Notification`.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registro) => registro.showNotification(titulo, opcoes))
        .catch(() => {
          try {
            new Notification(titulo, opcoes);
          } catch {
            // alguns navegadores de celular não permitem `new Notification` direto;
            // nesse caso, o som e a atualização da tela ainda acontecem normalmente.
          }
        });
      return;
    }

    try {
      new Notification(titulo, opcoes);
    } catch {
      // alguns navegadores de celular não permitem `new Notification` direto;
      // nesse caso, o som e a atualização da tela ainda acontecem normalmente.
    }
  },

  tocarAlerta() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // ambiente sem suporte a áudio - ignora
    }
  },
};
