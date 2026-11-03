// ---------- Caixas de pesquisa (combobox) ----------
// Em vez de procurar numa lista com scroll, escreve-se e as opções aparecem ordenadas da mais parecida
// para a menos parecida. Serve para dois casos:
//  - tornarPesquisavel(select): só se pode escolher uma opção da lista (ex.: medicamento com código ATC).
//    O <select> original fica escondido e continua a ter o valor, por isso o resto do código não muda.
//  - sugerirEnquantoEscreve(input, obterSugestoes): texto livre com sugestões (ex.: dose).

const normalizarPesquisa = texto => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function distanciaEdicao(a, b) {
  const linha = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0]; linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = linha[j];
      linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return linha[b.length];
}

// Quanto maior, mais parecido. 0 = não aparece.
function semelhancaPesquisa(texto, consulta) {
  const t = normalizarPesquisa(texto), q = normalizarPesquisa(consulta).trim();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const palavras = t.split(/[^a-z0-9.,/]+/).filter(Boolean);
  if (palavras.some(p => p.startsWith(q))) return 80;
  const partes = q.split(/\s+/);
  if (partes.every(x => palavras.some(p => p.startsWith(x)))) return 70;
  const posicao = t.indexOf(q);
  if (posicao >= 0) return 60 - Math.min(posicao, 40) / 4;
  // Pequenos erros de escrita (ex.: «temozolamida»): uma letra trocada por cada 4 escritas.
  const tolerancia = Math.floor(q.length / 4);
  if (tolerancia && palavras.some(p => distanciaEdicao(p.slice(0, q.length), q) <= tolerancia)) return 40;
  // Letras pela ordem dentro da mesma palavra (ex.: «lvtrc» → levetiracetam).
  const subsequencia = p => { let i = 0; for (const c of p) if (c === q[i]) i++; return i === q.length; };
  return q.length >= 3 && palavras.some(p => p[0] === q[0] && subsequencia(p)) ? 20 : 0;
}

function ordenarPorSemelhanca(opcoes, consulta) {
  return opcoes.map((o, ordem) => ({ ...o, ordem, pontos: semelhancaPesquisa(o.texto, consulta) }))
    .filter(o => o.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem);
}

// Realça a parte escrita (os índices coincidem porque os textos estão em forma composta).
function realcarPesquisa(texto, consulta) {
  const q = normalizarPesquisa(consulta).trim(), i = q ? normalizarPesquisa(texto).indexOf(q) : -1;
  if (i < 0) return escapar(texto);
  return `${escapar(texto.slice(0, i))}<mark>${escapar(texto.slice(i, i + q.length))}</mark>${escapar(texto.slice(i + q.length))}`;
}

let contadorPesquisa = 0;

// Liga uma caixa de texto a uma lista de sugestões. aoEscolher(opcao) é chamado quando se escolhe uma.
function criarListaPesquisa(input, { obterOpcoes, aoEscolher, aoSair, semResultados }) {
  const id = `lista-pesquisa-${++contadorPesquisa}`;
  const lista = document.createElement('ul');
  lista.id = id; lista.className = 'pesquisa-lista'; lista.setAttribute('role', 'listbox'); lista.hidden = true;
  input.insertAdjacentElement('afterend', lista);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id); input.setAttribute('aria-expanded', 'false'); input.autocomplete = 'off';
  let visiveis = [], ativo = -1, consultaAtual = '';

  const fechar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); ativo = -1; };
  const marcarAtivo = indice => {
    ativo = indice;
    [...lista.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === ativo)));
    const li = lista.children[ativo];
    if (li && li.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  const abrir = consulta => {
    consultaAtual = consulta;
    visiveis = ordenarPorSemelhanca(obterOpcoes(), consulta);
    lista.innerHTML = visiveis.length
      ? visiveis.map((o, i) => `<li role="option" id="${id}-${i}" aria-selected="false" data-indice="${i}"${o.estado ? ' class="com-estado"' : ''}>${o.estado
          ? `<i class="ponto-info ponto-${escapar(o.estado)}" aria-hidden="true"></i><span class="op-texto">${realcarPesquisa(o.texto, consulta)}</span><span class="op-detalhe">${escapar(o.detalhe || '')}</span>`
          : realcarPesquisa(o.texto, consulta)}</li>`).join('')
      : (semResultados ? `<li class="pesquisa-vazia" aria-disabled="true">${escapar(semResultados)}</li>` : '');
    if (!lista.innerHTML) return fechar();
    lista.hidden = false; input.setAttribute('aria-expanded', 'true');
    marcarAtivo(consulta.trim() && visiveis.length ? 0 : -1);
  };
  const escolher = indice => { const o = visiveis[indice]; if (!o) return; aoEscolher(o); fechar(); };

  input.addEventListener('input', () => abrir(input.value));
  input.addEventListener('focus', () => { input.select(); abrir(''); });
  input.addEventListener('keydown', evento => {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (lista.hidden) return abrir(consultaAtual);
      const passo = evento.key === 'ArrowDown' ? 1 : -1;
      marcarAtivo(Math.max(0, Math.min(visiveis.length - 1, ativo + passo)));
    } else if (evento.key === 'Enter' && !lista.hidden && ativo >= 0) {
      evento.preventDefault(); escolher(ativo);
    } else if (evento.key === 'Escape' && !lista.hidden) {
      evento.preventDefault(); fechar();
    }
  });
  // mousedown em vez de click para escolher antes de a caixa perder o foco.
  lista.addEventListener('mousedown', evento => {
    const li = evento.target.closest('li[data-indice]');
    evento.preventDefault();
    if (li) escolher(Number(li.dataset.indice));
  });
  input.addEventListener('blur', () => { fechar(); if (aoSair) aoSair(visiveis, consultaAtual); });
  return { fechar };
}

// Transforma um <select> numa caixa de pesquisa. O select continua a ser a fonte do valor.
// mostrarEstado: cada <option> pode ter data-estado (varia/igual/vazio) e data-detalhe, mostrados como bolinha e texto.
function tornarPesquisavel(select, { placeholder = 'Escreva para pesquisar…', mostrarEstado = false } = {}) {
  if (!select || select.dataset.pesquisavel) return;
  select.dataset.pesquisavel = '1';
  const caixa = document.createElement('div');
  caixa.className = 'pesquisa';
  const input = document.createElement('input');
  input.type = 'text'; input.id = `${select.id}-pesquisa`; input.placeholder = placeholder;
  if (select.getAttribute('aria-describedby')) input.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
  select.insertAdjacentElement('beforebegin', caixa);
  caixa.append(input, select);
  select.hidden = true; select.tabIndex = -1;
  const rotulo = document.querySelector(`label[for="${select.id}"]`);
  if (rotulo) rotulo.htmlFor = input.id;

  const opcoes = () => [...select.options].filter(o => o.value !== '').map(o => ({
    valor: o.value, texto: o.text, ...(mostrarEstado ? { estado: o.dataset.estado, detalhe: o.dataset.detalhe } : {})
  }));
  // A bolinha da opção escolhida também aparece dentro da caixa.
  const ponto = mostrarEstado ? document.createElement('i') : null;
  if (ponto) { ponto.className = 'ponto-info ponto-na-caixa'; ponto.setAttribute('aria-hidden', 'true'); caixa.classList.add('com-ponto'); caixa.prepend(ponto); }
  const textoSelecionado = () => (select.selectedIndex >= 0 && select.value !== '' ? select.options[select.selectedIndex].text : '');
  const sincronizar = () => {
    if (document.activeElement !== input) input.value = textoSelecionado();
    if (ponto) {
      const opcao = select.options[select.selectedIndex];
      ponto.className = `ponto-info ponto-na-caixa${opcao?.dataset.estado ? ` ponto-${opcao.dataset.estado}` : ''}`;
      input.title = opcao?.dataset.detalhe || '';
    }
  };
  const escolherValor = valor => {
    if (select.value !== valor) { select.value = valor; select.dispatchEvent(new Event('change', { bubbles: true })); }
    input.value = textoSelecionado();
  };

  criarListaPesquisa(input, {
    obterOpcoes: opcoes,
    semResultados: 'Nenhuma opção corresponde ao que escreveu.',
    aoEscolher: o => escolherValor(o.valor),
    // Ao sair: se o texto foi apagado, limpa; se só há uma opção parecida, escolhe-a; senão repõe a escolha anterior.
    aoSair: (visiveis, consulta) => {
      if (!input.value.trim() && [...select.options].some(o => o.value === '')) return escolherValor('');
      if (input.value !== textoSelecionado() && consulta.trim() && visiveis.length && (visiveis.length === 1 || visiveis[0].pontos >= 90)) {
        return escolherValor(visiveis[0].valor);
      }
      input.value = textoSelecionado();
    }
  });

  // Quando o código muda o valor ou as opções do select, a caixa de texto acompanha.
  const descritor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return descritor.get.call(this); },
    set(v) { descritor.set.call(this, v); sincronizar(); }
  });
  new MutationObserver(sincronizar).observe(select, { childList: true, subtree: true });
  select.addEventListener('change', sincronizar);
  select.addEventListener('opcoes-atualizadas', sincronizar);
  sincronizar();
}

// Texto livre com sugestões. obterSugestoes() devolve uma lista de textos (pode depender de outros campos).
function sugerirEnquantoEscreve(input, obterSugestoes) {
  if (!input || input.dataset.pesquisavel) return;
  input.dataset.pesquisavel = '1';
  input.removeAttribute('list');
  const caixa = document.createElement('div');
  caixa.className = 'pesquisa pesquisa-livre';
  input.insertAdjacentElement('beforebegin', caixa);
  caixa.append(input);
  criarListaPesquisa(input, {
    obterOpcoes: () => (obterSugestoes() || []).map(texto => ({ valor: texto, texto })),
    aoEscolher: o => { input.value = o.texto; input.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

// Sugestões a partir de um <datalist> que já exista na página.
const sugestoesDaDatalist = id => () => [...(document.getElementById(id)?.options || [])].map(o => o.value);
