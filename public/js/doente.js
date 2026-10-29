/*
 * Página do doente e do cuidador: registo de sintomas, evolução e histórico.
 * O doente pode também associar um cuidador. O cuidador com vários doentes escolhe-os no seletor.
 */

// ---------- Formulário de monitorização ----------
function renderizarFormulario() {
  $('tituloFormulario').textContent = `${formAtivo.nome} (versão ${formAtivo.versao})`;
  const grupos = {};
  formAtivo.perguntas.forEach(p => (grupos[p.categoria] = grupos[p.categoria] || []).push(p));
  $('contentorPerguntas').innerHTML = Object.entries(grupos).map(([categoria, perguntas]) => `
    <fieldset class="grupo-perguntas"><legend>${escapar(CATEGORIAS[categoria] || categoria)}</legend>
    ${perguntas.map(pergunta => `<div class="pergunta linha-campos">
      <div><label for="resp_${escapar(pergunta.id_pergunta)}">${escapar(pergunta.enunciado)}</label>
      <select id="resp_${escapar(pergunta.id_pergunta)}" data-opcao="${escapar(pergunta.id_pergunta)}">
        <option value="">Sem resposta</option>
        ${pergunta.opcoes.map(opcao => `<option value="${escapar(opcao.id_opcao)}">${escapar(opcao.rotulo)}</option>`).join('')}
      </select></div>
      ${pergunta.categoria === 'SINTOMA_GERAL' ? `<div><label for="freq_${escapar(pergunta.id_pergunta)}">Frequência (opcional)</label>
        <select id="freq_${escapar(pergunta.id_pergunta)}" data-frequencia="${escapar(pergunta.id_pergunta)}" disabled>
          <option value="">Não indicada</option><option value="PONTUAL">Pontual</option><option value="INTERMITENTE">Intermitente</option><option value="DIARIA">Diária</option><option value="CONSTANTE">Constante</option>
        </select></div>` : ''}
    </div>`).join('')}</fieldset>`).join('');
}

async function submeterMonitorizacao() {
  $('msgErroForm').textContent = '';
  const respostas = formAtivo.perguntas.map(pergunta => ({
    id_pergunta: pergunta.id_pergunta,
    id_opcao: $(`resp_${pergunta.id_pergunta}`).value,
    frequencia: $(`freq_${pergunta.id_pergunta}`)?.value || undefined
  })).filter(resposta => resposta.id_opcao);
  try {
    const resultado = await pedidoApi(urlDoente('submissoes'), {
      method: 'POST',
      body: JSON.stringify({ id_formulario: formAtivo.id_formulario, data_referencia_sintomas: $('inputDataRef').value, respostas })
    });
    $('msgErroForm').className = 'success';
    $('msgErroForm').textContent = resultado.alertasGerados.length
      ? 'Registo guardado. A equipa de enfermagem foi notificada das alterações reportadas.'
      : 'Registo guardado. Obrigado.';
    formAtivo.perguntas.forEach(pergunta => {
      $(`resp_${pergunta.id_pergunta}`).value = '';
      const f = $(`freq_${pergunta.id_pergunta}`); if (f) { f.value = ''; f.disabled = true; }
    });
    await carregarProcesso();
  } catch (erro) { $('msgErroForm').className = 'error'; $('msgErroForm').textContent = erro.message; }
}

function ligarFormulario() {
  renderizarFormulario();
  const hoje = new Date().toISOString().slice(0, 10);
  $('inputDataRef').value = hoje;
  $('inputDataRef').max = hoje;
  $('submeterMonitorizacao').addEventListener('click', submeterMonitorizacao);
  // A frequência só se pode indicar para um sintoma presente.
  $('contentorPerguntas').addEventListener('change', evento => {
    const idPergunta = evento.target.dataset.opcao;
    if (!idPergunta || !$(`freq_${idPergunta}`)) return;
    const opcao = formAtivo.perguntas.find(pergunta => pergunta.id_pergunta === idPergunta)?.opcoes
      .find(item => item.id_opcao === evento.target.value);
    const frequencia = $(`freq_${idPergunta}`);
    const permiteFrequencia = opcao && !['AUSENTE', 'IMPOSSIVEL_AVALIAR'].includes(opcao.valor_codificado);
    frequencia.disabled = !permiteFrequencia;
    if (!permiteFrequencia) frequencia.value = '';
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
