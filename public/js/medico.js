/*
 * Página do médico: alertas encaminhados, resumo, diagnóstico e medicação (com registo de
 * diagnóstico, tratamentos e medicação), evolução, registos e gestão clínica
 * (KPS, plano de monitorização, decisão de acompanhamento, associação de cuidador e exportação FHIR).
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
    ['encaminhados', 'Encaminhados pela enfermagem', a => a.estado_atual === 'Encaminhado'],
    ['sem-triagem', 'Sem triagem', a => a.estado_atual === 'Pendente'],
    ['concluidos', 'Concluídos', a => a.estado_atual === 'Concluído'],
    ['todos', 'Todos', () => true]
  ];
}
const alertaPorTratarDaPagina = a => a.estado_atual === 'Encaminhado';

// Vista «Por concluir» do médico: primeiro o que a enfermagem já triou e lhe encaminhou,
// depois o que está em avaliação pela enfermagem e, por fim, o que ainda ninguém viu.
function seccoesAlertasDaPagina() {
  return [
    ['Encaminhados pela enfermagem', 'A enfermagem avaliou estes alertas e pede a sua decisão.', a => a.estado_atual === 'Encaminhado', 'destaque'],
    ['Em avaliação pela enfermagem', 'A enfermagem está a tratar destes alertas. Pode consultá-los ou decidir, se entender.', a => a.estado_atual === 'Em análise'],
    ['Ainda sem triagem', 'Gerados automaticamente pelo questionário; a enfermagem ainda não os avaliou.', a => a.estado_atual === 'Pendente', 'sem-triagem']
  ];
}

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

// ---------- Medicação: botões de cada linha ----------
function acoesMedicacaoDaPagina(m) {
  const id = escapar(m.id_medicacao);
  const botao = (estado, texto, classe = 'secundario') => `<button type="button" class="${classe}" data-med="${id}" data-med-estado="${estado}">${texto}</button>`;
  if (m.estado === 'ATIVA') return botao('SUSPENSA', 'Suspender') + botao('TERMINADA', 'Terminar');
  if (m.estado === 'SUSPENSA') return botao('ATIVA', 'Retomar') + botao('TERMINADA', 'Terminar');
  return '';
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
  const avaliacaoKpsVigente = ultimaKps &&
    ultimaKps.data_avaliacao >= new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10) &&
    ultimaKps.data_avaliacao <= new Date().toISOString().slice(0, 10);
  $('inputKps').value = avaliacaoKpsVigente ? String(ultimaKps.score_kps) : '';
  $('avisoKps').classList.toggle('hidden', !$('inputKps').value || Number($('inputKps').value) > 70);
  const plano = p.planos.find(pl => pl.estado === 'ATIVO');
  $('planoAtualTexto').textContent = plano ? `Atualmente: um registo a cada ${plano.periodicidade_dias} dia(s), definido em ${dataCurta(plano.data_definicao)}.` : 'Sem plano definido.';
  if (plano) $('inputPeriodicidade').value = plano.periodicidade_dias;
  $('diagData').value = d.data_diagnostico || '';
  $('diagLocalizacao').value = d.codigo_cid10 || '';
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
// Doses mais usadas por substância (código ATC), só como sugestão: o médico pode escrever outra.
const DOSES_COMUNS = {
  L01AX03: ['75 mg/m²', '150 mg/m²', '200 mg/m²'], L01AD02: ['90 mg/m²', '110 mg/m²', '130 mg/m²'],
  L01AD01: ['150 mg/m²', '200 mg/m²'], L01XB01: ['60 mg/m²'], L01CA02: ['1,4 mg/m²'], L01FG01: ['5 mg/kg', '10 mg/kg'],
  H02AB02: ['1 mg', '2 mg', '4 mg', '8 mg'], N03AX14: ['250 mg', '500 mg', '750 mg', '1000 mg'],
  N03AX18: ['50 mg', '100 mg', '150 mg', '200 mg'], N03AG01: ['300 mg', '500 mg'], N03AX09: ['25 mg', '50 mg', '100 mg'],
  N05BA09: ['10 mg'], N05BA06: ['1 mg', '2,5 mg'], A04AA01: ['4 mg', '8 mg'], A03FA01: ['10 mg'],
  A02BC02: ['20 mg', '40 mg'], A02BC01: ['20 mg', '40 mg'], N02BE01: ['500 mg', '1 g'], N02AA01: ['5 mg', '10 mg'],
  A06AD11: ['10 ml', '15 ml'], J01EE01: ['400 mg + 80 mg', '800 mg + 160 mg'], B01AB05: ['40 mg', '60 mg']
};

// Listas de códigos normalizados: o médico escolhe pela designação e a base de dados guarda o código.
async function carregarCatalogosCodigos() {
  const { cid10, atc } = await pedidoApi('/api/codigos');
  const opcao = (codigo, texto) => `<option value="${escapar(codigo)}">${escapar(texto)}</option>`;
  $('diagLocalizacao').innerHTML = '<option value="">Selecionar</option>' + cid10.map(c => opcao(c.codigo, `${c.codigo} · ${c.designacao}`)).join('');
  $('medNome').innerHTML = '<option value="">Selecionar</option>' + atc.map(c => opcao(c.codigo, `${c.designacao} (${c.codigo})`)).join('');
  if (processoAtual?.diagnostico) $('diagLocalizacao').value = processoAtual.diagnostico.codigo_cid10 || '';
  tornarPesquisavel($('diagLocalizacao'), { placeholder: 'Ex.: frontal, C71.1…' });
  tornarPesquisavel($('medNome'), { placeholder: 'Escreva o nome ou o código ATC…' });
  sugerirEnquantoEscreve($('medDose'), () => DOSES_COMUNS[$('medNome').value] || [...new Set(Object.values(DOSES_COMUNS).flat())]);
  sugerirEnquantoEscreve($('diagFase'), sugestoesDaDatalist('listaFases'));
  sugerirEnquantoEscreve($('grauParentesco'), sugestoesDaDatalist('listaParentesco'));
}

function ligarGestao() {
  $('inputKps').innerHTML = '<option value="">Não registar avaliação</option>' +
    KPS.map(([v, d]) => `<option value="${v}">${v} — ${d}</option>`).join('');
  $('inputKps').addEventListener('change', () => $('avisoKps').classList.toggle(
    'hidden', !$('inputKps').value || Number($('inputKps').value) > 70
  ));

  $('guardarKps').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('kps'), { method: 'POST', body: JSON.stringify({ score_kps: $('inputKps').value }) }),
    'Avaliação KPS registada.', atualizarTudo));

  $('guardarPlano').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('planos'), { method: 'POST', body: JSON.stringify({ periodicidade_dias: $('inputPeriodicidade').value }) }),
    'Periodicidade de monitorização atualizada.', atualizarTudo));

  $('guardarDiagnostico').addEventListener('click', () => executarAcao(
    () => pedidoApi(urlDoente('diagnostico'), { method: 'PUT', body: JSON.stringify({
      data_diagnostico: $('diagData').value, codigo_cid10: $('diagLocalizacao').value, lateralidade: $('diagLateralidade').value,
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

  $('medInicio').value = new Date().toISOString().slice(0, 10);
  $('guardarMedicacao').addEventListener('click', () => executarAcao(async () => {
    await pedidoApi(urlDoente('medicacoes'), { method: 'POST', body: JSON.stringify({
      codigo_atc: $('medNome').value, dose: $('medDose').value, via: $('medVia').value, posologia: $('medPosologia').value || undefined,
      indicacao: $('medIndicacao').value || undefined, data_inicio: $('medInicio').value, observacoes: $('medObs').value || undefined
    }) });
    ['medNome', 'medDose', 'medPosologia', 'medIndicacao', 'medObs'].forEach(id => { $(id).value = ''; });
  }, 'Medicação registada.', atualizarTudo));
  $('dmMedicacao').addEventListener('click', evento => {
    const botao = evento.target.closest('[data-med]');
    if (!botao) return;
    const textos = { ATIVA: 'Medicação retomada.', SUSPENSA: 'Medicação suspensa.', TERMINADA: 'Medicação terminada.' };
    executarAcao(() => pedidoApi(urlDoente(`medicacoes/${encodeURIComponent(botao.dataset.med)}`), {
      method: 'PUT', body: JSON.stringify({ estado: botao.dataset.medEstado })
    }), textos[botao.dataset.medEstado], atualizarTudo);
  });

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

// ---------- Novo doente ----------
function ligarNovoDoente() {
  $('ndNascimento').max = new Date().toISOString().slice(0, 10);
  $('criarDoente').addEventListener('click', async () => {
    $('resultadoNovoDoente').innerHTML = '';
    try {
      const novo = await pedidoApi('/api/doentes', { method: 'POST', body: JSON.stringify({
        nome: $('ndNome').value, numero_processo_clinico: $('ndProcesso').value, data_nascimento: $('ndNascimento').value,
        sexo: $('ndSexo').value, email: $('ndEmail').value
      }) });
      ['ndNome', 'ndProcesso', 'ndNascimento', 'ndEmail'].forEach(id => { $(id).value = ''; });
      $('ndSexo').value = '';
      // A palavra-passe temporária só é mostrada agora: o médico entrega-a ao doente.
      $('resultadoNovoDoente').innerHTML = `<div class="notice" style="margin-top:1rem">
        <strong>${escapar(novo.nome)}</strong> foi criado(a) com o n.º de processo ${escapar(novo.numero_processo_clinico)}.<br />
        Entregue ao doente o email <code>${escapar(novo.email)}</code> e a palavra-passe temporária <code class="senha">${escapar(novo.palavra_passe_temporaria)}</code>.
        Esta palavra-passe não volta a ser mostrada.
        <div class="acoes" style="margin-top:.6rem"><button type="button" id="abrirNovoDoente" data-id="${escapar(novo.id_doente)}">Abrir processo e preencher o diagnóstico</button></div>
      </div>`;
      await atualizarTudo();
      mostrarMensagem(`Doente ${novo.nome} criado.`, 'success');
    } catch (erro) { $('resultadoNovoDoente').innerHTML = `<p class="error" role="alert">${escapar(erro.message)}</p>`; }
  });
  $('resultadoNovoDoente').addEventListener('click', async evento => {
    const botao = evento.target.closest('#abrirNovoDoente');
    if (!botao) return;
    await selecionarDoente(botao.dataset.id);
    renderizarListaDoentes();
    abrirSeparador('diagnostico');
    document.querySelector('#painel-diagnostico details.formulario-medico')?.setAttribute('open', '');
    window.scrollTo({ top: 0 });
  });
}

// ---------- Arranque ----------
iniciarPagina({
  perfis: ['MEDICO'],
  separadores: [['alertas', 'Alertas'], ['doentes', 'Doentes'], ['resumo', 'Resumo clínico'], ['diagnostico', 'Diagnóstico'], ['tratamentos', 'Tratamentos e medicação'], ['evolucao', 'Evolução'], ['historico', 'Registos do doente'], ['gestao', 'Gestão clínica']],
  semBarraDoente: ['alertas', 'doentes'],
  separadorInicial: 'alertas',
  depoisDeCarregar: async () => {
    ligarAlertas();
    ligarListaDoentes();
    ligarNovoDoente();
    ligarGestao();
    await carregarCatalogosCodigos();
    await carregarAlertas();
  }
});
