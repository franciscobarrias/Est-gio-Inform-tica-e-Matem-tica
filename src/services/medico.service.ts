import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { SintomaService } from './sintoma.service';
import { AlertaService } from './alerta.service';

function dataIsoValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const parsed = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === data;
}

export class MedicoService {
  static atualizarDiagnostico(idDoente: string, idMedico: string, dados: {
    data_diagnostico: string;
    localizacao_tumoral: string;
    lateralidade: string;
    estatuto_idh: string;
    metilacao_mgmt: string;
    fase_clinica_atual: string;
  }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados do diagnóstico inválidos.');
    const camposObrigatorios = Object.entries(dados);
    if (camposObrigatorios.some(([, valor]) => typeof valor !== 'string' || !valor.trim())) {
      throw new Error('Preencha todos os campos do diagnóstico.');
    }
    if (!dataIsoValida(dados.data_diagnostico)) {
      throw new Error('A data do diagnóstico deve ter o formato AAAA-MM-DD.');
    }
    const existente = db.prepare('SELECT id_diagnostico FROM DiagnosticoGB WHERE id_doente = ?').get(idDoente) as { id_diagnostico: string } | undefined;
    const idDiagnostico = existente?.id_diagnostico || crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO DiagnosticoGB
        (id_diagnostico, id_doente, data_diagnostico, localizacao_tumoral, lateralidade, estatuto_idh, metilacao_mgmt, fase_clinica_atual)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id_doente) DO UPDATE SET data_diagnostico = excluded.data_diagnostico,
          localizacao_tumoral = excluded.localizacao_tumoral, lateralidade = excluded.lateralidade,
          estatuto_idh = excluded.estatuto_idh, metilacao_mgmt = excluded.metilacao_mgmt,
          fase_clinica_atual = excluded.fase_clinica_atual`)
        .run(idDiagnostico, idDoente, dados.data_diagnostico, dados.localizacao_tumoral.trim(),
          dados.lateralidade.trim(), dados.estatuto_idh.trim(), dados.metilacao_mgmt.trim(), dados.fase_clinica_atual.trim());
      registarAuditoria(idMedico, 'ATUALIZACAO_DIAGNOSTICO_RF07', `Diagnóstico atualizado para o processo ${idDoente}`);
    });
    tx();
    return db.prepare('SELECT * FROM DiagnosticoGB WHERE id_doente = ?').get(idDoente);
  }

  static associarCuidador(idDoente: string, emailCuidador: string, grauParentesco: string, idAutor: string, consentimentoConfirmado: boolean) {
    if (!emailCuidador?.trim() || !grauParentesco?.trim()) throw new Error('Indique o email do cuidador e o grau de parentesco.');
    if (!consentimentoConfirmado) throw new Error('Confirme que existe autorização do doente para associar o cuidador.');
    const cuidador = db.prepare(`SELECT u.id_utilizador FROM Utilizador u JOIN Cuidador c ON c.id_cuidador = u.id_utilizador
      WHERE lower(u.email) = lower(?) AND u.perfil = 'CUIDADOR' AND u.estado_conta = 'ATIVA'`)
      .get(emailCuidador.trim()) as { id_utilizador: string } | undefined;
    if (!cuidador) throw new Error('O utilizador indicado não tem uma conta de cuidador ativa.');
    const idCuidador = cuidador.id_utilizador;
    const agora = new Date().toISOString();
    const idAssociacao = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`UPDATE DoenteCuidador SET ativa = 0, data_fim = ?
        WHERE id_doente = ? AND id_cuidador = ? AND ativa = 1`).run(agora, idDoente, idCuidador);
      db.prepare(`INSERT INTO DoenteCuidador
        (id_associacao, id_doente, id_cuidador, grau_parentesco, data_inicio, data_fim, autorizacao_validada, ativa)
        VALUES (?, ?, ?, ?, ?, NULL, 1, 1)`).run(idAssociacao, idDoente, idCuidador, grauParentesco.trim(), agora);
      registarAuditoria(idAutor, 'ASSOCIACAO_CUIDADOR_RF03', `Cuidador ${idCuidador} associado ao doente ${idDoente} com autorização.`);
    });
    tx();
    return { id_associacao: idAssociacao, id_doente: idDoente, id_cuidador: idCuidador, grau_parentesco: grauParentesco.trim(), autorizacao_validada: true };
  }

  static registarAvaliacaoKarnofsky(idDoente: string, idMedico: string, scoreKps: number) {
    if (!Number.isInteger(scoreKps) || scoreKps < 0 || scoreKps > 100 || scoreKps % 10 !== 0) {
      throw new Error('O score KPS deve situar-se entre 0 e 100 (múltiplos de 10).');
    }
    const id_avaliacao_kps = crypto.randomUUID();
    const data_avaliacao = new Date().toISOString().split('T')[0];
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO AvaliacaoKarnofsky VALUES (?, ?, ?, ?, ?)`).run(id_avaliacao_kps, idDoente, idMedico, data_avaliacao, scoreKps);
      registarAuditoria(idMedico, 'AVALIACAO_KPS_RF08', `Registado KPS=${scoreKps}`);
    });
    tx();
    return { id_avaliacao_kps, score_kps: scoreKps, data_avaliacao, participacao_cuidador_obrigatoria: scoreKps <= 70 };
  }

  static definirPlanoMonitorizacao(idDoente: string, idMedico: string, modoPeriodicidade: string, periodicidadeDias: number, faseClinica?: string) {
    if (!Number.isInteger(periodicidadeDias) || periodicidadeDias < 1 || periodicidadeDias > 365) {
      throw new Error('A periodicidade deve ser um número inteiro de dias entre 1 e 365.');
    }
    if (faseClinica !== undefined && !faseClinica.trim()) throw new Error('A fase clínica não pode estar vazia.');
    const id_plano = crypto.randomUUID();
    const agora = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`UPDATE PlanoMonitorizacao SET estado = 'HISTORICO' WHERE id_doente = ? AND estado = 'ATIVO'`).run(idDoente);
      db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, ?, ?, ?, 'ATIVO')`).run(id_plano, idDoente, idMedico, modoPeriodicidade, periodicidadeDias, agora);
      if (faseClinica) db.prepare(`UPDATE DiagnosticoGB SET fase_clinica_atual = ? WHERE id_doente = ?`).run(faseClinica.trim(), idDoente);
      registarAuditoria(idMedico, 'PLANO_MONITORIZACAO_RF09', `Periodicidade de ${periodicidadeDias} dias`);
    });
    tx();
    return { id_plano, periodicidade_dias: periodicidadeDias };
  }

  static registarTratamento(idDoente: string, idMedico: string, dados: { tipo: string; estado: string; data_inicio: string; data_fim?: string; descricao_esquema: string }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados do tratamento inválidos.');
    const tiposValidos = ['CIRURGIA', 'QUIMIOTERAPIA', 'RADIOTERAPIA', 'OUTRO'];
    const estadosValidos = ['PLANEADO', 'EM_CURSO', 'CONCLUIDO', 'SUSPENSO'];
    if (!tiposValidos.includes(dados.tipo) || !estadosValidos.includes(dados.estado) ||
        !dataIsoValida(dados.data_inicio) || !dados.descricao_esquema?.trim() ||
        (dados.data_fim && !dataIsoValida(dados.data_fim)) ||
        (dados.data_fim && dados.data_fim < dados.data_inicio)) {
      throw new Error('Dados do tratamento inválidos. Verifique o tipo, estado, datas e descrição.');
    }
    const id_tratamento = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO Tratamento VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id_tratamento, idDoente, dados.tipo, dados.estado, dados.data_inicio, dados.data_fim || null, dados.descricao_esquema.trim());
      registarAuditoria(idMedico, 'REGISTO_TRATAMENTO_RF07', `Tratamento ${dados.tipo}`);
    });
    tx();
    return { id_tratamento, ...dados };
  }

  static registarDecisaoAcompanhamento(idDoente: string, idMedico: string, dados: { id_alerta?: string; decisao_medica: string; fundamentacao_clinica: string }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados da decisão inválidos.');
    const decisoesValidas = ['Manter seguimento previsto', 'Necessidade de avaliação adicional', 'Proposta de antecipação de consulta'];
    if (!decisoesValidas.includes(dados.decisao_medica) || !dados.fundamentacao_clinica?.trim()) {
      throw new Error('Selecione uma decisão válida e registe a fundamentação clínica.');
    }
    if (dados.id_alerta) {
      const alerta = db.prepare(`SELECT 1 FROM AlertaClinico a JOIN SubmissaoMonitorizacao s
        ON s.id_submissao = a.id_submissao WHERE a.id_alerta = ? AND s.id_doente = ?`)
        .get(dados.id_alerta, idDoente);
      if (!alerta) throw new Error('O alerta indicado não pertence a este processo clínico.');
    }
    const id_decisao = crypto.randomUUID();
    const agora = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO DecisaoAcompanhamento VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id_decisao, idDoente, idMedico, dados.id_alerta || null, agora, dados.decisao_medica, dados.fundamentacao_clinica.trim());
      if (dados.id_alerta) AlertaService.registarTriagemAlerta(dados.id_alerta, idMedico, 'Concluído', undefined, `Decisão médica: ${dados.decisao_medica}`);
      registarAuditoria(idMedico, 'DECISAO_ACOMPANHAMENTO_RF30', `Decisão "${dados.decisao_medica}"`);
    });
    tx();
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
    const avaliacoesKps = db.prepare('SELECT * FROM AvaliacaoKarnofsky WHERE id_doente = ? ORDER BY data_avaliacao ASC, rowid ASC').all(idDoente) as any[];
    const ultimoKps = avaliacoesKps.length > 0 ? avaliacoesKps[avaliacoesKps.length - 1].score_kps : 100;
    const cuidadores = db.prepare(`SELECT dc.*, u.nome, u.email, c.telefone_contacto FROM DoenteCuidador dc JOIN Cuidador c ON dc.id_cuidador = c.id_cuidador JOIN Utilizador u ON c.id_cuidador = u.id_utilizador WHERE dc.id_doente = ? AND dc.ativa = 1 AND dc.autorizacao_validada = 1`).all(idDoente);
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
      sub.total_perguntas_ativas = (db.prepare(`SELECT COUNT(*) as total FROM PerguntaFormulario
        WHERE id_formulario = ? AND ativa = 1`).get(sub.id_formulario) as { total: number }).total;
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