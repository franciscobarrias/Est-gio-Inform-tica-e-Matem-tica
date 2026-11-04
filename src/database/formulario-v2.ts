/*
 * Formulário de monitorização (proposta para validação médica). O «v2» do nome é apenas histórico.
 *
 * Organização (ver o documento "Proposta de questionário para validação médica"):
 *   Bloco A — Sinais de alarme (sim / não, últimas 24 horas)
 *   Bloco B — Sintomas (escala de 0 a 3, últimos 7 dias)
 *   Bloco C — Função (níveis descritos por tarefa)
 *   Bloco D — Autonomia
 * Algumas perguntas têm perguntas de detalhe, que só aparecem quando a pergunta principal
 * atinge um valor mínimo (por exemplo, os detalhes da dor de cabeça só aparecem se houver dor).
 *
 * Cada pergunta tem o texto para o doente e, quando é diferente, o texto para o cuidador
 * (na 3.ª pessoa: «O doente teve…»). As opções de intensidade também têm versão para o cuidador.
 *
 * Os textos, os níveis e os limiares são uma proposta e têm de ser validados pela equipa clínica.
 * Para alterar o questionário depois da validação: mudar esta lista e criar uma versão 3,
 * para que os registos antigos continuem ligados às perguntas a que responderam.
 */

export const ID_FORMULARIO_V2 = 'form-gbm-v2';

// [sufixo do id, rótulo mostrado, valor codificado, valor numérico]
type Opcao = [string, string, string, number | null];

const NAO_CONSIGO: Opcao = ['nao-avaliavel', 'Não consigo avaliar', 'IMPOSSIVEL_AVALIAR', null]; // vazio: não é o mesmo que «Não tive» (0)
const SIM_NAO: Opcao[] = [['nao', 'Não', 'NAO', 0], ['sim', 'Sim', 'SIM', 1]];
const INTENSIDADE: Opcao[] = [
  ['ausente', 'Não tive', 'AUSENTE', 0],
  ['ligeira', 'Ligeira — notei, mas não me impediu de fazer nada', 'LIGEIRA', 1],
  ['moderada', 'Moderada — atrapalhou algumas das minhas atividades', 'MODERADA', 2],
  ['grave', 'Grave — impediu-me de fazer as atividades normais ou tive de ficar na cama', 'GRAVE', 3],
  NAO_CONSIGO
];
// Rótulos das opções quando responde o cuidador (por valor codificado). As restantes opções são iguais.
export const ROTULOS_CUIDADOR: Record<string, string> = {
  AUSENTE: 'Não teve',
  LIGEIRA: 'Ligeira — notou-se, mas não impediu nenhuma atividade',
  MODERADA: 'Moderada — atrapalhou algumas atividades do dia a dia',
  GRAVE: 'Grave — impediu as atividades normais ou teve de ficar na cama'
};
const niveis = (n0: string, n1: string, n2: string, n3?: string): Opcao[] => [
  ['n0', n0, 'AUSENTE', 0], ['n1', n1, 'LIGEIRA', 1], ['n2', n2, 'MODERADA', 2],
  ...(n3 ? [['n3', n3, 'GRAVE', 3] as Opcao] : []), NAO_CONSIGO
];

export interface PerguntaV2 {
  codigo: string;
  id: string;
  categoria: 'ALARME' | 'SINTOMA' | 'FUNCAO' | 'AUTONOMIA' | 'DETALHE';
  texto: string;
  textoCuidador?: string; // texto quando é o cuidador a responder; sem ele, usa-se o mesmo texto
  opcoes: Opcao[];
  tipo?: 'SELECAO_UNICA' | 'SELECAO_UNICA_COM_TEXTO' | 'TEXTO_LIVRE';  // TEXTO_LIVRE: sem opções, só texto
  pai?: string;          // código da pergunta principal
  valorMinimoPai?: number;
}

export const PERGUNTAS_V2: PerguntaV2[] = [
  // ---------- Bloco A — Sinais de alarme ----------
  { codigo: 'A1', id: 'v2-a1-convulsao', categoria: 'ALARME', texto: 'Teve uma convulsão (ataque)?', textoCuidador: 'O doente teve uma convulsão (ataque)?', opcoes: SIM_NAO },
  // Detalhes da convulsão (revistos com o orientador): duração, número e recuperação.
  { codigo: 'A1a', id: 'v2-a1-duracao', categoria: 'DETALHE', pai: 'A1', valorMinimoPai: 1, texto: 'Quanto tempo durou?', textoCuidador: 'Quanto tempo durou a convulsão?',
    opcoes: [['menos5', 'Menos de 5 minutos', 'MENOS_5_MIN', 0], ['mais5', '5 minutos ou mais', 'MAIS_5_MIN', 1], NAO_CONSIGO] },
  { codigo: 'A1b', id: 'v2-a1-quantas', categoria: 'DETALHE', pai: 'A1', valorMinimoPai: 1, texto: 'Quantas foram?', textoCuidador: 'Quantas convulsões foram?',
    opcoes: [['uma', 'Uma', 'UMA', 0], ['varias', 'Mais do que uma', 'VARIAS', 1], NAO_CONSIGO] },
  { codigo: 'A1c', id: 'v2-a1-recuperou', categoria: 'DETALHE', pai: 'A1', valorMinimoPai: 1,
    texto: 'Recuperou (voltou ao normal) depois da convulsão, ou entre elas se foram várias?',
    textoCuidador: 'O doente recuperou (voltou ao normal) depois da convulsão, ou entre elas se foram várias?',
    opcoes: [['sim', 'Sim, recuperou', 'RECUPEROU', 0], ['nao', 'Não recuperou', 'NAO_RECUPEROU', 1], NAO_CONSIGO] },
  { codigo: 'A2', id: 'v2-a2-cefaleia-subita', categoria: 'ALARME', texto: 'Teve uma dor de cabeça súbita, a pior da sua vida?', textoCuidador: 'O doente queixou-se de uma dor de cabeça súbita, a pior da vida dele?', opcoes: SIM_NAO },
  { codigo: 'A3', id: 'v2-a3-sonolencia-subita', categoria: 'ALARME', texto: 'De repente, está com muito mais sono ou mais confusão do que o normal, ou custa-lhe muito acordar?', textoCuidador: 'O doente está muito mais sonolento ou confuso de repente, ou é difícil acordá-lo?', opcoes: SIM_NAO },
  { codigo: 'A4', id: 'v2-a4-defice-subito', categoria: 'ALARME', texto: 'Ficou de repente com fraqueza de um lado do corpo, a boca ao lado ou sem conseguir falar?', textoCuidador: 'O doente ficou de repente com fraqueza de um lado do corpo, a boca ao lado ou sem conseguir falar?', opcoes: SIM_NAO },
  { codigo: 'A5', id: 'v2-a5-temperatura', categoria: 'ALARME', texto: 'Mediu a temperatura e teve 38 °C ou mais, ou menos de 36 °C?', textoCuidador: 'Mediu a temperatura ao doente e teve 38 °C ou mais, ou menos de 36 °C?', opcoes: SIM_NAO },
  { codigo: 'A6', id: 'v2-a6-falta-ar', categoria: 'ALARME', texto: 'Tem falta de ar que não tinha antes, ou dor no peito?', textoCuidador: 'O doente tem falta de ar que não tinha antes, ou dor no peito?', opcoes: SIM_NAO },
  { codigo: 'A7', id: 'v2-a7-perna', categoria: 'ALARME', texto: 'Tem uma perna inchada, quente ou dolorosa?', textoCuidador: 'O doente tem uma perna inchada, quente ou dolorosa?', opcoes: SIM_NAO },
  { codigo: 'A8', id: 'v2-a8-sangramento', categoria: 'ALARME', texto: 'Tem sangramento (nariz, gengivas) ou nódoas negras sem razão?', textoCuidador: 'O doente tem sangramento (nariz, gengivas) ou nódoas negras sem razão?', opcoes: SIM_NAO },
  { codigo: 'A9', id: 'v2-a9-vomitos', categoria: 'ALARME', texto: 'Continua a vomitar mesmo com os medicamentos para os enjoos?', textoCuidador: 'O doente continua a vomitar mesmo com os medicamentos para os enjoos?', opcoes: SIM_NAO },

  // ---------- Bloco B — Sintomas ----------
  { codigo: 'B1', id: 'v2-b1-cefaleia', categoria: 'SINTOMA', texto: 'Dor de cabeça', opcoes: INTENSIDADE },
  { codigo: 'B1a', id: 'v2-b1-manha', categoria: 'DETALHE', pai: 'B1', valorMinimoPai: 1, texto: 'É pior de manhã, ou acorda durante a noite por causa da dor?', textoCuidador: 'A dor é pior de manhã ou acorda o doente à noite?', opcoes: SIM_NAO },
  { codigo: 'B1b', id: 'v2-b1-analgesico', categoria: 'DETALHE', pai: 'B1', valorMinimoPai: 1, texto: 'A dor continua mesmo depois de tomar o analgésico habitual?', textoCuidador: 'A dor continua mesmo depois de o doente tomar o analgésico habitual?', opcoes: SIM_NAO },
  { codigo: 'B1c', id: 'v2-b1-diferente', categoria: 'DETALHE', pai: 'B1', valorMinimoPai: 1, texto: 'É diferente das dores de cabeça que costuma ter?', textoCuidador: 'É diferente das dores de cabeça que o doente costuma ter?', opcoes: SIM_NAO },
  { codigo: 'B2', id: 'v2-b2-nauseas', categoria: 'SINTOMA', texto: 'Náuseas', opcoes: INTENSIDADE },
  { codigo: 'B3', id: 'v2-b3-vomitos', categoria: 'SINTOMA', texto: 'Vómitos', opcoes: INTENSIDADE },
  { codigo: 'B3a', id: 'v2-b3-vezes', categoria: 'DETALHE', pai: 'B3', valorMinimoPai: 1, texto: 'Quantas vezes vomitou nas últimas 24 horas?', textoCuidador: 'Quantas vezes o doente vomitou nas últimas 24 horas?',
    opcoes: [['n1', '1 vez', 'N1', 1], ['n2', '2 a 3 vezes', 'N2', 2], ['n3', 'Mais de 3 vezes', 'N3', 3]] },
  { codigo: 'B4', id: 'v2-b4-sonolencia', categoria: 'SINTOMA', texto: 'Sonolência durante o dia', opcoes: INTENSIDADE },
  { codigo: 'B5', id: 'v2-b5-cansaco', categoria: 'SINTOMA', texto: 'Cansaço', opcoes: INTENSIDADE },
  { codigo: 'B6', id: 'v2-b6-visao', categoria: 'SINTOMA', texto: 'Visão turva ou dupla', opcoes: INTENSIDADE },
  { codigo: 'B6a', id: 'v2-b6-dupla', categoria: 'DETALHE', pai: 'B6', valorMinimoPai: 1, texto: 'Vê a dobrar (visão dupla)?', textoCuidador: 'O doente vê a dobrar (visão dupla)?', opcoes: SIM_NAO },
  { codigo: 'B7', id: 'v2-b7-memoria', categoria: 'SINTOMA', texto: 'Dificuldade de memória ou de concentração', opcoes: INTENSIDADE },
  { codigo: 'B8', id: 'v2-b8-falar', categoria: 'SINTOMA', texto: 'Dificuldade em falar ou em encontrar as palavras', opcoes: INTENSIDADE },
  { codigo: 'B9', id: 'v2-b9-compreender', categoria: 'SINTOMA', texto: 'Dificuldade em compreender o que lhe dizem', opcoes: INTENSIDADE },
  { codigo: 'B10', id: 'v2-b10-comportamento', categoria: 'SINTOMA', texto: 'Irritabilidade ou mudança de comportamento (os familiares costumam notar melhor)', textoCuidador: 'Irritabilidade ou mudança de comportamento', opcoes: INTENSIDADE },
  { codigo: 'B11', id: 'v2-b11-tristeza', categoria: 'SINTOMA', texto: 'Tristeza', opcoes: INTENSIDADE },
  { codigo: 'B12', id: 'v2-b12-ansiedade', categoria: 'SINTOMA', texto: 'Ansiedade ou angústia', opcoes: INTENSIDADE },
  { codigo: 'B13', id: 'v2-b13-apetite', categoria: 'SINTOMA', texto: 'Falta de apetite', opcoes: INTENSIDADE },
  { codigo: 'B14', id: 'v2-b14-dormencia', categoria: 'SINTOMA', texto: 'Dormência ou formigueiros', opcoes: INTENSIDADE },
  { codigo: 'B15', id: 'v2-b15-diarreia', categoria: 'SINTOMA', texto: 'Diarreia', opcoes: INTENSIDADE },
  { codigo: 'B15a', id: 'v2-b15-dejecoes', categoria: 'DETALHE', pai: 'B15', valorMinimoPai: 1, texto: 'Por dia, quantas vezes a mais do que o habitual vai à casa de banho (fezes)?', textoCuidador: 'Por dia, quantas vezes a mais do que o habitual o doente vai à casa de banho (fezes)?',
    opcoes: [['n1', '1 a 3', 'N1', 1], ['n2', '4 a 6', 'N2', 2], ['n3', '7 ou mais', 'N3', 3]] },
  { codigo: 'B16', id: 'v2-b16-obstipacao', categoria: 'SINTOMA', texto: 'Obstipação', opcoes: INTENSIDADE },
  { codigo: 'B17', id: 'v2-b17-sono', categoria: 'SINTOMA', texto: 'Alterações do sono', opcoes: INTENSIDADE },
  { codigo: 'B18', id: 'v2-b18-engolir', categoria: 'SINTOMA', texto: 'Dificuldade em engolir ou engasgar-se', opcoes: INTENSIDADE },
  { codigo: 'B18a', id: 'v2-b18-liquidos', categoria: 'DETALHE', pai: 'B18', valorMinimoPai: 1, texto: 'Engasga-se com líquidos?', textoCuidador: 'O doente engasga-se com líquidos?', opcoes: SIM_NAO },
  { codigo: 'B19', id: 'v2-b19-confusao', categoria: 'SINTOMA', texto: 'Confusão ou desorientação que tem vindo a agravar', opcoes: INTENSIDADE },
  // B20: texto livre para a equipa. Não tem escala e não entra no score nem nas regras de alerta.
  { codigo: 'B20', id: 'v2-b20-outro', categoria: 'SINTOMA', tipo: 'TEXTO_LIVRE',
    texto: 'Há mais alguma coisa que queira dizer à equipa? (outro sintoma ou preocupação)',
    textoCuidador: 'Há mais alguma coisa que queira dizer à equipa sobre o doente? (outro sintoma ou preocupação)', opcoes: [] },

  // ---------- Bloco C — Função ----------
  { codigo: 'C1', id: 'v2-c1-andar', categoria: 'FUNCAO', texto: 'Marcha e equilíbrio',
    opcoes: niveis('Normal', 'Anda sem ajuda, mas com desequilíbrio', 'Precisa de apoio ou de bengala', 'Não consegue andar') },
  { codigo: 'C2', id: 'v2-c2-forca', categoria: 'FUNCAO', texto: 'Força num braço ou numa perna',
    opcoes: niveis('Normal', 'Um pouco mais fraca do que o habitual', 'Deixa cair objetos ou arrasta a perna', 'Não consegue mexer') },
  { codigo: 'C3', id: 'v2-c3-quedas', categoria: 'FUNCAO', texto: 'Quedas nos últimos 7 dias',
    opcoes: niveis('Nenhuma', '1 queda', '2 ou mais quedas') },
  { codigo: 'C4', id: 'v2-c4-bexiga', categoria: 'FUNCAO', texto: 'Controlo da bexiga',
    opcoes: niveis('Normal', 'Perdas ocasionais novas', 'Perdas frequentes', 'Sem controlo') },

  // ---------- Bloco D — Autonomia ----------
  { codigo: 'D1', id: 'v2-d1-autonomia', categoria: 'AUTONOMIA', texto: 'Ajuda nas atividades do dia a dia',
    opcoes: niveis('Independente', 'Ajuda em algumas tarefas', 'Ajuda na maioria das tarefas', 'Depende totalmente de outra pessoa') }
];

// Regras de alerta do motor em camadas (ver alerta.service.ts). Não validadas clinicamente.
export const REGRAS_V2 = [
  ['regra-v2-alarme', 'Sinal de alarme', 'SINAL_ALARME_V2', 'Qualquer «sim» no Bloco A; sonolência (B4) em nível 3'],
  ['regra-v2-combinacao', 'Combinação de sintomas', 'COMBINACAO_V2', 'Hipertensão intracraniana, toxicidade da temozolomida, declínio neurológico, quedas, sintoma isolado grave'],
  ['regra-v2-score', 'Agravamento face à linha de base', 'SCORE_EVOLUCAO_V2', 'Variação ponderada ajustada à linha de base, à variabilidade individual e à cobertura mínima'],
  ['regra-v2-dados-insuficientes', 'Dados cognitivos não avaliáveis', 'DADOS_INSUFICIENTES_V2', 'Dois ou mais indicadores cognitivos assinalados como não avaliáveis']
] as const;

// Cria o formulário v2 (se ainda não existir) e torna-o o único ativo.
// Recebe a ligação à base de dados para não criar uma dependência circular com dados-locais.ts.
export function garantirFormularioV2(db: any): void {
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO Formulario (id_formulario, nome, versao, estado)
      VALUES (?, 'Questionário de monitorização GBM', 1, 'ATIVO')`).run(ID_FORMULARIO_V2);
    db.prepare(`UPDATE Formulario SET estado = 'INATIVO' WHERE id_formulario != ?`).run(ID_FORMULARIO_V2);
    db.prepare(`UPDATE Formulario SET estado = 'ATIVO' WHERE id_formulario = ?`).run(ID_FORMULARIO_V2);

    const inserirPergunta = db.prepare(`INSERT OR IGNORE INTO PerguntaFormulario
      (id_pergunta, id_formulario, categoria, enunciado, tipo_resposta, obrigatoria, ordem, ativa, codigo, id_pergunta_pai, valor_minimo_pai)
      VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?)`);
    const inserirOpcao = db.prepare(`INSERT OR IGNORE INTO OpcaoResposta
      (id_opcao, id_pergunta, rotulo, valor_codificado, ordem, valor_numerico) VALUES (?, ?, ?, ?, ?, ?)`);
    const idDoCodigo = (codigo?: string) => codigo ? PERGUNTAS_V2.find(p => p.codigo === codigo)!.id : null;
    // Os textos são sempre atualizados a partir deste ficheiro, também em bases de dados já existentes.
    const atualizarTextos = db.prepare(`UPDATE PerguntaFormulario SET enunciado = ?, enunciado_cuidador = ?, ordem = ?, tipo_resposta = ? WHERE id_pergunta = ?`);
    const atualizarRotulos = db.prepare(`UPDATE OpcaoResposta SET rotulo = ?, rotulo_cuidador = ?, ordem = ? WHERE id_opcao = ?`);
    PERGUNTAS_V2.forEach((p, indice) => {
      inserirPergunta.run(p.id, ID_FORMULARIO_V2, p.categoria, p.texto, p.tipo || 'SELECAO_UNICA', indice + 1,
        p.codigo, idDoCodigo(p.pai), p.valorMinimoPai ?? null);
      atualizarTextos.run(p.texto, p.textoCuidador ?? p.texto, indice + 1, p.tipo || 'SELECAO_UNICA', p.id);
      const intensidade = p.opcoes === INTENSIDADE;
      p.opcoes.forEach(([sufixo, rotulo, codigo, valor], ordem) => {
        const id = `op-${p.id}-${sufixo}`;
        inserirOpcao.run(id, p.id, rotulo, codigo, ordem + 1, valor);
        atualizarRotulos.run(rotulo, intensidade ? (ROTULOS_CUIDADOR[codigo] ?? rotulo) : rotulo, ordem + 1, id);
      });
    });

    // Perguntas e opções que saíram do questionário: as perguntas ficam inativas (os registos antigos
    // continuam ligados a elas) e as opções sem respostas são apagadas.
    const idsAtuais = PERGUNTAS_V2.map(p => p.id);
    const antigas = (db.prepare(`SELECT id_pergunta, codigo FROM PerguntaFormulario WHERE id_formulario = ? AND ativa = 1`)
      .all(ID_FORMULARIO_V2) as Array<{ id_pergunta: string; codigo: string | null }>).filter(p => !idsAtuais.includes(p.id_pergunta));
    for (const p of antigas) {
      // O código passa a "A1a-antiga" para não se confundir com a pergunta nova que tem o mesmo código.
      db.prepare(`UPDATE PerguntaFormulario SET ativa = 0, codigo = ? WHERE id_pergunta = ?`)
        .run(p.codigo ? `${p.codigo}-antiga` : null, p.id_pergunta);
    }
    for (const p of PERGUNTAS_V2) {
      const idsOpcoes = p.opcoes.map(([sufixo]) => `op-${p.id}-${sufixo}`);
      const opcoes = db.prepare(`SELECT id_opcao FROM OpcaoResposta WHERE id_pergunta = ?`).all(p.id) as Array<{ id_opcao: string }>;
      for (const o of opcoes.filter(o => !idsOpcoes.includes(o.id_opcao))) {
        const usada = db.prepare(`SELECT 1 FROM RespostaMonitorizacao WHERE id_opcao = ? LIMIT 1`).get(o.id_opcao);
        if (!usada) db.prepare(`DELETE FROM OpcaoResposta WHERE id_opcao = ?`).run(o.id_opcao);
      }
    }

    const inserirRegra = db.prepare(`INSERT OR IGNORE INTO RegraAlerta
      (id_regra, nome, tipo_regra, criterio_documentado, referencia_literatura, versao, validada_clinicamente, ativa)
      VALUES (?, ?, ?, ?, 'Proposta de questionário para validação médica', '1.0', 0, 1)`);
    REGRAS_V2.forEach(([id, nome, tipo, criterio]) => inserirRegra.run(id, nome, tipo, criterio));
    const atualizarRegra = db.prepare(`UPDATE RegraAlerta SET criterio_documentado = ? WHERE id_regra = ?`);
    REGRAS_V2.forEach(([id, , , criterio]) => atualizarRegra.run(criterio, id));
  });
  tx();
}
