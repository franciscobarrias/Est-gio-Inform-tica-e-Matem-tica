export interface FhirReference {
  reference: string;
}

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

export interface FhirPatient extends FhirResource {
  resourceType: 'Patient';
  id: string;
  identifier: Array<{ system: string; value: string }>;
  name: Array<{ text: string }>;
  birthDate: string;
  gender: 'male' | 'female' | 'other';
}

export interface FhirCondition extends FhirResource {
  resourceType: 'Condition';
  id: string;
  clinicalStatus: FhirCodeableConcept;
  verificationStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: FhirReference;
  recordedDate: string;
  bodySite: FhirCodeableConcept[];
  stage: Array<{ summary: FhirCodeableConcept }>;
}

export interface FhirObservation extends FhirResource {
  resourceType: 'Observation';
  status: 'registered' | 'preliminary' | 'final' | 'amended' | 'corrected' | 'cancelled' | 'entered-in-error' | 'unknown';
  code: FhirCodeableConcept;
  subject: FhirReference;
  [key: string]: unknown;
}

export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  type: 'collection';
  timestamp: string;
  entry: Array<{ resource: FhirResource }>;
}

const SYSTEM_ESTADO_CLINICO = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const SYSTEM_ESTADO_VERIFICACAO = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const ESTADOS_OBSERVATION = [
  'registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'
] as const;

function validarId(id: string, resourceType: string): void {
  if (!/^[A-Za-z0-9.-]{1,64}$/.test(id)) {
    throw new Error(`O identificador do recurso FHIR ${resourceType} é inválido.`);
  }
}

function validarReferencia(referencia: string, resourceType: string): void {
  if (!new RegExp(`^${resourceType}/[A-Za-z0-9.-]{1,64}$`).test(referencia)) {
    throw new Error(`A referência ${resourceType} do recurso FHIR é obrigatória.`);
  }
}

function validarData(data: string, campo: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) ||
      Number.isNaN(Date.parse(`${data}T00:00:00Z`)) ||
      new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) !== data) {
    throw new Error(`A data ${campo} não é válida para FHIR.`);
  }
}

export class FhirResourceBuilder {
  static patient(input: {
    id: string;
    numeroProcesso: string;
    nome: string;
    dataNascimento: string;
    sexo: 'M' | 'F' | 'OUTRO';
  }): FhirPatient {
    validarId(input.id, 'Patient');
    if (!input.numeroProcesso || !input.nome || !input.dataNascimento) {
      throw new Error('Patient FHIR requer número de processo, nome e data de nascimento.');
    }
    validarData(input.dataNascimento, 'birthDate');
    if (!['M', 'F', 'OUTRO'].includes(input.sexo)) {
      throw new Error('O sexo do Patient não tem um mapeamento FHIR válido.');
    }

    return {
      resourceType: 'Patient',
      id: input.id,
      identifier: [{ system: 'https://chsj.min-saude.pt/processo', value: input.numeroProcesso }],
      name: [{ text: input.nome }],
      birthDate: input.dataNascimento,
      gender: input.sexo === 'M' ? 'male' : input.sexo === 'F' ? 'female' : 'other'
    };
  }

  static condition(input: {
    id: string;
    idDoente: string;
    dataDiagnostico: string;
    localizacaoTumoral: string;
    faseClinica: string;
  }): FhirCondition {
    validarId(input.id, 'Condition');
    validarId(input.idDoente, 'Patient');
    if (!input.dataDiagnostico || !input.localizacaoTumoral || !input.faseClinica) {
      throw new Error('Condition FHIR requer data do diagnóstico, localização tumoral e fase clínica.');
    }
    validarData(input.dataDiagnostico, 'recordedDate');

    const condition: FhirCondition = {
      resourceType: 'Condition',
      id: input.id,
      clinicalStatus: {
        coding: [{ system: SYSTEM_ESTADO_CLINICO, code: 'active', display: 'Active' }]
      },
      verificationStatus: {
        coding: [{ system: SYSTEM_ESTADO_VERIFICACAO, code: 'confirmed', display: 'Confirmed' }]
      },
      code: {
        coding: [{ system: 'http://snomed.info/sct', code: '393563007', display: 'Glioblastoma' }],
        text: `Glioblastoma (${input.localizacaoTumoral})`
      },
      subject: { reference: `Patient/${input.idDoente}` },
      recordedDate: input.dataDiagnostico,
      bodySite: [{ text: input.localizacaoTumoral }],
      stage: [{ summary: { text: input.faseClinica } }]
    };
    validarReferencia(condition.subject.reference, 'Patient');
    return condition;
  }

  static observation(input: {
    id?: string;
    status: FhirObservation['status'];
    code: FhirCodeableConcept;
    subject: FhirReference;
    [key: string]: unknown;
  }): FhirObservation {
    if (!ESTADOS_OBSERVATION.includes(input.status)) throw new Error('Observation FHIR requer um status válido.');
    if (!input.code || (!input.code.coding?.length && !input.code.text)) {
      throw new Error('Observation FHIR requer code.');
    }
    if (!input.subject?.reference) throw new Error('Observation FHIR requer subject.');
    validarReferencia(input.subject.reference, 'Patient');
    if (input.id !== undefined) validarId(input.id, 'Observation');
    return { ...input, resourceType: 'Observation' };
  }

  static collection(resources: readonly FhirResource[], timestamp = new Date().toISOString()): FhirBundle {
    if (resources.some(resource => !resource || typeof resource.resourceType !== 'string')) {
      throw new Error('Todos os recursos do Bundle FHIR têm de indicar resourceType.');
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
        Number.isNaN(Date.parse(timestamp))) {
      throw new Error('Timestamp inválido para o Bundle FHIR.');
    }
    return {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp,
      entry: resources.map(resource => ({ resource }))
    };
  }
}
