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

  static submeterMonitorizacao(idDoente: string, idAutor: string, perfilAutor: string, payload: {
    id_formulario: string;
    data_referencia_sintomas: string;
    respostas: Array<{ id_pergunta: string; id_opcao: string; frequencia?: string; novo_ou_pior?: boolean; texto?: string }>;
  }) {
    if (!payload || typeof payload.id_formulario !== 'string' ||
        typeof payload.data_referencia_sintomas !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.data_referencia_sintomas) ||
        Number.isNaN(Date.parse(`${payload.data_referencia_sintomas}T00:00:00Z`)) ||
        new Date(`${payload.data_referencia_sintomas}T00:00:00Z`).toISOString().slice(0, 10) !== payload.data_referencia_sintomas ||
        payload.data_referencia_sintomas > new Date().toISOString().slice(0, 10)) {
      throw new Error('Indique uma data de referência válida, não futura, no formato AAAA-MM-DD.');
    }
    if (!Array.isArray(payload.respostas)) throw new Error('A lista de respostas é inválida.');
    const formulario = db.prepare("SELECT id_formulario FROM Formulario WHERE id_formulario = ? AND estado = 'ATIVO'")
      .get(payload.id_formulario);
    if (!formulario) throw new Error('O formulário selecionado não está ativo.');

    const respostasEnviadas = payload.respostas.filter(r => r && r.id_opcao !== '');
    if (respostasEnviadas.length === 0) throw new Error('Registe pelo menos uma resposta antes de submeter.');
    const idsPergunta = new Set<string>();
    const valores = new Map<string, number>();   // id_pergunta → valor numérico escolhido
    const detalhes: Array<{ id_pergunta: string; pai: string; minimo: number }> = [];
    for (const resposta of respostasEnviadas) {
      if (typeof resposta.id_pergunta !== 'string' || typeof resposta.id_opcao !== 'string' ||
          idsPergunta.has(resposta.id_pergunta)) {
        throw new Error('As respostas contêm campos inválidos ou perguntas repetidas.');
      }
      idsPergunta.add(resposta.id_pergunta);
      const opcaoValida = db.prepare(`SELECT p.categoria, p.tipo_resposta, p.id_pergunta_pai, p.valor_minimo_pai,
          o.valor_codificado, o.valor_numerico
        FROM PerguntaFormulario p
        JOIN OpcaoResposta o ON o.id_pergunta = p.id_pergunta
        WHERE p.id_pergunta = ? AND p.id_formulario = ? AND p.ativa = 1 AND o.id_opcao = ?`)
        .get(resposta.id_pergunta, payload.id_formulario, resposta.id_opcao) as {
          categoria: string; tipo_resposta: string; id_pergunta_pai: string | null; valor_minimo_pai: number | null;
          valor_codificado: string; valor_numerico: number | null } | undefined;
      if (!opcaoValida) throw new Error('Uma resposta não corresponde a uma opção válida do formulário.');
      const valor = SintomaService.valorDaOpcao(opcaoValida);
      const presente = opcaoValida.valor_codificado !== 'IMPOSSIVEL_AVALIAR' && valor > 0;
      valores.set(resposta.id_pergunta, opcaoValida.valor_codificado === 'IMPOSSIVEL_AVALIAR' ? -1 : valor);
      if (resposta.frequencia && (!['SINTOMA_GERAL', 'SINTOMA'].includes(opcaoValida.categoria) || !presente ||
          !['PONTUAL', 'INTERMITENTE', 'DIARIA', 'CONSTANTE'].includes(resposta.frequencia))) {
        throw new Error('A frequência só pode ser indicada para um sintoma presente e com uma opção válida.');
      }
      if (resposta.novo_ou_pior !== undefined && (typeof resposta.novo_ou_pior !== 'boolean' ||
          !['SINTOMA', 'FUNCAO'].includes(opcaoValida.categoria) || !presente)) {
        throw new Error('"É novo ou está pior do que o habitual?" só se responde para um sintoma ou alteração presente.');
      }
      if (resposta.texto !== undefined && (typeof resposta.texto !== 'string' || resposta.texto.length > 300 ||
          opcaoValida.tipo_resposta !== 'SELECAO_UNICA_COM_TEXTO')) {
        throw new Error('O texto livre só é aceite na pergunta "Outro sintoma" e tem no máximo 300 caracteres.');
      }
      if (opcaoValida.id_pergunta_pai) {
        detalhes.push({ id_pergunta: resposta.id_pergunta, pai: opcaoValida.id_pergunta_pai, minimo: opcaoValida.valor_minimo_pai ?? 1 });
      }
    }
    // Uma pergunta de detalhe só é válida se a pergunta principal tiver a resposta que a faz aparecer (RNF07).
    for (const d of detalhes) {
      if ((valores.get(d.pai) ?? -1) < d.minimo) {
        throw new Error('Há uma pergunta de detalhe respondida sem a pergunta principal correspondente.');
      }
    }

    const ultimaAvaliacao = db.prepare(`SELECT score_kps FROM AvaliacaoKarnofsky
      WHERE id_doente = ? ORDER BY data_avaliacao DESC, rowid DESC LIMIT 1`).get(idDoente) as { score_kps: number } | undefined;
    if (perfilAutor === 'DOENTE' && ultimaAvaliacao && ultimaAvaliacao.score_kps <= 70) {
      throw new Error('A avaliação funcional atual exige que o cuidador autorizado preencha o formulário (KPS ≤ 70).');
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
        INSERT INTO RespostaMonitorizacao (id_resposta, id_submissao, id_pergunta, id_opcao, valor_numerico, motivo_nao_avaliavel, frequencia, novo_ou_pior, texto)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of respostasEnviadas) {
        const opcao = db.prepare('SELECT * FROM OpcaoResposta WHERE id_opcao = ?').get(r.id_opcao) as any;
        const naoAvaliavel = opcao?.valor_codificado === 'IMPOSSIVEL_AVALIAR' ? 1 : 0;
        const valorNum = naoAvaliavel ? 0 : SintomaService.valorDaOpcao(opcao);
        const texto = typeof r.texto === 'string' && r.texto.trim() ? r.texto.trim() : null;
        stmtResp.run(crypto.randomUUID(), id_submissao, r.id_pergunta, r.id_opcao, valorNum, naoAvaliavel, r.frequencia || null,
          r.novo_ou_pior === undefined ? null : (r.novo_ou_pior ? 1 : 0), texto);
      }
      registarAuditoria(idAutor, 'SUBMISSAO_MONITORIZACAO', `Submissão ${id_submissao}`);
      const alertasGerados = AlertaService.processarRegrasNaSubmissao(idDoente, id_submissao, idAutor);
      return alertasGerados;
    });
    const alertasGerados = tx();
    return { id_submissao, data_hora_submissao: agora, alertasGerados };
  }

  // Valor numérico de uma opção: o do formulário v2, ou a conversão do código nas opções do formulário antigo.
  static valorDaOpcao(opcao: { valor_codificado: string; valor_numerico?: number | null } | undefined): number {
    if (!opcao) return 0;
    if (opcao.valor_numerico !== null && opcao.valor_numerico !== undefined) return opcao.valor_numerico;
    if (['LIGEIRA', 'ASSISTENCIA_PARCIAL'].includes(opcao.valor_codificado)) return 1;
    if (opcao.valor_codificado === 'MODERADA') return 2;
    if (['GRAVE', 'ASSISTENCIA_TOTAL'].includes(opcao.valor_codificado)) return 3;
    return 0;
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