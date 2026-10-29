/*
 * Página da enfermagem: triagem dos alertas (RF25–RF28) e consulta do processo
 * (resumo, evolução e registos). A enfermagem não altera informação clínica.
 */

// ---------- Alertas: o que é próprio da enfermagem ----------
function filtrosDaPagina() {
  return [
    ['abertos', 'Por concluir', a => a.estado_atual !== 'Concluído'],
    ['pendentes', 'Pendentes', a => a.estado_atual === 'Pendente'],
    ['concluidos', 'Concluídos', a => a.estado_atual === 'Concluído'],
    ['todos', 'Todos', () => true]
  ];
}
const alertaPorTratarDaPagina = a => a.estado_atual === 'Pendente';

function acoesAlertaDaPagina(a) {
  const id = escapar(a.id_alerta);
  let triagem = '';
  if (a.estado_atual === 'Encaminhado') {
    triagem = '<p class="muted pequeno">A aguardar avaliação do médico responsável.</p>';
  } else if (a.estado_atual !== 'Concluído') {
    // Só se oferecem as passagens de estado possíveis a partir do estado atual (UC05).
    const estados = [['Em análise', 'Em análise'], ['Encaminhado', 'Encaminhar ao médico'], ['Concluído', 'Concluir sem encaminhamento']]
      .filter(([v]) => v !== a.estado_atual);
    triagem = `<details class="triagem"><summary>Registar triagem</summary>
      <div class="linha-campos" style="margin-top:.5rem">
        <div><label for="estado_${id}">Ação</label><select id="estado_${id}">${estados.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
        <div><label for="prioridade_${id}">Prioridade</label><select id="prioridade_${id}">${['Baixa', 'Média', 'Alta', 'Crítica'].map(pr => `<option ${a.prioridade === pr ? 'selected' : ''}>${pr}</option>`).join('')}</select></div>
      </div>
      <label for="nota_${id}">Nota de triagem</label>
      <textarea id="nota_${id}" maxlength="500" placeholder="Ex.: contacto telefónico, avaliação realizada, motivo do encaminhamento"></textarea>
      <button type="button" data-triar="${id}">Guardar triagem</button></details>`;
  }
  return `<div class="acoes">${botaoAbrirProcesso(a)}</div>${triagem}`;
}

async function aoClicarAlertaDaPagina(evento) {
  const triar = evento.target.closest('[data-triar]');
  if (!triar) return;
  const id = triar.dataset.triar;
  const nota = $(`nota_${id}`).value.trim();
  if (!nota) { mostrarMensagem('Escreva uma nota de triagem antes de guardar.', 'error'); $(`nota_${id}`).focus(); return; }
  try {
    await pedidoApi(`/api/alertas/${encodeURIComponent(id)}/triagem`, { method: 'PUT', body: JSON.stringify({
      estado_novo: $(`estado_${id}`).value, prioridade: $(`prioridade_${id}`).value, nota_triagem: nota
    }) });
    mostrarMensagem('Triagem do alerta registada.', 'success');
    await atualizarTudo();
    if (processoAtual) await carregarProcesso();
  } catch (erro) { mostrarMensagem(erro.message, 'error'); }
}

// ---------- Desenho do processo ----------
function aoCarregarProcesso() {
  renderizarResumo();
}

// ---------- Arranque ----------
iniciarPagina({
  perfis: ['ENFERMEIRO'],
  separadores: [['alertas', 'Alertas'], ['resumo', 'Resumo clínico'], ['diagnostico', 'Diagnóstico e medicação'], ['evolucao', 'Evolução'], ['historico', 'Registos do doente']],
  semBarraDoente: ['alertas'],
  separadorInicial: 'alertas',
  depoisDeCarregar: async () => {
    ligarAlertas();
    await carregarAlertas();
  }
});
