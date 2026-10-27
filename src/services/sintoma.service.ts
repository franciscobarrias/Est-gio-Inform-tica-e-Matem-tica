import crypto from 'crypto';
import { db, registarAuditoria } from '../database/dados-locais';
import { AlertaService } from './alerta.service';

export class SintomaService {
  static obterFormularioAtivo() {
    const formulario = db.prepare(`SELECT * FROM Formulario WHERE estado = 'ATIVO' ORDER BY versao DESC LIMIT 1`).get() as any;
    if (!formulario) throw new Error('Nenhum formulário ativo configurado.');
    const perguntas = db.prepare(`SELECT * FROM PerguntaFormulario WHERE id_formulario = ? AND ativa = 1 ORDER BY ordem ASC`).all(formulario.id_formulario) as any[];
    for (const p of perguntas) {
      p.opcoes = db.prepare(`SELECT * FROM OpcaoResposta WHERE id_pergunta = ? ORDER BY ordem ASC`).all(p.id_pergunta);
    }
    return { ...formulario, perguntas };
  }

  static submeterMonitorizacao(idDoente: string, idAutor: string, perfilAutor: string, payload: { id_formulario: string; data_referencia_sintomas: string; respostas: Array<{ id_pergunta: string; id_opcao: string }> }) {
    const perguntasObrigatorias = db.prepare(`SELECT id_pergunta, enunciado FROM PerguntaFormulario WHERE id_formulario = ? AND obrigatoria = 1 AND ativa = 1`).all(payload.id_formulario) as any[];
    const camposEmFalta: string[] = [];
    if (!payload.data_referencia_sintomas) camposEmFalta.push('Data de referência dos sintomas (RF17)');
    const respostasEnviadas = payload.respostas || [];
    for (const perg of perguntasObrigatorias) {
      const resp = respostasEnviadas.find(r => r.id_pergunta === perg.id_pergunta && r.id_opcao);
      if (!resp) camposEmFalta.push(perg.enunciado);
    }
    if (camposEmFalta.length > 0) {
      const erro: any = new Error('Preenchimento incompleto (RF15).');
      erro.camposEmFalta = camposEmFalta;
      throw erro;
    }

    const planoAtivo = db.prepare(`SELECT id_plano FROM PlanoMonitorizacao WHERE id_doente = ? AND estado = 'ATIVO' ORDER BY data_definicao DESC LIMIT 1`).get(idDoente) as any;
    const id_submissao = crypto.randomUUID();
    const agora = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO SubmissaoMonitorizacao (id_submissao, id_doente, id_autor, id_formulario, id_plano, data_hora_submissao, data_referencia_sintomas, perfil_autor_no_registo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id_submissao, idDoente, idAutor, payload.id_formulario, planoAtivo ? planoAtivo.id_plano : null, agora, payload.data_referencia_sintomas, perfilAutor);

      const stmtResp = db.prepare(`
        INSERT INTO RespostaMonitorizacao (id_resposta, id_submissao, id_pergunta, id_opcao, valor_numerico, motivo_nao_avaliavel)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const r of respostasEnviadas) {
        const opcao = db.prepare('SELECT * FROM OpcaoResposta WHERE id_opcao = ?').get(r.id_opcao) as any;
        const naoAvaliavel = opcao?.valor_codificado === 'IMPOSSIVEL_AVALIAR' ? 1 : 0;
        let valorNum = 0;
        if (opcao?.valor_codificado === 'LIGEIRA' || opcao?.valor_codificado === 'ASSISTENCIA_PARCIAL') valorNum = 1;
        if (opcao?.valor_codificado === 'MODERADA') valorNum = 2;
        if (opcao?.valor_codificado === 'GRAVE' || opcao?.valor_codificado === 'ASSISTENCIA_TOTAL') valorNum = 3;
        stmtResp.run(crypto.randomUUID(), id_submissao, r.id_pergunta, r.id_opcao, valorNum, naoAvaliavel);
      }
      registarAuditoria(idAutor, 'SUBMISSAO_MONITORIZACAO', `Submissão ${id_submissao}`);
    });
    tx();

    const alertasGerados = AlertaService.processarRegrasNaSubmissao(idDoente, id_submissao, idAutor);
    return { id_submissao, data_hora_submissao: agora, alertasGerados };
  }

  static calcularLembreteMonitorizacao(idDoente: string) {
    const plano = db.prepare(`SELECT * FROM PlanoMonitorizacao WHERE id_doente = ? AND estado = 'ATIVO' ORDER BY data_definicao DESC LIMIT 1`).get(idDoente) as any;
    const periodicidade = plano ? plano.periodicidade_dias : 7;
    const ultimaSub = db.prepare(`SELECT data_hora_submissao FROM SubmissaoMonitorizacao WHERE id_doente = ? ORDER BY data_hora_submissao DESC LIMIT 1`).get(idDoente) as any;

    if (!ultimaSub) {
      return { periodicidade_dias: periodicidade, lembreteAtivo: true, mensagem: `Lembrete (RF18): Preenchimento pendente (periodicidade: a cada ${periodicidade} dias).` };
    }
    const proxData = new Date(new Date(ultimaSub.data_hora_submissao).getTime() + periodicidade * 86400000);
    const atrasado = new Date() >= proxData;
    return {
      periodicidade_dias: periodicidade,
      lembreteAtivo: atrasado,
      mensagem: atrasado ? `Lembrete Ativo (RF18): Novo registo solicitado.` : `Monitorização regularizada (RF18). Próximo até ${proxData.toLocaleDateString('pt-PT')}.`
    };
  }
}