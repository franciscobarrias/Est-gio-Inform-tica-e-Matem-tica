import { MedicoService } from './medico.service';
import { FhirObservationMapper } from '../mappers/fhir-observation.mapper';
import { FhirResource, FhirResourceBuilder } from '../mappers/fhir-resource.builder';

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

    for (const k of proc.avaliacoesKps) resources.push(FhirObservationMapper.kpsToFhir(k));
    for (const a of proc.avaliacoesAlgoritmo as any[]) {
      const avaliacao = FhirObservationMapper.avaliacaoAlgoritmoToFhir({ ...a, id_doente: idDoente });
      if (avaliacao) resources.push(avaliacao);
    }

    return FhirResourceBuilder.collection(resources);
  }
}
