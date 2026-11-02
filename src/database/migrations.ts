import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

type Migration = { version: number; up: (db: Database.Database) => void };

function acrescentarColuna(db: Database.Database, tabela: string, coluna: string, definicao: string): void {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  if (!colunas.some(c => c.name === coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      acrescentarColuna(db, 'RespostaMonitorizacao', 'frequencia', 'TEXT');
      acrescentarColuna(db, 'PerguntaFormulario', 'codigo', 'TEXT');
      acrescentarColuna(db, 'PerguntaFormulario', 'id_pergunta_pai', 'TEXT REFERENCES PerguntaFormulario(id_pergunta)');
      acrescentarColuna(db, 'PerguntaFormulario', 'valor_minimo_pai', 'INTEGER');
      acrescentarColuna(db, 'OpcaoResposta', 'valor_numerico', 'INTEGER');
      acrescentarColuna(db, 'RespostaMonitorizacao', 'novo_ou_pior', 'INTEGER');
      acrescentarColuna(db, 'RespostaMonitorizacao', 'texto', 'TEXT');
      acrescentarColuna(db, 'PerguntaFormulario', 'enunciado_cuidador', 'TEXT');
      acrescentarColuna(db, 'OpcaoResposta', 'rotulo_cuidador', 'TEXT');
    }
  },
  {
    version: 2,
    up(db) {
      const valor = (db.prepare('PRAGMA table_info(RespostaMonitorizacao)').all() as Array<{
        name: string; notnull: number; dflt_value: string | null;
      }>).find(coluna => coluna.name === 'valor_numerico');
      if (valor && (valor.notnull || valor.dflt_value !== null)) {
        db.exec(`
          CREATE TABLE RespostaMonitorizacao_nova (
            id_resposta TEXT PRIMARY KEY,
            id_submissao TEXT NOT NULL,
            id_pergunta TEXT NOT NULL,
            id_opcao TEXT,
            valor_numerico INTEGER,
            motivo_nao_avaliavel INTEGER NOT NULL DEFAULT 0,
            frequencia TEXT,
            novo_ou_pior INTEGER,
            texto TEXT,
            FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao),
            FOREIGN KEY (id_pergunta) REFERENCES PerguntaFormulario(id_pergunta),
            FOREIGN KEY (id_opcao) REFERENCES OpcaoResposta(id_opcao)
          );
          INSERT INTO RespostaMonitorizacao_nova
            (id_resposta, id_submissao, id_pergunta, id_opcao, valor_numerico, motivo_nao_avaliavel, frequencia, novo_ou_pior, texto)
          SELECT id_resposta, id_submissao, id_pergunta, id_opcao,
            CASE WHEN motivo_nao_avaliavel = 1 THEN NULL ELSE valor_numerico END,
            motivo_nao_avaliavel, frequencia, novo_ou_pior, texto
          FROM RespostaMonitorizacao;
          DROP TABLE RespostaMonitorizacao;
          ALTER TABLE RespostaMonitorizacao_nova RENAME TO RespostaMonitorizacao;
        `);
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_resposta_submissao_pergunta
        ON RespostaMonitorizacao(id_submissao, id_pergunta)`);
    }
  },
  {
    version: 3,
    up(db) {
      acrescentarColuna(db, 'AlertaClinico', 'prioridade_algoritmo', 'TEXT');
      acrescentarColuna(db, 'HistoricoAcaoAlerta', 'prioridade_anterior', 'TEXT');
      acrescentarColuna(db, 'HistoricoAcaoAlerta', 'prioridade_nova', 'TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS AvaliacaoAlgoritmo (
          id_submissao TEXT PRIMARY KEY,
          score REAL,
          cobertura REAL NOT NULL,
          linha_de_base REAL,
          variabilidade_linha_de_base REAL,
          limiar_score REAL,
          dados_nao_avaliaveis TEXT NOT NULL,
          motivos_json TEXT NOT NULL,
          prioridade_algoritmo TEXT,
          tipo_regra TEXT,
          versao_parametros TEXT NOT NULL,
          contexto_linha_base TEXT NOT NULL,
          data_hora_avaliacao TEXT NOT NULL,
          FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS AlertaSubmissao (
          id_alerta TEXT NOT NULL,
          id_submissao TEXT NOT NULL,
          PRIMARY KEY (id_alerta, id_submissao),
          FOREIGN KEY (id_alerta) REFERENCES AlertaClinico(id_alerta) ON DELETE CASCADE,
          FOREIGN KEY (id_submissao) REFERENCES SubmissaoMonitorizacao(id_submissao) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_avaliacao_contexto
          ON AvaliacaoAlgoritmo(contexto_linha_base, id_submissao);
        CREATE INDEX IF NOT EXISTS idx_submissao_doente_referencia
          ON SubmissaoMonitorizacao(id_doente, id_formulario, data_referencia_sintomas, data_hora_submissao);
      `);
    }
  },
  {
    version: 4,
    up(db) {
      db.exec(fs.readFileSync(path.join(__dirname, 'migracao_v4_delta.sql'), 'utf8'));
    }
  }
];

export function executarMigracoes(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS SchemaMigracao (
    versao INTEGER PRIMARY KEY,
    aplicada_em TEXT NOT NULL
  )`);
  const aplicada = db.prepare('SELECT versao FROM SchemaMigracao');
  for (const migration of migrations) {
    if ((aplicada.all() as Array<{ versao: number }>).some(row => row.versao === migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO SchemaMigracao (versao, aplicada_em) VALUES (?, ?)').run(
        migration.version, new Date().toISOString()
      );
    })();
  }
}
