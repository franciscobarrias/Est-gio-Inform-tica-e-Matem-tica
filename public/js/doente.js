/*
 * Página do doente e do cuidador: registo de sintomas, evolução e histórico.
 * O doente pode também associar um cuidador. O cuidador com vários doentes escolhe-os no seletor.
 */

// ---------- Formulário de monitorização ----------
// O que o doente deve fazer logo que responde «Sim» a um sinal de alarme (Bloco A).
// O servidor volta a avaliar tudo ao guardar; isto serve só para mostrar a instrução sem esperar.
const INSTRUCOES = {
  LIGAR_112: 'Ligue já 112.',
  CONTACTAR_JA: 'Contacte já a equipa do Serviço de Neurocirurgia (não espere pela próxima consulta).',
  CONTACTAR_HOJE: 'Contacte hoje a equipa do Serviço de Neurocirurgia.'
};
const ORDEM_INSTRUCOES = ['LIGAR_112', 'CONTACTAR_JA', 'CONTACTAR_HOJE'];
const INSTRUCAO_ALARME = { A1: 'LIGAR_112', A2: 'LIGAR_112', A3: 'LIGAR_112', A4: 'LIGAR_112', A6: 'LIGAR_112',
  A5: 'CONTACTAR_JA', A9: 'CONTACTAR_JA', A7: 'CONTACTAR_HOJE', A8: 'CONTACTAR_HOJE' };
const ORDEM_BLOCOS = ['ALARME', 'SINTOMA', 'FUNCAO', 'AUTONOMIA', 'SINTOMA_GERAL', 'ESCALA_NANO', 'AUTONOMIA_AVD'];
const NOTAS_BLOCO = {
  ALARME: 'Se responder «Sim» a alguma destas perguntas, siga logo a indicação que aparece.',
  SINTOMA: 'Compare com o que é habitual para si. Se tiver um sintoma, pode indicar com que frequência e se é novo ou está pior.'
};
const NOTAS_BLOCO_CUIDADOR = {
  ALARME: NOTAS_BLOCO.ALARME,
  SINTOMA: 'Compare com o que é habitual para o doente. Se ele tiver um sintoma, pode indicar com que frequência e se é novo ou está pior.'
};
// Quando responde o cuidador, as perguntas aparecem na 3.ª pessoa («O doente teve…»).
const respondeCuidador = () => user?.perfil === 'CUIDADOR';
const textoPergunta = p => (respondeCuidador() && p.enunciado_cuidador) || p.enunciado;
const rotuloOpcao = o => (respondeCuidador() && o.rotulo_cuidador) || o.rotulo;

const filhasDe = idPai => formAtivo.perguntas.filter(p => p.id_pergunta_pai === idPai);
const perguntaPorId = id => formAtivo.perguntas.find(p => p.id_pergunta === id);
// Opção escolhida numa pergunta (ou undefined se estiver «Sem resposta»).
function opcaoEscolhida(pergunta) {
  const marcado = document.querySelector(`input[name="resp_${CSS.escape(pergunta.id_pergunta)}"]:checked`);
  return marcado && marcado.value ? pergunta.opcoes.find(o => o.id_opcao === marcado.value) : undefined;
}
// Valor numérico da opção; «Não consigo avaliar» não conta como sintoma presente.
function valorEscolhido(pergunta) {
  const o = opcaoEscolhida(pergunta);
  if (!o || o.valor_codificado === 'IMPOSSIVEL_AVALIAR') return null;
  return Number(o.valor_numerico ?? 0);
}

function htmlPergunta(pergunta) {
  const id = escapar(pergunta.id_pergunta);
  const opcoes = pergunta.opcoes.map(o => `<label><input type="radio" name="resp_${id}" value="${escapar(o.id_opcao)}" />${escapar(rotuloOpcao(o))}</label>`).join('');
  const presente = ['SINTOMA', 'FUNCAO'].includes(pergunta.categoria);
  const extras = [
    ...filhasDe(pergunta.id_pergunta).map(htmlPergunta),
    pergunta.tipo_resposta === 'SELECAO_UNICA_COM_TEXTO'
      ? `<label for="texto_${id}">Qual?</label><input type="text" id="texto_${id}" data-texto="${id}" maxlength="300" />` : '',
    pergunta.categoria === 'SINTOMA'
      ? `<label for="freq_${id}">Com que frequência? (opcional)</label>
         <select id="freq_${id}" data-frequencia="${id}"><option value="">Não indicada</option><option value="PONTUAL">Uma vez</option><option value="INTERMITENTE">Algumas vezes</option><option value="DIARIA">Todos os dias</option><option value="CONSTANTE">Sempre / constante</option></select>` : '',
    presente ? `<label class="caixa"><input type="checkbox" id="pior_${id}" data-pior="${id}" />É novo ou está pior do que o habitual</label>` : ''
  ].join('');
  return `<fieldset class="pergunta-v2" data-pergunta="${id}">
    <legend>${pergunta.codigo ? `<span class="codigo">${escapar(pergunta.codigo)}</span>` : ''}${escapar(textoPergunta(pergunta))}</legend>
    <div class="opcoes-radio">${opcoes}<label class="sem-resposta"><input type="radio" name="resp_${id}" value="" checked />Sem resposta</label></div>
    ${extras ? `<div class="extras-pergunta hidden" id="extras_${id}">${extras}</div>` : ''}
    <p class="instrucao hidden" id="instrucao_${id}" role="alert"></p>
  </fieldset>`;
}

function renderizarFormulario() {
  $('tituloFormulario').textContent = `${formAtivo.nome} (versão ${formAtivo.versao})`;
  const notas = respondeCuidador() ? NOTAS_BLOCO_CUIDADOR : NOTAS_BLOCO;
  if (respondeCuidador()) {
    $('introFormulario').textContent = 'Está a responder pelo doente indicado acima, com base no que observou e no que ele lhe disse. '
      + 'Responda ao que conseguir: as perguntas em branco ficam «sem resposta» e não são consideradas «Ausente».';
  }
  const grupos = {};
  formAtivo.perguntas.filter(p => !p.id_pergunta_pai).forEach(p => (grupos[p.categoria] = grupos[p.categoria] || []).push(p));
  const categorias = Object.keys(grupos).sort((a, b) => ORDEM_BLOCOS.indexOf(a) - ORDEM_BLOCOS.indexOf(b));
  $('contentorPerguntas').innerHTML = categorias.map(categoria => `
    <fieldset class="grupo-perguntas"><legend>${escapar(CATEGORIAS[categoria] || categoria)}</legend>
      ${notas[categoria] ? `<p class="muted pequeno nota-bloco">${notas[categoria]}</p>` : ''}
      ${grupos[categoria].map(htmlPergunta).join('')}
    </fieldset>`).join('');
  formAtivo.perguntas.forEach(atualizarPergunta);
}

// Limpa uma pergunta (e as de detalhe): volta a «Sem resposta».
function limparPergunta(pergunta) {
  const id = pergunta.id_pergunta;
  const semResposta = document.querySelector(`input[name="resp_${CSS.escape(id)}"][value=""]`);
  if (semResposta) semResposta.checked = true;
  if ($(`freq_${id}`)) $(`freq_${id}`).value = '';
  if ($(`pior_${id}`)) $(`pior_${id}`).checked = false;
  if ($(`texto_${id}`)) $(`texto_${id}`).value = '';
  filhasDe(id).forEach(limparPergunta);
}

// Mostra ou esconde os detalhes, a frequência e a instrução de alarme conforme a resposta.
function atualizarPergunta(pergunta) {
  const id = pergunta.id_pergunta;
  const valor = valorEscolhido(pergunta);
  const extras = $(`extras_${id}`);
  if (extras) {
    const mostrar = valor !== null && valor >= 1;
    extras.classList.toggle('hidden', !mostrar);
    // Cada pergunta de detalhe só aparece a partir do valor mínimo da principal.
    filhasDe(id).forEach(filha => {
      const visivel = mostrar && valor >= Number(filha.valor_minimo_pai ?? 1);
      document.querySelector(`[data-pergunta="${CSS.escape(filha.id_pergunta)}"]`).classList.toggle('hidden', !visivel);
      if (!visivel) limparPergunta(filha);
    });
    if (!mostrar) filhasDe(id).forEach(limparPergunta);
    if (!mostrar) {
      if ($(`freq_${id}`)) $(`freq_${id}`).value = '';
      if ($(`pior_${id}`)) $(`pior_${id}`).checked = false;
      if ($(`texto_${id}`)) $(`texto_${id}`).value = '';
    }
  }
  const caixa = $(`instrucao_${id}`);
  if (caixa) {
    const instrucao = instrucaoImediata(pergunta, valor);
    caixa.className = `instrucao ${instrucao || 'hidden'}`;
    caixa.textContent = instrucao ? INSTRUCOES[instrucao] : '';
  }
}

function instrucaoImediata(pergunta, valor) {
  if (pergunta.categoria === 'ALARME' && !pergunta.id_pergunta_pai && valor === 1) {
    if (pergunta.codigo === 'A1') {
      // Convulsão: se não durou mais de 5 minutos e não foram várias seguidas, contactar hoje.
      const [a, b] = filhasDe(pergunta.id_pergunta).map(valorEscolhido);
      if (a === 0 && b === 0) return 'CONTACTAR_HOJE';
    }
    return INSTRUCAO_ALARME[pergunta.codigo] || 'CONTACTAR_JA';
  }
  if (['B4', 'B19'].includes(pergunta.codigo) && valor === 3) return 'CONTACTAR_JA';
  return null;
}

function recolherRespostas() {
  const visivel = p => !document.querySelector(`[data-pergunta="${CSS.escape(p.id_pergunta)}"]`)?.closest('.hidden');
  return formAtivo.perguntas.filter(visivel).map(pergunta => {
    const opcao = opcaoEscolhida(pergunta);
    if (!opcao) return null;
    const id = pergunta.id_pergunta;
    const resposta = { id_pergunta: id, id_opcao: opcao.id_opcao };
    if ($(`freq_${id}`)?.value) resposta.frequencia = $(`freq_${id}`).value;
    if ($(`pior_${id}`)?.checked) resposta.novo_ou_pior = true;
    if ($(`texto_${id}`)?.value.trim()) resposta.texto = $(`texto_${id}`).value.trim();
    return resposta;
  }).filter(Boolean);
}

async function submeterMonitorizacao() {
  $('msgErroForm').textContent = '';
  const respostas = recolherRespostas();
  if (!respostas.length) { $('msgErroForm').className = 'error'; $('msgErroForm').textContent = 'Responda a pelo menos uma pergunta antes de guardar.'; return; }
  try {
    const resultado = await pedidoApi(urlDoente('submissoes'), {
      method: 'POST',
      body: JSON.stringify({ id_formulario: formAtivo.id_formulario, data_referencia_sintomas: $('inputDataRef').value, respostas })
    });
    const instrucoes = resultado.alertasGerados.flatMap(a => a.instrucoes || []);
    const maisUrgente = ORDEM_INSTRUCOES.find(i => instrucoes.includes(i));
    $('msgErroForm').className = maisUrgente ? `instrucao ${maisUrgente}` : 'success';
    $('msgErroForm').textContent = maisUrgente
      ? `Registo guardado. ${INSTRUCOES[maisUrgente]} A equipa foi notificada.`
      : resultado.alertasGerados.length
        ? 'Registo guardado. A equipa de enfermagem foi notificada das alterações reportadas.'
        : 'Registo guardado. Obrigado.';
    formAtivo.perguntas.forEach(limparPergunta);
    formAtivo.perguntas.forEach(atualizarPergunta);
    await carregarProcesso();
  } catch (erro) { $('msgErroForm').className = 'error'; $('msgErroForm').textContent = erro.message; }
}

function ligarFormulario() {
  renderizarFormulario();
  const hoje = new Date().toISOString().slice(0, 10);
  $('inputDataRef').value = hoje;
  $('inputDataRef').max = hoje;
  $('submeterMonitorizacao').addEventListener('click', submeterMonitorizacao);
  $('contentorPerguntas').addEventListener('change', evento => {
    const campo = evento.target.closest('[data-pergunta]');
    if (!campo || evento.target.type !== 'radio') return;
    const pergunta = perguntaPorId(campo.dataset.pergunta);
    atualizarPergunta(pergunta);
    // Uma resposta de detalhe pode mudar a instrução da pergunta principal (ex.: convulsão).
    if (pergunta.id_pergunta_pai) atualizarPergunta(perguntaPorId(pergunta.id_pergunta_pai));
  });
}

// ---------- Associação de cuidador (só o doente) ----------
function ligarAssociacao() {
  $('associarCuidador').addEventListener('click', () => executarAcao(async () => {
    await pedidoApi(urlDoente('cuidadores'), { method: 'POST', body: JSON.stringify({
      email_cuidador: $('emailCuidador').value, grau_parentesco: $('grauParentesco').value,
      consentimento_confirmado: true
    }) });
    $('emailCuidador').value = ''; $('grauParentesco').value = '';
  }, 'Cuidador autorizado associado.'));
}

// ---------- Desenho do processo ----------
function aoCarregarProcesso() {
  // Com KPS ≤ 70 o formulário deve ser preenchido pelo cuidador (RF05).
  const bloqueado = user.perfil === 'DOENTE' && Boolean(processoAtual.doente.participacao_cuidador_obrigatoria);
  $('avisoCuidadorObrigatorio').classList.toggle('hidden', !bloqueado);
  $('corpoFormulario').classList.toggle('hidden', bloqueado);
}

// ---------- Arranque ----------
(() => {
  const sessao = lerSessao();
  const ehDoente = sessao?.utilizador?.perfil === 'DOENTE';
  const separadores = [['registar', 'Registar sintomas'], ['evolucao', ehDoente ? 'A minha evolução' : 'Evolução'], ['historico', 'Histórico']];
  if (ehDoente) separadores.push(['cuidador', 'O meu cuidador']);
  iniciarPagina({
    perfis: ['DOENTE', 'CUIDADOR'],
    separadores,
    separadorInicial: 'registar',
    depoisDeCarregar: async () => {
      ligarFormulario();
      if (ehDoente) ligarAssociacao();
    }
  });
})();
