ALTER TABLE AlertaClinico ADD COLUMN id_alerta_anterior TEXT
  REFERENCES AlertaClinico(id_alerta);

ALTER TABLE AlertaSubmissao ADD COLUMN tipo_associacao TEXT NOT NULL DEFAULT 'ORIGINAL'
  CHECK (tipo_associacao IN ('ORIGINAL', 'MOTIVO_REPETIDO', 'MOTIVO_NOVO', 'ESCALONAMENTO'));

ALTER TABLE AvaliacaoAlgoritmo RENAME TO AvaliacaoAlgoritmo_v3;

CREATE TABLE AvaliacaoAlgoritmo (
  id_submissao TEXT NOT NULL,
  versao_parametros TEXT NOT NULL,
  score REAL,
  cobertura REAL,
  linha_de_base REAL,
  variabilidade_linha_de_base REAL,
  limiar_score REAL,
  dados_nao_avaliaveis TEXT NOT NULL DEFAULT '[]',
  motivos_json TEXT NOT NULL DEFAULT '[]',
  prioridade_algoritmo TEXT,
  tipo_regra TEXT,
  contexto_linha_base TEXT NOT NULL DEFAULT '{}',
  data_hora_avaliacao TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'CONCLUIDA' CHECK (estado IN ('CONCLUIDA', 'ERRO')),
  erro TEXT,
  PRIMARY KEY (id_submissao, versao_parametros),
  FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao)
);

INSERT INTO AvaliacaoAlgoritmo
  (id_submissao, versao_parametros, score, cobertura, linha_de_base,
   variabilidade_linha_de_base, limiar_score, dados_nao_avaliaveis, motivos_json,
   prioridade_algoritmo, tipo_regra, contexto_linha_base, data_hora_avaliacao)
SELECT id_submissao, versao_parametros, score, cobertura, linha_de_base,
       variabilidade_linha_de_base, limiar_score, dados_nao_avaliaveis, motivos_json,
       prioridade_algoritmo, tipo_regra, contexto_linha_base, data_hora_avaliacao
FROM AvaliacaoAlgoritmo_v3;

DROP TABLE AvaliacaoAlgoritmo_v3;

CREATE INDEX idx_avaliacao_contexto
  ON AvaliacaoAlgoritmo(contexto_linha_base, id_submissao, versao_parametros);

CREATE TABLE MotivoEvidencia (
  id_submissao TEXT NOT NULL,
  versao_parametros TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  texto TEXT NOT NULL,
  prioridade TEXT NOT NULL,
  tipo TEXT NOT NULL,
  codigos_json TEXT NOT NULL,
  PRIMARY KEY (id_submissao, versao_parametros, ordem),
  FOREIGN KEY (id_submissao, versao_parametros)
    REFERENCES AvaliacaoAlgoritmo(id_submissao, versao_parametros)
);

INSERT INTO MotivoEvidencia
  (id_submissao, versao_parametros, ordem, texto, prioridade, tipo, codigos_json)
SELECT a.id_submissao, a.versao_parametros, CAST(m.key AS INTEGER),
       json_extract(m.value, '$.texto'), json_extract(m.value, '$.prioridade'),
       json_extract(m.value, '$.tipo'), json_extract(m.value, '$.codigos')
FROM AvaliacaoAlgoritmo a, json_each(a.motivos_json) m
WHERE a.estado = 'CONCLUIDA';

CREATE TABLE InstrucaoEmitida (
  id_submissao TEXT NOT NULL,
  versao_parametros TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  codigo TEXT NOT NULL CHECK (codigo IN ('LIGAR_112', 'CONTACTAR_JA', 'CONTACTAR_HOJE')),
  PRIMARY KEY (id_submissao, versao_parametros, ordem),
  FOREIGN KEY (id_submissao, versao_parametros)
    REFERENCES AvaliacaoAlgoritmo(id_submissao, versao_parametros)
);

CREATE TRIGGER trg_avaliacao_algoritmo_sem_update
BEFORE UPDATE ON AvaliacaoAlgoritmo
BEGIN
  SELECT RAISE(ABORT, 'AvaliacaoAlgoritmo é imutável.');
END;

CREATE TRIGGER trg_avaliacao_algoritmo_sem_delete
BEFORE DELETE ON AvaliacaoAlgoritmo
BEGIN
  SELECT RAISE(ABORT, 'AvaliacaoAlgoritmo é imutável.');
END;

CREATE TRIGGER trg_motivo_evidencia_sem_update
BEFORE UPDATE ON MotivoEvidencia
BEGIN
  SELECT RAISE(ABORT, 'MotivoEvidencia é imutável.');
END;

CREATE TRIGGER trg_motivo_evidencia_sem_delete
BEFORE DELETE ON MotivoEvidencia
BEGIN
  SELECT RAISE(ABORT, 'MotivoEvidencia é imutável.');
END;

CREATE TRIGGER trg_instrucao_emitida_sem_update
BEFORE UPDATE ON InstrucaoEmitida
BEGIN
  SELECT RAISE(ABORT, 'InstrucaoEmitida é imutável.');
END;

CREATE TRIGGER trg_instrucao_emitida_sem_delete
BEFORE DELETE ON InstrucaoEmitida
BEGIN
  SELECT RAISE(ABORT, 'InstrucaoEmitida é imutável.');
END;

CREATE TABLE FaseClinica (
  id_fase_clinica TEXT PRIMARY KEY,
  id_doente TEXT NOT NULL,
  fase_clinica TEXT NOT NULL,
  data_inicio TEXT NOT NULL,
  FOREIGN KEY (id_doente) REFERENCES Doente(id_doente)
);

INSERT INTO FaseClinica (id_fase_clinica, id_doente, fase_clinica, data_inicio)
SELECT 'fase-inicial-' || id_doente, id_doente, fase_clinica_atual, data_diagnostico
FROM DiagnosticoGB;

CREATE INDEX idx_fase_clinica_data
  ON FaseClinica(id_doente, data_inicio, id_fase_clinica);
