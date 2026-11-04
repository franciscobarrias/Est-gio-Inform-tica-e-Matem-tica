/*
 * Motor de alertas em camadas para o formulário v2.
 * Funções puras: recebem as respostas e o histórico e devolvem a prioridade e os motivos,
 * sem tocar na base de dados. Assim cada regra pode ser testada sozinha.
 *
 * Camadas (ver "Como se calcula o alerta" no documento de validação):
 *   1. Sinais de alarme        → Crítica (convulsão isolada com recuperação → Alta)
 *   2. Combinações de sintomas → Crítica, Alta ou Média
 *   3. Score de evolução       → Média, se ultrapassar um limiar adaptado à linha de base
 *   4. Ajustes finais          → KPS ≤ 70 ou frequência diária/constante sobem um nível, até Alta
 * Sai no máximo um alerta por submissão, com a prioridade mais alta e todos os motivos.
 *
 * TODOS os limiares e pesos são uma proposta e têm de ser validados pela equipa clínica.
 */

export type Prioridade = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
export type TipoRegraV2 = 'SINAL_ALARME_V2' | 'COMBINACAO_V2' | 'SCORE_EVOLUCAO_V2' | 'DADOS_INSUFICIENTES_V2';
// O que a aplicação diz logo ao doente ou ao cuidador.
export type Instrucao = 'LIGAR_112' | 'CONTACTAR_JA' | 'CONTACTAR_HOJE';

export interface RespostaV2 {
  valor: number;            // valor numérico da opção escolhida
  naoAvaliavel: boolean;    // "Não consigo avaliar"
  frequencia?: string | null;
}
// Respostas de uma submissão, indexadas pelo código da pergunta (A1, B3, C1, ...).
export type RespostasPorCodigo = Record<string, RespostaV2 | undefined>;

export interface Motivo {
  texto: string;
  prioridade: Prioridade;
  tipo: TipoRegraV2;
  codigos: string[];        // perguntas que deram origem ao motivo (para os ajustes de frequência)
}

export interface ResultadoV2 {
  prioridade: Prioridade | null;   // null = não há alerta
  tipo: TipoRegraV2 | null;        // regra do motivo mais grave
  motivos: Motivo[];
  ajustes: string[];
  instrucoes: Instrucao[];
  score: number | null;
  cobertura: number;
  linhaDeBase: number | null;
  variabilidadeLinhaDeBase: number | null;
  limiarScore: number | null;
  dadosNaoAvaliaveis: string[];
}

export const NIVEIS: Prioridade[] = ['Baixa', 'Média', 'Alta', 'Crítica'];
const nivel = (p: Prioridade) => NIVEIS.indexOf(p);

// ---------- Pesos do score (Passo 3) ----------
export const PESOS: Record<string, number> = {
  // Peso 3: função e comunicação
  C1: 3, C2: 3, C3: 3, C4: 3, D1: 3, B6: 3, B8: 3, B9: 3,
  // Peso 2: pressão intracraniana, cognição e deglutição
  B1: 2, B3: 2, B4: 2, B7: 2, B18: 2, B19: 2,
  // Peso 1: restantes sintomas do Bloco B
  B2: 1, B5: 1, B10: 1, B11: 1, B12: 1, B13: 1, B14: 1, B15: 1, B16: 1, B17: 1  // B20 é texto livre: não entra no score
};
// Valor máximo de cada pergunta (as quedas vão só até 2).
export const MAXIMOS: Record<string, number> = { C3: 2 };
const maximo = (codigo: string) => MAXIMOS[codigo] ?? 3;

export const SUBIDA_SCORE_MINIMA = 5;    // mínimo demonstrativo; requer validação clínica
export const COBERTURA_MINIMA = 0.6;     // fração do peso total que tem de estar respondida
export const REGISTOS_LINHA_DE_BASE = 3; // a linha de base é a mediana dos 3 primeiros registos
export const JANELA_MINIMA_DIAS = 7;     // evita sobreposição da recordação dos sintomas
// Versão das regras e parâmetros do cálculo. Cada avaliação guarda-a, para que os resultados antigos
// continuem rastreáveis se as regras mudarem. No protótipo existe uma única versão.
export const VERSAO_PARAMETROS = '1.0';

// Valor de uma resposta, ou null se não foi respondida ou se "não consegue avaliar".
export function valorDe(respostas: RespostasPorCodigo, codigo: string): number | null {
  const r = respostas[codigo];
  return r && !r.naoAvaliavel ? r.valor : null;
}

export function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

// ---------- Passo 3: score ponderado de 0 a 100 ----------
// Só contam as perguntas respondidas, por isso um registo parcial continua comparável (RF16).
export function calcularScore(respostas: RespostasPorCodigo): { score: number | null; cobertura: number } {
  let soma = 0, maximoRespondido = 0, maximoTotal = 0;
  for (const [codigo, peso] of Object.entries(PESOS)) {
    maximoTotal += peso * maximo(codigo);
    const v = valorDe(respostas, codigo);
    if (v === null) continue;
    soma += peso * v;
    maximoRespondido += peso * maximo(codigo);
  }
  const cobertura = maximoTotal ? maximoRespondido / maximoTotal : 0;
  return { score: maximoRespondido ? Math.round(1000 * soma / maximoRespondido) / 10 : null, cobertura };
}

// ---------- Avaliação de uma submissão ----------
export function avaliarSubmissaoV2(entrada: {
  respostas: RespostasPorCodigo;
  // Registos anteriores do mesmo formulário, do mais antigo para o mais recente.
  anteriores: RespostasPorCodigo[];
  kps: number | null;
}): ResultadoV2 {
  const { respostas, anteriores, kps } = entrada;
  const v = (codigo: string) => valorDe(respostas, codigo);
  const sim = (codigo: string) => v(codigo) === 1;
  const motivos: Motivo[] = [];
  const instrucoes = new Set<Instrucao>();
  const motivo = (texto: string, prioridade: Prioridade, tipo: TipoRegraV2, codigos: string[]) =>
    motivos.push({ texto, prioridade, tipo, codigos });

  // ----- Passo 1: sinais de alarme (Bloco A) -----
  // Convulsão: A1a = durou 5 minutos ou mais, A1b = mais do que uma, A1c = não recuperou.
  // Detalhes por responder ou «não consigo avaliar» contam como o pior caso.
  if (sim('A1')) {
    const curta = v('A1a') === 0, uma = v('A1b') === 0, recuperou = v('A1c') === 0;
    if (curta && uma && recuperou) {
      motivo('Convulsão única, com menos de 5 minutos e recuperação (A1)', 'Alta', 'SINAL_ALARME_V2', ['A1']);
      instrucoes.add('CONTACTAR_HOJE');
    } else if (curta && v('A1b') === 1 && recuperou) {
      // Várias convulsões curtas com recuperação entre elas: não é estado de mal, mas não pode esperar (a validar).
      motivo('Várias convulsões curtas, com recuperação entre elas (A1)', 'Crítica', 'SINAL_ALARME_V2', ['A1']);
      instrucoes.add('CONTACTAR_JA');
    } else {
      const detalhes = [
        v('A1a') === 1 ? 'durou 5 minutos ou mais' : v('A1a') === null ? 'duração não indicada' : '',
        v('A1b') === 1 && v('A1c') === 1 ? 'várias sem recuperar entre elas' : '',
        v('A1c') === 1 && v('A1b') !== 1 ? 'sem recuperação' : v('A1c') === null ? 'recuperação não indicada' : ''
      ].filter(Boolean).join('; ');
      motivo(`Convulsão: ${detalhes || 'detalhes não indicados'} (A1)`, 'Crítica', 'SINAL_ALARME_V2', ['A1']);
      instrucoes.add('LIGAR_112');
    }
  }
  // A prioridade acompanha a instrução dada ao doente: ligar 112 ou contactar já → Crítica; contactar hoje → Alta
  // (como na convulsão única com recuperação). Matriz prioridade × instrução a validar com a equipa clínica.
  const PRIORIDADE_DA_INSTRUCAO: Record<Instrucao, Prioridade> = { LIGAR_112: 'Crítica', CONTACTAR_JA: 'Crítica', CONTACTAR_HOJE: 'Alta' };
  const alarmes: Array<[string, string, Instrucao]> = [
    ['A2', 'Dor de cabeça súbita, a pior da vida', 'LIGAR_112'],
    ['A3', 'Sonolência ou confusão súbita, ou dificuldade em acordar', 'LIGAR_112'],
    ['A4', 'Défice neurológico súbito (fraqueza de um lado, boca ao lado ou sem falar)', 'LIGAR_112'],
    ['A5', 'Temperatura ≥ 38 °C ou < 36 °C', 'CONTACTAR_JA'],
    ['A6', 'Falta de ar nova ou dor no peito', 'LIGAR_112'],
    ['A7', 'Perna inchada, quente ou dolorosa', 'CONTACTAR_HOJE'],
    ['A8', 'Sangramento ou nódoas negras sem razão', 'CONTACTAR_HOJE'],
    ['A9', 'Vómitos que não param com os antieméticos', 'CONTACTAR_JA']
  ];
  for (const [codigo, texto, instrucao] of alarmes) {
    if (sim(codigo)) { motivo(`${texto} (${codigo})`, PRIORIDADE_DA_INSTRUCAO[instrucao], 'SINAL_ALARME_V2', [codigo]); instrucoes.add(instrucao); }
  }
  if (v('B4') === 3) { motivo('Sonolência em nível grave (B4)', 'Crítica', 'SINAL_ALARME_V2', ['B4']); instrucoes.add('CONTACTAR_JA'); }

  // ----- Passo 2: combinações de sintomas -----
  const cefaleia = v('B1') ?? 0, vomitos = v('B3') ?? 0;
  const detalhesCefaleia = ['B1a', 'B1b', 'B1c'].filter(sim).length;
  const hicProvavel = (cefaleia >= 2 || (cefaleia >= 1 && detalhesCefaleia >= 1)) && vomitos >= 1 && ((v('B4') ?? 0) >= 1 || sim('B6a'));
  const hicPossivel = (cefaleia >= 2 && vomitos >= 1) || (cefaleia >= 1 && detalhesCefaleia >= 2);
  if (hicProvavel) {
    motivo('Hipertensão intracraniana provável: dor de cabeça, vómitos e sonolência ou visão dupla (B1, B3, B4/B6)', 'Crítica', 'COMBINACAO_V2', ['B1', 'B3', 'B4']);
    instrucoes.add('CONTACTAR_JA');
  } else if (hicPossivel) {
    motivo('Hipertensão intracraniana possível: dor de cabeça com vómitos ou com sinais de alarme (B1, B3)', 'Alta', 'COMBINACAO_V2', ['B1', 'B3']);
  }
  if ((v('B15a') ?? 0) >= 2) motivo('Possível toxicidade da temozolomida: 4 ou mais dejeções a mais por dia (B15)', 'Alta', 'COMBINACAO_V2', ['B15']);

  // Declínio neurológico (inspirado no NANO): chega a 3, ou sobe 2 níveis face à linha de base desse item.
  const historicoElegivel = anteriores.filter(registo => {
    const resultado = calcularScore(registo);
    return resultado.score !== null && resultado.cobertura >= COBERTURA_MINIMA;
  });
  const basePontuacao = historicoElegivel.slice(0, REGISTOS_LINHA_DE_BASE);
  for (const codigo of ['C1', 'C2', 'B8', 'B9', 'B18']) {
    const atual = v(codigo);
    if (atual === null) continue;
    const valoresBase = basePontuacao.map(r => valorDe(r, codigo)).filter((x): x is number => x !== null);
    const referencia = valoresBase.length ? mediana(valoresBase) : null;
    if (atual >= 3 || (referencia !== null && atual - referencia >= 2)) {
      motivo(`Declínio neurológico em ${codigo}: nível ${atual}${referencia !== null ? ` (habitual ${referencia})` : ''}`, 'Alta', 'COMBINACAO_V2', [codigo]);
    }
  }
  if (v('C3') === 2) motivo('Duas ou mais quedas nos últimos 7 dias (C3)', 'Alta', 'COMBINACAO_V2', ['C3']);

  // Sintoma isolado grave: só quando nada mais explica o alerta.
  if (!motivos.length) {
    const graves = Object.keys(PESOS).filter(c => c.startsWith('B') && v(c) === 3);
    if (graves.length) motivo(`Sintoma grave isolado (${graves.join(', ')})`, 'Média', 'COMBINACAO_V2', graves);
  }

  const dadosNaoAvaliaveis = ['B7', 'B8', 'B9', 'B10', 'B19']
    .filter(codigo => respostas[codigo]?.naoAvaliavel === true);
  if (dadosNaoAvaliaveis.length >= 2) {
    motivo(`Não foi possível avaliar vários indicadores cognitivos (${dadosNaoAvaliaveis.join(', ')})`,
      'Média', 'DADOS_INSUFICIENTES_V2', dadosNaoAvaliaveis);
  }

  // ----- Passo 3: score de evolução face à linha de base -----
  const { score, cobertura } = calcularScore(respostas);
  const scoresBase = basePontuacao.map(registo => calcularScore(registo).score as number);
  const linhaDeBase = scoresBase.length === REGISTOS_LINHA_DE_BASE ? mediana(scoresBase) : null;
  const variabilidadeLinhaDeBase = linhaDeBase === null
    ? null
    : mediana(scoresBase.map(valor => Math.abs(valor - linhaDeBase)));
  const limiarScore = linhaDeBase === null || variabilidadeLinhaDeBase === null
    ? null
    : Math.max(SUBIDA_SCORE_MINIMA, linhaDeBase * 0.1, variabilidadeLinhaDeBase * 2);
  if (score !== null && cobertura >= COBERTURA_MINIMA && linhaDeBase !== null && limiarScore !== null &&
      score - linhaDeBase >= limiarScore) {
    motivo(`Agravamento global: score ${score} face à linha de base ${linhaDeBase} (+${Math.round((score - linhaDeBase) * 10) / 10}; limiar ${Math.round(limiarScore * 10) / 10})`,
      'Média', 'SCORE_EVOLUCAO_V2', []);
  }

  if (!motivos.length) {
    return { prioridade: null, tipo: null, motivos, ajustes: [], instrucoes: [], score, cobertura, linhaDeBase,
      variabilidadeLinhaDeBase, limiarScore, dadosNaoAvaliaveis };
  }

  // ----- Passo 4: ajustes finais (sobem um nível, sem passar de Alta) -----
  const maisGrave = motivos.reduce((a, b) => nivel(b.prioridade) > nivel(a.prioridade) ? b : a);
  let prioridade = maisGrave.prioridade;
  const ajustes: string[] = [];
  const subir = (razao: string) => {
    if (nivel(prioridade) < nivel('Alta')) { prioridade = NIVEIS[nivel(prioridade) + 1]; ajustes.push(razao); }
  };
  if (kps !== null && kps <= 70) subir(`KPS ${kps} ≤ 70`);
  const frequentes = motivos.flatMap(m => m.codigos).filter(c => ['DIARIA', 'CONSTANTE'].includes(respostas[c]?.frequencia || ''));
  if (frequentes.length) subir(`frequência diária ou constante (${Array.from(new Set(frequentes)).join(', ')})`);

  return { prioridade, tipo: maisGrave.tipo, motivos, ajustes, instrucoes: Array.from(instrucoes), score, cobertura,
    linhaDeBase, variabilidadeLinhaDeBase, limiarScore, dadosNaoAvaliaveis };
}

// Texto guardado no alerta: os motivos, os ajustes e a prioridade final.
export function resumoDoAlerta(r: ResultadoV2): string {
  const partes = r.motivos.map(m => `${m.texto} [${m.prioridade}]`);
  const ajuste = r.ajustes.length ? ` Ajustes: ${r.ajustes.join('; ')}.` : '';
  return `${partes.join('; ')}.${ajuste} Prioridade ${r.prioridade}.`;
}
