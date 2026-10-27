import crypto from 'crypto';
import { db, inicializarBaseDados } from './database/dados-locais';
import { AuthService } from './services/auth.service';
import { SintomaService } from './services/sintoma.service';

inicializarBaseDados();
db.exec(`
  DELETE FROM RegistoAuditoria; DELETE FROM DecisaoAcompanhamento; DELETE FROM HistoricoAcaoAlerta;
  DELETE FROM AlertaClinico; DELETE FROM RegraAlerta; DELETE FROM RespostaMonitorizacao;
  DELETE FROM SubmissaoMonitorizacao; DELETE FROM OpcaoResposta; DELETE FROM PerguntaFormulario;
  DELETE FROM Formulario; DELETE FROM PlanoMonitorizacao; DELETE FROM AvaliacaoKarnofsky;
  DELETE FROM Tratamento; DELETE FROM DiagnosticoGB; DELETE FROM DoenteCuidador;
  DELETE FROM Doente; DELETE FROM Cuidador; DELETE FROM Enfermeiro; DELETE FROM Medico; DELETE FROM Utilizador;
`);

const passHash = AuthService.gerarHashPassword('123456');
const agora = new Date().toISOString();

const idMedico = 'user-medico-001';
const idEnfermeiro = 'user-enfermeiro-001';
const idDoente = 'user-doente-001';
const idCuidador = 'user-cuidador-001';

const stmtUser = db.prepare(`INSERT INTO Utilizador VALUES (?, ?, ?, ?, ?, 'ATIVA', ?)`);
stmtUser.run(idMedico, 'Dr. Paulo Linhares', 'medico@chsj.pt', passHash, 'MEDICO', agora);
stmtUser.run(idEnfermeiro, 'Enf.ª Sofia Martins', 'enfermeiro@chsj.pt', passHash, 'ENFERMEIRO', agora);
stmtUser.run(idDoente, 'António Ferreira', 'doente@chsj.pt', passHash, 'DOENTE', agora);
stmtUser.run(idCuidador, 'Maria Ferreira', 'cuidador@chsj.pt', passHash, 'CUIDADOR', agora);

db.prepare(`INSERT INTO Medico VALUES (?, 'OM-45892', 'Neurocirurgia')`).run(idMedico);
db.prepare(`INSERT INTO Enfermeiro VALUES (?, 'OE-77321', 'Neurocirurgia')`).run(idEnfermeiro);
db.prepare(`INSERT INTO Cuidador VALUES (?, '912345678')`).run(idCuidador);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-001', '1962-04-15', 'M', ?)`).run(idDoente, idMedico);

db.prepare(`INSERT INTO DoenteCuidador VALUES (?, ?, ?, 'CONJUGE', '2026-08-15', NULL, 1, 1)`).run(crypto.randomUUID(), idDoente, idCuidador);
db.prepare(`INSERT INTO DiagnosticoGB VALUES (?, ?, '2026-08-10', 'Lobo Frontal', 'Direita', 'IDH-wildtype', 'MGMT Metilado', 'Quimioterapia Adjuvante')`).run(crypto.randomUUID(), idDoente);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'CIRURGIA', 'CONCLUIDO', '2026-08-18', '2026-08-18', 'Ressecção')`).run(crypto.randomUUID(), idDoente);

const stmtKps = db.prepare(`INSERT INTO AvaliacaoKarnofsky VALUES (?, ?, ?, ?, ?)`);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-09-01', 80);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-10-01', 70);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-10-20', 60);

db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 3, ?, 'ATIVO')`).run('plano-001', idDoente, idMedico, agora);

const idForm = 'form-gbm-v1';
db.prepare(`INSERT INTO Formulario VALUES (?, 'Questionário Estruturado Longitudinal GBM', 1, 'ATIVO')`).run(idForm);

const perguntasConfig = [
  { cat: 'SINTOMA_GERAL', texto: 'Cefaleia (Dor de cabeça)' },
  { cat: 'SINTOMA_GERAL', texto: 'Astenia (Fadiga)' },
  { cat: 'ESCALA_NANO', texto: 'Marcha (Equilíbrio ao caminhar)' },
  { cat: 'AUTONOMIA_AVD', texto: 'Capacidade para Atividades da Vida Quotidiana (AVD)' }
];

const stmtPerg = db.prepare(`INSERT INTO PerguntaFormulario VALUES (?, ?, ?, ?, 'SELECAO_UNICA', 1, ?, 1)`);
const stmtOpc = db.prepare(`INSERT INTO OpcaoResposta VALUES (?, ?, ?, ?, ?)`);
const mapaPerguntas: Array<{ id_pergunta: string; opcoes: Record<string, string> }> = [];

perguntasConfig.forEach((p, idx) => {
  const idPerg = `perg-${idx + 1}`;
  stmtPerg.run(idPerg, idForm, p.cat, p.texto, idx + 1);
  const opcoes = p.cat === 'AUTONOMIA_AVD'
    ? [{ rotulo: 'Independente', cod: 'AUSENTE', ord: 1 }, { rotulo: 'Assistência Parcial', cod: 'ASSISTENCIA_PARCIAL', ord: 2 }, { rotulo: 'Assistência Total', cod: 'ASSISTENCIA_TOTAL', ord: 3 }]
    : [{ rotulo: 'Ausente', cod: 'AUSENTE', ord: 1 }, { rotulo: 'Ligeira', cod: 'LIGEIRA', ord: 2 }, { rotulo: 'Moderada', cod: 'MODERADA', ord: 3 }, { rotulo: 'Grave', cod: 'GRAVE', ord: 4 }];

  const mapOpc: Record<string, string> = {};
  opcoes.forEach(o => {
    const idOpc = crypto.randomUUID();
    stmtOpc.run(idOpc, idPerg, o.rotulo, o.cod, o.ord);
    mapOpc[o.cod] = idOpc;
  });
  mapaPerguntas.push({ id_pergunta: idPerg, opcoes: mapOpc });
});

db.prepare(`INSERT INTO RegraAlerta VALUES (?, 'Severidade Neurológica ou Sintomática', 'SEVERIDADE_IMEDIATA_RF23', 'Sintoma grave', 'Nayak', '1.0', 1, 1)`).run('regra-rf23');
db.prepare(`INSERT INTO RegraAlerta VALUES (?, 'Agravamento Clínico Longitudinal', 'AGRAVAMENTO_LONGITUDINAL_RF24', 'Evolução desfavorável', 'CHSJ', '1.0', 1, 1)`).run('regra-rf24');

const respostasSub1 = mapaPerguntas.map(mp => ({ id_pergunta: mp.id_pergunta, id_opcao: mp.opcoes['AUSENTE'] }));
SintomaService.submeterMonitorizacao(idDoente, idDoente, 'DOENTE', { id_formulario: idForm, data_referencia_sintomas: '2026-10-22', respostas: respostasSub1 });

console.log('Seed executado com sucesso!');