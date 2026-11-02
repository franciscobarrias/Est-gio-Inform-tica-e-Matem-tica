
import crypto from 'crypto';
import {
  db,
  inicializarBaseDados,
  garantirPerguntasFormularioDemonstracao
} from './database/dados-locais';

import { AuthService } from './services/auth.service';
import { SintomaService } from './services/sintoma.service';
import { AlertaService } from './services/alerta.service';
import { MedicoService } from './services/medico.service';
import { garantirFormularioV2, ID_FORMULARIO_V2 } from './database/formulario-v2';


if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed não pode ser executado em produção.');
}

inicializarBaseDados();

// FUNÇÕES AUXILIARES

const id = (perfil: string, n: number) =>
  `user-${perfil}-${String(n).padStart(3, '0')}`;

function diasAtras(dias: number): string {
  const data = new Date();
  data.setUTCHours(10, 0, 0, 0);
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString();
}

const dataAtras = (dias: number) => diasAtras(dias).slice(0, 10);

// O médico principal (médico 1) acompanha os cenários 1 a 10; os médicos 2 e 3 têm dois doentes cada.
const medicoDe = (n: number) => id('medico', n <= 10 ? 1 : n % 2 === 1 ? 2 : 3);


type Cenario = {
  n: number;
  descricao: string;
  kps: [number, number, number];
  evolucao: number[];
  perguntas: number;
  cuidador?: number;
  prefereCuidador?: boolean;
  naoAvaliavel?: boolean;
};

const cenarios: Cenario[] = [
  {
    n: 1,
    descricao: 'Dependência crescente',
    kps: [80, 70, 60],
    evolucao: [0, 0, 1, 1, 2, 2, 3, 2],
    perguntas: 17,
    cuidador: 1
  },
  {
    n: 2,
    descricao: 'Estável',
    kps: [90, 90, 90],
    evolucao: [0, 0, 0, 0, 0, 0, 0, 0],
    perguntas: 17
  },
  {
    n: 3,
    descricao: 'Agravamento progressivo',
    kps: [90, 80, 80],
    evolucao: [0, 0, 1, 1, 2, 2, 3, 3],
    perguntas: 9,
    cuidador: 2
  },
  {
    n: 4,
    descricao: 'Agravamento súbito',
    kps: [90, 90, 80],
    evolucao: [0, 0, 0, 0, 3, 0, 0, 0],
    perguntas: 7
  },
  {
    n: 5,
    descricao: 'Melhoria gradual',
    kps: [60, 70, 80],
    evolucao: [3, 3, 2, 2, 1, 1, 0, 0],
    perguntas: 10,
    cuidador: 3
  },
  {
    n: 6,
    descricao: 'Respostas muito parciais',
    kps: [90, 90, 80],
    evolucao: [0, 1, 0, 2, 0, 1, 0, 0],
    perguntas: 2
  },
  {
    n: 7,
    descricao: 'Não consegue avaliar',
    kps: [80, 80, 80],
    evolucao: [0, 0, 0, 0, 0, 0, 0, 0],
    perguntas: 4,
    naoAvaliavel: true
  },
  {
    n: 8,
    descricao: 'Preenchimento pelo cuidador',
    kps: [70, 60, 60],
    evolucao: [0, 0, 0, 1, 1, 2, 2, 1],
    perguntas: 8,
    cuidador: 4,
    prefereCuidador: true
  },
  {
    n: 9,
    descricao: 'Alertas e triagem',
    kps: [70, 60, 50],
    evolucao: [0, 0, 1, 1, 2, 1, 2, 3],
    perguntas: 9,
    cuidador: 5
  },
  {
    n: 10,
    descricao: 'Histórico prolongado',
    kps: [90, 80, 80],
    evolucao: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    perguntas: 17
  },
  {
    n: 11,
    descricao: 'Autonomia variável',
    kps: [80, 70, 70],
    evolucao: [0, 0, 0, 1, 1, 2, 1, 0],
    perguntas: 8,
    cuidador: 6
  },
  {
    n: 12,
    descricao: 'Tratamentos múltiplos',
    kps: [90, 90, 80],
    evolucao: [0, 0, 1, 0, 0, 1, 0, 0],
    perguntas: 7,
    cuidador: 7
  },
  {
    n: 13,
    descricao: 'Agravamento neurológico agudo',
    kps: [80, 80, 70],
    evolucao: [0, 0, 0, 0, 0, 1, 1, 3],
    perguntas: 12,
    cuidador: 8
  },
  {
    n: 14,
    descricao: 'Agravamento ligeiro com cuidador',
    kps: [70, 70, 70],
    evolucao: [0, 0, 1, 0, 0, 0, 1, 2],
    perguntas: 17,
    cuidador: 8,
    prefereCuidador: true
  }
];

// CRIAÇÃO DOS DADOS

// NOMES FICTÍCIOS (dados de demonstração; não correspondem a pessoas reais)

const NOMES_DOENTES = [
  'António Ferreira', 'Maria do Céu Lopes', 'Joaquim Pereira', 'Helena Sousa', 'Manuel Rodrigues',
  'Rosa Martins', 'José Carvalho', 'Fernanda Almeida', 'Carlos Ribeiro', 'Isabel Gomes',
  'Luís Teixeira', 'Teresa Moreira', 'Fernando Costa', 'Ana Paula Mendes'
];
const NOMES_CUIDADORES = [
  'Luísa Ferreira', 'Pedro Pereira', 'Graça Rodrigues', 'Miguel Almeida',
  'Sofia Ribeiro', 'Clara Teixeira', 'Ricardo Moreira', 'Marta Costa'
];
// Profissionais sem nomes próprios, para não coincidirem com profissionais reais do hospital.
const NOMES_MEDICOS = ['Médico 1', 'Médico 2', 'Médico 3'];
const NOMES_ENFERMEIROS = ['Enfermeiro 1', 'Enfermeiro 2', 'Enfermeiro 3'];

const criarDados = db.transaction(() => {


  db.exec(`
    DELETE FROM RegistoAuditoria;
    DELETE FROM DecisaoAcompanhamento;
    DELETE FROM HistoricoAcaoAlerta;
    DELETE FROM AlertaClinico;
    DELETE FROM RegraAlerta;
    DELETE FROM RespostaMonitorizacao;
    DELETE FROM SubmissaoMonitorizacao;
    DELETE FROM OpcaoResposta;
    DELETE FROM PerguntaFormulario;
    DELETE FROM Formulario;
    DELETE FROM PlanoMonitorizacao;
    DELETE FROM AvaliacaoKarnofsky;
    DELETE FROM Medicacao;
    DELETE FROM Tratamento;
    DELETE FROM DiagnosticoGB;
    DELETE FROM DoenteCuidador;
    DELETE FROM Doente;
    DELETE FROM Cuidador;
    DELETE FROM Enfermeiro;
    DELETE FROM Medico;
    DELETE FROM Utilizador;
  `);

  // UTILIZADORES

  const criarUtilizador = db.prepare(`
    INSERT INTO Utilizador (
      id_utilizador,
      nome,
      email,
      password_hash,
      perfil,
      estado_conta,
      criado_em
    )
    VALUES (?, ?, ?, ?, ?, 'ATIVA', ?)
  `);

  function novoUtilizador(
    perfil: string,
    n: number,
    nome: string,
    email: string
  ) {
    criarUtilizador.run(
      id(perfil, n),
      nome,
      email,
      AuthService.gerarHashPassword('123456'),
      perfil.toUpperCase(),
      diasAtras(120)
    );
  }

  // MÉDICOS E ENFERMEIROS

  for (let n = 1; n <= 3; n++) {

    novoUtilizador(
      'medico',
      n,
      NOMES_MEDICOS[n - 1],
      `medico${n}@chsj.min-saude.pt`
    );

    db.prepare(`
      INSERT INTO Medico VALUES (?, ?, ?)
    `).run(
      id('medico', n),
      `MED-FICTICIO-${n}`,
      'Neurocirurgia'
    );

    novoUtilizador(
      'enfermeiro',
      n,
      NOMES_ENFERMEIROS[n - 1],
      `enfermeiro${n}@chsj.min-saude.pt`
    );

    db.prepare(`
      INSERT INTO Enfermeiro VALUES (?, ?, ?)
    `).run(
      id('enfermeiro', n),
      `ENF-FICTICIO-${n}`,
      'Neurocirurgia'
    );
  }

  // CUIDADORES

  for (let n = 1; n <= 8; n++) {

    novoUtilizador(
      'cuidador',
      n,
      NOMES_CUIDADORES[n - 1],
      n === 1 ? 'cuidador@chsj.pt' : `cuidador${n}@example.invalid`
    );

    db.prepare(`
      INSERT INTO Cuidador VALUES (?, ?)
    `).run(
      id('cuidador', n),
      `0000000${String(n).padStart(2, '0')}`
    );
  }

  // FORMULÁRIO E PERGUNTAS (formulário v2: ver src/database/formulario-v2.ts)

  const idFormulario = ID_FORMULARIO_V2;
  garantirFormularioV2(db);

  // CARREGAR PERGUNTAS E OPÇÕES

  type Pergunta = {
    id_pergunta: string;
    categoria: string;
  };

  type Opcao = {
    id_pergunta: string;
    id_opcao: string;
    valor_codificado: string;
  };

  // Perguntas com escala (Blocos B, C e D); os sinais de alarme e os detalhes tratam-se à parte.
  const perguntas = db.prepare(`
    SELECT id_pergunta, categoria
    FROM PerguntaFormulario
    WHERE id_formulario = ? AND ativa = 1 AND id_pergunta_pai IS NULL
      AND categoria IN ('SINTOMA', 'FUNCAO', 'AUTONOMIA') AND tipo_resposta != 'TEXTO_LIVRE'
    ORDER BY ordem
  `).all(idFormulario) as Pergunta[];
  const alarmes = db.prepare(`
    SELECT id_pergunta FROM PerguntaFormulario
    WHERE id_formulario = ? AND ativa = 1 AND categoria = 'ALARME'
  `).all(idFormulario) as Array<{ id_pergunta: string }>;

  const opcoes = db.prepare(`
    SELECT
      o.id_pergunta,
      o.id_opcao,
      o.valor_codificado
    FROM OpcaoResposta o
    JOIN PerguntaFormulario p
      ON p.id_pergunta = o.id_pergunta
    WHERE p.id_formulario = ?
  `).all(idFormulario) as Opcao[];

  if (perguntas.length < 2) {
    throw new Error('O formulário não tem perguntas suficientes.');
  }

  function obterOpcao(
    idPergunta: string,
    codigo: string
  ): string {
    const opcao = opcoes.find(
      o => o.id_pergunta === idPergunta &&
           o.valor_codificado === codigo
    );

    if (!opcao) {
      throw new Error(
        `Falta a opção ${codigo} para a pergunta ${idPergunta}`
      );
    }

    return opcao.id_opcao;
  }

  // INSTRUÇÕES SQL REUTILIZÁVEIS

  const inserirKps = db.prepare(`
    INSERT INTO AvaliacaoKarnofsky
    VALUES (?, ?, ?, ?, ?)
  `);

  const inserirMedicacao = db.prepare(`
    INSERT INTO Medicacao (id_medicacao, id_doente, nome, dose, via, posologia, indicacao,
      data_inicio, data_fim, estado, observacoes, id_medico_registo, data_hora_registo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const inserirTratamento = db.prepare(`
    INSERT INTO Tratamento
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // DOENTES E HISTÓRICOS

  for (const c of cenarios) {

    const doente = id('doente', c.n);

    const medico = medicoDe(c.n);

    const cuidador = c.cuidador
      ? id('cuidador', c.cuidador)
      : null;

    novoUtilizador(
      'doente',
      c.n,
      // O cenário (c.descricao) fica só no código e no README; o nome é o que se vê na aplicação.
      NOMES_DOENTES[c.n - 1],
      c.n === 1 ? 'doente@chsj.pt' : `doente${c.n}@example.invalid`
    );

    db.prepare(`
      INSERT INTO Doente VALUES (?, ?, ?, ?, ?)
    `).run(
      doente,
      `PC-${String(204310 + c.n * 37)}`,
      `${1950 + ((c.n * 7) % 25)}-${String(1 + (c.n * 5) % 12).padStart(2, '0')}-${String(3 + (c.n * 11) % 25).padStart(2, '0')}`,
      c.n % 2 === 0 ? 'F' : 'M',
      medico
    );

    // ASSOCIAR CUIDADOR

    if (cuidador) {

      db.prepare(`
        INSERT INTO DoenteCuidador
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        doente,
        cuidador,
        'FAMILIAR',
        dataAtras(110),
        null,
        1,
        1
      );
    }

    // DIAGNÓSTICO

    db.prepare(`
      INSERT INTO DiagnosticoGB
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      doente,
      dataAtras(115),
      c.n % 2 ? 'Lobo Frontal' : 'Lobo Temporal',
      c.n % 2 ? 'Direita' : 'Esquerda',
      'IDH-wildtype',
      c.n % 3 === 0
        ? 'MGMT Metilado'
        : c.n % 3 === 1 ? 'MGMT Não metilado' : 'Não determinado',
      c.n % 2 === 0 || c.n === 1 ? 'Quimioterapia Adjuvante' : 'Seguimento'
    );

    // TRATAMENTOS

    inserirTratamento.run(
      crypto.randomUUID(),
      doente,
      'CIRURGIA',
      'CONCLUIDO',
      dataAtras(105),
      dataAtras(105),
      c.n % 4 === 0 ? 'Biópsia estereotáxica' : 'Ressecção cirúrgica macroscópica'
    );

    if (c.n % 3 !== 0) {
      inserirTratamento.run(
        crypto.randomUUID(),
        doente,
        'RADIOTERAPIA',
        'CONCLUIDO',
        dataAtras(95),
        dataAtras(55),
        'Radioterapia 60 Gy em 30 frações, com temozolomida concomitante (protocolo de Stupp)'
      );
    }

    if (c.n % 2 === 0 || c.n === 1) {
      inserirTratamento.run(
        crypto.randomUUID(),
        doente,
        'QUIMIOTERAPIA',
        'EM_CURSO',
        dataAtras(40),
        null,
        'Temozolomida adjuvante, dias 1 a 5 de cada ciclo de 28 dias'
      );
    }

    // MEDICAÇÃO (registada pelo médico responsável)

    const emQuimio = c.n % 2 === 0 || c.n === 1;
    const medicar = (nome: string, dose: string, via: string, posologia: string, indicacao: string,
      inicio: number, estado = 'ATIVA', fim: number | null = null) =>
      inserirMedicacao.run(crypto.randomUUID(), doente, nome, dose, via, posologia, indicacao,
        dataAtras(inicio), fim === null ? null : dataAtras(fim), estado, null, medico, diasAtras(inicio));

    // Corticoide: ativo nos cenários com agravamento, terminado nos outros.
    const comCorticoide = [1, 3, 4, 8, 9, 13].includes(c.n);
    medicar('Dexametasona', comCorticoide ? '4 mg' : '2 mg', 'ORAL', 'Uma vez por dia, de manhã', 'Edema cerebral',
      110, comCorticoide ? 'ATIVA' : 'TERMINADA', comCorticoide ? null : 60);
    if (comCorticoide) medicar('Pantoprazol', '20 mg', 'ORAL', 'Uma vez por dia, em jejum', 'Proteção gástrica durante o corticoide', 110);
    // Antiepilético nos tumores frontais (cenários ímpares).
    if (c.n % 2 === 1) medicar('Levetiracetam', '500 mg', 'ORAL', 'De 12 em 12 horas', 'Prevenção de convulsões', 105);
    if (emQuimio) {
      medicar('Temozolomida', '150 mg/m²', 'ORAL', 'Dias 1 a 5 de cada ciclo de 28 dias, ao deitar', 'Quimioterapia adjuvante', 40);
      medicar('Ondansetrom', '8 mg', 'ORAL', '30 minutos antes da temozolomida; se necessário até 2 vezes por dia', 'Náuseas e vómitos', 40);
    }
    if (c.n === 5) medicar('Paracetamol', '1 g', 'ORAL', 'Até 3 vezes por dia, se dor', 'Dor de cabeça', 30, 'SUSPENSA', 10);

    // PRIMEIRA AVALIAÇÃO KPS

    inserirKps.run(
      crypto.randomUUID(),
      doente,
      medico,
      dataAtras(90),
      c.kps[0]
    );

    let kpsAtual = c.kps[0];
    let segundaAvaliacao = false;
    let terceiraAvaliacao = false;

    // PLANO ATIVO

    db.prepare(`
      INSERT INTO PlanoMonitorizacao
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `plano-${c.n}`,
      doente,
      medico,
      'Ad hoc',
      c.kps[2] <= 70 ? 3 : 7,
      diasAtras(85),
      'ATIVO'
    );

    // PLANOS HISTÓRICOS

    if (c.n === 10 || c.n === 12) {

      db.prepare(`
        INSERT INTO PlanoMonitorizacao
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        doente,
        medico,
        'Ad hoc',
        14,
        diasAtras(100),
        'HISTORICO'
      );
    }

    // SUBMISSÕES AO LONGO DO TEMPO

    c.evolucao.forEach((nivel, indice) => {

      const dias = (c.evolucao.length - indice) * 7 - 5;

      // ATUALIZAR KPS DURANTE O HISTÓRICO

      if (!segundaAvaliacao && dias <= 40) {

        inserirKps.run(
          crypto.randomUUID(),
          doente,
          medico,
          dataAtras(40),
          c.kps[1]
        );

        kpsAtual = c.kps[1];
        segundaAvaliacao = true;
      }

      if (!terceiraAvaliacao && dias <= 10) {

        inserirKps.run(
          crypto.randomUUID(),
          doente,
          medico,
          dataAtras(10),
          c.kps[2]
        );

        kpsAtual = c.kps[2];
        terceiraAvaliacao = true;
      }

      // VARIAR AS PERGUNTAS RESPONDIDAS

      const fixas = [
        'v2-b1-cefaleia',
        'v2-c1-andar',
        'v2-b3-vomitos',
        'v2-b4-sonolencia'
      ];

      const outras = perguntas
        .map(p => p.id_pergunta)
        .filter(p => !fixas.includes(p));

      const escolhidas = [
        ...fixas,
        ...outras.slice(indice % outras.length),
        ...outras.slice(0, indice % outras.length)
      ].slice(0, c.perguntas);

      // CRIAR AS RESPOSTAS

      const respostas = escolhidas.map(
        (idPergunta, posicao) => {

          const naoAvaliavel =
            c.naoAvaliavel &&
            posicao === 1 &&
            indice % 2 === 0;

          // A cefaleia segue sempre a evolução do cenário; a marcha só nalguns cenários.
          // Nos cenários 4 e 13 aparecem também vómitos e sonolência (combinação de hipertensão intracraniana).
          const intensidade =
            idPergunta === 'v2-b1-cefaleia' ||
            (idPergunta === 'v2-c1-andar' && [4, 8, 9, 11, 13].includes(c.n)) ||
            (idPergunta === 'v2-b3-vomitos' && [4, 13].includes(c.n)) ||
            (idPergunta === 'v2-b4-sonolencia' && [4, 13].includes(c.n) && nivel >= 2)
              ? Math.min(nivel, 3)
              : 0;

          const codigo = naoAvaliavel
            ? 'IMPOSSIVEL_AVALIAR'
            : ['AUSENTE', 'LIGEIRA', 'MODERADA', 'GRAVE'][intensidade];

          const pergunta = perguntas.find(
            p => p.id_pergunta === idPergunta
          )!;

          return {
            id_pergunta: idPergunta,
            id_opcao: obterOpcao(
              idPergunta,
              codigo
            ),
            ...(
              pergunta.categoria === 'SINTOMA' &&
              intensidade > 0 &&
              !naoAvaliavel
                ? { frequencia: 'INTERMITENTE' }
                : {}
            )
          };
        }
      );

      // Sinais de alarme: todos respondidos com "Não" nos registos de demonstração.
      for (const a of alarmes) {
        respostas.push({ id_pergunta: a.id_pergunta, id_opcao: obterOpcao(a.id_pergunta, 'NAO') });
      }

      // SITUAÇÕES EXTRA NO ÚLTIMO REGISTO (para haver alertas de vários tipos na demonstração)
      // [pergunta, código da opção]; substituem a resposta que já existir para essa pergunta.
      const EXTRAS: Record<number, Array<[string, string]>> = {
        6: [['v2-c3-quedas', 'MODERADA']],                                   // 2 ou mais quedas → Alta
        8: [['v2-c1-andar', 'GRAVE']],                                       // deixou de andar → declínio neurológico
        11: [['v2-b18-engolir', 'GRAVE'], ['v2-b18-liquidos', 'SIM']],       // dificuldade grave em engolir → declínio
        7: [['v2-b7-memoria', 'IMPOSSIVEL_AVALIAR'], ['v2-b9-compreender', 'IMPOSSIVEL_AVALIAR'],
            ['v2-b19-confusao', 'IMPOSSIVEL_AVALIAR']],                        // indicadores cognitivos não avaliáveis → Média
        10: [['v2-b15-diarreia', 'MODERADA'], ['v2-b15-dejecoes', 'N2']],     // 4 a 6 dejeções a mais → toxicidade da temozolomida
        12: [['v2-a5-temperatura', 'SIM']],                                   // febre durante a quimioterapia → Crítica
        14: [['v2-b1-cefaleia', 'MODERADA'], ['v2-b3-vomitos', 'LIGEIRA'], ['v2-b3-vezes', 'N1']] // hipertensão intracraniana possível
      };
      if (EXTRAS[c.n] && indice === c.evolucao.length - 1) {
        for (const [idPergunta, codigo] of EXTRAS[c.n]) {
          const resposta = { id_pergunta: idPergunta, id_opcao: obterOpcao(idPergunta, codigo) };
          const existente = respostas.findIndex(r => r.id_pergunta === idPergunta);
          if (existente >= 0) respostas.splice(existente, 1, resposta); else respostas.push(resposta);
        }
      }

      // Mensagem livre para a equipa (B20) no último registo de alguns cenários.
      const MENSAGENS: Record<number, string> = {
        1: 'Tem andado com mais tonturas quando se levanta da cama.',
        3: 'As dores de cabeça pioram ao fim do dia; gostava de falar sobre a medicação para as dores.'
      };
      if (MENSAGENS[c.n] && indice === c.evolucao.length - 1) {
        (respostas as any[]).push({ id_pergunta: 'v2-b20-outro', texto: MENSAGENS[c.n] });
      }

      // IDENTIFICAR O AUTOR

      const autor =
        (
          kpsAtual <= 70 ||
          (
            c.prefereCuidador &&
            indice % 2 === 0
          )
        ) && cuidador
          ? cuidador
          : doente;

      const perfil =
        autor === doente
          ? 'DOENTE'
          : 'CUIDADOR';

      // UTILIZAR O SERVIÇO REAL DE MONITORIZAÇÃO

      const resultado =
        SintomaService.submeterMonitorizacao(
          doente,
          autor,
          perfil,
          {
            id_formulario: idFormulario,
            data_referencia_sintomas:
              dataAtras(dias),
            respostas
          }
        );

      // AJUSTAR AS DATAS PARA O HISTÓRICO FICTÍCIO

      db.prepare(`
        UPDATE SubmissaoMonitorizacao
        SET data_hora_submissao = ?
        WHERE id_submissao = ?
      `).run(
        diasAtras(dias),
        resultado.id_submissao
      );

      db.prepare(`
        UPDATE AlertaClinico
        SET data_hora_geracao = ?
        WHERE id_submissao = ?
      `).run(
        diasAtras(dias),
        resultado.id_submissao
      );
    });
  }

  // TRIAGEM PELA ENFERMAGEM E DECISÕES MÉDICAS
  // Cada alerta passa pelos estados que teria na realidade: «Em análise» e, depois, «Encaminhado» ou «Concluído».
  // Os doentes 5 e 14 ficam de propósito sem triagem, para se ver o grupo «Ainda sem triagem».

  type Triagem = {
    doente: number;
    passos: Array<[estado: string, prioridade: string, nota: string]>;
    decisao?: [decisao: string, fundamentacao: string];
  };

  const triagens: Triagem[] = [
    { doente: 1, passos: [
      ['Em análise', 'Alta', 'Contacto telefónico com a cuidadora: cefaleia moderada há 3 dias, sem vómitos. Doente mais dependente nas últimas semanas.'],
      ['Encaminhado', 'Alta', 'KPS 60 e cefaleia persistente apesar do paracetamol. Peço avaliação médica.']] },
    { doente: 3, passos: [
      ['Em análise', 'Alta', 'Doente refere cefaleia grave ao fim do dia. Sem sinais de alarme.'],
      ['Encaminhado', 'Alta', 'Agravamento progressivo da cefaleia nas últimas 4 semanas. Encaminho ao médico.']],
      decisao: ['Proposta de antecipação de consulta', 'Agravamento progressivo da cefaleia. Antecipar consulta e pedir RM cerebral.'] },
    { doente: 4, passos: [
      ['Em análise', 'Crítica', 'Contacto com a doente: vómitos desde ontem, cefaleia intensa e sonolência. Família orientada para o serviço de urgência.'],
      ['Encaminhado', 'Crítica', 'Suspeita de hipertensão intracraniana. Doente a caminho da urgência; peço avaliação médica imediata.']] },
    { doente: 6, passos: [
      ['Em análise', 'Alta', 'Duas quedas em casa esta semana, sem traumatismo craniano. A aguardar contacto com a família para avaliar a marcha.']] },
    { doente: 7, passos: [
      ['Em análise', 'Média', 'Cuidador não conseguiu avaliar memória, compreensão nem confusão. Agendado contacto telefónico.'],
      ['Concluído', 'Baixa', 'Contacto com o doente: orientado e a responder bem. Sem alterações cognitivas novas. Mantém seguimento.']] },
    { doente: 8, passos: [
      ['Em análise', 'Alta', 'Cuidador refere que o doente deixou de conseguir andar, mesmo com apoio.'],
      ['Encaminhado', 'Alta', 'Declínio marcado da marcha face ao habitual. Peço avaliação neurológica.']] },
    { doente: 9, passos: [
      ['Em análise', 'Alta', 'Doente deixou de conseguir andar sem ajuda. KPS 50.'],
      ['Encaminhado', 'Alta', 'Declínio neurológico marcado. Encaminho para decisão sobre antecipação de consulta.']] },
    { doente: 10, passos: [
      ['Em análise', 'Alta', 'Diarreia com 4 a 6 dejeções a mais por dia desde o início do ciclo de temozolomida. Hidratação oral reforçada.'],
      ['Encaminhado', 'Alta', 'Possível toxicidade da temozolomida. Peço avaliação médica e análises.']] },
    { doente: 11, passos: [
      ['Em análise', 'Alta', 'Cuidadora refere que o doente se engasga com líquidos a quase todas as refeições.'],
      ['Encaminhado', 'Alta', 'Disfagia grave com risco de aspiração. Peço avaliação médica.']],
      decisao: ['Necessidade de avaliação adicional', 'Disfagia com engasgamento a líquidos. Pedir avaliação da deglutição em terapia da fala.'] },
    { doente: 12, passos: [
      ['Em análise', 'Crítica', 'Temperatura de 38,4 °C em quimioterapia. Doente orientada para o serviço de urgência.'],
      ['Encaminhado', 'Crítica', 'Febre durante a temozolomida: risco de neutropenia febril. Peço avaliação médica imediata.']] },
    { doente: 13, passos: [
      ['Em análise', 'Crítica', 'Sonolência marcada e vómitos relatados pela cuidadora.'],
      ['Encaminhado', 'Crítica', 'Suspeita de hipertensão intracraniana. Encaminho de imediato.']] }
  ];

  for (const t of triagens) {

    const alerta = db.prepare(`
      SELECT a.id_alerta
      FROM AlertaClinico a
      JOIN SubmissaoMonitorizacao s
        ON s.id_submissao = a.id_submissao
      WHERE s.id_doente = ?
      ORDER BY a.data_hora_geracao DESC
      LIMIT 1
    `).get(
      id('doente', t.doente)
    ) as { id_alerta: string } | undefined;

    if (!alerta) continue;

    for (const [estado, prioridade, nota] of t.passos) {
      AlertaService.registarTriagemAlerta(alerta.id_alerta, id('enfermeiro', 1 + (t.doente % 3)), estado, prioridade, nota);
    }

    if (t.decisao) {
      MedicoService.registarDecisaoAcompanhamento(
        id('doente', t.doente),
        medicoDe(t.doente),
        { id_alerta: alerta.id_alerta, decisao_medica: t.decisao[0], fundamentacao_clinica: t.decisao[1] }
      );
    }
  }
});

// EXECUTAR A CRIAÇÃO DOS DADOS

criarDados();

// MOSTRAR AS QUANTIDADES NO TERMINAL

const tabelas = [
  'Utilizador',
  'Doente',
  'Cuidador',
  'Tratamento',
  'AvaliacaoKarnofsky',
  'PlanoMonitorizacao',
  'SubmissaoMonitorizacao',
  'RespostaMonitorizacao',
  'AlertaClinico',
  'HistoricoAcaoAlerta',
  'DecisaoAcompanhamento',
  'Medicacao'
];

for (const tabela of tabelas) {

  const resultado = db.prepare(`
    SELECT COUNT(*) AS total
    FROM ${tabela}
  `).get() as { total: number };

  console.log(
    `${tabela}: ${resultado.total}`
  );
}

// VERIFICAR CHAVES ESTRANGEIRAS

const falhas = db.prepare(`
  PRAGMA foreign_key_check
`).all();

if (falhas.length > 0) {
  throw new Error(
    'Falha na integridade das chaves estrangeiras.'
  );
}

console.log(
  'Seed concluído: dados sintéticos e regras de alerta NÃO validadas clinicamente.'
);
