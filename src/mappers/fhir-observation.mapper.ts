import { FhirResourceBuilder, FhirObservation } from './fhir-resource.builder';

interface DiagnosticoParaFhir {
  id_diagnostico: string;
  data_diagnostico: string;
  lateralidade: string;
  estatuto_idh: string;
  metilacao_mgmt: string;
}

interface AvaliacaoKpsParaFhir {
  id_avaliacao_kps: string;
  id_doente: string;
  id_medico: string;
  data_avaliacao: string;
  score_kps: number;
}

interface AvaliacaoAlgoritmoParaFhir {
  id_submissao: string;
  id_doente: string;
  data_referencia_sintomas: string;
  score: number | null;
  cobertura: number | null;
  linha_de_base: number | null;
  variabilidade_linha_de_base: number | null;
  limiar_score: number | null;
  versao_parametros: string;
}

export class FhirObservationMapper {
  static diagnosticoToFhir(diagnostico: DiagnosticoParaFhir, idDoente: string): FhirObservation[] {
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

  static kpsToFhir(kps: AvaliacaoKpsParaFhir): FhirObservation {
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

  static avaliacaoAlgoritmoToFhir(avaliacao: AvaliacaoAlgoritmoParaFhir): FhirObservation | null {
    if (avaliacao.score === null) return null;
    const components = [
      ['coverage', 'Cobertura das respostas', avaliacao.cobertura],
      ['baseline', 'Linha de base', avaliacao.linha_de_base],
      ['baseline-mad', 'Variabilidade da linha de base (MAD)', avaliacao.variabilidade_linha_de_base],
      ['threshold', 'Limiar de agravamento', avaliacao.limiar_score]
    ].flatMap(([code, display, value]) => {
      return value === null ? [] : [{
        code: { coding: [{ system: 'https://chsj.min-saude.pt/fhir/CodeSystem/gbm-score', code, display }] },
        valueQuantity: {
          value,
          unit: code === 'coverage' ? '1' : '%',
          system: 'http://unitsofmeasure.org',
          code: code === 'coverage' ? '1' : '%'
        }
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