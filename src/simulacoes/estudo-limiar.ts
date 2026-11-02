type Variante = {
  nome: string;
  tamanhoBase: number;
  fatorMad: number;
  relativo?: number;
  persistencia?: number;
};

const COORTE_POR_GRUPO = 500;
const REGISTOS_SEMANAIS = 52;
const INICIO_PROGRESSAO = 12;
const VARIANTES: Variante[] = [
  { nome: 'Atual: max(5; 0,1×S0; 2×MAD)', tamanhoBase: 3, fatorMad: 2 },
  { nome: 'MAD escalada: 2×1,4826×MAD', tamanhoBase: 3, fatorMad: 2 * 1.4826 },
  { nome: 'Variação relativa de 10%', tamanhoBase: 3, fatorMad: 2, relativo: 0.1 },
  { nome: 'Persistência: 2 registos', tamanhoBase: 3, fatorMad: 2, persistencia: 2 },
  { nome: 'Mais registos de base: k=4', tamanhoBase: 4, fatorMad: 2 },
  { nome: 'Mais registos de base: k=5', tamanhoBase: 5, fatorMad: 2 }
];

function gerador(seed: number): () => number {
  let estado = seed >>> 0;
  return () => {
    estado = (1664525 * estado + 1013904223) >>> 0;
    return (estado + 1) / 4294967297;
  };
}

function ruidoNormal(aleatorio: () => number): number {
  const u1 = Math.max(Number.EPSILON, aleatorio());
  const u2 = aleatorio();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function limitarScore(valor: number): number {
  return Math.max(0, Math.min(100, Math.round(valor * 10) / 10));
}

function criarCoorte(estavel: boolean, seed: number): number[][] {
  const aleatorio = gerador(seed);
  return Array.from({ length: COORTE_POR_GRUPO }, () => {
    const media = 20 + aleatorio() * 45;
    const desvio = 2 + aleatorio() * 3;
    const inclinacao = 1.5 + aleatorio() * 1.5;
    return Array.from({ length: REGISTOS_SEMANAIS }, (_, semana) => {
      const progressao = estavel ? 0 : Math.max(0, semana - INICIO_PROGRESSAO) * inclinacao;
      return limitarScore(media + progressao + ruidoNormal(aleatorio) * desvio);
    });
  });
}

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function detetar(scores: number[], variante: Variante): number | null {
  const base = mediana(scores.slice(0, variante.tamanhoBase));
  const mad = mediana(scores.slice(0, variante.tamanhoBase).map(valor => Math.abs(valor - base)));
  const limiar = Math.max(5, base * 0.1, variante.fatorMad * mad);
  let acimaConsecutivos = 0;
  for (let indice = variante.tamanhoBase; indice < scores.length; indice++) {
    const delta = scores[indice] - base;
    const ultrapassa = variante.relativo === undefined
      ? delta >= limiar
      : base < 100 && delta / (100 - base) >= variante.relativo;
    acimaConsecutivos = ultrapassa ? acimaConsecutivos + 1 : 0;
    if (acimaConsecutivos >= (variante.persistencia ?? 1)) return indice;
  }
  return null;
}

function executar(): void {
  const coorteEstavel = criarCoorte(true, 20261102);
  const coorteProgressiva = criarCoorte(false, 20261103);
  const mesesPorDoente = REGISTOS_SEMANAIS * 7 / 30.4375;
  const resultados = VARIANTES.map(variante => {
    const falsosAlarmes = coorteEstavel.filter(scores => detetar(scores, variante) !== null).length;
    const deteccoes = coorteProgressiva
      .map(scores => detetar(scores, variante))
      .filter((indice): indice is number => indice !== null && indice >= INICIO_PROGRESSAO);
    const temposDias = deteccoes.map(indice => (indice - INICIO_PROGRESSAO) * 7);
    return {
      variante: variante.nome,
      falsosPorDoenteMes: falsosAlarmes / (COORTE_POR_GRUPO * mesesPorDoente),
      taxaDetecao: deteccoes.length / COORTE_POR_GRUPO,
      medianaDiasAteDetecao: temposDias.length ? mediana(temposDias) : null,
      diasSemCamadaScore: variante.tamanhoBase * 7
    };
  });
  console.log(JSON.stringify({
    parametros: {
      coorteEstavel: COORTE_POR_GRUPO,
      coorteProgressiva: COORTE_POR_GRUPO,
      registosPorAno: REGISTOS_SEMANAIS,
      ruido: 'Normal independente, desvio-padrão uniforme entre 2 e 5 pontos',
      progressao: `Aumento linear aleatório após a semana ${INICIO_PROGRESSAO}`,
      pressupostoVariacaoRelativa: '10% do intervalo restante até 100',
      diasSemScore: 'k primeiros registos semanais, assumindo uma submissão por semana'
    },
    resultados
  }, null, 2));
}

executar();
