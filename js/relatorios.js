/* =====================================================================
   RELATÓRIOS EM PDF — semana atual (de segunda 00:00 até agora)
   ---------------------------------------------------------------------
   Cada seção do painel da secretaria tem o seu botão e gera o seu
   próprio PDF: um só de ocorrências e outro só de entradas atrasadas.
   O PDF traz TODOS os registros da semana atual, sem depender do filtro
   "Em aberto / Todas". Os dados vêm de Dados.listarOcorrencias() e
   Dados.listarEntradasAtrasadas(), que já devolvem só a semana atual.
   Usa jsPDF + AutoTable (carregados no <head> do index.html).
   ===================================================================== */
(function () {
  const ROTULO_TIPO = { INDISCIPLINA: "Indisciplina", ATRASO: "Atraso", MATERIAL: "Sem material", SAUDE: "Saúde", OUTRO: "Outro" };
  const ROTULO_GRAVIDADE = { LEVE: "Leve", MODERADA: "Moderada", GRAVE: "Grave" };
  const ROTULO_STATUS = { NOVA: "Nova", LIDA: "Vista", EM_ANDAMENTO: "Em andamento", RESOLVIDA: "Resolvida" };

  function dataHora(iso) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function baixarPdf({ titulo, prefixoArquivo, cabecalho, linhas, colunas }) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("Não foi possível carregar o gerador de PDF. Verifique a internet e recarregue a página.");
      return;
    }
    if (linhas.length === 0) {
      alert("Não há registros nesta semana para gerar o PDF.");
      return;
    }

    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const fim = new Date();
    const inicio = window.Dados.inicioDaSemana(); // segunda-feira desta semana

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(titulo, 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      `Período: ${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}   |   Total de registros: ${linhas.length}`,
      14, 23
    );
    doc.text(`Gerado em ${dataHora(fim.toISOString())}`, 14, 28);

    doc.autoTable({
      head: [cabecalho],
      body: linhas,
      startY: 33,
      margin: { left: 14, right: 14, bottom: 16 },
      styles: { fontSize: 9, cellPadding: 2, valign: "top", overflow: "linebreak" },
      headStyles: { fillColor: [30, 42, 69] },
      alternateRowStyles: { fillColor: [245, 247, 251] },
      columnStyles: colunas,
    });

    const paginas = doc.internal.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(
        `Página ${i} de ${paginas}`,
        doc.internal.pageSize.getWidth() - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: "right" }
      );
    }

    const dia = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-${String(fim.getDate()).padStart(2, "0")}`;
    doc.save(`${prefixoArquivo}-${dia}.pdf`);
  }

  // busca os dados na hora do clique (assim o PDF sai sempre atualizado),
  // trava o botão enquanto trabalha e avisa se algo der errado
  async function gerar(botao, buscar, montar) {
    botao.disabled = true;
    try {
      let registros;
      try {
        registros = await buscar();
      } catch (erro) {
        console.error("Não foi possível buscar os dados para o PDF.", erro);
        alert("Não foi possível buscar os dados para o PDF. Tente de novo.");
        return;
      }
      const ordenados = [...registros].sort((a, b) => String(a.criadaEm).localeCompare(String(b.criadaEm)));
      montar(ordenados);
    } finally {
      botao.disabled = false;
    }
  }

  const botaoOcorrencias = document.getElementById("pn-imprimir-ocorrencias");
  const botaoAtrasos = document.getElementById("pn-imprimir-atrasos");

  if (botaoOcorrencias) {
    botaoOcorrencias.addEventListener("click", () =>
      gerar(botaoOcorrencias, () => window.Dados.listarOcorrencias(), (lista) =>
        baixarPdf({
          titulo: "Ocorrências da semana",
          prefixoArquivo: "ocorrencias",
          cabecalho: ["Data e hora", "Aluno", "RA", "Turma", "Tipo", "Gravidade", "Professor(a)", "Situação", "Detalhes"],
          linhas: lista.map((o) => [
            dataHora(o.criadaEm),
            o.alunoNome || "-",
            o.alunoRa || "-",
            o.turma || "-",
            ROTULO_TIPO[o.tipo] || o.tipo || "-",
            ROTULO_GRAVIDADE[o.gravidade] || o.gravidade || "-",
            o.professorNome || "-",
            ROTULO_STATUS[o.status] || o.status || "-",
            o.detalhes || "-",
          ]),
          colunas: {
            0: { cellWidth: 30 }, 1: { cellWidth: 34 }, 2: { cellWidth: 15 }, 3: { cellWidth: 16 },
            4: { cellWidth: 24 }, 5: { cellWidth: 20 }, 6: { cellWidth: 32 }, 7: { cellWidth: 22 },
          },
        })
      )
    );
  }

  if (botaoAtrasos) {
    botaoAtrasos.addEventListener("click", () =>
      gerar(botaoAtrasos, () => window.Dados.listarEntradasAtrasadas(), (lista) =>
        baixarPdf({
          titulo: "Entradas atrasadas da semana",
          prefixoArquivo: "entradas-atrasadas",
          cabecalho: ["Data e hora", "Aluno", "RA", "Turma", "Situação", "Motivo"],
          linhas: lista.map((e) => [
            dataHora(e.criadaEm),
            e.alunoNome || "-",
            e.alunoRa || "-",
            e.turma || "-",
            ROTULO_STATUS[e.status] || e.status || "-",
            e.motivo || "-",
          ]),
          colunas: {
            0: { cellWidth: 32 }, 1: { cellWidth: 48 }, 2: { cellWidth: 18 }, 3: { cellWidth: 22 }, 4: { cellWidth: 26 },
          },
        })
      )
    );
  }
})();