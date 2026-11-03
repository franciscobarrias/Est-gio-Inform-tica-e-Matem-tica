// Códigos clínicos normalizados usados no protótipo.
// A base de dados guarda o código e o ecrã mostra a designação em português.
//
// - CID-10-CM (ICD-10-CM): classificação de diagnósticos usada na codificação clínica dos hospitais do SNS.
//   Para o glioblastoma usa-se a categoria C71 (neoplasia maligna do encéfalo); o 4.º carácter indica a localização.
// - ATC (Anatomical Therapeutic Chemical, OMS): classificação das substâncias ativas (DCI).
//   O código identifica a substância, não a marca nem a apresentação comercial.
//
// Só estão aqui os códigos de que o serviço precisa neste protótipo. Para acrescentar um código,
// basta juntá-lo à lista (verificando-o na fonte oficial) e correr «npm run seed».

export const SISTEMA_CID10 = 'http://hl7.org/fhir/sid/icd-10-cm';
export const SISTEMA_ATC = 'http://www.whocc.no/atc';

export const CODIGOS_CID10: Array<[codigo: string, designacao: string]> = [
  ['C71.0', 'Neoplasia maligna do cérebro, exceto lobos e ventrículos (inclui corpo caloso)'],
  ['C71.1', 'Neoplasia maligna do lobo frontal'],
  ['C71.2', 'Neoplasia maligna do lobo temporal'],
  ['C71.3', 'Neoplasia maligna do lobo parietal'],
  ['C71.4', 'Neoplasia maligna do lobo occipital'],
  ['C71.5', 'Neoplasia maligna do ventrículo cerebral'],
  ['C71.6', 'Neoplasia maligna do cerebelo'],
  ['C71.7', 'Neoplasia maligna do tronco cerebral'],
  ['C71.8', 'Neoplasia maligna de localizações sobrepostas do encéfalo (multifocal)'],
  ['C71.9', 'Neoplasia maligna do encéfalo, não especificada']
];

export const CODIGOS_ATC: Array<[codigo: string, designacao: string]> = [
  // Antineoplásicos
  ['L01AX03', 'Temozolomida'],
  ['L01AD02', 'Lomustina'],
  ['L01AD01', 'Carmustina'],
  ['L01XB01', 'Procarbazina'],
  ['L01CA02', 'Vincristina'],
  ['L01FG01', 'Bevacizumab'],
  // Corticoide
  ['H02AB02', 'Dexametasona'],
  // Antiepiléticos e benzodiazepinas
  ['N03AX14', 'Levetiracetam'],
  ['N03AX18', 'Lacosamida'],
  ['N03AG01', 'Ácido valproico'],
  ['N03AX09', 'Lamotrigina'],
  ['N05BA09', 'Clobazam'],
  ['N05BA06', 'Lorazepam'],
  // Sintomáticos e prevenção
  ['A04AA01', 'Ondansetrom'],
  ['A03FA01', 'Metoclopramida'],
  ['A02BC02', 'Pantoprazol'],
  ['A02BC01', 'Omeprazol'],
  ['N02BE01', 'Paracetamol'],
  ['N02AA01', 'Morfina'],
  ['A06AD11', 'Lactulose'],
  ['J01EE01', 'Sulfametoxazol + trimetoprim (cotrimoxazol)'],
  ['B01AB05', 'Enoxaparina']
];
