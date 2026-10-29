import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'plataforma-gbm-test-'));
process.env.DATABASE_PATH = path.join(diretorioTemporario, 'teste.db');
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-local-tests';

const { db } = require('../database/dados-locais') as typeof import('../database/dados-locais');
require('../seed');
const { AuthService } = require('../services/auth.service') as typeof import('../services/auth.service');
const { SintomaService } = require('../services/sintoma.service') as typeof import('../services/sintoma.service');
const { MedicoService } = require('../services/medico.service') as typeof import('../services/medico.service');
const { AlertaService } = require('../services/alerta.service') as typeof import('../services/alerta.service');
const { avaliarSubmissaoV2, calcularScore } = require('../services/motor-alertas-v2') as typeof import('../services/motor-alertas-v2');
const { FhirService } = require('../services/fhir.service') as typeof import('../services/fhir.service');

const idDoente = 'user-doente-001';
const idCuidador = 'user-cuidador-001';
const idMedico = 'user-medico-001';

after(() => {
  db.close();
  fs.rmSync(diretorioTemporario, { recursive: true, force: true });
});

test('guarda hashes individuais e migra credenciais antigas após autenticação', () => {
  const hashes = db.prepare('SELECT password_hash FROM Utilizador ORDER BY id_utilizador').all() as Array<{ password_hash: string }>;
  assert.ok(hashes.every(({ password_hash }) => password_hash.startsWith('scrypt$')));
  assert.equal(new Set(hashes.map(({ password_hash }) => password_hash.split('$')[1])).size, hashes.length);

  const hashAntigo = require('crypto').scryptSync('123456', 'salt_gbm_chsj', 64).toString('hex');
  db.prepare('UPDATE Utilizador SET password_hash = ? WHERE id_utilizador = ?').run(hashAntigo, idMedico);
  assert.equal(AuthService.login('medico@chsj.pt', '123456').utilizador.perfil, 'MEDICO');
  const hashMigrado = db.prepare('SELECT password_hash FROM Utilizador WHERE id_utilizador = ?').get(idMedico) as { password_hash: string };
  assert.ok(hashMigrado.password_hash.startsWith('scrypt$'));
  assert.throws(() => AuthService.login('medico@chsj.pt', 'errada'), /Credenciais inválidas/);
});

test('autoriza apenas o doente, cuidador associado e médico responsável', () => {
  const doente = { id_utilizador: idDoente, nome: 'Doente', email: 'doente@chsj.pt', perfil: 'DOENTE' as const };
  const cuidador = { ...doente, id_utilizador: idCuidador, perfil: 'CUIDADOR' as const };
  const medico = { ...doente, id_utilizador: idMedico, perfil: 'MEDICO' as const };
  assert.equal(AuthService.podeAcederDoente(doente, idDoente), true);
  assert.equal(AuthService.podeAcederDoente(doente, 'outro-doente'), false);
  assert.equal(AuthService.podeAcederDoente(cuidador, idDoente), true);
  assert.equal(AuthService.podeAcederDoente(cuidador, 'outro-doente'), false);
  assert.equal(AuthService.podeAcederDoente(medico, idDoente), true);
  assert.equal(AuthService.podeAcederDoente(medico, 'outro-doente'), false);
});

test('aceita registos parciais e distingue impossível avaliar de ausência e omissão', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'v2-b1-cefaleia');
  const naoAvaliavel = pergunta.opcoes.find((opcao: any) => opcao.valor_codificado === 'IMPOSSIVEL_AVALIAR');
  const agora = new Date().toISOString().slice(0, 10);

  assert.throws(
    () => SintomaService.submeterMonitorizacao(idDoente, idDoente, 'DOENTE', {
      id_formulario: formulario.id_formulario,
      data_referencia_sintomas: agora,
      respostas: [{ id_pergunta: pergunta.id_pergunta, id_opcao: naoAvaliavel.id_opcao }]
    }),
    /exige que o cuidador autorizado/
  );
  assert.equal(AuthService.podeAcederDoente({
    id_utilizador: idCuidador, nome: 'Cuidador', email: 'cuidador@chsj.pt', perfil: 'CUIDADOR'
  }, idDoente), true);

  const submissao = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: agora,
    respostas: [{ id_pergunta: pergunta.id_pergunta, id_opcao: naoAvaliavel.id_opcao }]
  });
  const respostas = db.prepare('SELECT id_pergunta, id_opcao, motivo_nao_avaliavel FROM RespostaMonitorizacao WHERE id_submissao = ?')
    .all(submissao.id_submissao) as Array<{ id_pergunta: string; id_opcao: string; motivo_nao_avaliavel: number }>;
  assert.equal(respostas.length, 1);
  assert.equal(respostas[0].motivo_nao_avaliavel, 1);
  assert.equal(submissao.alertasGerados.length, 0);

  const fhir = FhirService.exportarBundleFhir(idDoente);
  const respostaFhir = fhir.entry.find((entrada: any) => entrada.resource.id === submissao.id_submissao);
  assert.equal(respostaFhir.resource.status, 'in-progress');
  assert.equal(respostaFhir.resource.item.length, 1);
  assert.throws(() => SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: agora,
    respostas: [{ id_pergunta: 'pergunta-inexistente', id_opcao: naoAvaliavel.id_opcao }]
  }), /não corresponde a uma opção válida/);
});

test('regista frequência opcional sem a confundir com intensidade', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'v2-b1-cefaleia');
  const moderada = pergunta.opcoes.find((opcao: any) => opcao.valor_codificado === 'MODERADA');
  const submissao = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: new Date().toISOString().slice(0, 10),
    respostas: [{ id_pergunta: pergunta.id_pergunta, id_opcao: moderada.id_opcao, frequencia: 'DIARIA' }]
  });
  const resposta = db.prepare('SELECT valor_numerico, frequencia FROM RespostaMonitorizacao WHERE id_submissao = ?')
    .get(submissao.id_submissao) as { valor_numerico: number; frequencia: string };
  assert.deepEqual(resposta, { valor_numerico: 2, frequencia: 'DIARIA' });
  const bundle = FhirService.exportarBundleFhir(idDoente);
  const recurso = bundle.entry.find((entrada: any) => entrada.resource.id === submissao.id_submissao).resource;
  assert.equal(recurso.item[0].answer[0].extension[0].valueCode, 'DIARIA');
});

test('gera e audita alerta determinístico após resposta grave', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'v2-c1-andar');
  const grave = pergunta.opcoes.find((opcao: any) => opcao.valor_codificado === 'GRAVE');
  const submissao = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: new Date().toISOString().slice(0, 10),
    respostas: [{ id_pergunta: pergunta.id_pergunta, id_opcao: grave.id_opcao }]
  });
  assert.ok(submissao.alertasGerados.length > 0);
  const alerta = submissao.alertasGerados[0];
  AlertaService.registarTriagemAlerta(alerta.id_alerta, idMedico, 'Em análise', 'Alta', 'Avaliação registada no teste.');
  const estado = db.prepare('SELECT estado_atual, prioridade FROM AlertaClinico WHERE id_alerta = ?').get(alerta.id_alerta) as {
    estado_atual: string; prioridade: string;
  };
  assert.deepEqual(estado, { estado_atual: 'Em análise', prioridade: 'Alta' });
  const historico = db.prepare('SELECT COUNT(*) as total FROM HistoricoAcaoAlerta WHERE id_alerta = ?').get(alerta.id_alerta) as { total: number };
  assert.equal(historico.total, 1);
});

test('exige registo explícito de autorização na associação de cuidador', () => {
  assert.throws(() => MedicoService.associarCuidador(
    idDoente, 'cuidador@chsj.pt', 'Cônjuge', idMedico, false
  ), /Confirme que existe autorização/);
});

test('valida e guarda o diagnóstico do médico responsável', () => {
  assert.throws(() => MedicoService.atualizarDiagnostico(idDoente, idMedico, {
    data_diagnostico: '2026-02-31', localizacao_tumoral: 'Frontal', lateralidade: 'Direita',
    estatuto_idh: 'IDH-wildtype', metilacao_mgmt: 'Metilado', fase_clinica_atual: 'Seguimento'
  }), /formato AAAA-MM-DD/);
  const resultado = MedicoService.atualizarDiagnostico(idDoente, idMedico, {
    data_diagnostico: '2026-02-28', localizacao_tumoral: 'Frontal', lateralidade: 'Direita',
    estatuto_idh: 'IDH-wildtype', metilacao_mgmt: 'Metilado', fase_clinica_atual: 'Seguimento'
  }) as { localizacao_tumoral: string };
  assert.equal(resultado.localizacao_tumoral, 'Frontal');
});
test('gradua a prioridade dos alertas pela gravidade e pelo KPS', () => {
  const item = (id_pergunta: string, categoria: string, valor_numerico: number) => ({ id_pergunta, categoria, valor_numerico });
  assert.equal(AlertaService.calcularPrioridade([item('perg-marcha', 'ESCALA_NANO', 3)], 90).prioridade, 'Crítica');
  assert.equal(AlertaService.calcularPrioridade([item('perg-consciencia', 'ESCALA_NANO', 2)], 90).prioridade, 'Crítica');
  assert.equal(AlertaService.calcularPrioridade([item('perg-forca', 'ESCALA_NANO', 2)], 90).prioridade, 'Alta');
  assert.equal(AlertaService.calcularPrioridade([item('perg-cefaleia', 'SINTOMA_GERAL', 3)], 90).prioridade, 'Alta');
  assert.equal(AlertaService.calcularPrioridade([item('perg-cefaleia', 'SINTOMA_GERAL', 2)], 90).prioridade, 'Média');
  // KPS <= 70 sobe um nível, mas só os critérios neurológicos chegam a Crítica.
  assert.equal(AlertaService.calcularPrioridade([item('perg-cefaleia', 'SINTOMA_GERAL', 2)], 60).prioridade, 'Alta');
  assert.equal(AlertaService.calcularPrioridade([item('perg-cefaleia', 'SINTOMA_GERAL', 3)], 60).prioridade, 'Alta');
  assert.match(AlertaService.calcularPrioridade([item('perg-cefaleia', 'SINTOMA_GERAL', 2)], 60).motivo, /KPS 60/);
});

test('não permite alterar um alerta já concluído', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'v2-c2-forca');
  const grave = pergunta.opcoes.find((opcao: any) => opcao.valor_codificado === 'GRAVE');
  const { alertasGerados } = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: new Date().toISOString().slice(0, 10),
    respostas: [{ id_pergunta: pergunta.id_pergunta, id_opcao: grave.id_opcao }]
  });
  AlertaService.registarTriagemAlerta(alertasGerados[0].id_alerta, idMedico, 'Concluído', undefined, 'Resolvido.');
  assert.throws(() => AlertaService.registarTriagemAlerta(alertasGerados[0].id_alerta, idMedico, 'Em análise', undefined, 'Reabrir.'), /já está concluído/);
});

// ---------- Questionário v2 e motor de alertas por camadas ----------

type Valores = Record<string, number | [number, string]>;
const respostasV2 = (valores: Valores) => Object.fromEntries(Object.entries(valores).map(([codigo, v]) => [
  codigo,
  Array.isArray(v) ? { valor: v[0], naoAvaliavel: false, frequencia: v[1] } : { valor: v, naoAvaliavel: false }
]));
const avaliar = (valores: Valores, kps = 90, anteriores: Valores[] = []) =>
  avaliarSubmissaoV2({ respostas: respostasV2(valores), anteriores: anteriores.map(respostasV2), kps });

test('v2: o formulário ativo é o v2 e o v1 fica inativo', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  assert.equal(formulario.id_formulario, 'form-gbm-v2');
  const v1 = db.prepare("SELECT estado FROM Formulario WHERE id_formulario = 'form-gbm-v1'").get() as { estado: string } | undefined;
  if (v1) assert.equal(v1.estado, 'INATIVO');
});

test('v2: sinal de alarme dá Crítica e a instrução de ligar 112', () => {
  const r = avaliar({ A2: 1 });
  assert.equal(r.prioridade, 'Crítica');
  assert.deepEqual(r.instrucoes, ['LIGAR_112']);
  assert.deepEqual(avaliar({ A5: 1 }).instrucoes, ['CONTACTAR_JA']);
  assert.equal(avaliar({ A1: 0, A2: 0, A5: 0 }).prioridade, null);
});

test('v2: convulsão isolada com recuperação dá Alta; sem detalhes assume o pior', () => {
  const isolada = avaliar({ A1: 1, A1a: 0, A1b: 0 });
  assert.equal(isolada.prioridade, 'Alta');
  assert.deepEqual(isolada.instrucoes, ['CONTACTAR_HOJE']);
  assert.equal(avaliar({ A1: 1 }).prioridade, 'Crítica');
  assert.equal(avaliar({ A1: 1, A1a: 1, A1b: 0 }).prioridade, 'Crítica');
});

test('v2: cefaleia + vómitos + sonolência = hipertensão intracraniana provável (Crítica)', () => {
  const r = avaliar({ B1: 2, B3: 1, B4: 1 });
  assert.equal(r.prioridade, 'Crítica');
  assert.match(r.motivos[0].texto, /Hipertensão intracraniana provável/);
  // Só cefaleia e vómitos: possível (Alta).
  assert.equal(avaliar({ B1: 2, B3: 1 }).prioridade, 'Alta');
  // Cefaleia ligeira com dois detalhes de alarme: possível (Alta).
  assert.equal(avaliar({ B1: 1, B1a: 1, B1c: 1 }).prioridade, 'Alta');
});

test('v2: diarreia com 4 ou mais dejeções e quedas repetidas dão Alta', () => {
  assert.equal(avaliar({ B15: 2, B15a: 2 }).prioridade, 'Alta');
  assert.equal(avaliar({ C3: 2 }).prioridade, 'Alta');
  assert.equal(avaliar({ C3: 1 }).prioridade, null);
});

test('v2: declínio neurológico conta a subida face ao habitual do doente', () => {
  const base = [{ C1: 0 }, { C1: 0 }, { C1: 0 }];
  assert.equal(avaliar({ C1: 2 }, 90, base).prioridade, 'Alta');
  assert.equal(avaliar({ C1: 1 }, 90, base).prioridade, null);
  // Quem já andava com dificuldade (habitual 1) não dispara com 2.
  assert.equal(avaliar({ C1: 2 }, 90, [{ C1: 1 }, { C1: 1 }, { C1: 1 }]).prioridade, null);
});

test('v2: sintoma grave isolado dá Média e sobe com KPS ≤ 70 ou frequência diária', () => {
  assert.equal(avaliar({ B5: 3 }).prioridade, 'Média');
  assert.equal(avaliar({ B5: 3 }, 60).prioridade, 'Alta');
  assert.equal(avaliar({ B5: [3, 'DIARIA'] }).prioridade, 'Alta');
  // Os ajustes nunca levam a Crítica.
  assert.equal(avaliar({ B5: [3, 'CONSTANTE'] }, 60).prioridade, 'Alta');
});

test('v2: o score só gera alerta com linha de base e cobertura suficientes', () => {
  const todos = (valor: number) => Object.fromEntries(
    ['B1', 'B2', 'B5', 'B7', 'B10', 'B11', 'B12', 'B13', 'B16', 'B17', 'C1', 'C2', 'C4', 'D1', 'B6', 'B8', 'B9'].map(c => [c, valor])
  );
  const estavel = [todos(0), todos(0), todos(0)];
  const pior = { ...todos(1), B1: 2, B5: 2, B7: 2 };
  const r = avaliar(pior, 90, estavel);
  assert.ok((r.score ?? 0) >= 15);
  assert.ok(r.motivos.some(m => m.tipo === 'SCORE_EVOLUCAO_V2'));
  assert.equal(r.prioridade, 'Média');
  // Só com dois registos anteriores ainda não há linha de base.
  assert.equal(avaliar(pior, 90, estavel.slice(0, 2)).linhaDeBase, null);
  // Poucas perguntas respondidas: cobertura abaixo de 60%, sem score.
  assert.ok(calcularScore(respostasV2({ B1: 3 })).cobertura < 0.6);
});

test('v2: grava o alerta com a instrução e rejeita detalhes sem a pergunta principal', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const opcao = (idPergunta: string, codigo: string) => formulario.perguntas
    .find((p: any) => p.id_pergunta === idPergunta).opcoes.find((o: any) => o.valor_codificado === codigo).id_opcao;
  const hoje = new Date().toISOString().slice(0, 10);

  assert.throws(() => SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-b1-manha', id_opcao: opcao('v2-b1-manha', 'SIM') }]
  }));

  const { alertasGerados } = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-a2-cefaleia-subita', id_opcao: opcao('v2-a2-cefaleia-subita', 'SIM') }]
  });
  assert.equal(alertasGerados.length, 1);
  assert.equal(alertasGerados[0].prioridade, 'Crítica');
  assert.deepEqual(alertasGerados[0].instrucoes, ['LIGAR_112']);
});

// ---------- Medicação ----------

test('regista, suspende e termina medicação, validando os dados', () => {
  const hoje = new Date().toISOString().slice(0, 10);
  assert.throws(() => MedicoService.registarMedicacao(idDoente, idMedico, {
    nome: '', dose: '4 mg', via: 'ORAL', posologia: 'De manhã', data_inicio: hoje
  }), /medicamento, a dose e a posologia/);
  assert.throws(() => MedicoService.registarMedicacao(idDoente, idMedico, {
    nome: 'Dexametasona', dose: '4 mg', via: 'NASAL', posologia: 'De manhã', data_inicio: hoje
  }), /Via de administração/);
  const med = MedicoService.registarMedicacao(idDoente, idMedico, {
    nome: 'Metoclopramida', dose: '10 mg', via: 'ORAL', posologia: 'Até 3 vezes por dia', indicacao: 'Náuseas', data_inicio: hoje
  }) as { id_medicacao: string; estado: string };
  assert.equal(med.estado, 'ATIVA');
  const suspensa = MedicoService.alterarEstadoMedicacao(idDoente, med.id_medicacao, idMedico, 'SUSPENSA') as { estado: string; data_fim: string };
  assert.equal(suspensa.estado, 'SUSPENSA');
  assert.equal(suspensa.data_fim, hoje);
  const retomada = MedicoService.alterarEstadoMedicacao(idDoente, med.id_medicacao, idMedico, 'ATIVA') as { data_fim: string | null };
  assert.equal(retomada.data_fim, null);
  // Não se altera medicação de outro doente.
  assert.throws(() => MedicoService.alterarEstadoMedicacao('user-doente-002', med.id_medicacao, idMedico, 'TERMINADA'), /não pertence/);
  const processo = MedicoService.obterProcessoLongitudinal(idDoente) as any;
  assert.ok(processo.medicacoes.some((m: any) => m.id_medicacao === med.id_medicacao));
  assert.equal(processo.medicacoes[0].estado, 'ATIVA');
});
