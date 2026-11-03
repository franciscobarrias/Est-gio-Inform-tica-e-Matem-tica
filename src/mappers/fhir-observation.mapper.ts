import { FhirResourceBuilder, FhirObservation } from './fhir-resource.builder';

export class FhirObservationMapper {
  static diagnosticoToFhir(diagnostico: any, idDoente: string): FhirObservation[] {
    const observacoes = [
      ['tumour-laterality', 'Lateralidade tumoral', diagnostico.lateralidade],
      ['idh-status', 'Estatuto IDH', diagnostico.estatuto_idh],
      ['mgmt-methylation', 'Metilação do promotor MGMT', diagnostico.metilacao_mgmt]
    ] as const;

    return observacoes.map(([code, display, value]) => FhirResourceBuilder.observation({
      id: `${diagnostico.id_diagnostico}-${code}`,
      status: 'final',
      code: {
        coding: [{
          system: 'https://chsj.min-saude.pt/fhir/CodeSystem/diagnostico-gbm',
          code,
          display
        }]
      },
      subject: { reference: `Patient/${idDoente}` },
      effectiveDateTime: diagnostico.data_diagnostico,
      valueString: value
    }));
  }

  static kpsToFhir(kps: any): FhirObservation {
    return FhirResourceBuilder.observation({
      id: kps.id_avaliacao_kps,
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '89243-0', display: 'Karnofsky Performance Status score' }] },
      subject: { reference: `Patient/${kps.id_doente}` },
      performer: [{ reference: `Practitioner/${kps.id_medico}` }],
      effectiveDateTime: kps.data_avaliacao,
      valueInteger: kps.score_kps
    });
  }

  static submissaoToFhirQuestionnaireResponse(sub: any) {
    return {
      resourceType: 'QuestionnaireResponse',
      id: sub.id_submissao,
      questionnaire: `Questionnaire/${sub.id_formulario}`,
      status: 'completed',
      subject: { reference: `Patient/${sub.id_doente}` },
      authored: sub.data_hora_submissao,
      extension: [{
        url: 'https://chsj.min-saude.pt/fhir/StructureDefinition/symptom-reference-date',
        valueDate: sub.data_referencia_sintomas
      }],
      item: sub.respostas.map((r: any) => ({
        linkId: r.codigo || r.id_pergunta,
        text: `[${r.categoria}] ${r.enunciado}`,
        // Texto livre (B20): a resposta é um valueString, não uma opção codificada.
        answer: r.tipo_resposta === 'TEXTO_LIVRE' ? [{ valueString: r.texto }] : [{
          valueCoding: {
            system: 'https://chsj.min-saude.pt/fhir/CodeSystem/resposta-gbm',
            code: r.valor_codificado,
            display: r.rotulo
          },
          ...(r.frequencia ? { extension: [{ url: 'https://chsj.min-saude.pt/fhir/StructureDefinition/symptom-frequency', valueCode: r.frequencia }] } : {})
        }]
      }))
    };
  }

  static avaliacaoAlgoritmoToFhir(avaliacao: any): FhirObservation | null {
    if (avaliacao.score === null) return null;
    const components = [
      ['coverage', 'Cobertura das respostas', avaliacao.cobertura],
      ['baseline', 'Linha de base', avaliacao.linha_de_base],
      ['baseline-mad', 'Variabilidade da linha de base (MAD)', avaliacao.variabilidade_linha_de_base],
      ['threshold', 'Limiar de agravamento', avaliacao.limiar_score]
    ].flatMap(([code, display, value]) => {
      return value === null ? [] : [{
        code: { coding: [{ system: 'https://chsj.min-saude.pt/fhir/CodeSystem/gbm-score', code, display }] },
        valueDecimal: value
      }];
    });
    return FhirResourceBuilder.observation({
      id: `score-${avaliacao.id_submissao}`,
      status: 'final',
      code: { coding: [{ system: 'https://chsj.min-saude.pt/fhir/CodeSystem/gbm-score', code: 'symptom-burden', display: 'Score de carga sintomática GBM' }] },
      subject: { reference: `Patient/${avaliacao.id_doente}` },
      effectiveDateTime: avaliacao.data_referencia_sintomas,
      valueQuantity: { value: avaliacao.score, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
      component: components,
      method: { text: `Versão de parâmetros ${avaliacao.versao_parametros}` }
    });
  }
}