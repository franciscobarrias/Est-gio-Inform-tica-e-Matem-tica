
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
      `Médico de Demonstração ${n}`,
      n === 1 ? 'medico@chsj.pt' : `medico${n}@example.invalid`
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
      `Enfermeiro de Demonstração ${n}`,
      n === 1 ? 'enfermeiro@chsj.pt' : `enfermeiro${n}@example.invalid`
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
      `Cuidador de Demonstração ${n}`,
      n === 1 ? 'cuidador@chsj.pt' : `cuidador${n}@example.invalid`
    );

    db.prepare(`
      INSERT INTO Cuidador VALUES (?, ?)
    `).run(
      id('cuidador', n),
      `0000000${String(n).padStart(2, '0')}`
    );
  }

  // FORMULÁRIO E PERGUNTAS

  const idFormulario = 'form-gbm-v1';

  db.prepare(`
    INSERT INTO Formulario VALUES (?, ?, ?, ?)
  `).run(
    idFormulario,
    'Questionário estruturado GBM (demonstração)',
    1,
    'ATIVO'
  );

  garantirPerguntasFormularioDemonstracao();

  // REGRAS DE ALERTA DEMONSTRATIVAS

  db.prepare(`
    INSERT INTO RegraAlerta VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'regra-rf23',
    'Severidade imediata (demonstração)',
    'SEVERIDADE_IMEDIATA_RF23',
    'Limiares provisórios para testes',
    'NÃO VALIDADO CLINICAMENTE',
    '1.0',
    0,
    1
  );

  db.prepare(`
    INSERT INTO RegraAlerta VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'regra-rf24',
    'Agravamento longitudinal (demonstração)',
    'AGRAVAMENTO_LONGITUDINAL_RF24',
    'Comparação provisória de respostas sucessivas',
    'NÃO VALIDADO CLINICAMENTE',
    '1.0',
    0,
    1
  );

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

  const perguntas = db.prepare(`
    SELECT id_pergunta, categoria
    FROM PerguntaFormulario
    WHERE id_formulario = ? AND ativa = 1
    ORDER BY ordem
  `).all(idFormulario) as Pergunta[];

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
      `Doente Fictício ${String(c.n).padStart(2, '0')} - ${c.descricao}`,
      c.n === 1 ? 'doente@chsj.pt' : `doente${c.n}@example.invalid`
    );

    db.prepare(`
      INSERT INTO Doente VALUES (?, ?, ?, ?, ?)
    `).run(
      doente,
      `GBM-FICTICIO-${String(c.n).padStart(3, '0')}`,
      `${1960 + c.n}-05-15`,
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
      c.n % 2 ? 'Lobo frontal' : 'Lobo temporal',
      c.n % 2 ? 'Direita' : 'Esquerda',
      'IDH-wildtype (fictício)',
      c.n % 3 === 0
        ? 'MGMT metilado'
        : 'MGMT não determinado',
      'Seguimento (fictício)'
    );

    // TRATAMENTOS

    inserirTratamento.run(
      crypto.randomUUID(),
      doente,
      'CIRURGIA',
      'CONCLUIDO',
      dataAtras(105),
      dataAtras(105),
      'Procedimento fictício para demonstração'
    );

    if (c.n % 3 !== 0) {
      inserirTratamento.run(
        crypto.randomUUID(),
        doente,
        'RADIOTERAPIA',
        'CONCLUIDO',
        dataAtras(95),
        dataAtras(55),
        'Tratamento fictício para demonstração'
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
        'Tratamento fictício para demonstração'
      );
    }

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
        'perg-cefaleia',
        'perg-marcha'
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

          const intensidade =
            idPergunta === 'perg-cefaleia' ||
            (
              idPergunta === 'perg-marcha' &&
              [4, 8, 9, 11, 13].includes(c.n)
            )
              ? nivel
              : 0;

          const autonomia =
            idPergunta === 'perg-autonomia';

          const codigo = naoAvaliavel
            ? 'IMPOSSIVEL_AVALIAR'
            : autonomia
              ? intensidade === 0
                ? 'AUSENTE'
                : intensidade === 3
                  ? 'ASSISTENCIA_TOTAL'
                  : 'ASSISTENCIA_PARCIAL'
              : [
                  'AUSENTE',
                  'LIGEIRA',
                  'MODERADA',
                  'GRAVE'
                ][intensidade];

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
              pergunta.categoria === 'SINTOMA_GERAL' &&
              intensidade > 0 &&
              !naoAvaliavel
                ? { frequencia: 'INTERMITENTE' }
                : {}
            )
          };
        }
      );

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

  // TRIAGEM DE ALGUNS ALERTAS

  const triagens: Array<{
    doente: number;
    estado: string;
    prioridade: string;
    concluir?: boolean;
  }> = [
    {
      doente: 1,
      estado: 'Em análise',
      prioridade: 'Alta'
    },
    {
      doente: 3,
      estado: 'Encaminhado',
      prioridade: 'Alta',
      concluir: true
    },
    {
      doente: 4,
      estado: 'Em análise',
      prioridade: 'Crítica'
    },
    {
      doente: 5,
      estado: 'Em análise',
      prioridade: 'Baixa'
    },
    {
      doente: 8,
      estado: 'Encaminhado',
      prioridade: 'Média'
    },
    {
      doente: 9,
      estado: 'Encaminhado',
      prioridade: 'Alta'
    },
    {
      doente: 11,
      estado: 'Encaminhado',
      prioridade: 'Média',
      concluir: true
    },
    {
      doente: 13,
      estado: 'Encaminhado',
      prioridade: 'Crítica'
    }
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

    AlertaService.registarTriagemAlerta(
      alerta.id_alerta,
      id('enfermeiro', 1),
      t.estado,
      t.prioridade,
      'Triagem fictícia para demonstração.'
    );

    if (t.concluir) {

      MedicoService.registarDecisaoAcompanhamento(
        id('doente', t.doente),
        medicoDe(t.doente),
        {
          id_alerta: alerta.id_alerta,
          decisao_medica:
            'Necessidade de avaliação adicional',
          fundamentacao_clinica:
            'Decisão fictícia para demonstração.'
        }
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
  'DecisaoAcompanhamento'
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
