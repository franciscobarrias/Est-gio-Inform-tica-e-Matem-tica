import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { SintomaService } from './sintoma.service';
import { AlertaService } from './alerta.service';
import { AuthService } from './auth.service';

function dataIsoValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const parsed = new Date(`${data}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === data;
}

// O diagnóstico e a medicação guardam só o código; a designação em português vem dos catálogos.
const SQL_DIAGNOSTICO = `SELECT dg.*, c.designacao AS designacao_cid10
  FROM DiagnosticoGB dg JOIN CodigoCID10 c ON c.codigo = dg.codigo_cid10`;
const SQL_MEDICACAO = `SELECT m.*, atc.designacao AS nome
  FROM Medicacao m JOIN CodigoATC atc ON atc.codigo = m.codigo_atc`;

export class MedicoService {
  static atualizarDiagnostico(idDoente: string, idMedico: string, dados: {
    data_diagnostico: string;
    codigo_cid10: string;
    lateralidade: string;
    estatuto_idh: string;
    metilacao_mgmt: string;
    fase_clinica_atual: string;
  }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados do diagnóstico inválidos.');
    const camposObrigatorios = ['data_diagnostico', 'codigo_cid10', 'lateralidade', 'estatuto_idh', 'metilacao_mgmt', 'fase_clinica_atual'] as const;
    if (camposObrigatorios.some(campo => typeof dados[campo] !== 'string' || !dados[campo].trim())) {
      throw new Error('Preencha todos os campos do diagnóstico.');
    }
    if (!dataIsoValida(dados.data_diagnostico)) {
      throw new Error('A data do diagnóstico deve ter o formato AAAA-MM-DD.');
    }
    if (!db.prepare('SELECT 1 FROM CodigoCID10 WHERE codigo = ?').get(dados.codigo_cid10.trim())) {
      throw new Error('Escolha a localização a partir da lista de códigos CID-10.');
    }
    const existente = db.prepare('SELECT id_diagnostico FROM DiagnosticoGB WHERE id_doente = ?').get(idDoente) as { id_diagnostico: string } | undefined;
    const idDiagnostico = existente?.id_diagnostico || crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO DiagnosticoGB
        (id_diagnostico, id_doente, data_diagnostico, codigo_cid10, lateralidade, estatuto_idh, metilacao_mgmt, fase_clinica_atual)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id_doente) DO UPDATE SET data_diagnostico = excluded.data_diagnostico,
          codigo_cid10 = excluded.codigo_cid10, lateralidade = excluded.lateralidade,
          estatuto_idh = excluded.estatuto_idh, metilacao_mgmt = excluded.metilacao_mgmt,
          fase_clinica_atual = excluded.fase_clinica_atual`)
        .run(idDiagnostico, idDoente, dados.data_diagnostico, dados.codigo_cid10.trim(),
          dados.lateralidade.trim(), dados.estatuto_idh.trim(), dados.metilacao_mgmt.trim(), dados.fase_clinica_atual.trim());
      this.registarFaseClinica(idDoente, dados.fase_clinica_atual.trim(), new Date().toISOString().slice(0, 10));
      registarAuditoria(idMedico, 'ATUALIZACAO_DIAGNOSTICO_RF07', `Diagnóstico atualizado para o processo ${idDoente}`);
    });
    tx();
    return db.prepare(`${SQL_DIAGNOSTICO} WHERE dg.id_doente = ?`).get(idDoente);
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
      if (faseClinica) {
        const atualizado = db.prepare(`UPDATE DiagnosticoGB SET fase_clinica_atual = ? WHERE id_doente = ?`)
          .run(faseClinica.trim(), idDoente);
        if (atualizado.changes) this.registarFaseClinica(idDoente, faseClinica.trim(), new Date().toISOString().slice(0, 10));
      }
      registarAuditoria(idMedico, 'PLANO_MONITORIZACAO_RF09', `Periodicidade de ${periodicidadeDias} dias`);
    });
    tx();
    return { id_plano, periodicidade_dias: periodicidadeDias };
  }

  private static registarFaseClinica(idDoente: string, faseClinica: string, dataInicio: string): void {
    const faseAnterior = db.prepare(`SELECT fase_clinica FROM FaseClinica
      WHERE id_doente = ? AND data_inicio <= ?
      ORDER BY data_inicio DESC, rowid DESC LIMIT 1`)
      .get(idDoente, dataInicio) as { fase_clinica: string } | undefined;
    if (faseAnterior?.fase_clinica === faseClinica) return;
    db.prepare(`INSERT INTO FaseClinica (id_fase_clinica, id_doente, fase_clinica, data_inicio)
      VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), idDoente, faseClinica, dataInicio);
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

  // ---------- Novo doente (criado pelo médico, que fica como médico responsável) ----------
  // Devolve uma palavra-passe temporária, mostrada uma única vez, para o médico entregar ao doente.
  static criarDoente(idMedico: string, dados: {
    nome: string; email: string; numero_processo_clinico: string; data_nascimento: string; sexo: string; periodicidade_dias?: number;
  }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados do doente inválidos.');
    const nome = typeof dados.nome === 'string' ? dados.nome.trim().replace(/\s+/g, ' ') : '';
    const email = typeof dados.email === 'string' ? dados.email.trim().toLowerCase() : '';
    const processo = typeof dados.numero_processo_clinico === 'string' ? dados.numero_processo_clinico.trim().toUpperCase() : '';
    if (nome.length < 3 || nome.length > 120) throw new Error('Indique o nome completo do doente.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new Error('Indique um email válido.');
    if (!/^[A-Z0-9-]{3,30}$/.test(processo)) throw new Error('O n.º de processo só pode ter letras, números e hífenes (3 a 30 caracteres).');
    const hoje = new Date().toISOString().slice(0, 10);
    if (!dataIsoValida(dados.data_nascimento) || dados.data_nascimento > hoje || dados.data_nascimento < '1900-01-01') {
      throw new Error('Indique uma data de nascimento válida (AAAA-MM-DD) e não futura.');
    }
    if (!['M', 'F', 'OUTRO'].includes(dados.sexo)) throw new Error('Indique o sexo do doente.');
    const periodicidade = dados.periodicidade_dias === undefined ? 7 : Number(dados.periodicidade_dias);
    if (!Number.isInteger(periodicidade) || periodicidade < 1 || periodicidade > 365) {
      throw new Error('A periodicidade deve ser um número inteiro de dias entre 1 e 365.');
    }
    if (db.prepare('SELECT 1 FROM Utilizador WHERE lower(email) = ?').get(email)) throw new Error('Já existe uma conta com este email.');
    if (db.prepare('SELECT 1 FROM Doente WHERE numero_processo_clinico = ?').get(processo)) throw new Error('Já existe um doente com este n.º de processo.');

    const idDoente = `doente-${crypto.randomUUID()}`;
    // Palavra-passe temporária legível (sem 0/O nem 1/l), para entregar ao doente.
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const palavraPasse = Array.from(crypto.randomBytes(10), b => letras[b % letras.length]).join('');
    const agora = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO Utilizador (id_utilizador, nome, email, password_hash, perfil, estado_conta, criado_em)
        VALUES (?, ?, ?, ?, 'DOENTE', 'ATIVA', ?)`).run(idDoente, nome, email, AuthService.gerarHashPassword(palavraPasse), agora);
      db.prepare(`INSERT INTO Doente (id_doente, numero_processo_clinico, data_nascimento, sexo, id_medico_responsavel)
        VALUES (?, ?, ?, ?, ?)`).run(idDoente, processo, dados.data_nascimento, dados.sexo, idMedico);
      db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', ?, ?, 'ATIVO')`)
        .run(crypto.randomUUID(), idDoente, idMedico, periodicidade, agora);
      registarAuditoria(idMedico, 'CRIACAO_DOENTE', `Doente ${processo} criado; plano de ${periodicidade} dias`);
    });
    tx();
    return { id_doente: idDoente, nome, email, numero_processo_clinico: processo, palavra_passe_temporaria: palavraPasse };
  }

  // ---------- Medicação ----------
  static readonly VIAS_MEDICACAO = ['ORAL', 'ENDOVENOSA', 'SUBCUTANEA', 'INTRAMUSCULAR', 'OUTRA'];
  static readonly ESTADOS_MEDICACAO = ['ATIVA', 'SUSPENSA', 'TERMINADA'];

  static registarMedicacao(idDoente: string, idMedico: string, dados: {
    codigo_atc: string; dose: string; via: string; posologia?: string; indicacao?: string;
    data_inicio: string; data_fim?: string; estado?: string; observacoes?: string;
  }) {
    if (!dados || typeof dados !== 'object') throw new Error('Dados da medicação inválidos.');
    const texto = (valor: unknown, max: number) => typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= max;
    const estado = dados.estado || 'ATIVA';
    if (!texto(dados.codigo_atc, 10) || !texto(dados.dose, 60)) {
      throw new Error('Indique o medicamento e a dose.');
    }
    const substancia = db.prepare('SELECT designacao FROM CodigoATC WHERE codigo = ?').get(dados.codigo_atc.trim()) as { designacao: string } | undefined;
    if (!substancia) throw new Error('Escolha o medicamento a partir da lista de substâncias (código ATC).');
    if (!MedicoService.VIAS_MEDICACAO.includes(dados.via) || !MedicoService.ESTADOS_MEDICACAO.includes(estado)) {
      throw new Error('Via de administração ou estado da medicação inválidos.');
    }
    if (!dataIsoValida(dados.data_inicio) || (dados.data_fim && (!dataIsoValida(dados.data_fim) || dados.data_fim < dados.data_inicio))) {
      throw new Error('Datas da medicação inválidas. Use AAAA-MM-DD e uma data de fim igual ou posterior ao início.');
    }
    if ((dados.posologia && !texto(dados.posologia, 160)) || (dados.indicacao && !texto(dados.indicacao, 160)) || (dados.observacoes && !texto(dados.observacoes, 500))) {
      throw new Error('A posologia, a indicação ou as observações são demasiado longas.');
    }
    const id_medicacao = crypto.randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO Medicacao (id_medicacao, id_doente, codigo_atc, dose, via, posologia, indicacao, data_inicio, data_fim,
        estado, observacoes, id_medico_registo, data_hora_registo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id_medicacao, idDoente, dados.codigo_atc.trim(), dados.dose.trim(), dados.via, dados.posologia?.trim() || null,
        dados.indicacao?.trim() || null, dados.data_inicio, dados.data_fim || null, estado,
        dados.observacoes?.trim() || null, idMedico, new Date().toISOString());
      registarAuditoria(idMedico, 'REGISTO_MEDICACAO', `Medicação ${substancia.designacao} [ATC ${dados.codigo_atc.trim()}] (${estado})`);
    });
    tx();
    return db.prepare(`${SQL_MEDICACAO} WHERE m.id_medicacao = ?`).get(id_medicacao);
  }

  // Suspender ou terminar uma medicação (ou retomá-la). Guarda a data de fim quando deixa de estar ativa.
  static alterarEstadoMedicacao(idDoente: string, idMedicacao: string, idMedico: string, estado: string, dataFim?: string) {
    if (!MedicoService.ESTADOS_MEDICACAO.includes(estado)) throw new Error('Estado da medicação inválido.');
    const atual = db.prepare(`${SQL_MEDICACAO} WHERE m.id_medicacao = ? AND m.id_doente = ?`).get(idMedicacao, idDoente) as any;
    if (!atual) throw new Error('A medicação indicada não pertence a este processo clínico.');
    const fim = estado === 'ATIVA' ? null : (dataFim || new Date().toISOString().slice(0, 10));
    if (fim && (!dataIsoValida(fim) || fim < atual.data_inicio)) throw new Error('A data de fim tem de ser igual ou posterior ao início.');
    const tx = db.transaction(() => {
      db.prepare('UPDATE Medicacao SET estado = ?, data_fim = ? WHERE id_medicacao = ?').run(estado, fim, idMedicacao);
      registarAuditoria(idMedico, 'ALTERACAO_MEDICACAO', `Medicação ${atual.nome}: ${atual.estado} → ${estado}`);
    });
    tx();
    return db.prepare(`${SQL_MEDICACAO} WHERE m.id_medicacao = ?`).get(idMedicacao);
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

    const diagnostico = db.prepare(`${SQL_DIAGNOSTICO} WHERE dg.id_doente = ?`).get(idDoente);
    const tratamentos = db.prepare('SELECT * FROM Tratamento WHERE id_doente = ? ORDER BY data_inicio DESC').all(idDoente);
    // Ativas primeiro; dentro de cada estado, as mais recentes primeiro.
    const medicacoes = db.prepare(`SELECT m.*, atc.designacao AS nome, u.nome as nome_medico FROM Medicacao m
      JOIN CodigoATC atc ON atc.codigo = m.codigo_atc JOIN Utilizador u ON u.id_utilizador = m.id_medico_registo
      WHERE m.id_doente = ? ORDER BY CASE m.estado WHEN 'ATIVA' THEN 0 WHEN 'SUSPENSA' THEN 1 ELSE 2 END, m.data_inicio DESC`).all(idDoente);
    const avaliacoesKps = db.prepare('SELECT * FROM AvaliacaoKarnofsky WHERE id_doente = ? ORDER BY data_avaliacao ASC, rowid ASC').all(idDoente) as any[];
    const kpsMaisRecente = avaliacoesKps.length > 0 ? avaliacoesKps[avaliacoesKps.length - 1] : null;
    const hoje = new Date().toISOString().slice(0, 10);
    const ultimoKps = kpsMaisRecente &&
      kpsMaisRecente.data_avaliacao <= hoje &&
      kpsMaisRecente.data_avaliacao >= new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
      ? kpsMaisRecente.score_kps
      : null;
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
      // Só contam as perguntas principais: as de detalhe só aparecem quando a principal tem resposta.
      sub.total_perguntas_ativas = (db.prepare(`SELECT COUNT(*) as total FROM PerguntaFormulario
        WHERE id_formulario = ? AND ativa = 1 AND id_pergunta_pai IS NULL`).get(sub.id_formulario) as { total: number }).total;
      sub.respostas = db.prepare(`
        SELECT r.*, p.categoria, p.enunciado, p.codigo, p.id_pergunta_pai, p.tipo_resposta, o.rotulo, o.valor_codificado
        FROM RespostaMonitorizacao r
        JOIN PerguntaFormulario p ON r.id_pergunta = p.id_pergunta
        LEFT JOIN OpcaoResposta o ON r.id_opcao = o.id_opcao
        WHERE r.id_submissao = ?
        ORDER BY p.ordem ASC
      `).all(sub.id_submissao);
    }

    const alertas = db.prepare(`SELECT a.*, r.nome as nome_regra, r.tipo_regra FROM AlertaClinico a
      JOIN SubmissaoMonitorizacao s ON a.id_submissao = s.id_submissao
      JOIN RegraAlerta r ON a.id_regra = r.id_regra
      WHERE s.id_doente = ? ORDER BY a.data_hora_geracao DESC`).all(idDoente);
    const avaliacoesAlgoritmo = db.prepare(`SELECT a.*, s.data_referencia_sintomas FROM AvaliacaoAlgoritmo a
      JOIN SubmissaoMonitorizacao s ON s.id_submissao = a.id_submissao
      WHERE s.id_doente = ? AND a.rowid = (
        SELECT a2.rowid FROM AvaliacaoAlgoritmo a2
        WHERE a2.id_submissao = a.id_submissao
        ORDER BY a2.data_hora_avaliacao DESC LIMIT 1
      )
      ORDER BY s.data_referencia_sintomas ASC, s.data_hora_submissao ASC`).all(idDoente);
    const decisoes = db.prepare(`SELECT dec.*, u.nome as nome_medico FROM DecisaoAcompanhamento dec JOIN Utilizador u ON dec.id_medico = u.id_utilizador WHERE dec.id_doente = ? ORDER BY dec.data_hora_decisao DESC`).all(idDoente);

    return {
      doente: {
        ...doente,
        ultimo_kps: ultimoKps,
        participacao_cuidador_obrigatoria: ultimoKps !== null && ultimoKps <= 70
      },
      diagnostico, tratamentos, medicacoes, avaliacoesKps, cuidadores, planos, submissoes, alertas, decisoes,
      avaliacoesAlgoritmo, lembrete: SintomaService.calcularLembreteMonitorizacao(idDoente)
    };
  }
}