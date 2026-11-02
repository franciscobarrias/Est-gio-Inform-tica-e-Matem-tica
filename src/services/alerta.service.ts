import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { ID_FORMULARIO_V2 } from '../database/formulario-v2';
import { avaliarSubmissaoV2, resumoDoAlerta, RespostasPorCodigo, TipoRegraV2, VERSAO_PARAMETROS, JANELA_MINIMA_DIAS } from './motor-alertas-v2';

export type Prioridade = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
const NIVEIS_PRIORIDADE: Prioridade[] = ['Baixa', 'Média', 'Alta', 'Crítica'];

export class AlertaService {
  static processarRegrasNaSubmissao(idDoente: string, idSubmissao: string, idAutor: string): any[] {
    const submissao = db.prepare('SELECT id_formulario FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { id_formulario: string } | undefined;
    if (!submissao) throw new Error('Submissão de monitorização não encontrada.');
    if (submissao.id_formulario !== ID_FORMULARIO_V2) {
      throw new Error('O motor de alertas só aceita submissões do formulário v2 ativo.');
    }
    return this.processarFormularioV2(idDoente, idSubmissao, idAutor);
  }

  // ---------- Formulário v2: motor em camadas (ver motor-alertas-v2.ts) ----------
  static respostasPorCodigo(idSubmissao: string): RespostasPorCodigo {
    const linhas = db.prepare(`SELECT p.codigo, r.valor_numerico, r.motivo_nao_avaliavel, r.frequencia
      FROM RespostaMonitorizacao r JOIN PerguntaFormulario p ON p.id_pergunta = r.id_pergunta
      WHERE r.id_submissao = ? AND p.codigo IS NOT NULL`)
      .all(idSubmissao) as Array<{
        codigo: string; valor_numerico: number | null; motivo_nao_avaliavel: number; frequencia: string | null;
      }>;
    const respostas: RespostasPorCodigo = {};
    for (const l of linhas) {
      respostas[l.codigo] = {
        valor: l.valor_numerico ?? 0,
        naoAvaliavel: Boolean(l.motivo_nao_avaliavel),
        frequencia: l.frequencia
      };
    }
    return respostas;
  }

  static processarFormularioV2(idDoente: string, idSubmissao: string, idAutor: string): any[] {
    const submissao = db.prepare('SELECT data_referencia_sintomas FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { data_referencia_sintomas: string };
    const kps = this.obterKpsVigente(idDoente, submissao.data_referencia_sintomas);
    const contexto = this.contextoLinhaBase(idDoente, submissao.data_referencia_sintomas, kps?.id_avaliacao_kps ?? null);
    const limiteHistorico = `-${JANELA_MINIMA_DIAS} days`;
    const linhasHistorico = db.prepare(`SELECT s.id_submissao, s.data_referencia_sintomas
      FROM SubmissaoMonitorizacao s JOIN AvaliacaoAlgoritmo a ON a.id_submissao = s.id_submissao
      WHERE s.id_doente = ? AND s.id_formulario = ? AND s.id_submissao != ?
        AND a.contexto_linha_base = ? AND s.data_referencia_sintomas <= date(?, ?)
      ORDER BY s.data_referencia_sintomas ASC, s.data_hora_submissao ASC`)
      .all(idDoente, ID_FORMULARIO_V2, idSubmissao, contexto, submissao.data_referencia_sintomas, limiteHistorico) as Array<{
        id_submissao: string; data_referencia_sintomas: string;
      }>;
    const historico = this.filtrarJanelasSobrepostas(linhasHistorico);
    const anteriores = historico.map(s => this.respostasPorCodigo(s.id_submissao));
    const resultado = avaliarSubmissaoV2({
      respostas: this.respostasPorCodigo(idSubmissao), anteriores, kps: kps?.score_kps ?? null
    });
    db.prepare(`INSERT INTO AvaliacaoAlgoritmo
      (id_submissao, score, cobertura, linha_de_base, variabilidade_linha_de_base, limiar_score,
       dados_nao_avaliaveis, motivos_json, prioridade_algoritmo, tipo_regra, versao_parametros, contexto_linha_base, data_hora_avaliacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(idSubmissao, resultado.score, resultado.cobertura, resultado.linhaDeBase,
        resultado.variabilidadeLinhaDeBase, resultado.limiarScore, JSON.stringify(resultado.dadosNaoAvaliaveis),
        JSON.stringify(resultado.motivos), resultado.prioridade, resultado.tipo, VERSAO_PARAMETROS, contexto, new Date().toISOString());
    if (!resultado.prioridade || !resultado.tipo) return [];

    const regras: Record<TipoRegraV2, string> = {
      SINAL_ALARME_V2: 'regra-v2-alarme',
      COMBINACAO_V2: 'regra-v2-combinacao',
      SCORE_EVOLUCAO_V2: 'regra-v2-score',
      DADOS_INSUFICIENTES_V2: 'regra-v2-dados-insuficientes'
    };
    const regra = db.prepare('SELECT id_regra, nome FROM RegraAlerta WHERE id_regra = ? AND ativa = 1')
      .get(regras[resultado.tipo]) as { id_regra: string; nome: string } | undefined;
    if (!regra) throw new Error(`A regra de alerta ${regras[resultado.tipo]} não está configurada ou ativa.`);
    const alerta = this.inserirAlertaClinico(
      idSubmissao, regra.id_regra, `Questionário v2 — ${regra.nome}`, resultado.prioridade, resumoDoAlerta(resultado)
    );
    registarAuditoria(idAutor, alerta.duplicado ? 'ASSOCIACAO_ALERTA_DUPLICADO' : 'GERACAO_ALERTA_V2',
      `${alerta.duplicado ? 'Submissão associada ao alerta aberto' : `Alerta ${resultado.prioridade}`} (${resultado.motivos.length} motivo(s))`);
    // As instruções não ficam guardadas: servem para a aplicação avisar logo quem está a preencher.
    return [{ ...alerta, instrucoes: resultado.instrucoes, motivos: resultado.motivos.map(m => m.texto) }];
  }

  private static obterKpsVigente(idDoente: string, dataReferencia: string):
    { id_avaliacao_kps: string; score_kps: number } | undefined {
    return db.prepare(`SELECT id_avaliacao_kps, score_kps FROM AvaliacaoKarnofsky
      WHERE id_doente = ? AND data_avaliacao <= ? AND data_avaliacao >= date(?, '-180 days')
      ORDER BY data_avaliacao DESC, rowid DESC LIMIT 1`)
      .get(idDoente, dataReferencia, dataReferencia) as { id_avaliacao_kps: string; score_kps: number } | undefined;
  }

  private static contextoLinhaBase(idDoente: string, dataReferencia: string, idKps: string | null): string {
    const diagnostico = db.prepare('SELECT fase_clinica_atual FROM DiagnosticoGB WHERE id_doente = ?')
      .get(idDoente) as { fase_clinica_atual: string } | undefined;
    const cirurgia = db.prepare(`SELECT id_tratamento FROM Tratamento
      WHERE id_doente = ? AND tipo = 'CIRURGIA' AND data_inicio <= ?
      ORDER BY data_inicio DESC, rowid DESC LIMIT 1`).get(idDoente, dataReferencia) as { id_tratamento: string } | undefined;
    return JSON.stringify({
      fase: diagnostico?.fase_clinica_atual ?? null,
      cirurgia: cirurgia?.id_tratamento ?? null,
      avaliacaoKps: idKps
    });
  }

  private static filtrarJanelasSobrepostas<T extends { data_referencia_sintomas: string }>(historico: T[]): T[] {
    const selecionados: T[] = [];
    for (const registo of historico) {
      const anterior = selecionados[selecionados.length - 1];
      if (!anterior || Date.parse(`${registo.data_referencia_sintomas}T00:00:00Z`) -
          Date.parse(`${anterior.data_referencia_sintomas}T00:00:00Z`) >= JANELA_MINIMA_DIAS * 86400000) {
        selecionados.push(registo);
      }
    }
    return selecionados;
  }

  static inserirAlertaClinico(idSubmissao: string, idRegra: string, origemGatilho: string, prioridade: Prioridade, resumoAgravamento: string) {
    const doente = db.prepare('SELECT id_doente FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { id_doente: string } | undefined;
    if (!doente) throw new Error('Submissão do alerta não encontrada.');
    const existente = db.prepare(`SELECT a.* FROM AlertaClinico a JOIN SubmissaoMonitorizacao s ON s.id_submissao = a.id_submissao
      WHERE s.id_doente = ? AND a.id_regra = ? AND a.estado_atual != 'Concluído'
      ORDER BY a.data_hora_geracao DESC LIMIT 1`).get(doente.id_doente, idRegra) as any;
    const prioridadeAnterior = existente?.prioridade_algoritmo || existente?.prioridade;
    if (existente && NIVEIS_PRIORIDADE.indexOf(prioridade) <= NIVEIS_PRIORIDADE.indexOf(prioridadeAnterior)) {
      db.prepare('INSERT OR IGNORE INTO AlertaSubmissao (id_alerta, id_submissao) VALUES (?, ?)')
        .run(existente.id_alerta, idSubmissao);
      return { ...existente, duplicado: true };
    }
    const id_alerta = crypto.randomUUID();
    const agora = new Date().toISOString();
    db.prepare(`
      INSERT INTO AlertaClinico
        (id_alerta, id_submissao, id_regra, data_hora_geracao, origem_gatilho, prioridade, prioridade_algoritmo, estado_atual, resumo_agravamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente', ?)
    `).run(id_alerta, idSubmissao, idRegra, agora, origemGatilho, prioridade, prioridade, resumoAgravamento);
    db.prepare('INSERT INTO AlertaSubmissao (id_alerta, id_submissao) VALUES (?, ?)').run(id_alerta, idSubmissao);
    return {
      id_alerta,
      id_submissao: idSubmissao,
      id_regra: idRegra,
      prioridade,
      estado_atual: 'Pendente',
      resumo_agravamento: resumoAgravamento
    };
  }

  static listarAlertas() {
    return db.prepare(`
      SELECT a.*, r.nome as nome_regra, r.referencia_literatura,
             s.id_doente, d.numero_processo_clinico, u.nome as nome_doente,
             (SELECT h.nota_triagem FROM HistoricoAcaoAlerta h WHERE h.id_alerta = a.id_alerta
               ORDER BY h.data_hora_acao DESC LIMIT 1) as ultima_nota,
             (SELECT ua.nome FROM HistoricoAcaoAlerta h JOIN Utilizador ua ON ua.id_utilizador = h.id_utilizador
               WHERE h.id_alerta = a.id_alerta ORDER BY h.data_hora_acao DESC LIMIT 1) as autor_ultima_nota,
             (SELECT r.texto FROM RespostaMonitorizacao r JOIN PerguntaFormulario p ON p.id_pergunta = r.id_pergunta
               WHERE r.id_submissao = a.id_submissao AND p.tipo_resposta = 'TEXTO_LIVRE' LIMIT 1) as mensagem_doente
      FROM AlertaClinico a
      JOIN RegraAlerta r ON a.id_regra = r.id_regra
      JOIN SubmissaoMonitorizacao s ON a.id_submissao = s.id_submissao
      JOIN Doente d ON s.id_doente = d.id_doente
      JOIN Utilizador u ON d.id_doente = u.id_utilizador
      ORDER BY CASE a.prioridade WHEN 'Crítica' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Média' THEN 3 ELSE 4 END, a.data_hora_geracao DESC
    `).all();
  }

  static registarTriagemAlerta(idAlerta: string, idUtilizador: string, novoEstado: string, novaPrioridade: string | undefined, notaTriagem: string) {
    const alerta = db.prepare('SELECT * FROM AlertaClinico WHERE id_alerta = ?').get(idAlerta) as any;
    if (!alerta) throw new Error('AlertaClinico não encontrado.');
    if (alerta.estado_atual === 'Concluído') throw new Error('Este alerta já está concluído e não pode voltar a ser alterado.');
    const estadosValidos = ['Pendente', 'Em análise', 'Encaminhado', 'Concluído'];
    const prioridadesValidas = ['Baixa', 'Média', 'Alta', 'Crítica'];
    if (!estadosValidos.includes(novoEstado)) throw new Error('Estado de alerta inválido.');
    if (novaPrioridade && !prioridadesValidas.includes(novaPrioridade)) throw new Error('Prioridade de alerta inválida.');
    if (typeof notaTriagem !== 'string' || !notaTriagem.trim()) throw new Error('Registe uma nota de triagem.');
    const prioridadeFinal = novaPrioridade || alerta.prioridade;
    const agora = new Date().toISOString();
    const tipoAcao = novoEstado === 'Encaminhado' ? 'ENCAMINHAMENTO_MEDICO_RF26' : 'TRIAGEM_ENFERMAGEM';

    const tx = db.transaction(() => {
      db.prepare('UPDATE AlertaClinico SET estado_atual = ?, prioridade = ? WHERE id_alerta = ?').run(novoEstado, prioridadeFinal, idAlerta);
      db.prepare(`
        INSERT INTO HistoricoAcaoAlerta
          (id_acao, id_alerta, id_utilizador, data_hora_acao, tipo_acao, estado_anterior, estado_novo, prioridade_anterior, prioridade_nova, nota_triagem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), idAlerta, idUtilizador, agora, tipoAcao, alerta.estado_atual, novoEstado,
        alerta.prioridade, prioridadeFinal, notaTriagem);
      registarAuditoria(idUtilizador, tipoAcao, `Alerta ${idAlerta}: ${alerta.estado_atual} -> ${novoEstado}`);
    });
    tx();
    return db.prepare('SELECT * FROM AlertaClinico WHERE id_alerta = ?').get(idAlerta);
  }
}