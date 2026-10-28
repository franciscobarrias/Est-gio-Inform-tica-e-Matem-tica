import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const dbPath = path.resolve(process.env.DATABASE_PATH || path.resolve(__dirname, '../../data.db'));
export const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export function inicializarBaseDados(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Utilizador (
      id_utilizador TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK(perfil IN ('DOENTE', 'CUIDADOR', 'ENFERMEIRO', 'MEDICO')),
      estado_conta TEXT NOT NULL DEFAULT 'ATIVA' CHECK(estado_conta IN ('ATIVA', 'INATIVA', 'SUSPENSA')),
      criado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Enfermeiro (
      id_enfermeiro TEXT PRIMARY KEY,
      cedula_profissional TEXT NOT NULL,
      servico_hospitalar TEXT NOT NULL,
      FOREIGN KEY (id_enfermeiro) REFERENCES Utilizador(id_utilizador)
    );

    CREATE TABLE IF NOT EXISTS Medico (
      id_medico TEXT PRIMARY KEY,
      cedula_profissional TEXT NOT NULL,
      especialidade TEXT NOT NULL,
      FOREIGN KEY (id_medico) REFERENCES Utilizador(id_utilizador)
    );

    CREATE TABLE IF NOT EXISTS Cuidador (
      id_cuidador TEXT PRIMARY KEY,
      telefone_contacto TEXT NOT NULL,
      FOREIGN KEY (id_cuidador) REFERENCES Utilizador(id_utilizador)
    );

    CREATE TABLE IF NOT EXISTS Doente (
      id_doente TEXT PRIMARY KEY,
      numero_processo_clinico TEXT UNIQUE NOT NULL,
      data_nascimento TEXT NOT NULL,
      sexo TEXT NOT NULL CHECK(sexo IN ('M', 'F', 'OUTRO')),
      id_medico_responsavel TEXT NOT NULL,
      FOREIGN KEY (id_doente) REFERENCES Utilizador(id_utilizador),
      FOREIGN KEY (id_medico_responsavel) REFERENCES Medico(id_medico)
    );

    CREATE TABLE IF NOT EXISTS DoenteCuidador (
      id_associacao TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      id_cuidador TEXT NOT NULL,
      grau_parentesco TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT,
      autorizacao_validada INTEGER NOT NULL DEFAULT 1,
      ativa INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente),
      FOREIGN KEY (id_cuidador) REFERENCES Cuidador(id_cuidador)
    );

    CREATE TABLE IF NOT EXISTS DiagnosticoGB (
      id_diagnostico TEXT PRIMARY KEY,
      id_doente TEXT UNIQUE NOT NULL,
      data_diagnostico TEXT NOT NULL,
      localizacao_tumoral TEXT NOT NULL,
      lateralidade TEXT NOT NULL,
      estatuto_idh TEXT NOT NULL,
      metilacao_mgmt TEXT NOT NULL,
      fase_clinica_atual TEXT NOT NULL,
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente)
    );

    CREATE TABLE IF NOT EXISTS Tratamento (
      id_tratamento TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      tipo TEXT NOT NULL,
      estado TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT,
      descricao_esquema TEXT NOT NULL,
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente)
    );

    CREATE TABLE IF NOT EXISTS AvaliacaoKarnofsky (
      id_avaliacao_kps TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      id_medico TEXT NOT NULL,
      data_avaliacao TEXT NOT NULL,
      score_kps INTEGER NOT NULL CHECK(score_kps BETWEEN 0 AND 100),
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente),
      FOREIGN KEY (id_medico) REFERENCES Medico(id_medico)
    );

    CREATE TABLE IF NOT EXISTS PlanoMonitorizacao (
      id_plano TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      id_medico TEXT NOT NULL,
      modo_periodicidade TEXT NOT NULL,
      periodicidade_dias INTEGER NOT NULL,
      data_definicao TEXT NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('ATIVO', 'INATIVO', 'HISTORICO')),
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente),
      FOREIGN KEY (id_medico) REFERENCES Medico(id_medico)
    );

    CREATE TABLE IF NOT EXISTS Formulario (
      id_formulario TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      versao INTEGER NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('ATIVO', 'INATIVO'))
    );

    CREATE TABLE IF NOT EXISTS PerguntaFormulario (
      id_pergunta TEXT PRIMARY KEY,
      id_formulario TEXT NOT NULL,
      categoria TEXT NOT NULL,
      enunciado TEXT NOT NULL,
      tipo_resposta TEXT NOT NULL,
      obrigatoria INTEGER NOT NULL DEFAULT 1,
      ordem INTEGER NOT NULL,
      ativa INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (id_formulario) REFERENCES Formulario(id_formulario)
    );

    CREATE TABLE IF NOT EXISTS OpcaoResposta (
      id_opcao TEXT PRIMARY KEY,
      id_pergunta TEXT NOT NULL,
      rotulo TEXT NOT NULL,
      valor_codificado TEXT NOT NULL,
      ordem INTEGER NOT NULL,
      FOREIGN KEY (id_pergunta) REFERENCES PerguntaFormulario(id_pergunta)
    );

    CREATE TABLE IF NOT EXISTS SubmissaoMonitorizacao (
      id_submissao TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      id_autor TEXT NOT NULL,
      id_formulario TEXT NOT NULL,
      id_plano TEXT,
      data_hora_submissao TEXT NOT NULL,
      data_referencia_sintomas TEXT NOT NULL,
      perfil_autor_no_registo TEXT NOT NULL,
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente),
      FOREIGN KEY (id_autor) REFERENCES Utilizador(id_utilizador),
      FOREIGN KEY (id_formulario) REFERENCES Formulario(id_formulario),
      FOREIGN KEY (id_plano) REFERENCES PlanoMonitorizacao(id_plano)
    );

    CREATE TABLE IF NOT EXISTS RespostaMonitorizacao (
      id_resposta TEXT PRIMARY KEY,
      id_submissao TEXT NOT NULL,
      id_pergunta TEXT NOT NULL,
      id_opcao TEXT,
      valor_numerico INTEGER NOT NULL DEFAULT 0,
      motivo_nao_avaliavel INTEGER NOT NULL DEFAULT 0,
      frequencia TEXT,
      FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao),
      FOREIGN KEY (id_pergunta) REFERENCES PerguntaFormulario(id_pergunta),
      FOREIGN KEY (id_opcao) REFERENCES OpcaoResposta(id_opcao)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resposta_submissao_pergunta
      ON RespostaMonitorizacao(id_submissao, id_pergunta);
    CREATE INDEX IF NOT EXISTS idx_submissao_doente_data
      ON SubmissaoMonitorizacao(id_doente, data_hora_submissao);

    CREATE TABLE IF NOT EXISTS RegraAlerta (
      id_regra TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo_regra TEXT NOT NULL,
      criterio_documentado TEXT NOT NULL,
      referencia_literatura TEXT NOT NULL,
      versao TEXT NOT NULL,
      validada_clinicamente INTEGER NOT NULL DEFAULT 1,
      ativa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS AlertaClinico (
      id_alerta TEXT PRIMARY KEY,
      id_submissao TEXT NOT NULL,
      id_regra TEXT NOT NULL,
      data_hora_geracao TEXT NOT NULL,
      origem_gatilho TEXT NOT NULL,
      prioridade TEXT NOT NULL CHECK(prioridade IN ('Baixa', 'Média', 'Alta', 'Crítica')),
      estado_atual TEXT NOT NULL CHECK(estado_atual IN ('Pendente', 'Em análise', 'Encaminhado', 'Concluído')),
      resumo_agravamento TEXT NOT NULL,
      FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao),
      FOREIGN KEY (id_regra) REFERENCES RegraAlerta(id_regra)
    );

    CREATE TABLE IF NOT EXISTS HistoricoAcaoAlerta (
      id_acao TEXT PRIMARY KEY,
      id_alerta TEXT NOT NULL,
      id_utilizador TEXT NOT NULL,
      data_hora_acao TEXT NOT NULL,
      tipo_acao TEXT NOT NULL,
      estado_anterior TEXT NOT NULL,
      estado_novo TEXT NOT NULL,
      nota_triagem TEXT NOT NULL,
      FOREIGN KEY (id_alerta) REFERENCES AlertaClinico(id_alerta),
      FOREIGN KEY (id_utilizador) REFERENCES Utilizador(id_utilizador)
    );

    CREATE TABLE IF NOT EXISTS DecisaoAcompanhamento (
      id_decisao TEXT PRIMARY KEY,
      id_doente TEXT NOT NULL,
      id_medico TEXT NOT NULL,
      id_alerta TEXT,
      data_hora_decisao TEXT NOT NULL,
      decisao_medica TEXT NOT NULL,
      fundamentacao_clinica TEXT NOT NULL,
      FOREIGN KEY (id_doente) REFERENCES Doente(id_doente),
      FOREIGN KEY (id_medico) REFERENCES Medico(id_medico),
      FOREIGN KEY (id_alerta) REFERENCES AlertaClinico(id_alerta)
    );

    CREATE TABLE IF NOT EXISTS RegistoAuditoria (
      id_auditoria TEXT PRIMARY KEY,
      id_utilizador TEXT NOT NULL,
      acao TEXT NOT NULL,
      detalhes TEXT NOT NULL,
      data_hora TEXT NOT NULL,
      FOREIGN KEY (id_utilizador) REFERENCES Utilizador(id_utilizador)
    );
  `);
  const colunasResposta = db.prepare('PRAGMA table_info(RespostaMonitorizacao)').all() as Array<{ name: string }>;
  if (!colunasResposta.some(coluna => coluna.name === 'frequencia')) {
    db.exec('ALTER TABLE RespostaMonitorizacao ADD COLUMN frequencia TEXT');
  }
  garantirPerguntasFormularioDemonstracao();
}

export function garantirPerguntasFormularioDemonstracao(): void {
  const formulario = db.prepare("SELECT id_formulario FROM Formulario WHERE id_formulario = 'form-gbm-v1' AND estado = 'ATIVO'").get();
  if (!formulario) return;

  const perguntas = [
    { id: 'perg-cefaleia', cat: 'SINTOMA_GERAL', texto: 'Cefaleia (dor de cabeça)' },
    { id: 'perg-astenia', cat: 'SINTOMA_GERAL', texto: 'Astenia (cansaço ou falta de energia)' },
    { id: 'perg-ansiedade', cat: 'SINTOMA_GERAL', texto: 'Ansiedade' },
    { id: 'perg-temperatura', cat: 'SINTOMA_GERAL', texto: 'Alterações da temperatura corporal (febre ou arrepios)' },
    { id: 'perg-sono', cat: 'SINTOMA_GERAL', texto: 'Alterações do sono' },
    { id: 'perg-nauseas', cat: 'SINTOMA_GERAL', texto: 'Náuseas' },
    { id: 'perg-vomitos', cat: 'SINTOMA_GERAL', texto: 'Vómitos' },
    { id: 'perg-outros-sintomas', cat: 'SINTOMA_GERAL', texto: 'Outros sintomas relevantes' },
    { id: 'perg-marcha', cat: 'ESCALA_NANO', texto: 'Marcha e equilíbrio ao caminhar' },
    { id: 'perg-forca', cat: 'ESCALA_NANO', texto: 'Força muscular' },
    { id: 'perg-coordenacao', cat: 'ESCALA_NANO', texto: 'Coordenação dos movimentos' },
    { id: 'perg-sensibilidade', cat: 'ESCALA_NANO', texto: 'Sensibilidade' },
    { id: 'perg-visao', cat: 'ESCALA_NANO', texto: 'Visão' },
    { id: 'perg-linguagem', cat: 'ESCALA_NANO', texto: 'Linguagem e comunicação' },
    { id: 'perg-consciencia', cat: 'ESCALA_NANO', texto: 'Estado de consciência' },
    { id: 'perg-comportamento', cat: 'ESCALA_NANO', texto: 'Comportamento' },
    { id: 'perg-autonomia', cat: 'AUTONOMIA_AVD', texto: 'Autonomia nas atividades da vida diária' }
  ];
  const inserirPergunta = db.prepare(`INSERT OR IGNORE INTO PerguntaFormulario
    (id_pergunta, id_formulario, categoria, enunciado, tipo_resposta, obrigatoria, ordem, ativa)
    VALUES (?, 'form-gbm-v1', ?, ?, 'SELECAO_UNICA', 0, ?, 1)`);
  const inserirOpcao = db.prepare(`INSERT OR IGNORE INTO OpcaoResposta
    (id_opcao, id_pergunta, rotulo, valor_codificado, ordem) VALUES (?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE PerguntaFormulario SET ativa = 0
      WHERE id_formulario = 'form-gbm-v1' AND id_pergunta IN ('perg-1', 'perg-2', 'perg-3', 'perg-4')`).run();
    perguntas.forEach((pergunta, indice) => {
      inserirPergunta.run(pergunta.id, pergunta.cat, pergunta.texto, indice + 1);
      const opcoes = pergunta.cat === 'AUTONOMIA_AVD'
        ? [
          ['autonomo', 'Independente', 'AUSENTE'],
          ['parcial', 'Necessita assistência parcial', 'ASSISTENCIA_PARCIAL'],
          ['total', 'Necessita assistência total', 'ASSISTENCIA_TOTAL']
        ]
        : [
          ['ausente', 'Ausente / sem alteração', 'AUSENTE'],
          ['ligeira', 'Ligeira', 'LIGEIRA'],
          ['moderada', 'Moderada', 'MODERADA'],
          ['grave', 'Grave', 'GRAVE']
        ];
      opcoes.forEach(([sufixo, rotulo, codigo], ordem) =>
        inserirOpcao.run(`op-${pergunta.id}-${sufixo}`, pergunta.id, rotulo, codigo, ordem + 1));
      inserirOpcao.run(`op-${pergunta.id}-nao-avaliavel`, pergunta.id, 'Não consigo avaliar', 'IMPOSSIVEL_AVALIAR', opcoes.length + 1);
    });
  });
  tx();
}

export function registarAuditoria(idUtilizador: string, acao: string, detalhes: string): void {
  db.prepare(`
    INSERT INTO RegistoAuditoria (id_auditoria, id_utilizador, acao, detalhes, data_hora)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), idUtilizador, acao, detalhes, new Date().toISOString());
}