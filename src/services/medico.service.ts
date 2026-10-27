import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { SintomaService } from './sintoma.service';
import { AlertaService } from './alerta.service';

export class MedicoService {
  static registarAvaliacaoKarnofsky(idDoente: string, idMedico: string, scoreKps: number) {
    if (scoreKps < 0 || scoreKps > 100 || scoreKps % 10 !== 0) {
      throw new Error('O score KPS deve situar-se entre 0 e 100 (múltiplos de 10).');
    }
    const id_avaliacao_kps = crypto.randomUUID();
    const data_avaliacao = new Date().toISOString().split('T')[0];
    db.prepare(`INSERT INTO AvaliacaoKarnofsky VALUES (?, ?, ?, ?, ?)`).run(id_avaliacao_kps, idDoente, idMedico, data_avaliacao, scoreKps);
    registarAuditoria(idMedico, 'AVALIACAO_KPS_RF08', `Registado KPS=${scoreKps}`);
    return { id_avaliacao_kps, score_kps: scoreKps, data_avaliacao, participacao_cuidador_obrigatoria: scoreKps <= 70 };
  }

  static definirPlanoMonitorizacao(idDoente: string, idMedico: string, modoPeriodicidade: string, periodicidadeDias: number, faseClinica?: string) {
    const id_plano = crypto.randomUUID();
    const agora = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`UPDATE PlanoMonitorizacao SET estado = 'HISTORICO' WHERE id_doente = ? AND estado = 'ATIVO'`).run(idDoente);
      db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, ?, ?, ?, 'ATIVO')`).run(id_plano, idDoente, idMedico, modoPeriodicidade, periodicidadeDias, agora);
      if (faseClinica) db.prepare(`UPDATE DiagnosticoGB SET fase_clinica_atual = ? WHERE id_doente = ?`).run(faseClinica, idDoente);
      registarAuditoria(idMedico, 'PLANO_MONITORIZACAO_RF09', `Periodicidade de ${periodicidadeDias} dias`);
    });
    tx();
    return { id_plano, periodicidade_dias: periodicidadeDias };
  }

  static registarTratamento(idDoente: string, idMedico: string, dados: { tipo: string; estado: string; data_inicio: string; data_fim?: string; descricao_esquema: string }) {
    const id_tratamento = crypto.randomUUID();
    db.prepare(`INSERT INTO Tratamento VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id_tratamento, idDoente, dados.tipo, dados.estado, dados.data_inicio, dados.data_fim || null, dados.descricao_esquema);
    registarAuditoria(idMedico, 'REGISTO_TRATAMENTO_RF07', `Tratamento ${dados.tipo}`);
    return { id_tratamento, ...dados };
  }

  static registarDecisaoAcompanhamento(idDoente: string, idMedico: string, dados: { id_alerta?: string; decisao_medica: string; fundamentacao_clinica: string }) {
    const id_decisao = crypto.randomUUID();
    const agora = new Date().toISOString();
    db.prepare(`INSERT INTO DecisaoAcompanhamento VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id_decisao, idDoente, idMedico, dados.id_alerta || null, agora, dados.decisao_medica, dados.fundamentacao_clinica);
    if (dados.id_alerta) AlertaService.registarTriagemAlerta(dados.id_alerta, idMedico, 'Concluído', undefined, `Decisão médica: ${dados.decisao_medica}`);
    registarAuditoria(idMedico, 'DECISAO_ACOMPANHAMENTO_RF30', `Decisão "${dados.decisao_medica}"`);
    return { id_decisao, data_hora_decisao: agora, ...dados };
  }

  static obterProcessoLongitudinal(idDoente: string) {
    const doente = db.prepare(`
      SELECT d.*, u.nome, u.email, m_user.nome as nome_medico_responsavel
      FROM Doente d
      JOIN Utilizador u ON d.id_doente = u.id_utilizador
      JOIN Utilizador m_user ON d.id_medico_responsavel = m_user.id_utilizador
      WHERE d.id_doente = ?
    `).get(idDoente) as any;
    if (!doente) throw new Error('Doente não encontrado.');

    const diagnostico = db.prepare('SELECT * FROM DiagnosticoGB WHERE id_doente = ?').get(idDoente);
    const tratamentos = db.prepare('SELECT * FROM Tratamento WHERE id_doente = ? ORDER BY data_inicio DESC').all(idDoente);
    const avaliacoesKps = db.prepare('SELECT * FROM AvaliacaoKarnofsky WHERE id_doente = ? ORDER BY data_avaliacao ASC').all(idDoente) as any[];
    const ultimoKps = avaliacoesKps.length > 0 ? avaliacoesKps[avaliacoesKps.length - 1].score_kps : 100;
    const cuidadores = db.prepare(`SELECT dc.*, u.nome, u.email, c.telefone_contacto FROM DoenteCuidador dc JOIN Cuidador c ON dc.id_cuidador = c.id_cuidador JOIN Utilizador u ON c.id_cuidador = u.id_utilizador WHERE dc.id_doente = ? AND dc.ativa = 1`).all(idDoente);
    const planos = db.prepare('SELECT * FROM PlanoMonitorizacao WHERE id_doente = ? ORDER BY data_definicao DESC').all(idDoente);

    const submissoes = db.prepare(`
      SELECT s.*, u.nome as nome_autor, f.nome as nome_formulario
      FROM SubmissaoMonitorizacao s
      JOIN Utilizador u ON s.id_autor = u.id_utilizador
      JOIN Formulario f ON s.id_formulario = f.id_formulario
      WHERE s.id_doente = ?
      ORDER BY s.data_referencia_sintomas ASC, s.data_hora_submissao ASC
    `).all(idDoente) as any[];

    for (const sub of submissoes) {
      sub.respostas = db.prepare(`
        SELECT r.*, p.categoria, p.enunciado, o.rotulo, o.valor_codificado
        FROM RespostaMonitorizacao r
        JOIN PerguntaFormulario p ON r.id_pergunta = p.id_pergunta
        LEFT JOIN OpcaoResposta o ON r.id_opcao = o.id_opcao
        WHERE r.id_submissao = ?
        ORDER BY p.ordem ASC
      `).all(sub.id_submissao);
    }

    const alertas = db.prepare(`SELECT a.*, r.nome as nome_regra FROM AlertaClinico a JOIN SubmissaoMonitorizacao s ON a.id_submissao = s.id_submissao JOIN RegraAlerta r ON a.id_regra = r.id_regra WHERE s.id_doente = ? ORDER BY a.data_hora_geracao DESC`).all(idDoente);
    const decisoes = db.prepare(`SELECT dec.*, u.nome as nome_medico FROM DecisaoAcompanhamento dec JOIN Utilizador u ON dec.id_medico = u.id_utilizador WHERE dec.id_doente = ? ORDER BY dec.data_hora_decisao DESC`).all(idDoente);

    return {
      doente: { ...doente, ultimo_kps: ultimoKps, participacao_cuidador_obrigatoria: ultimoKps <= 70 },
      diagnostico, tratamentos, avaliacoesKps, cuidadores, planos, submissoes, alertas, decisoes,
      lembrete: SintomaService.calcularLembreteMonitorizacao(idDoente)
    };
  }
}