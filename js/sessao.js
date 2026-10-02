const CHAVE_SESSAO = "livro-ocorrencias:sessao";

const Sessao = {
  salvar(usuario) {
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(usuario));
  },
  obter() {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO));
    } catch {
      return null;
    }
  },
  encerrar() {
    sessionStorage.removeItem(CHAVE_SESSAO);
  },
};
