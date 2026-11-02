import { MedicoService } from './medico.service';
import { FhirObservationMapper } from '../mappers/fhir-observation.mapper';
import { db } from '../database/dados-locais';
import { ID_FORMULARIO_V2 } from '../database/formulario-v2';

export class FhirService {
  static exportarBundleFhir(idDoente: string) {
    const proc = MedicoService.obterProcessoLongitudinal(idDoente);
    const entries: any[] = [];
    entries.push({
      resource: {
        resourceType: 'Patient',
        id: proc.doente.id_doente,
        identifier: [{ system: 'https://chsj.min-saude.pt/processo', value: proc.doente.numero_processo_clinico }],
        name: [{ text: proc.doente.nome }],
        birthDate: proc.doente.data_nascimento
      }
    });

    if (proc.diagnostico) {
      const d: any = proc.diagnostico;
      entries.push({
        resource: {
          resourceType: 'Condition',
          id: d.id_diagnostico,
          subject: { reference: `Patient/${idDoente}` },
          recordedDate: d.data_diagnostico,
          code: { coding: [{ system: 'http://snomed.info/sct', code: '393563007', display: 'Glioblastoma' }], text: `GBM (${d.localizacao_tumoral})` }
        }
      });
    }

    for (const k of proc.avaliacoesKps) entries.push({ resource: FhirObservationMapper.kpsToFhir(k) });
    const formularios = new Set<string>([ID_FORMULARIO_V2, ...(proc.submissoes as any[]).map(s => s.id_formulario)]);
    for (const idFormulario of formularios) {
      const formulario = db.prepare('SELECT nome, versao FROM Formulario WHERE id_formulario = ?')
        .get(idFormulario) as { nome: string; versao: number } | undefined;
      if (!formulario) throw new Error(`Questionário ${idFormulario} não encontrado.`);
      const perguntas = db.prepare(`SELECT id_pergunta, codigo, enunciado, tipo_resposta, ordem
        FROM PerguntaFormulario WHERE id_formulario = ? ORDER BY ordem ASC`)
        .all(idFormulario) as Array<{ id_pergunta: string; codigo: string | null; enunciado: string; tipo_resposta: string; ordem: number }>;
      entries.push({
        resource: {
          resourceType: 'Questionnaire',
          id: idFormulario,
          status: 'active',
          title: formulario.nome,
          version: String(formulario.versao),
          subjectType: ['Patient'],
          item: perguntas.map(pergunta => ({
            linkId: pergunta.codigo || pergunta.id_pergunta,
            text: pergunta.enunciado,
            type: 'choice',
            answerOption: db.prepare(`SELECT valor_codificado, rotulo FROM OpcaoResposta
              WHERE id_pergunta = ? ORDER BY ordem ASC`).all(pergunta.id_pergunta)
              .map((opcao: any) => ({
                valueCoding: {
                  system: 'https://chsj.min-saude.pt/fhir/CodeSystem/resposta-gbm',
                  code: opcao.valor_codificado,
                  display: opcao.rotulo
                }
              }))
          }))
        }
      });
    }
    for (const s of proc.submissoes as any[]) entries.push({ resource: FhirObservationMapper.submissaoToFhirQuestionnaireResponse(s) });
    for (const a of proc.avaliacoesAlgoritmo as any[]) {
      const avaliacao = FhirObservationMapper.avaliacaoAlgoritmoToFhir({ ...a, id_doente: idDoente });
      if (avaliacao) entries.push({ resource: avaliacao });
    }
    for (const a of proc.alertas as any[]) {
      const nivel = a.prioridade === 'Crítica' || a.prioridade === 'Alta' ? 'high' :
        a.prioridade === 'Média' ? 'moderate' : 'low';
      entries.push({
        resource: {
          resourceType: 'DetectedIssue',
          id: a.id_alerta,
          status: 'final',
          code: { coding: [{ system: 'https://chsj.min-saude.pt/fhir/CodeSystem/alerta-gbm', code: a.tipo_regra, display: a.nome_regra }] },
          patient: { reference: `Patient/${idDoente}` },
          identifiedDateTime: a.data_hora_geracao,
          severity: nivel,
          detail: a.resumo_agravamento,
          note: [{ text: `Estado: ${a.estado_atual}. Prioridade algorítmica: ${a.prioridade_algoritmo || a.prioridade}; prioridade atual após triagem: ${a.prioridade}.` }]
        }
      });
    }

    return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), total: entries.length, entry: entries };
  }
}