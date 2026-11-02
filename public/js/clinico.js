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
// Tempo máximo sem triagem, por prioridade (valores demonstrativos, a validar com a equipa clínica).
const PRAZO_TRIAGEM_HORAS = { 'Crítica': 1, 'Alta': 24, 'Média': 72, 'Baixa': 168 };
function duracao(horas) {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} dias`;
}
// Um alerta pendente que já passou o prazo de triagem da sua prioridade.
function atrasoTriagem(a) {
  if (a.estado_atual !== 'Pendente') return null;
  const horas = (Date.now() - new Date(a.data_hora_geracao).getTime()) / 3600000;
  const prazo = PRAZO_TRIAGEM_HORAS[a.prioridade] ?? 24;
  return horas > prazo ? { horas, prazo } : null;
}

function renderizarAlertas() {
  const filtros = filtrosDaPagina();
  $('filtrosAlertas').innerHTML = filtros.map(([id, nome, fn]) =>
    `<button type="button" data-filtro="${id}" aria-pressed="${filtroAlertas === id}">${nome} (${alertas.filter(fn).length})</button>`).join('');
  const porTratar = alertas.filter(alertaPorTratarDaPagina).length;
  const contador = $('contadorAlertas');
  if (contador) { contador.textContent = porTratar; contador.classList.toggle('hidden', !porTratar); contador.setAttribute('aria-label', `${porTratar} por tratar`); }
  const atrasados = alertas.filter(atrasoTriagem);
  $('avisoAtrasos').innerHTML = atrasados.length ? `<div class="aviso-atraso" role="alert">
      <strong>${atrasados.length} alerta(s) sem triagem para além do prazo previsto</strong>
      <ul>${atrasados.map(a => { const t = atrasoTriagem(a); return `<li><span class="prioridade p-${escapar(a.prioridade)}">${escapar(a.prioridade)}</span>
        ${escapar(a.nome_doente)}: há ${duracao(t.horas)} (prazo: ${duracao(t.prazo)})</li>`; }).join('')}</ul>
    </div>` : '';
  const fn = (filtros.find(f => f[0] === filtroAlertas) || filtros[0])[2];
  const lista = alertas.filter(fn);
  // Na vista «Por concluir», a página pode separar os alertas por fase da triagem (secções com título).
  if (filtroAlertas === filtros[0][0] && typeof seccoesAlertasDaPagina === 'function') {
    $('listaAlertas').innerHTML = seccoesAlertasDaPagina().map(([titulo, descricao, filtro, classe]) => {
      const doGrupo = lista.filter(filtro);
      return `<section class="grupo-alertas ${classe || ''}">
        <header><h3>${titulo} <span class="contagem">${doGrupo.length}</span></h3><p class="muted pequeno">${descricao}</p></header>
        ${doGrupo.length ? doGrupo.map(cartaoAlerta).join('') : '<p class="muted pequeno vazio">Nenhum alerta.</p>'}
      </section>`;
    }).join('');
    return;
  }
  $('listaAlertas').innerHTML = lista.length ? lista.map(cartaoAlerta).join('') : '<p class="muted">Não existem alertas neste filtro.</p>';
}

function cartaoAlerta(a) {
  const atraso = atrasoTriagem(a);
  return `<article class="alerta p-${escapar(a.prioridade)}${atraso ? ' atrasado' : ''}" aria-label="Alerta ${escapar(a.prioridade)} de ${escapar(a.nome_doente)}">
    <div class="alerta-cabecalho">
      <div><span class="prioridade p-${escapar(a.prioridade)}">${escapar(a.prioridade)}</span>
        <span class="alerta-doente">${escapar(a.nome_doente)}</span> <span class="muted pequeno">${escapar(a.numero_processo_clinico)}</span></div>
      <div class="pequeno"><span class="estado e-${escapar(a.estado_atual)}">${escapar(a.estado_atual)}</span> <span class="muted">${dataHora(a.data_hora_geracao)}</span></div>
    </div>
    <p>${escapar(a.resumo_agravamento)}</p>
    <p class="muted pequeno">Regra: ${escapar(a.nome_regra)}${a.prioridade_algoritmo && a.prioridade_algoritmo !== a.prioridade
      ? ` · prioridade ajustada na triagem (o algoritmo indicou ${escapar(a.prioridade_algoritmo)})` : ''}</p>
    ${a.mensagem_doente ? `<p class="mensagem-doente"><strong>Mensagem do doente/cuidador:</strong> «${escapar(a.mensagem_doente)}»</p>` : ''}
    ${a.ultima_nota ? `<p class="nota"><strong>Nota de triagem</strong> (${escapar(a.autor_ultima_nota)}): ${escapar(a.ultima_nota)}</p>`
      : a.estado_atual === 'Pendente' ? `<p class="nota ${atraso ? 'nota-atraso' : 'muted'}">Ainda não avaliado pela enfermagem${atraso
        ? `: <strong>sem triagem há ${duracao(atraso.horas)}</strong>, para um prazo de ${duracao(atraso.prazo)} nesta prioridade` : ''}.</p>` : ''}
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
      renderizarListaDoentes();
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
  renderizarListaDoentes();
}

// ---------- Lista de doentes ----------
// Primeiro passo nas páginas clínicas: escolher o doente. Os que têm alertas por concluir ou registos em atraso aparecem primeiro.
function renderizarListaDoentes() {
  if (!$('listaDoentes')) return;
  const termo = ($('pesquisaDoentes').value || '').trim().toLowerCase();
  const lista = pacientes
    .filter(p => !termo || `${p.nome} ${p.numero_processo_clinico || ''}`.toLowerCase().includes(termo))
    .sort((a, b) => (b.alertas_abertos || 0) - (a.alertas_abertos || 0)
      || Number(b.registo_em_atraso || 0) - Number(a.registo_em_atraso || 0)
      || a.nome.localeCompare(b.nome, 'pt'));
  const atual = pacientes.find(p => p.id_doente === idDoenteAtivo);
  const voltar = atual ? `<div class="voltar-processo"><span>Em consulta: <strong>${escapar(atual.nome)}</strong></span>
    <button type="button" data-escolher-doente="${escapar(atual.id_doente)}">Voltar ao processo</button></div>` : '';
  if (!lista.length) { $('listaDoentes').innerHTML = voltar + '<p class="muted">Nenhum doente encontrado.</p>'; return; }
  const sexo = { M: 'M', F: 'F', OUTRO: 'Outro' };
  $('listaDoentes').innerHTML = voltar + `<table class="tabela-doentes">
    <thead><tr><th>Doente</th><th>KPS</th><th>Fase clínica</th><th>Alertas por concluir</th><th>Último registo</th><th><span class="sr-only">Ação</span></th></tr></thead>
    <tbody>${lista.map(p => {
      const anos = idade(p.data_nascimento);
      return `<tr data-escolher-doente="${escapar(p.id_doente)}" class="${p.id_doente === idDoenteAtivo ? 'ativo' : ''}" tabindex="0">
        <th scope="row"><span class="nome">${escapar(p.nome)}</span>
          <span class="muted pequeno">${escapar(p.numero_processo_clinico || '')}${anos !== null ? ` · ${anos} anos` : ''}${p.sexo ? ` · ${sexo[p.sexo] || ''}` : ''}</span>
          ${p.mensagem_ultimo_registo ? `<span class="badge badge-mensagem" title="${escapar(p.mensagem_ultimo_registo)}">Mensagem no último registo</span>` : ''}</th>
        <td>${p.ultimo_kps ?? '—'}${p.ultimo_kps !== null && p.ultimo_kps <= 70 ? ' <span class="badge badge-neutro">cuidador</span>' : ''}</td>
        <td>${escapar(p.fase_clinica_atual || '—')}</td>
        <td>${p.alertas_abertos ? `<span class="badge badge-alerta">${p.alertas_abertos}</span>` : '<span class="muted">0</span>'}</td>
        <td>${p.ultimo_registo ? dataCurta(p.ultimo_registo) : '—'}${p.registo_em_atraso ? ' <span class="badge badge-alerta">em atraso</span>' : ''}</td>
        <td><button type="button" class="secundario">Abrir</button></td></tr>`;
    }).join('')}</tbody></table>`;
}

function ligarListaDoentes() {
  $('pesquisaDoentes').addEventListener('input', renderizarListaDoentes);
  const abrir = async linha => {
    await selecionarDoente(linha.dataset.escolherDoente);
    renderizarListaDoentes();
    abrirSeparador('resumo');
    window.scrollTo({ top: 0 });
  };
  $('listaDoentes').addEventListener('click', evento => {
    const linha = evento.target.closest('[data-escolher-doente]');
    if (linha) abrir(linha);
  });
  $('listaDoentes').addEventListener('keydown', evento => {
    const linha = evento.target.closest('[data-escolher-doente]');
    if (linha && (evento.key === 'Enter' || evento.key === ' ')) { evento.preventDefault(); abrir(linha); }
  });
  renderizarListaDoentes();
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
