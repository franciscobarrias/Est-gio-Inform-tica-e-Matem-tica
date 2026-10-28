import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';

export type Prioridade = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
const NIVEIS_PRIORIDADE: Prioridade[] = ['Baixa', 'Média', 'Alta', 'Crítica'];

export class AlertaService {
  static processarRegrasNaSubmissao(idDoente: string, idSubmissao: string, idAutor: string): any[] {
    const alertasCriados: any[] = [];
    const ultimoKpsRow = db.prepare(`
      SELECT score_kps FROM AvaliacaoKarnofsky
      WHERE id_doente = ? ORDER BY data_avaliacao DESC, rowid DESC LIMIT 1
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
    const itensGraves = respostasAtuais.filter(r => !r.motivo_nao_avaliavel &&
      (r.valor_numerico >= 3 || (r.categoria === 'ESCALA_NANO' && r.valor_numerico >= 2)));

    if (regraSeveridade && itensGraves.length > 0) {
      const descricao = itensGraves.map(i => `${i.enunciado}: ${i.rotulo}`).join('; ');
      const { prioridade, motivo } = this.calcularPrioridade(itensGraves, kpsAtual);
      alertasCriados.push(this.inserirAlertaClinico(idSubmissao, regraSeveridade.id_regra, 'Submissão de Sintomas / NANO (RF23)', prioridade,
        `Agravamento agudo [${descricao}] com KPS=${kpsAtual}. ${motivo}`));
    }

    const submissaoAnterior = db.prepare(`
      SELECT id_submissao, id_formulario FROM SubmissaoMonitorizacao
      WHERE id_doente = ? AND id_submissao != ?
      ORDER BY data_hora_submissao DESC LIMIT 1
    `).get(idDoente, idSubmissao) as any;

    const regraLongitudinal = db.prepare(`SELECT * FROM RegraAlerta WHERE tipo_regra = 'AGRAVAMENTO_LONGITUDINAL_RF24' AND ativa = 1 LIMIT 1`).get() as any;

    const formularioAtual = db.prepare('SELECT id_formulario FROM SubmissaoMonitorizacao WHERE id_submissao = ?').get(idSubmissao) as any;
    if (submissaoAnterior && regraLongitudinal && submissaoAnterior.id_formulario === formularioAtual.id_formulario) {
      const respostasAnteriores = db.prepare(`SELECT id_pergunta, valor_numerico, motivo_nao_avaliavel
        FROM RespostaMonitorizacao WHERE id_submissao = ?`).all(submissaoAnterior.id_submissao) as any[];
      const agravamentos = respostasAtuais.filter(atual => {
        if (atual.motivo_nao_avaliavel) return false;
        const ant = respostasAnteriores.find(a => a.id_pergunta === atual.id_pergunta);
        return ant && !ant.motivo_nao_avaliavel &&
          atual.valor_numerico > ant.valor_numerico && atual.valor_numerico >= 2;
      });

      if (agravamentos.length > 0) {
        const resumo = agravamentos.map(a => `${a.enunciado} agravou para "${a.rotulo}"`).join('; ');
        const { prioridade, motivo } = this.calcularPrioridade(agravamentos, kpsAtual);
        alertasCriados.push(this.inserirAlertaClinico(idSubmissao, regraLongitudinal.id_regra, 'Comparação Longitudinal Sucessiva (RF24)', prioridade,
          `Evolução desfavorável: ${resumo}. ${motivo}`));
      }
    }

    if (alertasCriados.length > 0) {
      registarAuditoria(idAutor, 'GERACAO_ALERTA_RF23_RF24', `Gerados ${alertasCriados.length} alerta(s)`);
    }
    return alertasCriados;
  }

  /**
   * Prioridade determinística (RF28/RNF09). Limiares demonstrativos, a validar pela equipa clínica:
   * - Crítica: alteração neurológica grave ou alteração do estado de consciência moderada/grave;
   * - Alta: alteração neurológica moderada, sintoma geral grave ou dependência total;
   * - Média: restantes agravamentos (por exemplo, sintoma geral que passa a moderado);
   * - KPS <= 70 sobe um nível, sem chegar a Crítica (reservada aos critérios neurológicos).
   */
  static calcularPrioridade(itens: Array<{ id_pergunta: string; categoria: string; valor_numerico: number }>, kpsAtual: number): { prioridade: Prioridade; motivo: string } {
    const motivos: string[] = [];
    let nivel = 1;
    const subir = (novo: number, motivo: string) => { if (novo >= nivel) { if (novo > nivel) motivos.length = 0; nivel = novo; motivos.push(motivo); } };
    for (const item of itens) {
      if (item.categoria === 'ESCALA_NANO' && (item.valor_numerico >= 3 || (item.id_pergunta === 'perg-consciencia' && item.valor_numerico >= 2))) {
        subir(3, item.id_pergunta === 'perg-consciencia' ? 'alteração do estado de consciência' : 'alteração neurológica grave');
      } else if (item.categoria === 'ESCALA_NANO' && item.valor_numerico >= 2) {
        subir(2, 'alteração neurológica moderada');
      } else if (item.categoria === 'SINTOMA_GERAL' && item.valor_numerico >= 3) {
        subir(2, 'sintoma geral grave');
      } else if (item.categoria === 'AUTONOMIA_AVD' && item.valor_numerico >= 3) {
        subir(2, 'dependência total nas atividades diárias');
      } else {
        subir(1, 'agravamento sintomático');
      }
    }
    const unicos = Array.from(new Set(motivos));
    let motivo = unicos.join(', ');
    if (kpsAtual <= 70 && nivel < 3) {
      nivel = Math.min(nivel + 1, 2);
      motivo += `; KPS ${kpsAtual} ≤ 70 (sobe um nível)`;
    }
    const prioridade = NIVEIS_PRIORIDADE[nivel];
    return { prioridade, motivo: `Prioridade ${prioridade}: ${motivo}.` };
  }

  static inserirAlertaClinico(idSubmissao: string, idRegra: string, origemGatilho: string, prioridade: Prioridade, resumoAgravamento: string) {
    const id_alerta = crypto.randomUUID();
    const agora = new Date().toISOString();
    db.prepare(`
      INSERT INTO AlertaClinico (id_alerta, id_submissao, id_regra, data_hora_geracao, origem_gatilho, prioridade, estado_atual, resumo_agravamento)
      VALUES (?, ?, ?, ?, ?, ?, 'Pendente', ?)
    `).run(id_alerta, idSubmissao, idRegra, agora, origemGatilho, prioridade, resumoAgravamento);
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
               WHERE h.id_alerta = a.id_alerta ORDER BY h.data_hora_acao DESC LIMIT 1) as autor_ultima_nota
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
        INSERT INTO HistoricoAcaoAlerta (id_acao, id_alerta, id_utilizador, data_hora_acao, tipo_acao, estado_anterior, estado_novo, nota_triagem)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), idAlerta, idUtilizador, agora, tipoAcao, alerta.estado_atual, novoEstado, notaTriagem);
      registarAuditoria(idUtilizador, tipoAcao, `Alerta ${idAlerta}: ${alerta.estado_atual} -> ${novoEstado}`);
    });
    tx();
    return db.prepare('SELECT * FROM AlertaClinico WHERE id_alerta = ?').get(idAlerta);
  }
}