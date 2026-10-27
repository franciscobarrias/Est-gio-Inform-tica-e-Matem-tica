import { MedicoService } from './medico.service';
import { FhirObservationMapper } from '../mappers/fhir-observation.mapper';

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
    for (const s of proc.submissoes) entries.push({ resource: FhirObservationMapper.submissaoToFhirQuestionnaireResponse(s) });

    return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), total: entries.length, entry: entries };
  }
}