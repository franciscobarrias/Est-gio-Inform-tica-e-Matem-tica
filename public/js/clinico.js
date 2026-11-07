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
  const totalAlertas = alertas.length;
  const contador = $('contadorAlertas');
  if (contador) { contador.textContent = totalAlertas; contador.classList.toggle('hidden', !totalAlertas); contador.setAttribute('aria-label', `${totalAlertas} alertas`); }
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

const INDICACOES_DOENTE = {
  LIGAR_112: 'Ligar 112',
  CONTACTAR_JA: 'Contactar a equipa de imediato',
  CONTACTAR_HOJE: 'Contactar a equipa ainda hoje'
};

// Motivos do alerta: vêm estruturados da avaliação; nos alertas antigos, lêem-se do resumo em texto.
function motivosDoAlerta(a) {
  if (a.motivos?.length) return a.motivos;
  const corpo = String(a.resumo_agravamento || '').replace(/\.\s*(Ajustes:.*)?Prioridade [^.]+\.\s*$/, '');
  return corpo.split(/;\s*/).filter(Boolean).map(t => {
    const m = t.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    return { texto: m ? m[1] : t, prioridade: m ? m[2] : a.prioridade, codigos: [] };
  });
}

// Separa o texto do motivo das referências às perguntas, ex.: «… (B1, B3, B4/B6)».
function linhaMotivo(m) {
  const ref = String(m.texto).match(/^(.*?)\s*\(([A-D]\d+[a-z]?(?:[\/,]\s*[A-D]\d+[a-z]?)*)\)\s*$/);
  const texto = ref ? ref[1] : m.texto;
  const codigos = ref ? ref[2].split(/,\s*/) : (m.codigos || []);
  const pergunta = codigo => formAtivo?.perguntas.find(p => p.codigo === codigo);
  const etiqueta = codigo => {
    const nomes = codigo.split('/').map(c => pergunta(c)?.enunciado).filter(Boolean).map(nomeCurtoPergunta);
    const titulo = nomes.join(' ou ');
    // Com um só código, mostra-se também o nome do sintoma (ex.: «B1 · Dor de cabeça»); nos sinais de alarme (A)
    // o texto do motivo já descreve a pergunta, por isso fica só o código.
    const comNome = codigos.length === 1 && titulo && !codigo.startsWith('A');
    return `<abbr class="motivo-codigo" title="${escapar(titulo)}">${escapar(codigo)}${comNome ? ` · ${escapar(titulo)}` : ''}</abbr>`;
  };
  return `<li class="motivo">
      <span class="motivo-nivel p-${escapar(m.prioridade)}">${escapar(m.prioridade)}</span>
      <span class="motivo-texto">${escapar(texto)}</span>
      <span class="motivo-codigos">${codigos.map(etiqueta).join('')}</span>
    </li>`;
}
const nomeCurtoPergunta = t => String(t).replace(/\s*\([^)]*\)\s*$/, '');

function cartaoAlerta(a) {
  const atraso = atrasoTriagem(a);
  const ajuste = String(a.resumo_agravamento || '').match(/Ajustes:\s*(.+?)\.\s*Prioridade/)?.[1];
  const detalhes = [
    ['Regra', escapar(a.nome_regra)],
    a.instrucoes?.length ? ['Indicação dada ao doente', a.instrucoes.map(c => escapar(INDICACOES_DOENTE[c] || c)).join('; ')] : null,
    ajuste ? ['Prioridade agravada por', escapar(ajuste)] : null,
    a.prioridade_algoritmo && a.prioridade_algoritmo !== a.prioridade
      ? ['Prioridade na triagem', `${escapar(a.prioridade)} <span class="muted">(algoritmo: ${escapar(a.prioridade_algoritmo)})</span>`] : null
  ].filter(Boolean);
  const nota = a.ultima_nota
    ? `<div class="alerta-nota"><div class="alerta-nota-cab">Nota de triagem · ${escapar(a.autor_ultima_nota)}${a.data_ultima_nota ? ` · ${dataHora(a.data_ultima_nota)}` : ''}</div>
        <p>${escapar(a.ultima_nota)}</p></div>`
    : a.estado_atual === 'Pendente'
      ? `<div class="alerta-nota ${atraso ? 'nota-atraso' : 'sem-nota'}"><p>Ainda não avaliado pela enfermagem${atraso
          ? `: <strong>sem triagem há ${duracao(atraso.horas)}</strong> (prazo de ${duracao(atraso.prazo)} nesta prioridade)` : ''}.</p></div>` : '';
  return `<article class="alerta p-${escapar(a.prioridade)}${atraso ? ' atrasado' : ''}" aria-label="Alerta ${escapar(a.prioridade)} de ${escapar(a.nome_doente)}">
    <header class="alerta-topo">
      <span class="prioridade p-${escapar(a.prioridade)}">${escapar(a.prioridade)}</span>
      <div class="alerta-quem"><span class="alerta-doente">${escapar(a.nome_doente)}</span><span class="alerta-processo">${escapar(a.numero_processo_clinico)}</span></div>
      <div class="alerta-meta"><span class="estado e-${escapar(a.estado_atual)}">${escapar(a.estado_atual)}</span><time datetime="${escapar(a.data_hora_geracao)}">${dataHora(a.data_hora_geracao)}</time></div>
    </header>
    <ul class="alerta-motivos" aria-label="Motivos do alerta">${motivosDoAlerta(a).map(linhaMotivo).join('')}</ul>
    <dl class="alerta-detalhes">${detalhes.map(([t, v]) => `<div><dt>${t}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${ligacaoAlertaSeguinte(a)}
    ${ligacaoAlertaAnterior(a)}
    ${registosDoAlerta(a)}
    ${a.mensagem_doente ? `<div class="alerta-nota mensagem"><div class="alerta-nota-cab">Mensagem do doente ou cuidador</div><p>«${escapar(a.mensagem_doente)}»</p></div>` : ''}
    ${nota}
    <footer class="alerta-acoes">${acoesAlertaDaPagina(a)}</footer>
  </article>`;
}
// Num alerta que já tem um alerta mais recente do mesmo doente, avisa para ver esse primeiro.
function ligacaoAlertaSeguinte(a) {
  if (!a.seguinte_data) return '';
  const seguinte = `alerta de ${dataCurta(a.seguinte_data)} (${escapar(a.seguinte_prioridade)})`;
  return a.estado_atual === 'Concluído'
    ? `<p class="alerta-ligacao">Foi seguido pelo ${seguinte}.</p>`
    : `<p class="alerta-seguido"><strong>Foi seguido pelo ${seguinte}.</strong> Veja esse alerta primeiro: tem a informação mais recente do doente.</p>`;
}

// Ligação ao alerta anterior do mesmo doente, em linguagem clínica (sem códigos internos).
function ligacaoAlertaAnterior(a) {
  if (!a.id_alerta_anterior || !a.anterior_data) return '';
  const propria = (a.submissoes_associadas || []).find(s => s.id_submissao === a.id_submissao);
  const anterior = `alerta de ${dataCurta(a.anterior_data)} (${escapar(a.anterior_prioridade)})`;
  const texto = propria?.tipo_associacao === 'ESCALONAMENTO'
    ? `Agrava o ${anterior}, que estava aberto nessa altura: a prioridade subiu de ${escapar(a.anterior_prioridade)} para ${escapar(a.prioridade_algoritmo || a.prioridade)}.`
    : `Traz um motivo novo em relação ao ${anterior}, que estava aberto nessa altura.`;
  return `<p class="alerta-ligacao">${texto}</p>`;
}

// Registos de sintomas ligados ao alerta: o que o gerou e os seguintes que repetiram o mesmo motivo.
function registosDoAlerta(a) {
  const repetidos = (a.submissoes_associadas || []).filter(s => s.tipo_associacao === 'MOTIVO_REPETIDO');
  if (!repetidos.length) return '';
  return `<p class="alerta-ligacao">O mesmo motivo voltou a aparecer ${repetidos.length === 1 ? 'no registo' : 'nos registos'} de
    ${repetidos.map(s => dataCurta(s.data_referencia_sintomas)).join(', ')} (ligado${repetidos.length === 1 ? '' : 's'} a este alerta, sem criar alertas novos).</p>`;
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
      <dt>Localização</dt><dd>${escapar(d.designacao_cid10)} (${escapar(d.lateralidade)})${codigoClinico('CID-10', d.codigo_cid10)}</dd>
      <dt>Tipo de tumor</dt><dd>${tipoTumor(d)}</dd>
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
