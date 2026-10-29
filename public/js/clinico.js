/*
 * Código partilhado entre o médico e a enfermagem: lista de alertas e resumo clínico.
 * As ações próprias de cada perfil sobre um alerta vêm da página:
 *   - acoesAlertaDaPagina(alerta) devolve o HTML dos botões ou formulários desse perfil;
 *   - aoClicarAlertaDaPagina(evento) trata os cliques nesses botões.
 */

let alertas = [];
let filtroAlertas = 'abertos';
const ORDEM_PRIORIDADE = { 'Crítica': 1, 'Alta': 2, 'Média': 3, 'Baixa': 4 };

// ---------- Alertas ----------
async function carregarAlertas() {
  try {
    alertas = await pedidoApi('/api/alertas');
    alertas.sort((a, b) => (ORDEM_PRIORIDADE[a.prioridade] || 9) - (ORDEM_PRIORIDADE[b.prioridade] || 9) ||
      String(b.data_hora_geracao).localeCompare(String(a.data_hora_geracao)));
    renderizarAlertas();
  } catch (erro) { mostrarMensagem(erro.message, 'error'); }
}

// filtrosDaPagina = [['id', 'Nome', função que diz se o alerta entra], ...]
function renderizarAlertas() {
  const filtros = filtrosDaPagina();
  $('filtrosAlertas').innerHTML = filtros.map(([id, nome, fn]) =>
    `<button type="button" data-filtro="${id}" aria-pressed="${filtroAlertas === id}">${nome} (${alertas.filter(fn).length})</button>`).join('');
  const porTratar = alertas.filter(alertaPorTratarDaPagina).length;
  const contador = $('contadorAlertas');
  if (contador) { contador.textContent = porTratar; contador.classList.toggle('hidden', !porTratar); contador.setAttribute('aria-label', `${porTratar} por tratar`); }
  const fn = (filtros.find(f => f[0] === filtroAlertas) || filtros[0])[2];
  const lista = alertas.filter(fn);
  $('listaAlertas').innerHTML = lista.length ? lista.map(cartaoAlerta).join('') : '<p class="muted">Não existem alertas neste filtro.</p>';
}

function cartaoAlerta(a) {
  return `<article class="alerta p-${escapar(a.prioridade)}" aria-label="Alerta ${escapar(a.prioridade)} de ${escapar(a.nome_doente)}">
    <div class="alerta-cabecalho">
      <div><span class="prioridade p-${escapar(a.prioridade)}">${escapar(a.prioridade)}</span>
        <span class="alerta-doente">${escapar(a.nome_doente)}</span> <span class="muted pequeno">${escapar(a.numero_processo_clinico)}</span></div>
      <div class="pequeno"><span class="estado e-${escapar(a.estado_atual)}">${escapar(a.estado_atual)}</span> <span class="muted">${dataHora(a.data_hora_geracao)}</span></div>
    </div>
    <p>${escapar(a.resumo_agravamento)}</p>
    <p class="muted pequeno">Regra: ${escapar(a.nome_regra)}</p>
    ${a.ultima_nota ? `<p class="nota"><strong>Última nota</strong> (${escapar(a.autor_ultima_nota)}): ${escapar(a.ultima_nota)}</p>` : ''}
    ${acoesAlertaDaPagina(a)}
  </article>`;
}
const botaoAbrirProcesso = a => `<button type="button" class="secundario" data-abrir-doente="${escapar(a.id_doente)}">Abrir processo</button>`;

function ligarAlertas() {
  $('filtrosAlertas').addEventListener('click', evento => {
    const botao = evento.target.closest('[data-filtro]');
    if (!botao) return;
    filtroAlertas = botao.dataset.filtro;
    renderizarAlertas();
  });
  $('listaAlertas').addEventListener('click', async evento => {
    const abrir = evento.target.closest('[data-abrir-doente]');
    if (abrir) {
      await selecionarDoente(abrir.dataset.abrirDoente);
      abrirSeparador('resumo');
      window.scrollTo({ top: 0 });
      return;
    }
    await aoClicarAlertaDaPagina(evento);
  });
}

// Depois de uma ação: atualiza alertas, a lista de doentes (KPS e contagem) e o processo aberto.
async function atualizarTudo() {
  await carregarAlertas();
  pacientes = await pedidoApi('/api/doentes');
  preencherSeletorDoentes();
}

// ---------- Resumo clínico ----------
function renderizarResumo() {
  const p = processoAtual, d = p.diagnostico;
  $('resumoDiagnostico').innerHTML = d ? `<dl class="ficha">
      <dt>Data</dt><dd>${dataCurta(d.data_diagnostico)}</dd>
      <dt>Localização</dt><dd>${escapar(d.localizacao_tumoral)} (${escapar(d.lateralidade)})</dd>
      <dt>IDH</dt><dd>${escapar(d.estatuto_idh)}</dd>
      <dt>MGMT</dt><dd>${escapar(d.metilacao_mgmt)}</dd>
      <dt>Fase clínica</dt><dd>${escapar(d.fase_clinica_atual)}</dd></dl>`
    : '<p class="muted">Diagnóstico ainda não registado.</p>';
  const plano = p.planos.find(pl => pl.estado === 'ATIVO');
  const ultima = p.submissoes[p.submissoes.length - 1];
  $('resumoPlano').innerHTML = `<dl class="ficha">
      <dt>Periodicidade</dt><dd>${plano ? `a cada ${escapar(plano.periodicidade_dias)} dia(s)` : 'Sem plano definido (7 dias por omissão)'}</dd>
      <dt>Último registo</dt><dd>${ultima ? `${dataHora(ultima.data_hora_submissao)} por ${escapar(ultima.nome_autor)} (${escapar(NOMES_PERFIL[ultima.perfil_autor_no_registo] || ultima.perfil_autor_no_registo)})` : 'Nenhum'}</dd>
      <dt>Estado</dt><dd>${escapar(semCodigoRequisito(p.lembrete.mensagem))}</dd></dl>`;
  $('resumoTratamentos').innerHTML = p.tratamentos.length ? `<ul class="lista">${p.tratamentos.map(t => `<li>
      <strong>${escapar(TIPOS_TRATAMENTO[t.tipo] || t.tipo)}</strong> <span class="badge ${t.estado === 'EM_CURSO' ? 'badge-alerta' : 'badge-neutro'}">${escapar(ESTADOS_TRATAMENTO[t.estado] || t.estado)}</span>
      <div class="muted pequeno">${dataCurta(t.data_inicio)}${t.data_fim ? ` a ${dataCurta(t.data_fim)}` : ''}</div>
      <div>${escapar(t.descricao_esquema)}</div></li>`).join('')}</ul>` : '<p class="muted">Sem tratamentos registados.</p>';
  $('resumoCuidadores').innerHTML = p.cuidadores.length ? `<ul class="lista">${p.cuidadores.map(c => `<li><strong>${escapar(c.nome)}</strong> · ${escapar(PARENTESCO[c.grau_parentesco] || c.grau_parentesco)}<div class="muted pequeno">${escapar(c.email)} · ${escapar(c.telefone_contacto)}</div></li>`).join('')}</ul>`
    : '<p class="muted">Nenhum cuidador associado.</p>';
  $('resumoAlertas').innerHTML = p.alertas.length ? `<ul class="lista">${p.alertas.slice(0, 6).map(a => `<li>
      <span class="prioridade p-${escapar(a.prioridade)}">${escapar(a.prioridade)}</span> <span class="estado e-${escapar(a.estado_atual)}">${escapar(a.estado_atual)}</span>
      <span class="muted pequeno">${dataHora(a.data_hora_geracao)}</span>
      <div class="pequeno">${escapar(a.resumo_agravamento)}</div></li>`).join('')}</ul>`
    : '<p class="muted">Sem alertas registados.</p>';
  $('resumoDecisoes').innerHTML = p.decisoes.length ? `<ul class="lista">${p.decisoes.map(dec => `<li>
      <strong>${escapar(dec.decisao_medica)}</strong>
      <div class="muted pequeno">${dataHora(dec.data_hora_decisao)} · ${escapar(dec.nome_medico)}${dec.id_alerta ? ' · resposta a alerta' : ''}</div>
      <div>${escapar(dec.fundamentacao_clinica)}</div></li>`).join('')}</ul>`
    : '<p class="muted">Ainda não foram registadas decisões.</p>';
}
