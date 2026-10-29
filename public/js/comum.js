/*
 * Código comum a todas as páginas: sessão, pedidos à API, mensagens, datas,
 * separadores, barra do doente em consulta, gráficos de evolução e histórico.
 * Cada página (medico.js, enfermeiro.js, doente.js) usa estas funções.
 */

// ---------- Estado da página ----------
let token = '';
let user = null;
let pacientes = [];
let idDoenteAtivo = '';
let formAtivo = null;
let processoAtual = null;
let separadorAtivo = '';
let temporizadorMsg = null;

const $ = id => document.getElementById(id);
const escapar = valor => String(valor ?? '').replace(/[&<>"']/g, caracter => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[caracter]);
const ehClinico = () => ['MEDICO', 'ENFERMEIRO'].includes(user?.perfil);

// ---------- Textos usados em várias páginas ----------
const NOMES_PERFIL = { MEDICO: 'Médico', ENFERMEIRO: 'Enfermeiro', DOENTE: 'Doente', CUIDADOR: 'Cuidador' };
const CATEGORIAS = { SINTOMA_GERAL: 'Sintomas gerais', ESCALA_NANO: 'Alterações neurológicas', AUTONOMIA_AVD: 'Autonomia e atividades diárias' };
const TIPOS_TRATAMENTO = { CIRURGIA: 'Cirurgia', QUIMIOTERAPIA: 'Quimioterapia', RADIOTERAPIA: 'Radioterapia', OUTRO: 'Outro' };
const ESTADOS_TRATAMENTO = { PLANEADO: 'Planeado', EM_CURSO: 'Em curso', CONCLUIDO: 'Concluído', SUSPENSO: 'Suspenso' };
const PARENTESCO = { CONJUGE: 'Cônjuge' };
const FREQUENCIAS = { PONTUAL: 'pontual', INTERMITENTE: 'intermitente', DIARIA: 'diária', CONSTANTE: 'constante' };
const PAGINA_DO_PERFIL = { MEDICO: 'medico.html', ENFERMEIRO: 'enfermeiro.html', DOENTE: 'doente.html', CUIDADOR: 'doente.html' };

// ---------- Sessão ----------
// O token passa de uma página para a outra no sessionStorage, que é apagado quando o separador do browser fecha.
// Quem decide o que cada perfil pode ver é sempre o servidor; isto só serve para mostrar a página certa.
const CHAVE_SESSAO = 'gbm-sessao';

function guardarSessao(dados) {
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token: dados.token, utilizador: dados.utilizador })); } catch { /* sem storage: a sessão dura só esta página */ }
}
function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null'); } catch { return null; }
}
function terminarSessao() {
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* nada a apagar */ }
  location.href = 'index.html';
}
// Chamada no início de cada página: sem sessão volta ao login; com o perfil errado vai para a página desse perfil.
function exigirSessao(perfisDaPagina) {
  const sessao = lerSessao();
  if (!sessao?.token || !sessao.utilizador) { terminarSessao(); return false; }
  if (!perfisDaPagina.includes(sessao.utilizador.perfil)) {
    location.href = PAGINA_DO_PERFIL[sessao.utilizador.perfil] || 'index.html';
    return false;
  }
  token = sessao.token;
  user = sessao.utilizador;
  $('etiquetaUtilizador').textContent = `${user.nome} · ${NOMES_PERFIL[user.perfil] || user.perfil}`;
  $('terminarSessao').addEventListener('click', terminarSessao);
  $('fecharMsg').addEventListener('click', () => mostrarMensagem(''));
  return true;
}

// ---------- Pedidos à API ----------
async function pedidoApi(url, opcoes = {}) {
  const headers = { ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opcoes.headers || {}) };
  const resposta = await fetch(url, { ...opcoes, headers });
  const dados = await resposta.json().catch(() => ({}));
  // Sessão expirada ou revogada: volta ao login em vez de deixar a página partida.
  // (No login ainda não há token: aí um 401 é só "credenciais inválidas".)
  if (token && (resposta.status === 401 || (resposta.status === 403 && /Sessão inválida/.test(dados.erro || '')))) {
    terminarSessao();
    throw new Error('A sessão terminou. Inicie sessão novamente.');
  }
  if (!resposta.ok) throw new Error(dados.erro || `O pedido falhou (${resposta.status}).`);
  return dados;
}
const urlDoente = sufixo => `/api/doentes/${encodeURIComponent(idDoenteAtivo)}/${sufixo}`;

// ---------- Mensagens ----------
function mostrarMensagem(mensagem, tipo = '') {
  clearTimeout(temporizadorMsg);
  if (!mensagem) { $('msgGeral').classList.add('hidden'); return; }
  $('msgTexto').textContent = mensagem;
  $('msgGeral').className = tipo;
  $('msgGeral').setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  if (tipo !== 'error') temporizadorMsg = setTimeout(() => $('msgGeral').classList.add('hidden'), 5000);
}
const nomeDoenteAtivo = () => processoAtual?.doente?.nome || 'o doente';

// Executa uma ação, mostra o resultado e volta a carregar o processo (e o que a página precisar).
async function executarAcao(acao, mensagem, depois) {
  mostrarMensagem('');
  try {
    await acao();
    mostrarMensagem(`${mensagem} (${nomeDoenteAtivo()})`, 'success');
    await carregarProcesso();
    if (depois) await depois();
  } catch (erro) { mostrarMensagem(erro.message, 'error'); }
}

// ---------- Datas ----------
const semCodigoRequisito = texto => String(texto || '').replace(/\s*\(RF\d+\)/g, '');
function dataHora(valor) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? escapar(valor) : data.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}
function dataCurta(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : escapar(iso);
}
function idade(dataNascimento) {
  if (!dataNascimento) return null;
  const n = new Date(dataNascimento), h = new Date();
  let anos = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) anos--;
  return anos;
}

// ---------- Separadores ----------
// separadores = [['alertas', 'Alertas'], ...]; cada id corresponde a um <section id="painel-<id>">.
// Os separadores em "semBarraDoente" escondem a barra do doente (por exemplo, a lista de alertas de todos os doentes).
let separadoresSemBarra = [];
function construirSeparadores(separadores, semBarraDoente = []) {
  separadoresSemBarra = semBarraDoente;
  $('separadores').innerHTML = separadores.map(([id, nome]) =>
    `<button type="button" role="tab" id="tab-${id}" aria-controls="painel-${id}" aria-selected="false" tabindex="-1" data-tab="${id}">${nome}${id === 'alertas' ? '<span class="contador hidden" id="contadorAlertas"></span>' : ''}</button>`
  ).join('');
  $('separadores').addEventListener('click', evento => {
    const tab = evento.target.closest('[role="tab"]');
    if (tab) abrirSeparador(tab.dataset.tab);
  });
  $('separadores').addEventListener('keydown', evento => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const i = tabs.findIndex(t => t.dataset.tab === separadorAtivo);
    let novo = null;
    if (evento.key === 'ArrowRight') novo = tabs[(i + 1) % tabs.length];
    if (evento.key === 'ArrowLeft') novo = tabs[(i - 1 + tabs.length) % tabs.length];
    if (evento.key === 'Home') novo = tabs[0];
    if (evento.key === 'End') novo = tabs[tabs.length - 1];
    if (novo) { evento.preventDefault(); abrirSeparador(novo.dataset.tab, true); }
  });
}
function abrirSeparador(id, focar = false) {
  separadorAtivo = id;
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    const ativo = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(ativo));
    tab.tabIndex = ativo ? 0 : -1;
    if (ativo && focar) tab.focus();
  });
  document.querySelectorAll('[role="tabpanel"]').forEach(painel => painel.classList.toggle('hidden', painel.id !== `painel-${id}`));
  $('barraDoente').classList.toggle('hidden', separadoresSemBarra.includes(id));
}

// ---------- Doente em consulta ----------
async function carregarDoentes() {
  pacientes = await pedidoApi('/api/doentes');
  if (!pacientes.length) throw new Error('Não existem processos de doentes atribuídos a esta conta.');
  if (!pacientes.some(p => p.id_doente === idDoenteAtivo)) idDoenteAtivo = pacientes[0].id_doente;
  preencherSeletorDoentes();
}
function preencherSeletorDoentes() {
  const mostrarSeletor = ehClinico() || pacientes.length > 1;
  $('caixaSeletor').classList.toggle('hidden', !mostrarSeletor);
  $('barraDoente').style.gridTemplateColumns = mostrarSeletor ? '' : '1fr';
  $('doenteSelecionado').innerHTML = pacientes.map(p => {
    const extra = ehClinico()
      ? ` · KPS ${p.ultimo_kps ?? '—'}${p.alertas_abertos ? ` · ${p.alertas_abertos} alerta(s)` : ''}`
      : '';
    return `<option value="${escapar(p.id_doente)}">${escapar(p.nome)} · ${escapar(p.numero_processo_clinico || '')}${extra}</option>`;
  }).join('');
  $('doenteSelecionado').value = idDoenteAtivo;
}
async function selecionarDoente(idDoente) {
  idDoenteAtivo = idDoente;
  $('doenteSelecionado').value = idDoente;
  await carregarProcesso();
}

// Cada página define "aoCarregarProcesso()" para desenhar o que lhe diz respeito.
async function carregarProcesso() {
  try {
    processoAtual = await pedidoApi(urlDoente('processo'));
    renderizarIdentidade();
    desenharKps(processoAtual.avaliacoesKps);
    desenharSintomas(processoAtual.submissoes);
    desenharQuadroComparativo(processoAtual.submissoes);
    renderizarHistorico(processoAtual.submissoes);
    if (typeof aoCarregarProcesso === 'function') aoCarregarProcesso();
  } catch (erro) { mostrarMensagem(erro.message, 'error'); }
}

function renderizarIdentidade() {
  const p = processoAtual, doente = p.doente, d = p.diagnostico || {};
  const anos = idade(doente.data_nascimento);
  const sexo = { M: 'Masculino', F: 'Feminino', OUTRO: 'Outro' }[doente.sexo];
  const meta = [doente.numero_processo_clinico && `Processo ${escapar(doente.numero_processo_clinico)}`,
    anos !== null && `${anos} anos`, sexo, doente.nome_medico_responsavel && `Médico: ${escapar(doente.nome_medico_responsavel)}`].filter(Boolean).join(' · ');
  const cuidadorObrig = Boolean(doente.participacao_cuidador_obrigatoria);
  const abertos = (p.alertas || []).filter(a => a.estado_atual !== 'Concluído').length;
  $('identidadeDoente').innerHTML = `
    <h1>${escapar(doente.nome)}</h1>
    ${meta ? `<p class="meta">${meta}</p>` : ''}
    <div class="chips">
      <span class="chip ${cuidadorObrig ? 'chip-alerta' : ''}"><strong>KPS ${escapar(doente.ultimo_kps)}</strong>${cuidadorObrig ? ' · cuidador obrigatório' : ''}</span>
      ${d.fase_clinica_atual ? `<span class="chip">Fase: <strong>${escapar(d.fase_clinica_atual)}</strong></span>` : ''}
      ${ehClinico() ? `<span class="chip ${abertos ? 'chip-alerta' : 'chip-ok'}">${abertos ? `<strong>${abertos}</strong> alerta(s) por concluir` : 'Sem alertas por concluir'}</span>` : ''}
      <span class="chip ${p.lembrete.lembreteAtivo ? 'chip-alerta' : 'chip-ok'}">${escapar(semCodigoRequisito(p.lembrete.mensagem))}</span>
    </div>`;
}

// ---------- Gráficos de evolução ----------
function desenharLinha({ pontos, yMax, marcas, limiar, cor, titulo }) {
  const L = 640, A = 230, esq = 92, dir = 620, topo = 16, base = 186;
  const x = i => pontos.length === 1 ? (esq + dir) / 2 : esq + i * (dir - esq) / (pontos.length - 1);
  const y = v => base - v * (base - topo) / yMax;
  const passo = Math.max(1, Math.ceil(pontos.length / 8));
  return `<svg class="chart" viewBox="0 0 ${L} ${A}" role="img" aria-label="${escapar(titulo)}: ${pontos.map(p => `${dataCurta(p.data)} ${escapar(p.rotulo)}`).join('; ')}">
    ${marcas.map(m => `<line x1="${esq}" y1="${y(m.v)}" x2="${dir}" y2="${y(m.v)}" stroke="#e2e8f0"/><text x="${esq - 8}" y="${y(m.v) + 4}" text-anchor="end" font-size="12" fill="#4a5568">${escapar(m.t)}</text>`).join('')}
    ${limiar ? `<line x1="${esq}" y1="${y(limiar.v)}" x2="${dir}" y2="${y(limiar.v)}" stroke="#b54708" stroke-dasharray="6 4" stroke-width="1.5"/><text x="${dir}" y="${y(limiar.v) - 6}" text-anchor="end" font-size="11" fill="#b54708">${escapar(limiar.t)}</text>` : ''}
    ${pontos.length > 1 ? `<polyline points="${pontos.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')}" fill="none" stroke="${cor}" stroke-width="3"/>` : ''}
    ${pontos.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="5.5" fill="${cor}" stroke="#fff" stroke-width="2"><title>${dataCurta(p.data)}: ${escapar(p.rotulo)}</title></circle>`).join('')}
    ${pontos.map((p, i) => i % passo === 0 || i === pontos.length - 1 ? `<text x="${x(i)}" y="${base + 22}" text-anchor="middle" font-size="12" fill="#1a202c">${dataCurta(p.data).slice(0, 5)}</text>` : '').join('')}
  </svg>`;
}
function desenharKps(avaliacoes) {
  if (!$('chartKps')) return;
  if (!avaliacoes.length) { $('chartKps').innerHTML = '<p class="muted">Ainda não existem avaliações funcionais registadas.</p>'; return; }
  const pontos = avaliacoes.map(a => ({ data: a.data_avaliacao, v: Number(a.score_kps), rotulo: `${a.score_kps} pontos` }));
  const ultima = pontos[pontos.length - 1];
  $('chartKps').innerHTML = desenharLinha({ pontos, yMax: 100, cor: '#0f4c81', titulo: 'Evolução do KPS',
    marcas: [0, 50, 100].map(v => ({ v, t: String(v) })), limiar: { v: 70, t: 'Limiar 70 · cuidador obrigatório' } }) +
    `<p class="muted pequeno">Avaliação mais recente: <strong>${ultima.v}/100</strong> em ${dataCurta(ultima.data)}.</p>`;
}
function desenharSintomas(submissoes) {
  if (!$('chartSintomas')) return;
  const idPergunta = $('perguntaGrafico').value;
  const pontos = submissoes.slice()
    .sort((a, b) => a.data_referencia_sintomas.localeCompare(b.data_referencia_sintomas))
    .map(s => {
      const r = s.respostas.find(item => item.id_pergunta === idPergunta);
      return r && !r.motivo_nao_avaliavel ? { data: s.data_referencia_sintomas, v: Number(r.valor_numerico), rotulo: r.rotulo } : null;
    }).filter(Boolean);
  if (!pontos.length) {
    $('chartSintomas').innerHTML = '<p class="muted">Ainda não existem respostas comparáveis para este domínio. Respostas em falta ou não avaliáveis não são representadas como ausência.</p>';
    return;
  }
  const autonomia = idPergunta === 'perg-autonomia';
  const marcas = autonomia ? [{ v: 0, t: 'Independente' }, { v: 1, t: 'Assist. parcial' }, { v: 3, t: 'Assist. total' }]
    : [{ v: 0, t: 'Ausente' }, { v: 1, t: 'Ligeira' }, { v: 2, t: 'Moderada' }, { v: 3, t: 'Grave' }];
  $('chartSintomas').innerHTML = desenharLinha({ pontos, yMax: 3, marcas, cor: '#6b46c1', titulo: 'Evolução do sintoma selecionado' }) +
    '<p class="muted pequeno">Só são representadas respostas presentes e avaliáveis; cada ponto corresponde à data dos sintomas.</p>';
}
function desenharQuadroComparativo(submissoes) {
  if (!$('quadroComparativo')) return;
  const ultimas = submissoes.slice().sort((a, b) => a.data_referencia_sintomas.localeCompare(b.data_referencia_sintomas)).slice(-6);
  if (!ultimas.length) { $('quadroComparativo').innerHTML = '<p class="muted">Sem registos para comparar.</p>'; return; }
  const linhas = formAtivo.perguntas.map(p => {
    const celulas = ultimas.map(s => {
      const r = s.respostas.find(x => x.id_pergunta === p.id_pergunta);
      if (!r) return '<td class="cel vazio" title="Sem resposta">—</td>';
      if (r.motivo_nao_avaliavel) return '<td class="cel na">Não avaliável</td>';
      return `<td class="cel v${Number(r.valor_numerico)}">${escapar(r.rotulo.replace(' / sem alteração', ''))}</td>`;
    }).join('');
    return `<tr><th scope="row">${escapar(p.enunciado)}</th>${celulas}</tr>`;
  }).join('');
  $('quadroComparativo').innerHTML = `<table class="quadro"><thead><tr><th>Sintoma / domínio</th>${ultimas.map(s => `<th style="text-align:center">${dataCurta(s.data_referencia_sintomas)}<div class="muted pequeno" style="font-weight:400">${escapar(NOMES_PERFIL[s.perfil_autor_no_registo] || '')}</div></th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table>`;
}
// Liga o seletor de sintoma do gráfico e preenche-o com as perguntas do formulário ativo.
function prepararEvolucao() {
  $('perguntaGrafico').innerHTML = formAtivo.perguntas.map(pergunta =>
    `<option value="${escapar(pergunta.id_pergunta)}">${escapar(pergunta.enunciado)}</option>`).join('');
  $('perguntaGrafico').addEventListener('change', () => { if (processoAtual) desenharSintomas(processoAtual.submissoes); });
}

// ---------- Histórico ----------
function renderizarHistorico(submissoes) {
  if (!$('contentorHistorico')) return;
  if (!submissoes.length) { $('contentorHistorico').innerHTML = '<p class="muted">Ainda não existem registos de monitorização.</p>'; return; }
  $('contentorHistorico').innerHTML = submissoes.slice().reverse().map(s => {
    const alteradas = s.respostas.filter(r => !r.motivo_nao_avaliavel && Number(r.valor_numerico) > 0);
    const ausentes = s.respostas.filter(r => !r.motivo_nao_avaliavel && Number(r.valor_numerico) === 0);
    const naoAval = s.respostas.filter(r => r.motivo_nao_avaliavel);
    const semResposta = Math.max(0, (s.total_perguntas_ativas || 0) - s.respostas.length);
    const badge = (r, cls) => `<span class="badge resp ${cls}">${escapar(r.enunciado)}: ${escapar(r.rotulo || 'Não avaliado')}${r.frequencia ? ` · ${escapar(FREQUENCIAS[r.frequencia] || r.frequencia)}` : ''}</span>`;
    return `<article class="registo">
      <strong>Sintomas de ${dataCurta(s.data_referencia_sintomas)}</strong>
      <div class="muted pequeno">Registado em ${dataHora(s.data_hora_submissao)} por ${escapar(s.nome_autor)} (${escapar(NOMES_PERFIL[s.perfil_autor_no_registo] || s.perfil_autor_no_registo)})</div>
      <p class="pequeno">${alteradas.length} com alteração · ${ausentes.length} sem alteração · ${naoAval.length} não avaliável(eis) · ${semResposta} sem resposta</p>
      <div>${alteradas.length ? alteradas.map(r => badge(r, 'badge-alerta')).join('') : '<span class="muted pequeno">Nenhuma alteração reportada nas respostas dadas.</span>'}</div>
      ${ausentes.length || naoAval.length ? `<details style="margin-top:.4rem"><summary class="pequeno">Ver as restantes respostas</summary>
        ${naoAval.map(r => badge(r, 'badge-neutro')).join('')}${ausentes.map(r => badge(r, 'badge-ok')).join('')}</details>` : ''}
    </article>`;
  }).join('');
}

// ---------- Arranque comum ----------
// Cada página chama iniciarPagina(); se a sessão for válida, carrega os doentes, o formulário ativo e o processo.
async function iniciarPagina({ perfis, separadores, semBarraDoente = [], separadorInicial, depoisDeCarregar }) {
  if (!exigirSessao(perfis)) return;
  construirSeparadores(separadores, semBarraDoente);
  try {
    await carregarDoentes();
    formAtivo = await pedidoApi('/api/formularios/ativo');
    if ($('perguntaGrafico')) prepararEvolucao();
    $('doenteSelecionado').addEventListener('change', evento => selecionarDoente(evento.target.value));
    if (depoisDeCarregar) await depoisDeCarregar();
    await carregarProcesso();
    abrirSeparador(separadorInicial);
  } catch (erro) { mostrarMensagem(erro.message, 'error'); }
}
