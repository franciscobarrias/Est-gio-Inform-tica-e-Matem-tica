/*
 * Página do médico: alertas encaminhados, resumo, evolução, registos e gestão clínica
 * (KPS, plano de monitorização, decisão de acompanhamento, diagnóstico, tratamentos,
 * associação de cuidador e exportação FHIR).
 */

const KPS = [
  [100, 'Normal; sem queixas nem sinais de doença'],
  [90, 'Atividade normal; sinais ou sintomas menores'],
  [80, 'Atividade normal com esforço; alguns sintomas'],
  [70, 'Cuida de si; incapaz de atividade normal ou de trabalhar'],
  [60, 'Necessita de assistência ocasional'],
  [50, 'Necessita de assistência considerável e cuidados médicos frequentes'],
  [40, 'Incapacitado; necessita de cuidados e assistência especiais'],
  [30, 'Gravemente incapacitado; hospitalização indicada'],
  [20, 'Muito doente; tratamento de suporte ativo necessário'],
  [10, 'Moribundo'],
  [0, 'Óbito']
];

// ---------- Alertas: o que é próprio do médico ----------
function filtrosDaPagina() {
  return [
    ['abertos', 'Por concluir', a => a.estado_atual !== 'Concluído'],
    ['encaminhados', 'Encaminhados para mim', a => a.estado_atual === 'Encaminhado'],
    ['concluidos', 'Concluídos', a => a.estado_atual === 'Concluído'],
    ['todos', 'Todos', () => true]
  ];
}
const alertaPorTratarDaPagina = a => a.estado_atual === 'Encaminhado';

function acoesAlertaDaPagina(a) {
  const decidir = a.estado_atual !== 'Concluído'
    ? ` <button type="button" data-decidir="${escapar(a.id_alerta)}" data-doente="${escapar(a.id_doente)}">Registar decisão</button>` : '';
  return `<div class="acoes">${botaoAbrirProcesso(a)}${decidir}</div>`;
}

async function aoClicarAlertaDaPagina(evento) {
  const decidir = evento.target.closest('[data-decidir]');
  if (!decidir) return;
  await selecionarDoente(decidir.dataset.doente);
  abrirSeparador('gestao');
  $('selectAlertaDecisao').value = decidir.dataset.decidir;
  $('cartaoDecisao').scrollIntoView({ block: 'start' });
  $('inputFundamentacao').focus();
}

// ---------- Desenho do processo ----------
function definirValorSelect(select, valor) {
  if (valor && ![...select.options].some(o => o.value === valor)) select.add(new Option(valor, valor));
  select.value = valor || '';
}

function aoCarregarProcesso() {
  renderizarResumo();
  renderizarGestao();
}

function renderizarGestao() {
  const p = processoAtual, d = p.diagnostico || {};
  const ultimaKps = p.avaliacoesKps[p.avaliacoesKps.length - 1];
  $('kpsAtualTexto').textContent = ultimaKps ? `Última avaliação: ${ultimaKps.score_kps} em ${dataCurta(ultimaKps.data_avaliacao)}.` : 'Sem avaliações anteriores.';
  $('inputKps').value = String(ultimaKps ? ultimaKps.score_kps : 100);
  $('avisoKps').classList.toggle('hidden', Number($('inputKps').value) > 70);
  const plano = p.planos.find(pl => pl.estado === 'ATIVO');
  $('planoAtualTexto').textContent = plano ? `Atualmente: um registo a cada ${plano.periodicidade_dias} dia(s), definido em ${dataCurta(plano.data_definicao)}.` : 'Sem plano definido.';
  if (plano) $('inputPeriodicidade').value = plano.periodicidade_dias;
  $('diagData').value = d.data_diagnostico || '';
  $('diagLocalizacao').value = d.localizacao_tumoral || '';
  definirValorSelect($('diagLateralidade'), d.lateralidade);
  definirValorSelect($('diagIdh'), d.estatuto_idh);
  definirValorSelect($('diagMgmt'), d.metilacao_mgmt);
  $('diagFase').value = d.fase_clinica_atual || '';
  const abertos = p.alertas.filter(a => a.estado_atual !== 'Concluído');
  $('selectAlertaDecisao').innerHTML = '<option value="">Sem alerta associado</option>' + abertos.map(a =>
    `<option value="${escapar(a.id_alerta)}">${escapar(a.prioridade)} · ${escapar(a.estado_atual)} · ${dataHora(a.data_hora_geracao)}</option>`).join('');
  const c = p.cuidadores || [];
  $('cuidadoresAtuais').innerHTML = c.length
    ? `<p class="notice pequeno">Cuidador(es) já associado(s): ${c.map(x => `${escapar(x.nome)} (${escapar(PARENTESCO[x.grau_parentesco] || x.grau_parentesco)})`).join(', ')}</p>` : '';
}

// ---------- Ações da gestão clínica ----------
function ligarGestao() {
  $('inputKps').innerHTML = KPS.map(([v, d]) => `<option value="${v}">${v} — ${d}</option>`).join('');
  $('inputKps').addEventListener('change', () => $('avisoKps').classList.toggle('hidden', Number($('inputKps').value) > 70));

  $('guardarKps').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('kps'), { method: 'POST', body: JSON.stringify({ score_kps: $('inputKps').value }) }),
    'Avaliação KPS registada.', atualizarTudo));

  $('guardarPlano').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('planos'), { method: 'POST', body: JSON.stringify({ periodicidade_dias: $('inputPeriodicidade').value }) }),
    'Periodicidade de monitorização atualizada.', atualizarTudo));

  $('guardarDiagnostico').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('diagnostico'), { method: 'PUT', body: JSON.stringify({
      data_diagnostico: $('diagData').value, localizacao_tumoral: $('diagLocalizacao').value, lateralidade: $('diagLateralidade').value,
      estatuto_idh: $('diagIdh').value, metilacao_mgmt: $('diagMgmt').value, fase_clinica_atual: $('diagFase').value
    }) }),
    'Diagnóstico atualizado.', atualizarTudo));

  $('guardarTratamento').addEventListener('click', () => executarAcao(async () => {
    await pedidoApi(urlDoente('tratamentos'), { method: 'POST', body: JSON.stringify({
      tipo: $('tratTipo').value, estado: $('tratEstado').value, data_inicio: $('tratInicio').value,
      data_fim: $('tratFim').value || undefined, descricao_esquema: $('tratDescricao').value
    }) });
    $('tratDescricao').value = ''; $('tratInicio').value = ''; $('tratFim').value = '';
  }, 'Tratamento registado.', atualizarTudo));

  $('guardarDecisao').addEventListener('click', () => executarAcao(async () => {
    await pedidoApi(urlDoente('decisoes'), { method: 'POST', body: JSON.stringify({
      decisao_medica: $('selectDecisao').value, fundamentacao_clinica: $('inputFundamentacao').value,
      id_alerta: $('selectAlertaDecisao').value || undefined
    }) });
    $('inputFundamentacao').value = '';
  }, 'Decisão de acompanhamento registada.', atualizarTudo));

  $('associarCuidador').addEventListener('click', () => executarAcao(async () => {
    await pedidoApi(urlDoente('cuidadores'), { method: 'POST', body: JSON.stringify({
      email_cuidador: $('emailCuidador').value, grau_parentesco: $('grauParentesco').value,
      consentimento_confirmado: $('consentimentoCuidador').checked
    }) });
    $('emailCuidador').value = ''; $('grauParentesco').value = ''; $('consentimentoCuidador').checked = false;
  }, 'Cuidador autorizado associado.', atualizarTudo));

  const obterFhir = () => pedidoApi(`/api/fhir/Patient/${encodeURIComponent(idDoenteAtivo)}/$everything`);
  $('abrirFhir').addEventListener('click', async () => {
    try {
      const bundle = await obterFhir();
      $('conteudoFhir').textContent = JSON.stringify(bundle, null, 2);
      $('resultadoFhir').classList.remove('hidden');
      $('resultadoFhir').open = true;
      mostrarMensagem(`Bundle FHIR gerado com ${bundle.total} recursos.`, 'success');
    } catch (erro) { mostrarMensagem(erro.message, 'error'); }
  });
  $('descarregarFhir').addEventListener('click', async () => {
    try {
      const bundle = await obterFhir();
      const ligacao = document.createElement('a');
      ligacao.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' }));
      ligacao.download = `fhir-${processoAtual?.doente?.numero_processo_clinico || idDoenteAtivo}.json`;
      ligacao.click();
      URL.revokeObjectURL(ligacao.href);
    } catch (erro) { mostrarMensagem(erro.message, 'error'); }
  });
}

// ---------- Arranque ----------
iniciarPagina({
  perfis: ['MEDICO'],
  separadores: [['alertas', 'Alertas'], ['resumo', 'Resumo clínico'], ['evolucao', 'Evolução'], ['historico', 'Registos do doente'], ['gestao', 'Gestão clínica']],
  semBarraDoente: ['alertas'],
  separadorInicial: 'alertas',
  depoisDeCarregar: async () => {
    ligarAlertas();
    ligarGestao();
    await carregarAlertas();
  }
});
