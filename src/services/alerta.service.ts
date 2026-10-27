import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';

export class AlertaService {
  static processarRegrasNaSubmissao(idDoente: string, idSubmissao: string, idAutor: string): any[] {
    const alertasCriados: any[] = [];
    const ultimoKpsRow = db.prepare(`
      SELECT score_kps FROM AvaliacaoKarnofsky
      WHERE id_doente = ? ORDER BY data_avaliacao DESC LIMIT 1
    `).get(idDoente) as any;
    const kpsAtual = ultimoKpsRow ? ultimoKpsRow.score_kps : 100;

    const respostasAtuais = db.prepare(`
      SELECT r.*, p.categoria, p.enunciado, o.rotulo, o.valor_codificado
      FROM RespostaMonitorizacao r
      JOIN PerguntaFormulario p ON r.id_pergunta = p.id_pergunta
      LEFT JOIN OpcaoResposta o ON r.id_opcao = o.id_opcao
      WHERE r.id_submissao = ?
    `).all(idSubmissao) as any[];

    const regraSeveridade = db.prepare(`SELECT * FROM RegraAlerta WHERE tipo_regra = 'SEVERIDADE_IMEDIATA_RF23' AND ativa = 1 LIMIT 1`).get() as any;
    const itensGraves = respostasAtuais.filter(r => r.valor_numerico >= 3 || (r.categoria === 'ESCALA_NANO' && r.valor_numerico >= 2));

    if (regraSeveridade && itensGraves.length > 0) {
      const descricao = itensGraves.map(i => `${i.enunciado}: ${i.rotulo}`).join('; ');
      const prioridade = (kpsAtual <= 70 || itensGraves.some(i => i.categoria === 'ESCALA_NANO')) ? 'Crítica' : 'Alta';
      alertasCriados.push(this.inserirAlertaClinico(idSubmissao, regraSeveridade.id_regra, 'Submissão de Sintomas / NANO (RF23)', prioridade, `Agravamento agudo [${descricao}] com KPS=${kpsAtual}.`));
    }

    const submissaoAnterior = db.prepare(`
      SELECT id_submissao FROM SubmissaoMonitorizacao
      WHERE id_doente = ? AND id_submissao != ?
      ORDER BY data_hora_submissao DESC LIMIT 1
    `).get(idDoente, idSubmissao) as any;

    const regraLongitudinal = db.prepare(`SELECT * FROM RegraAlerta WHERE tipo_regra = 'AGRAVAMENTO_LONGITUDINAL_RF24' AND ativa = 1 LIMIT 1`).get() as any;

    if (submissaoAnterior && regraLongitudinal) {
      const respostasAnteriores = db.prepare(`SELECT id_pergunta, valor_numerico FROM RespostaMonitorizacao WHERE id_submissao = ?`).all(submissaoAnterior.id_submissao) as any[];
      const agravamentos = respostasAtuais.filter(atual => {
        const ant = respostasAnteriores.find(a => a.id_pergunta === atual.id_pergunta);
        return ant && atual.valor_numerico > ant.valor_numerico && atual.valor_numerico >= 2;
      });

      if (agravamentos.length > 0) {
        const resumo = agravamentos.map(a => `${a.enunciado} agravou para "${a.rotulo}"`).join('; ');
        alertasCriados.push(this.inserirAlertaClinico(idSubmissao, regraLongitudinal.id_regra, 'Comparação Longitudinal Sucessiva (RF24)', kpsAtual <= 70 ? 'Crítica' : 'Alta', `Evolução desfavorável: ${resumo}.`));
      }
    }

    if (alertasCriados.length > 0) {
      registarAuditoria(idAutor, 'GERACAO_ALERTA_RF23_RF24', `Gerados ${alertasCriados.length} alerta(s)`);
    }
    return alertasCriados;
  }

  static inserirAlertaClinico(idSubmissao: string, idRegra: string, origemGatilho: string, prioridade: 'Baixa' | 'Média' | 'Alta' | 'Crítica', resumoAgravamento: string) {
    const id_alerta = crypto.randomUUID();
    const agora = new Date().toISOString();
    db.prepare(`
      INSERT INTO AlertaClinico (id_alerta, id_submissao, id_regra, data_hora_geracao, origem_gatilho, prioridade, estado_atual, resumo_agravamento)
      VALUES (?, ?, ?, ?, ?, ?, 'Pendente', ?)
    `).run(id_alerta, idSubmissao, idRegra, agora, origemGatilho, prioridade, resumoAgravamento);
    return { id_alerta, id_submissao, id_regra, prioridade, estado_atual: 'Pendente', resumo_agravamento };
  }

  static listarAlertas() {
    return db.prepare(`
      SELECT a.*, r.nome as nome_regra, r.referencia_literatura,
             s.id_doente, d.numero_processo_clinico, u.nome as nome_doente
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
    const prioridadeFinal = novaPrioridade || alerta.prioridade;
    const agora = new Date().toISOString();
    const tipoAcao = novoEstado === 'Encaminhado' ? 'ENCAMINHAMENTO_MEDICO_RF26' : 'TRIAGEM_ENFERMAGEM';

    const tx = db.transaction(() => {
      db.prepare('UPDATE AlertaClinico SET estado_atual = ?, prioridade = ? WHERE id_alerta = ?').run(novoEstado, prioridadeFinal, idAlerta);
      db.prepare(`
        INSERT INTO HistoricoAcaoAlerta (id_acao, id_alerta, id_utilizador, data_hora_acao, tipo_acao, estado_anterior, estado_novo, nota_triagem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), idAlerta, idUtilizador, agora, tipoAcao, alerta.estado_atual, novoEstado, notaTriagem);
      registarAuditoria(idUtilizador, tipoAcao, `Alerta ${idAlerta}: ${alerta.estado_atual} -> ${novoEstado}`);
    });
    tx();
    return db.prepare('SELECT * FROM AlertaClinico WHERE id_alerta = ?').get(idAlerta);
  }
}