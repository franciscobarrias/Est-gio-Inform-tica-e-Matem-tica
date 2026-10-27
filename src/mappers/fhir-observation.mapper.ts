export class FhirObservationMapper {
  static kpsToFhir(kps: any) {
    return {
      resourceType: 'Observation',
      id: kps.id_avaliacao_kps,
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '89243-0', display: 'Karnofsky Performance Status score' }] },
      subject: { reference: `Patient/${kps.id_doente}` },
      performer: [{ reference: `Practitioner/${kps.id_medico}` }],
      effectiveDateTime: kps.data_avaliacao,
      valueInteger: kps.score_kps
    };
  }

  static submissaoToFhirQuestionnaireResponse(sub: any) {
    return {
      resourceType: 'QuestionnaireResponse',
      id: sub.id_submissao,
      questionnaire: `Questionnaire/${sub.id_formulario}`,
      status: 'completed',
      subject: { reference: `Patient/${sub.id_doente}` },
      authored: sub.data_hora_submissao,
      item: sub.respostas.map((r: any) => ({
        linkId: r.id_pergunta,
        text: `[${r.categoria}] ${r.enunciado}`,
        answer: [{ valueCoding: { code: r.valor_codificado, display: r.rotulo } }]
      }))
    };
  }
}