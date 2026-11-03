import { MedicoService } from './medico.service';
import { FhirObservationMapper } from '../mappers/fhir-observation.mapper';
import { FhirResource, FhirResourceBuilder } from '../mappers/fhir-resource.builder';
import { db } from '../database/dados-locais';
import { ID_FORMULARIO_V2 } from '../database/formulario-v2';
import { SISTEMA_ATC } from '../database/terminologias';

const ESTADO_FHIR_MEDICACAO: Record<string, string> = { ATIVA: 'active', SUSPENSA: 'on-hold', TERMINADA: 'completed' };

export class FhirService {
  static exportarBundleFhir(idDoente: string) {
    const proc = MedicoService.obterProcessoLongitudinal(idDoente);
    const resources: FhirResource[] = [];
    resources.push(FhirResourceBuilder.patient({
      id: proc.doente.id_doente,
      numeroProcesso: proc.doente.numero_processo_clinico,
      nome: proc.doente.nome,
      dataNascimento: proc.doente.data_nascimento,
      sexo: proc.doente.sexo
    }));

    if (proc.diagnostico) {
      const d: any = proc.diagnostico;
      resources.push(FhirResourceBuilder.condition({
        id: d.id_diagnostico,
        idDoente,
        dataDiagnostico: d.data_diagnostico,
        codigoCid10: d.codigo_cid10,
        designacaoCid10: d.designacao_cid10,
        faseClinica: d.fase_clinica_atual
      }));
      resources.push(...FhirObservationMapper.diagnosticoToFhir(d, idDoente));
    }

    // Medicação com o código ATC da substância.
    for (const m of proc.medicacoes as any[]) {
      resources.push({
        resourceType: 'MedicationStatement',
        id: m.id_medicacao,
        status: ESTADO_FHIR_MEDICACAO[m.estado] || 'unknown',
        subject: { reference: `Patient/${idDoente}` },
        medicationCodeableConcept: { coding: [{ system: SISTEMA_ATC, code: m.codigo_atc, display: m.nome }], text: m.nome },
        effectivePeriod: { start: m.data_inicio, ...(m.data_fim ? { end: m.data_fim } : {}) },
        dateAsserted: m.data_hora_registo,
        ...(m.indicacao ? { reasonCode: [{ text: m.indicacao }] } : {}),
        dosage: [{ text: m.posologia ? `${m.dose}, ${m.posologia}` : m.dose }]
      });
    }

    for (const k of proc.avaliacoesKps) resources.push(FhirObservationMapper.kpsToFhir(k));
    const formularios = new Set<string>([ID_FORMULARIO_V2, ...(proc.submissoes as any[]).map(s => s.id_formulario)]);
    for (const idFormulario of formularios) {
      const formulario = db.prepare('SELECT nome, versao FROM Formulario WHERE id_formulario = ?')
        .get(idFormulario) as { nome: string; versao: number } | undefined;
      if (!formulario) throw new Error(`Questionário ${idFormulario} não encontrado.`);
      const perguntas = db.prepare(`SELECT id_pergunta, codigo, enunciado, tipo_resposta, ordem
        FROM PerguntaFormulario WHERE id_formulario = ? ORDER BY ordem ASC`)
        .all(idFormulario) as Array<{ id_pergunta: string; codigo: string | null; enunciado: string; tipo_resposta: string; ordem: number }>;
      resources.push({
          resourceType: 'Questionnaire',
          id: idFormulario,
          status: 'active',
          title: formulario.nome,
          version: String(formulario.versao),
          subjectType: ['Patient'],
          item: perguntas.map(pergunta => ({
            linkId: pergunta.codigo || pergunta.id_pergunta,
            text: pergunta.enunciado,
            type: pergunta.tipo_resposta === 'TEXTO_LIVRE' ? 'text' : 'choice',
            ...(pergunta.tipo_resposta === 'TEXTO_LIVRE' ? {} : { answerOption: db.prepare(`SELECT valor_codificado, rotulo FROM OpcaoResposta
              WHERE id_pergunta = ? ORDER BY ordem ASC`).all(pergunta.id_pergunta)
              .map((opcao: any) => ({
                valueCoding: {
                  system: 'https://chsj.min-saude.pt/fhir/CodeSystem/resposta-gbm',
                  code: opcao.valor_codificado,
                  display: opcao.rotulo
                }
              })) })
          }))
      });
    }
    for (const s of proc.submissoes as any[]) resources.push(FhirObservationMapper.submissaoToFhirQuestionnaireResponse(s));
    for (const a of proc.avaliacoesAlgoritmo as any[]) {
      const avaliacao = FhirObservationMapper.avaliacaoAlgoritmoToFhir({ ...a, id_doente: idDoente });
      if (avaliacao) resources.push(avaliacao);
    }
    for (const a of proc.alertas as any[]) {
      const nivel = a.prioridade === 'Crítica' || a.prioridade === 'Alta' ? 'high' :
        a.prioridade === 'Média' ? 'moderate' : 'low';
      const motivos = db.prepare(`SELECT DISTINCT m.id_submissao, m.ordem, m.texto, m.prioridade, m.tipo
        FROM AlertaSubmissao ls
        JOIN MotivoEvidencia m
          ON m.id_submissao = ls.id_submissao
        WHERE ls.id_alerta = ?
        ORDER BY m.id_submissao, m.ordem`)
        .all(a.id_alerta) as Array<{ id_submissao: string; texto: string; prioridade: string; tipo: string }>;
      resources.push({
          resourceType: 'DetectedIssue',
          id: a.id_alerta,
          status: 'final',
          code: { coding: [{ system: 'https://chsj.min-saude.pt/fhir/CodeSystem/alerta-gbm', code: a.tipo_regra, display: a.nome_regra }] },
          patient: { reference: `Patient/${idDoente}` },
          identifiedDateTime: a.data_hora_geracao,
          severity: nivel,
          detail: a.resumo_agravamento,
          evidence: motivos.map(motivo => ({
            code: { text: `${motivo.prioridade}: ${motivo.texto}` },
            detail: [{ reference: `QuestionnaireResponse/${motivo.id_submissao}` }]
          })),
          note: [{ text: `Estado: ${a.estado_atual}. Prioridade algorítmica: ${a.prioridade_algoritmo || a.prioridade}; prioridade atual após triagem: ${a.prioridade}.` }]
      });
    }

    return FhirResourceBuilder.collection(resources);
  }
}
