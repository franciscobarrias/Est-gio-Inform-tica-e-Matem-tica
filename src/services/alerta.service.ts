import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { ID_FORMULARIO_V2 } from '../database/formulario-v2';
import { avaliarSubmissaoV2, resumoDoAlerta, RespostasPorCodigo, TipoRegraV2, VERSAO_PARAMETROS, JANELA_MINIMA_DIAS } from './motor-alertas-v2';

export type Prioridade = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
const NIVEIS_PRIORIDADE: Prioridade[] = ['Baixa', 'Média', 'Alta', 'Crítica'];
type MotivoPersistido = { texto: string; prioridade: Prioridade; tipo: TipoRegraV2; codigos: string[] };
type TipoAssociacao = 'ORIGINAL' | 'MOTIVO_REPETIDO' | 'MOTIVO_NOVO' | 'ESCALONAMENTO';

export class AlertaService {
  static processarRegrasNaSubmissao(idDoente: string, idSubmissao: string, idAutor: string, dataHora?: string): any[] {
    const submissao = db.prepare('SELECT id_formulario FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { id_formulario: string } | undefined;
    if (!submissao) throw new Error('Submissão de monitorização não encontrada.');
    if (submissao.id_formulario !== ID_FORMULARIO_V2) {
      throw new Error('O motor de alertas só aceita submissões do formulário v2 ativo.');
    }
    return db.transaction(() => this.processarFormularioV2(idDoente, idSubmissao, idAutor, dataHora))();
  }

  static registarFalhaAvaliacao(idSubmissao: string, erro: string, dataHora = new Date().toISOString()): void {
    const textoErro = erro.trim() || 'Erro desconhecido durante a avaliação.';
    db.prepare(`INSERT INTO AvaliacaoAlgoritmo
      (id_submissao, versao_parametros, cobertura, dados_nao_avaliaveis, motivos_json,
       contexto_linha_base, data_hora_avaliacao, estado, erro)
      VALUES (?, ?, NULL, '[]', '[]', '{}', ?, 'ERRO', ?)`)
      .run(idSubmissao, VERSAO_PARAMETROS, dataHora, textoErro);
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

  static processarFormularioV2(idDoente: string, idSubmissao: string, idAutor: string, dataHora?: string): any[] {
    const submissao = db.prepare('SELECT data_referencia_sintomas FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { data_referencia_sintomas: string };
    const kps = this.obterKpsVigente(idDoente, submissao.data_referencia_sintomas);
    const contexto = this.contextoLinhaBase(idDoente, submissao.data_referencia_sintomas);
    const limiteHistorico = `-${JANELA_MINIMA_DIAS} days`;
    const linhasHistorico = db.prepare(`SELECT s.id_submissao, s.data_referencia_sintomas
      FROM SubmissaoMonitorizacao s JOIN AvaliacaoAlgoritmo a ON a.id_submissao = s.id_submissao
      WHERE s.id_doente = ? AND s.id_formulario = ? AND s.id_submissao != ?
        AND a.versao_parametros = ? AND a.estado = 'CONCLUIDA'
        AND a.contexto_linha_base = ? AND s.data_referencia_sintomas <= date(?, ?)
      ORDER BY s.data_referencia_sintomas ASC, s.data_hora_submissao ASC`)
      .all(idDoente, ID_FORMULARIO_V2, idSubmissao, VERSAO_PARAMETROS, contexto, submissao.data_referencia_sintomas, limiteHistorico) as Array<{
        id_submissao: string; data_referencia_sintomas: string;
      }>;
    const historico = this.filtrarJanelasSobrepostas(linhasHistorico);
    const anteriores = historico.map(s => this.respostasPorCodigo(s.id_submissao));
    const resultado = avaliarSubmissaoV2({
      respostas: this.respostasPorCodigo(idSubmissao), anteriores, kps: kps?.score_kps ?? null
    });
    const instanteAvaliacao = dataHora ?? new Date().toISOString();
    db.prepare(`INSERT INTO AvaliacaoAlgoritmo
      (id_submissao, versao_parametros, score, cobertura, linha_de_base, variabilidade_linha_de_base,
       limiar_score, dados_nao_avaliaveis, motivos_json, prioridade_algoritmo, tipo_regra,
       contexto_linha_base, data_hora_avaliacao, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONCLUIDA')`)
      .run(idSubmissao, VERSAO_PARAMETROS, resultado.score, resultado.cobertura, resultado.linhaDeBase,
        resultado.variabilidadeLinhaDeBase, resultado.limiarScore, JSON.stringify(resultado.dadosNaoAvaliaveis),
        JSON.stringify(resultado.motivos), resultado.prioridade, resultado.tipo, contexto, instanteAvaliacao);
    const inserirMotivo = db.prepare(`INSERT INTO MotivoEvidencia
      (id_submissao, versao_parametros, ordem, texto, prioridade, tipo, codigos_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    resultado.motivos.forEach((motivo, ordem) => inserirMotivo.run(
      idSubmissao, VERSAO_PARAMETROS, ordem, motivo.texto, motivo.prioridade, motivo.tipo, JSON.stringify(motivo.codigos)
    ));
    const inserirInstrucao = db.prepare(`INSERT INTO InstrucaoEmitida
      (id_submissao, versao_parametros, ordem, codigo) VALUES (?, ?, ?, ?)`);
    resultado.instrucoes.forEach((instrucao, ordem) => inserirInstrucao.run(
      idSubmissao, VERSAO_PARAMETROS, ordem, instrucao
    ));
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
      idSubmissao, regra.id_regra, `Questionário v2 — ${regra.nome}`, resultado.prioridade,
      resumoDoAlerta(resultado), resultado.motivos, instanteAvaliacao
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

  private static contextoLinhaBase(idDoente: string, dataReferencia: string): string {
    const fase = db.prepare(`SELECT id_fase_clinica, fase_clinica FROM FaseClinica
      WHERE id_doente = ? AND data_inicio <= ?
      ORDER BY data_inicio DESC, rowid DESC LIMIT 1`)
      .get(idDoente, dataReferencia) as { id_fase_clinica: string; fase_clinica: string } | undefined;
    const cirurgia = db.prepare(`SELECT id_tratamento FROM Tratamento
      WHERE id_doente = ? AND tipo = 'CIRURGIA' AND data_inicio <= ?
      ORDER BY data_inicio DESC, rowid DESC LIMIT 1`).get(idDoente, dataReferencia) as { id_tratamento: string } | undefined;
    const kps = db.prepare(`SELECT id_avaliacao_kps, score_kps FROM AvaliacaoKarnofsky
      WHERE id_doente = ? AND data_avaliacao <= ?
      ORDER BY data_avaliacao ASC, rowid ASC`).all(idDoente, dataReferencia) as Array<{
        id_avaliacao_kps: string; score_kps: number;
      }>;
    let kpsMarco: string | null = null;
    for (let indice = 1; indice < kps.length; indice++) {
      const anterior = kps[indice - 1].score_kps;
      const atual = kps[indice].score_kps;
      const cruzaSetenta = (anterior > 70 && atual <= 70) || (anterior <= 70 && atual > 70);
      if (Math.abs(atual - anterior) >= 20 || cruzaSetenta) kpsMarco = kps[indice].id_avaliacao_kps;
    }
    return JSON.stringify({
      faseId: fase?.id_fase_clinica ?? null,
      fase: fase?.fase_clinica ?? null,
      cirurgia: cirurgia?.id_tratamento ?? null,
      marcoKps: kpsMarco
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

  private static chaveMotivo(motivo: Pick<MotivoPersistido, 'texto' | 'tipo' | 'codigos'>): string {
    const texto = motivo.texto.replace(
      /: score [\d.]+ face à linha de base [\d.]+ \(\+[\d.]+; limiar [\d.]+\)/,
      ': agravamento global do score'
    );
    return JSON.stringify([motivo.tipo, [...motivo.codigos].sort(), texto]);
  }

  private static motivosDoAlerta(idAlerta: string): MotivoPersistido[] {
    const submissoes = db.prepare(`SELECT id_submissao FROM AlertaSubmissao WHERE id_alerta = ?
      UNION SELECT id_submissao FROM AlertaClinico WHERE id_alerta = ?`)
      .all(idAlerta, idAlerta) as Array<{ id_submissao: string }>;
    const motivos = new Map<string, MotivoPersistido>();
    for (const submissao of submissoes) {
      const avaliacao = db.prepare(`SELECT motivos_json FROM AvaliacaoAlgoritmo
        WHERE id_submissao = ? AND estado = 'CONCLUIDA'
        ORDER BY data_hora_avaliacao DESC LIMIT 1`)
        .get(submissao.id_submissao) as { motivos_json: string } | undefined;
      if (!avaliacao) continue;
      const motivosAvaliados = JSON.parse(avaliacao.motivos_json) as MotivoPersistido[];
      for (const motivo of motivosAvaliados) motivos.set(this.chaveMotivo(motivo), motivo);
    }
    return [...motivos.values()];
  }

  static inserirAlertaClinico(
    idSubmissao: string,
    idRegra: string,
    origemGatilho: string,
    prioridade: Prioridade,
    resumoAgravamento: string,
    motivos: MotivoPersistido[] = [],
    dataHora = new Date().toISOString()
  ) {
    const doente = db.prepare('SELECT id_doente FROM SubmissaoMonitorizacao WHERE id_submissao = ?')
      .get(idSubmissao) as { id_doente: string } | undefined;
    if (!doente) throw new Error('Submissão do alerta não encontrada.');
    const existente = db.prepare(`SELECT a.* FROM AlertaClinico a JOIN SubmissaoMonitorizacao s ON s.id_submissao = a.id_submissao
      WHERE s.id_doente = ? AND a.estado_atual != 'Concluído'
      ORDER BY a.data_hora_geracao DESC LIMIT 1`).get(doente.id_doente) as any;
    const motivosExistentes = existente ? this.motivosDoAlerta(existente.id_alerta) : [];
    const chavesExistentes = new Set(motivosExistentes.map(motivo => this.chaveMotivo(motivo)));
    const motivoNovo = motivos.some(motivo => !chavesExistentes.has(this.chaveMotivo(motivo)));
    const prioridadeAnterior = existente?.prioridade_algoritmo || existente?.prioridade;
    const escalonamento = Boolean(existente) &&
      NIVEIS_PRIORIDADE.indexOf(prioridade) > NIVEIS_PRIORIDADE.indexOf(prioridadeAnterior);
    if (existente && !motivoNovo && !escalonamento) {
      db.prepare(`INSERT OR IGNORE INTO AlertaSubmissao (id_alerta, id_submissao, tipo_associacao)
        VALUES (?, ?, 'MOTIVO_REPETIDO')`).run(existente.id_alerta, idSubmissao);
      return { ...existente, duplicado: true, tipo_associacao: 'MOTIVO_REPETIDO' as TipoAssociacao };
    }
    const id_alerta = crypto.randomUUID();
    db.prepare(`
      INSERT INTO AlertaClinico
        (id_alerta, id_submissao, id_regra, data_hora_geracao, origem_gatilho, prioridade, prioridade_algoritmo,
         estado_atual, resumo_agravamento, id_alerta_anterior)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente', ?, ?)
    `).run(id_alerta, idSubmissao, idRegra, dataHora, origemGatilho, prioridade, prioridade,
      resumoAgravamento, existente?.id_alerta ?? null);
    // Sem alerta aberto é o original; com alerta aberto, a subida de prioridade prevalece sobre o motivo novo.
    const tipoAssociacao: TipoAssociacao = !existente ? 'ORIGINAL' : escalonamento ? 'ESCALONAMENTO' : 'MOTIVO_NOVO';
    db.prepare(`INSERT INTO AlertaSubmissao (id_alerta, id_submissao, tipo_associacao) VALUES (?, ?, ?)`)
      .run(id_alerta, idSubmissao, tipoAssociacao);
    return {
      id_alerta,
      id_submissao: idSubmissao,
      id_regra: idRegra,
      prioridade,
      estado_atual: 'Pendente',
      resumo_agravamento: resumoAgravamento,
      id_alerta_anterior: existente?.id_alerta ?? null,
      tipo_associacao: tipoAssociacao
    };
  }

  static listarAlertas(): Array<{ id_doente: string; [campo: string]: any }> {
    const alertas = db.prepare(`
      SELECT a.*, r.nome as nome_regra, r.referencia_literatura,
             s.id_doente, d.numero_processo_clinico, u.nome as nome_doente,
             (SELECT h.nota_triagem FROM HistoricoAcaoAlerta h WHERE h.id_alerta = a.id_alerta
               ORDER BY h.data_hora_acao DESC LIMIT 1) as ultima_nota,
             (SELECT ua.nome FROM HistoricoAcaoAlerta h JOIN Utilizador ua ON ua.id_utilizador = h.id_utilizador
               WHERE h.id_alerta = a.id_alerta ORDER BY h.data_hora_acao DESC LIMIT 1) as autor_ultima_nota,
             (SELECT h.data_hora_acao FROM HistoricoAcaoAlerta h WHERE h.id_alerta = a.id_alerta
               ORDER BY h.data_hora_acao DESC LIMIT 1) as data_ultima_nota,
             (SELECT r.texto FROM RespostaMonitorizacao r JOIN PerguntaFormulario p ON p.id_pergunta = r.id_pergunta
               WHERE r.id_submissao = a.id_submissao AND p.tipo_resposta = 'TEXTO_LIVRE' LIMIT 1) as mensagem_doente,
             ant.data_hora_geracao as anterior_data, ant.prioridade as anterior_prioridade, ant.estado_atual as anterior_estado,
             -- Alerta que veio a seguir a este (o mais recente que o indica como anterior).
             (SELECT seg.data_hora_geracao FROM AlertaClinico seg WHERE seg.id_alerta_anterior = a.id_alerta
               ORDER BY seg.data_hora_geracao DESC LIMIT 1) as seguinte_data,
             (SELECT seg.prioridade FROM AlertaClinico seg WHERE seg.id_alerta_anterior = a.id_alerta
               ORDER BY seg.data_hora_geracao DESC LIMIT 1) as seguinte_prioridade
      FROM AlertaClinico a
      LEFT JOIN AlertaClinico ant ON ant.id_alerta = a.id_alerta_anterior
      JOIN RegraAlerta r ON a.id_regra = r.id_regra
      JOIN SubmissaoMonitorizacao s ON a.id_submissao = s.id_submissao
      JOIN Doente d ON s.id_doente = d.id_doente
      JOIN Utilizador u ON d.id_doente = u.id_utilizador
      ORDER BY CASE a.prioridade WHEN 'Crítica' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Média' THEN 3 ELSE 4 END, a.data_hora_geracao DESC
    `).all() as Array<{ id_doente: string; [campo: string]: any }>;
    const submissoes = db.prepare(`SELECT s.id_submissao, s.data_referencia_sintomas, ls.tipo_associacao
      FROM AlertaSubmissao ls JOIN SubmissaoMonitorizacao s ON s.id_submissao = ls.id_submissao
      WHERE ls.id_alerta = ? ORDER BY s.data_referencia_sintomas DESC, s.data_hora_submissao DESC`);
    // Motivos e instruções da avaliação que gerou o alerta (versão de parâmetros mais recente dessa submissão).
    const motivos = db.prepare(`SELECT texto, prioridade, tipo, codigos_json FROM MotivoEvidencia
      WHERE id_submissao = ? AND versao_parametros = (SELECT MAX(versao_parametros) FROM MotivoEvidencia WHERE id_submissao = ?)
      ORDER BY ordem`);
    const instrucoes = db.prepare(`SELECT DISTINCT codigo FROM InstrucaoEmitida
      WHERE id_submissao = ? AND versao_parametros = (SELECT MAX(versao_parametros) FROM InstrucaoEmitida WHERE id_submissao = ?)`);
    return alertas.map(alerta => ({
      ...alerta,
      submissoes_associadas: submissoes.all(alerta.id_alerta),
      motivos: (motivos.all(alerta.id_submissao, alerta.id_submissao) as any[])
        .map(m => ({ ...m, codigos: JSON.parse(m.codigos_json || '[]') })),
      instrucoes: (instrucoes.all(alerta.id_submissao, alerta.id_submissao) as Array<{ codigo: string }>).map(i => i.codigo)
    }));
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