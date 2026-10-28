import crypto from 'crypto';
import { db, garantirPerguntasFormularioDemonstracao, inicializarBaseDados } from './database/dados-locais';
import { AuthService } from './services/auth.service';
import { SintomaService } from './services/sintoma.service';
import { AlertaService } from './services/alerta.service';
import { MedicoService } from './services/medico.service';

inicializarBaseDados();
db.exec(`
  DELETE FROM RegistoAuditoria; DELETE FROM DecisaoAcompanhamento; DELETE FROM HistoricoAcaoAlerta;
  DELETE FROM AlertaClinico; DELETE FROM RegraAlerta; DELETE FROM RespostaMonitorizacao;
  DELETE FROM SubmissaoMonitorizacao; DELETE FROM OpcaoResposta; DELETE FROM PerguntaFormulario;
  DELETE FROM Formulario; DELETE FROM PlanoMonitorizacao; DELETE FROM AvaliacaoKarnofsky;
  DELETE FROM Tratamento; DELETE FROM DiagnosticoGB; DELETE FROM DoenteCuidador;
  DELETE FROM Doente; DELETE FROM Cuidador; DELETE FROM Enfermeiro; DELETE FROM Medico; DELETE FROM Utilizador;
`);

const agora = new Date().toISOString();

const idMedico = 'user-medico-001';
const idEnfermeiro = 'user-enfermeiro-001';
const idDoente = 'user-doente-001';
const idCuidador = 'user-cuidador-001';
const idDoente2 = 'user-doente-002';
const idDoente3 = 'user-doente-003';
const idDoente4 = 'user-doente-004';
const idDoente5 = 'user-doente-005';
const idCuidador2 = 'user-cuidador-002';
const diasAtras = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

const stmtUser = db.prepare(`INSERT INTO Utilizador VALUES (?, ?, ?, ?, ?, 'ATIVA', ?)`);
stmtUser.run(idMedico, 'Dr. Paulo Linhares', 'medico@chsj.pt', AuthService.gerarHashPassword('123456'), 'MEDICO', agora);
stmtUser.run(idEnfermeiro, 'Enf.ª Sofia Martins', 'enfermeiro@chsj.pt', AuthService.gerarHashPassword('123456'), 'ENFERMEIRO', agora);
stmtUser.run(idDoente, 'António Ferreira', 'doente@chsj.pt', AuthService.gerarHashPassword('123456'), 'DOENTE', agora);
stmtUser.run(idCuidador, 'Maria Ferreira', 'cuidador@chsj.pt', AuthService.gerarHashPassword('123456'), 'CUIDADOR', agora);
stmtUser.run(idDoente2, 'Helena Sousa', 'doente2@chsj.pt', AuthService.gerarHashPassword('123456'), 'DOENTE', agora);
stmtUser.run(idDoente3, 'Joaquim Pereira', 'doente3@chsj.pt', AuthService.gerarHashPassword('123456'), 'DOENTE', agora);
stmtUser.run(idDoente4, 'Rosa Almeida', 'doente4@chsj.pt', AuthService.gerarHashPassword('123456'), 'DOENTE', agora);
stmtUser.run(idDoente5, 'Manuel Costa', 'doente5@chsj.pt', AuthService.gerarHashPassword('123456'), 'DOENTE', agora);
stmtUser.run(idCuidador2, 'Rui Costa', 'cuidador2@chsj.pt', AuthService.gerarHashPassword('123456'), 'CUIDADOR', agora);

db.prepare(`INSERT INTO Medico VALUES (?, 'OM-45892', 'Neurocirurgia')`).run(idMedico);
db.prepare(`INSERT INTO Enfermeiro VALUES (?, 'OE-77321', 'Neurocirurgia')`).run(idEnfermeiro);
db.prepare(`INSERT INTO Cuidador VALUES (?, '912345678')`).run(idCuidador);
db.prepare(`INSERT INTO Cuidador VALUES (?, '934567890')`).run(idCuidador2);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-001', '1962-04-15', 'M', ?)`).run(idDoente, idMedico);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-002', '1971-11-03', 'F', ?)`).run(idDoente2, idMedico);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-003', '1958-06-27', 'M', ?)`).run(idDoente3, idMedico);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-004', '1966-02-19', 'F', ?)`).run(idDoente4, idMedico);
db.prepare(`INSERT INTO Doente VALUES (?, 'CHSJ-GBM-2026-005', '1949-09-08', 'M', ?)`).run(idDoente5, idMedico);

db.prepare(`INSERT INTO DoenteCuidador VALUES (?, ?, ?, 'CONJUGE', '2026-08-15', NULL, 1, 1)`).run(crypto.randomUUID(), idDoente, idCuidador);
db.prepare(`INSERT INTO DiagnosticoGB VALUES (?, ?, '2026-08-10', 'Lobo Frontal', 'Direita', 'IDH-wildtype', 'MGMT Metilado', 'Quimioterapia Adjuvante')`).run(crypto.randomUUID(), idDoente);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'CIRURGIA', 'CONCLUIDO', '2026-08-18', '2026-08-18', 'Ressecção')`).run(crypto.randomUUID(), idDoente);
db.prepare(`INSERT INTO DiagnosticoGB VALUES (?, ?, '2026-06-02', 'Lobo Temporal', 'Esquerda', 'IDH-wildtype', 'MGMT Não metilado', 'Radioterapia')`).run(crypto.randomUUID(), idDoente2);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'CIRURGIA', 'CONCLUIDO', '2026-06-10', '2026-06-10', 'Ressecção subtotal')`).run(crypto.randomUUID(), idDoente2);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'RADIOTERAPIA', 'EM_CURSO', '2026-10-01', NULL, '60 Gy em 30 frações com temozolomida concomitante')`).run(crypto.randomUUID(), idDoente2);
db.prepare(`INSERT INTO DiagnosticoGB VALUES (?, ?, '2026-03-15', 'Lobo Parietal', 'Direita', 'IDH-wildtype', 'MGMT Metilado', 'Seguimento')`).run(crypto.randomUUID(), idDoente3);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'QUIMIOTERAPIA', 'CONCLUIDO', '2026-04-20', '2026-09-30', 'Temozolomida adjuvante, 6 ciclos')`).run(crypto.randomUUID(), idDoente3);
db.prepare(`INSERT INTO DiagnosticoGB VALUES (?, ?, '2025-11-20', 'Lobo Occipital', 'Esquerda', 'IDH-wildtype', 'MGMT Metilado', 'Seguimento')`).run(crypto.randomUUID(), idDoente4);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'CIRURGIA', 'CONCLUIDO', '2025-12-02', '2025-12-02', 'Ressecção completa')`).run(crypto.randomUUID(), idDoente4);
db.prepare(`INSERT INTO Tratamento VALUES (?, ?, 'QUIMIOTERAPIA', 'CONCLUIDO', '2026-01-15', '2026-06-30', 'Temozolomida adjuvante, 6 ciclos')`).run(crypto.randomUUID(), idDoente4);
// Manuel Costa fica, de propósito, sem diagnóstico registado (processo acabado de abrir).

const stmtKps = db.prepare(`INSERT INTO AvaliacaoKarnofsky VALUES (?, ?, ?, ?, ?)`);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-09-01', 80);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-10-01', 70);
stmtKps.run(crypto.randomUUID(), idDoente, idMedico, '2026-10-20', 60);
stmtKps.run(crypto.randomUUID(), idDoente2, idMedico, '2026-09-15', 90);
stmtKps.run(crypto.randomUUID(), idDoente3, idMedico, '2026-08-01', 90);
stmtKps.run(crypto.randomUUID(), idDoente3, idMedico, '2026-10-10', 80);
stmtKps.run(crypto.randomUUID(), idDoente4, idMedico, '2026-07-10', 90);
stmtKps.run(crypto.randomUUID(), idDoente4, idMedico, '2026-10-05', 100);
stmtKps.run(crypto.randomUUID(), idDoente5, idMedico, '2026-09-20', 80);

db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 3, ?, 'ATIVO')`).run('plano-001', idDoente, idMedico, agora);
db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 7, ?, 'ATIVO')`).run('plano-002', idDoente2, idMedico, agora);
db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 14, ?, 'ATIVO')`).run('plano-003', idDoente3, idMedico, agora);
db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 14, ?, 'ATIVO')`).run('plano-004', idDoente4, idMedico, agora);
db.prepare(`INSERT INTO PlanoMonitorizacao VALUES (?, ?, ?, 'Ad hoc', 7, ?, 'ATIVO')`).run('plano-005', idDoente5, idMedico, agora);

const idForm = 'form-gbm-v1';
db.prepare(`INSERT INTO Formulario VALUES (?, 'Questionário Estruturado Longitudinal GBM', 1, 'ATIVO')`).run(idForm);
garantirPerguntasFormularioDemonstracao();

db.prepare(`INSERT INTO RegraAlerta VALUES (?, 'Severidade Neurológica ou Sintomática', 'SEVERIDADE_IMEDIATA_RF23', 'Sintoma grave', 'Nayak', '1.0', 1, 1)`).run('regra-rf23');
db.prepare(`INSERT INTO RegraAlerta VALUES (?, 'Agravamento Clínico Longitudinal', 'AGRAVAMENTO_LONGITUDINAL_RF24', 'Evolução desfavorável', 'CHSJ', '1.0', 1, 1)`).run('regra-rf24');

// Respostas de demonstração: linha de base sem alterações e, depois, agravamentos com prioridades diferentes.
const opcoes = db.prepare(`SELECT p.id_pergunta, o.id_opcao, o.valor_codificado
  FROM PerguntaFormulario p JOIN OpcaoResposta o ON o.id_pergunta = p.id_pergunta
  WHERE p.id_formulario = ?`).all(idForm) as Array<{ id_pergunta: string; id_opcao: string; valor_codificado: string }>;
const linhaBase = opcoes.filter(o => o.valor_codificado === 'AUSENTE').map(({ id_pergunta, id_opcao }) => ({ id_pergunta, id_opcao }));
const resposta = (idPergunta: string, codigo: string) => {
  const opcao = opcoes.find(o => o.id_pergunta === idPergunta && o.valor_codificado === codigo);
  if (!opcao) throw new Error(`Opção ${codigo} inexistente para ${idPergunta}.`);
  return { id_pergunta: idPergunta, id_opcao: opcao.id_opcao };
};
const submeter = (idDoenteSub: string, idAutor: string, perfil: string, dias: number, respostas: Array<{ id_pergunta: string; id_opcao: string }>) =>
  SintomaService.submeterMonitorizacao(idDoenteSub, idAutor, perfil, { id_formulario: idForm, data_referencia_sintomas: diasAtras(dias), respostas });

// António (KPS 60): agravamento grave da marcha, reportado pela cuidadora -> prioridade Crítica.
submeter(idDoente, idCuidador, 'CUIDADOR', 6, linhaBase);
const alertasAntonio = submeter(idDoente, idCuidador, 'CUIDADOR', 0, [resposta('perg-marcha', 'GRAVE'), resposta('perg-astenia', 'MODERADA')]).alertasGerados;
AlertaService.registarTriagemAlerta(alertasAntonio[0].id_alerta, idEnfermeiro, 'Encaminhado', undefined, 'Agravamento da marcha confirmado por contacto telefónico com a cuidadora. Encaminhado ao médico responsável.');
if (alertasAntonio[1]) AlertaService.registarTriagemAlerta(alertasAntonio[1].id_alerta, idEnfermeiro, 'Concluído', undefined, 'Mesmo episódio do alerta de severidade, já encaminhado.');

// Joaquim (KPS 80): perda de força moderada -> prioridade Alta.
submeter(idDoente3, idDoente3, 'DOENTE', 10, linhaBase);
const alertasJoaquim = submeter(idDoente3, idDoente3, 'DOENTE', 1, [resposta('perg-forca', 'MODERADA'), resposta('perg-sono', 'LIGEIRA')]).alertasGerados;
AlertaService.registarTriagemAlerta(alertasJoaquim[0].id_alerta, idEnfermeiro, 'Em análise', undefined, 'A aguardar contacto com o doente.');

// Helena (KPS 90): cefaleia que passa a moderada -> prioridade Média.
submeter(idDoente2, idDoente2, 'DOENTE', 7, linhaBase);
submeter(idDoente2, idDoente2, 'DOENTE', 2, [resposta('perg-cefaleia', 'MODERADA'), resposta('perg-nauseas', 'LIGEIRA')]);

// Rosa (KPS 100): doente estável. Teve um alerta Médio, já resolvido com decisão médica; o último registo é normal.
submeter(idDoente4, idDoente4, 'DOENTE', 20, linhaBase);
const alertasRosa = submeter(idDoente4, idDoente4, 'DOENTE', 12, [resposta('perg-astenia', 'MODERADA'), resposta('perg-sono', 'LIGEIRA')]).alertasGerados;
AlertaService.registarTriagemAlerta(alertasRosa[0].id_alerta, idEnfermeiro, 'Encaminhado', undefined, 'Cansaço desde a última semana, sem outros sintomas. Encaminhado para avaliação.');
MedicoService.registarDecisaoAcompanhamento(idDoente4, idMedico, {
  id_alerta: alertasRosa[0].id_alerta,
  decisao_medica: 'Manter seguimento previsto',
  fundamentacao_clinica: 'Astenia ligeira a moderada compatível com a fase pós-tratamento. Sem sinais neurológicos; reavaliar no próximo registo.'
});
submeter(idDoente4, idDoente4, 'DOENTE', 3, linhaBase);

// Manuel (KPS 70): processo sem diagnóstico, sem cuidador associado (apesar de obrigatório) e com o registo em atraso.
const registoManuel = submeter(idDoente5, idDoente5, 'DOENTE', 12, linhaBase);
db.prepare('UPDATE SubmissaoMonitorizacao SET data_hora_submissao = ? WHERE id_submissao = ?')
  .run(new Date(Date.now() - 12 * 86400000).toISOString(), registoManuel.id_submissao);
stmtKps.run(crypto.randomUUID(), idDoente5, idMedico, diasAtras(2), 70);
// O cuidador Rui Costa (cuidador2@chsj.pt) existe mas não está associado: pode ser associado na demonstração.

console.log('Seed executado com sucesso!');