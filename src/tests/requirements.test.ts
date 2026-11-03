import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const diretorioTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'plataforma-gbm-test-'));
process.env.DATABASE_PATH = path.join(diretorioTemporario, 'teste.db');
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-local-tests';

const { db } = require('../database/dados-locais') as typeof import('../database/dados-locais');
require('../seed');
const { AuthService } = require('../services/auth.service') as typeof import('../services/auth.service');
const { SintomaService } = require('../services/sintoma.service') as typeof import('../services/sintoma.service');
const { MedicoService } = require('../services/medico.service') as typeof import('../services/medico.service');
const { AlertaService } = require('../services/alerta.service') as typeof import('../services/alerta.service');
const { avaliarSubmissaoV2, calcularScore, PESOS } = require('../services/motor-alertas-v2') as typeof import('../services/motor-alertas-v2');
const { FhirService } = require('../services/fhir.service') as typeof import('../services/fhir.service');

const idDoente = 'user-doente-001';
const idCuidador = 'user-cuidador-001';
const idMedico = 'user-medico-001';

after(() => {
  db.close();
  fs.rmSync(diretorioTemporario, { recursive: true, force: true });
});

test('o esquema tem as tabelas do algoritmo, a imutabilidade e «não avaliável» como vazio', () => {
  const coluna = (db.prepare('PRAGMA table_info(RespostaMonitorizacao)').all() as Array<{
    name: string; notnull: number; dflt_value: string | null;
  }>).find(item => item.name === 'valor_numerico');
  assert.equal(coluna?.notnull, 0);
  assert.equal(coluna?.dflt_value, null);
  const chaveAvaliacao = db.prepare('PRAGMA table_info(AvaliacaoAlgoritmo)').all() as Array<{ name: string; pk: number }>;
  assert.equal(chaveAvaliacao.find(c => c.name === 'id_submissao')?.pk, 1);
  assert.equal(chaveAvaliacao.find(c => c.name === 'versao_parametros')?.pk, 2);
  const foreignKeys = db.prepare('PRAGMA foreign_key_list(AvaliacaoAlgoritmo)').all() as Array<{ on_delete: string }>;
  assert.ok(foreignKeys.every(chave => chave.on_delete === 'NO ACTION'));
  const totalTriggers = db.prepare(`SELECT COUNT(*) AS total FROM sqlite_master
    WHERE type = 'trigger' AND name LIKE 'trg_%'`).get() as { total: number };
  assert.equal(totalTriggers.total, 6);
  for (const tabela of ['MotivoEvidencia', 'InstrucaoEmitida', 'FaseClinica', 'AlertaSubmissao']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela), tabela);
  }
  // A avaliação do algoritmo não se pode apagar.
  const avaliacao = db.prepare('SELECT id_submissao FROM AvaliacaoAlgoritmo LIMIT 1').get() as { id_submissao: string } | undefined;
  if (avaliacao) assert.throws(() => db.prepare('DELETE FROM AvaliacaoAlgoritmo WHERE id_submissao = ?').run(avaliacao.id_submissao), /imutável/);
});

test('guarda hashes individuais e migra credenciais antigas após autenticação', () => {
  const hashes = db.prepare('SELECT password_hash FROM Utilizador ORDER BY id_utilizador').all() as Array<{ password_hash: string }>;
  assert.ok(hashes.every(({ password_hash }) => password_hash.startsWith('scrypt$')));
  assert.equal(new Set(hashes.map(({ password_hash }) => password_hash.split('$')[1])).size, hashes.length);

  const hashAntigo = require('crypto').scryptSync('123456', 'salt_gbm_chsj', 64).toString('hex');
  db.prepare('UPDATE Utilizador SET password_hash = ? WHERE id_utilizador = ?').run(hashAntigo, idMedico);
  assert.equal(AuthService.login('medico1@chsj.min-saude.pt', '123456').utilizador.perfil, 'MEDICO');
  assert.equal(AuthService.login('medico@chsj.pt', '123456').utilizador.perfil, 'MEDICO');
  assert.equal(AuthService.login('enfermeiro1@chsj.min-saude.pt', '123456').utilizador.perfil, 'ENFERMEIRO');
  assert.equal(AuthService.login('enfermeiro@chsj.pt', '123456').utilizador.perfil, 'ENFERMEIRO');
  const hashMigrado = db.prepare('SELECT password_hash FROM Utilizador WHERE id_utilizador = ?').get(idMedico) as { password_hash: string };
  assert.ok(hashMigrado.password_hash.startsWith('scrypt$'));
  assert.throws(() => AuthService.login('medico1@chsj.min-saude.pt', 'errada'), /Credenciais inválidas/);
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
  assert.equal(respostaFhir.resource.status, 'completed');
  assert.equal(respostaFhir.resource.item.length, 1);
  assert.equal(respostaFhir.resource.item[0].linkId, 'B1');
  assert.equal(respostaFhir.resource.item[0].answer[0].valueCoding.system,
    'https://chsj.min-saude.pt/fhir/CodeSystem/resposta-gbm');
  assert.ok(fhir.entry.some((entrada: any) => entrada.resource.resourceType === 'Questionnaire'));
  const valorPersistido = db.prepare(`SELECT valor_numerico FROM RespostaMonitorizacao
    WHERE id_submissao = ?`).get(submissao.id_submissao) as { valor_numerico: number | null };
  assert.equal(valorPersistido.valor_numerico, null);
  assert.ok(fhir.entry.some((entrada: any) => entrada.resource.resourceType === 'DetectedIssue'));
  assert.ok(fhir.entry.some((entrada: any) => entrada.resource.resourceType === 'Observation' &&
    entrada.resource.code?.coding?.[0]?.code === 'symptom-burden'));
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
  AlertaService.registarTriagemAlerta(alerta.id_alerta, idMedico, 'Em análise', 'Média', 'Avaliação registada no teste.');
  const estado = db.prepare('SELECT estado_atual, prioridade FROM AlertaClinico WHERE id_alerta = ?').get(alerta.id_alerta) as {
    estado_atual: string; prioridade: string;
  };
  assert.deepEqual(estado, { estado_atual: 'Em análise', prioridade: 'Média' });
  const historico = db.prepare(`SELECT prioridade_anterior, prioridade_nova
    FROM HistoricoAcaoAlerta WHERE id_alerta = ? ORDER BY data_hora_acao DESC LIMIT 1`).get(alerta.id_alerta) as {
      prioridade_anterior: string; prioridade_nova: string;
    };
  assert.deepEqual(historico, { prioridade_anterior: 'Alta', prioridade_nova: 'Média' });
  const decisaoOriginal = db.prepare('SELECT prioridade_algoritmo FROM AlertaClinico WHERE id_alerta = ?')
    .get(alerta.id_alerta) as { prioridade_algoritmo: string };
  assert.equal(decisaoOriginal.prioridade_algoritmo, alerta.prioridade);
});

test('exige registo explícito de autorização na associação de cuidador', () => {
  assert.throws(() => MedicoService.associarCuidador(
    idDoente, 'cuidador@chsj.pt', 'Cônjuge', idMedico, false
  ), /Confirme que existe autorização/);
});

test('valida e guarda o diagnóstico do médico responsável', () => {
  assert.throws(() => MedicoService.atualizarDiagnostico(idDoente, idMedico, {
    data_diagnostico: '2026-02-31', codigo_cid10: 'C71.1', lateralidade: 'Direita',
    estatuto_idh: 'IDH-wildtype', metilacao_mgmt: 'Metilado', fase_clinica_atual: 'Seguimento'
  }), /formato AAAA-MM-DD/);
  const resultado = MedicoService.atualizarDiagnostico(idDoente, idMedico, {
    data_diagnostico: '2026-02-28', codigo_cid10: 'C71.1', lateralidade: 'Direita',
    estatuto_idh: 'IDH-wildtype', metilacao_mgmt: 'Metilado', fase_clinica_atual: 'Seguimento'
  }) as { codigo_cid10: string; designacao_cid10: string };
  assert.equal(resultado.codigo_cid10, 'C71.1');
  assert.equal(resultado.designacao_cid10, 'Neoplasia maligna do lobo frontal');
  // Só se aceitam códigos que existem no catálogo CID-10.
  assert.throws(() => MedicoService.atualizarDiagnostico(idDoente, idMedico, {
    data_diagnostico: '2026-02-28', codigo_cid10: 'Lobo frontal', lateralidade: 'Direita',
    estatuto_idh: 'IDH-wildtype', metilacao_mgmt: 'Metilado', fase_clinica_atual: 'Seguimento'
  }), /lista de códigos CID-10/);
});
test('não permite alterar um alerta já concluído', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'v2-c2-forca');
  const grave = pergunta.opcoes.find((opcao: any) => opcao.valor_codificado === 'GRAVE');
  const { id_submissao, alertasGerados } = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
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
const avaliar = (valores: Valores, kps: number | null = 90, anteriores: Valores[] = []) =>
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
  // Perna inchada (A7) e sangramento (A8): contactar hoje → Alta, coerente com a instrução.
  assert.equal(avaliar({ A7: 1 }).prioridade, 'Alta');
  assert.deepEqual(avaliar({ A8: 1 }).instrucoes, ['CONTACTAR_HOJE']);
  assert.equal(avaliar({ A8: 1 }).prioridade, 'Alta');
  assert.equal(avaliar({ A1: 0, A2: 0, A5: 0 }).prioridade, null);
});

test('v2: convulsão isolada com recuperação dá Alta; sem detalhes assume o pior', () => {
  // A1a: durou 5 min ou mais; A1b: mais do que uma; A1c: não recuperou.
  const isolada = avaliar({ A1: 1, A1a: 0, A1b: 0, A1c: 0 });
  assert.equal(isolada.prioridade, 'Alta');
  assert.deepEqual(isolada.instrucoes, ['CONTACTAR_HOJE']);
  assert.deepEqual(avaliar({ A1: 1 }).instrucoes, ['LIGAR_112']);
  assert.deepEqual(avaliar({ A1: 1, A1a: 1, A1b: 0, A1c: 0 }).instrucoes, ['LIGAR_112']);
  assert.deepEqual(avaliar({ A1: 1, A1a: 0, A1b: 1, A1c: 1 }).instrucoes, ['LIGAR_112']);
  // Uma só convulsão curta mas sem recuperação: 112.
  assert.deepEqual(avaliar({ A1: 1, A1a: 0, A1b: 0, A1c: 1 }).instrucoes, ['LIGAR_112']);
  // Várias curtas com recuperação: contactar já (a validar com o médico).
  const varias = avaliar({ A1: 1, A1a: 0, A1b: 1, A1c: 0 });
  assert.equal(varias.prioridade, 'Crítica');
  assert.deepEqual(varias.instrucoes, ['CONTACTAR_JA']);
});

test('v2: confusão grave (B19 = 3) já não é sinal de alarme, conta como sintoma isolado', () => {
  assert.equal(avaliar({ B19: 3 }).prioridade, 'Média');
  assert.equal(avaliar({ B4: 3 }).prioridade, 'Crítica');
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
  const completa = (c1: number) => ({ ...Object.fromEntries(Object.keys(PESOS).map(codigo => [codigo, 0])), C1: c1 });
  const base = [completa(0), completa(0), completa(0)];
  assert.equal(avaliar({ C1: 2 }, 90, base).prioridade, 'Alta');
  assert.equal(avaliar({ C1: 1 }, 90, base).prioridade, null);
  // Quem já andava com dificuldade (habitual 1) não dispara com 2.
  assert.equal(avaliar({ C1: 2 }, 90, [completa(1), completa(1), completa(1)]).prioridade, null);
  // Registos incompletos não constituem uma linha de base comparável.
  assert.equal(avaliar({ C1: 2 }, 90, [{ C1: 0 }, { C1: 0 }, { C1: 0 }]).prioridade, null);
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
    Object.keys(PESOS).map(c => [c, valor])
  );
  const estavel = [todos(0), todos(0), todos(0)];
  const pior = { ...todos(0), D1: 2, C4: 2, B7: 2 };
  const r = avaliar(pior, 90, estavel);
  assert.ok((r.score ?? 0) >= 10);
  assert.ok(r.motivos.some(m => m.tipo === 'SCORE_EVOLUCAO_V2'));
  assert.equal(r.prioridade, 'Média');
  assert.ok(Math.abs((r.score ?? 0) - 11.9) < 0.1);  // 16 / 135 (sem o B20, que é texto livre)
  // Só com dois registos anteriores ainda não há linha de base.
  assert.equal(avaliar(pior, 90, estavel.slice(0, 2)).linhaDeBase, null);
  // Poucas perguntas respondidas: cobertura abaixo de 60%, sem score.
  assert.ok(calcularScore(respostasV2({ B1: 3 })).cobertura < 0.6);
});

test('v2: exclui bases parciais antes de selecionar três registos elegíveis', () => {
  const todos = Object.fromEntries(Object.keys(PESOS).map(c => [c, 0]));
  const parcial = respostasV2({ B1: 0 });
  const completos = [respostasV2(todos), respostasV2(todos), respostasV2(todos)];
  const agravado = { ...todos, D1: 2, C4: 2, B7: 2 };
  const resultado = avaliarSubmissaoV2({
    respostas: respostasV2(agravado),
    anteriores: [parcial, ...completos],
    kps: null
  });
  assert.equal(resultado.linhaDeBase, 0);
  assert.ok((resultado.limiarScore ?? Infinity) <= 10);
  assert.ok(resultado.motivos.some(m => m.tipo === 'SCORE_EVOLUCAO_V2'));
  assert.equal(resultado.prioridade, 'Média');
});

test('v2: o limiar aumenta com o nível e a variabilidade da linha de base', () => {
  const todas = (valor: number) => respostasV2(Object.fromEntries(
    Object.keys(PESOS).map(codigo => [codigo, codigo === 'C3' ? Math.min(valor, 2) : valor])
  ));
  const baixo = avaliarSubmissaoV2({ respostas: todas(0), anteriores: [todas(0), todas(0), todas(0)], kps: null });
  const alto = avaliarSubmissaoV2({ respostas: todas(3), anteriores: [todas(3), todas(3), todas(3)], kps: null });
  const variavel = avaliarSubmissaoV2({ respostas: todas(1), anteriores: [todas(0), todas(1), todas(3)], kps: null });
  assert.equal(baixo.limiarScore, 5);
  assert.equal(alto.limiarScore, 10);
  assert.ok(alto.limiarScore !== null && variavel.limiarScore !== null && variavel.limiarScore > alto.limiarScore);
});

test('v2: respostas cognitivas não avaliáveis são sinalizadas e KPS ausente não equivale a 100 nem a 0', () => {
  const naoAvaliavel = (codigo: string) => [codigo, { valor: 0, naoAvaliavel: true }] as const;
  const resultado = avaliarSubmissaoV2({
    respostas: Object.fromEntries([naoAvaliavel('B7'), naoAvaliavel('B8')]),
    anteriores: [],
    kps: null
  });
  assert.equal(resultado.prioridade, 'Média');
  assert.equal(resultado.tipo, 'DADOS_INSUFICIENTES_V2');
  assert.deepEqual(resultado.dadosNaoAvaliaveis, ['B7', 'B8']);
  assert.equal(avaliar({ B5: 3 }, null).prioridade, 'Média');
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

  const { id_submissao, alertasGerados } = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-a2-cefaleia-subita', id_opcao: opcao('v2-a2-cefaleia-subita', 'SIM') }]
  });
  assert.equal(alertasGerados.length, 1);
  assert.equal(alertasGerados[0].prioridade, 'Crítica');
  assert.deepEqual(alertasGerados[0].instrucoes, ['LIGAR_112']);
  const avaliacaoPersistida = db.prepare(`SELECT score, cobertura, linha_de_base, versao_parametros,
    prioridade_algoritmo, motivos_json
    FROM AvaliacaoAlgoritmo WHERE id_submissao = ? AND versao_parametros = '4.0'`).get(id_submissao) as {
      score: number | null; cobertura: number; linha_de_base: number | null;
      versao_parametros: string; prioridade_algoritmo: string; motivos_json: string;
    };
  assert.equal(avaliacaoPersistida.versao_parametros, '4.0');
  assert.equal(avaliacaoPersistida.prioridade_algoritmo, 'Crítica');
  assert.match(JSON.parse(avaliacaoPersistida.motivos_json)[0].texto, /Dor de cabeça súbita/);
  assert.throws(() => db.prepare(`UPDATE AvaliacaoAlgoritmo SET score = score
    WHERE id_submissao = ? AND versao_parametros = '4.0'`).run(id_submissao), /imutável/);
  assert.throws(() => db.prepare(`UPDATE MotivoEvidencia SET texto = texto
    WHERE id_submissao = ? AND versao_parametros = '4.0'`).run(id_submissao), /imutável/);
  assert.throws(() => db.prepare(`UPDATE InstrucaoEmitida SET codigo = codigo
    WHERE id_submissao = ? AND versao_parametros = '4.0'`).run(id_submissao), /imutável/);

  const submissaoRepetida = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-a2-cefaleia-subita', id_opcao: opcao('v2-a2-cefaleia-subita', 'SIM') }]
  });
  assert.equal(submissaoRepetida.alertasGerados[0].id_alerta, alertasGerados[0].id_alerta);
  assert.equal(submissaoRepetida.alertasGerados[0].duplicado, true);
  const ligacoes = db.prepare(`SELECT COUNT(*) AS total FROM AlertaSubmissao WHERE id_alerta = ?`)
    .get(alertasGerados[0].id_alerta) as { total: number };
  assert.ok(ligacoes.total >= 2);
  const motivoNovo = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario,
    data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-a3-sonolencia-subita', id_opcao: opcao('v2-a3-sonolencia-subita', 'SIM') }]
  }).alertasGerados[0];
  assert.notEqual(motivoNovo.id_alerta, alertasGerados[0].id_alerta);
  assert.equal(motivoNovo.id_alerta_anterior, alertasGerados[0].id_alerta);
  assert.equal(motivoNovo.tipo_associacao, 'MOTIVO_NOVO');
  const associacao = db.prepare(`SELECT tipo_associacao FROM AlertaSubmissao
    WHERE id_alerta = ? AND id_submissao = ?`).get(motivoNovo.id_alerta, motivoNovo.id_submissao) as {
      tipo_associacao: string;
    };
  assert.equal(associacao.tipo_associacao, 'MOTIVO_NOVO');
  const alertaListado = AlertaService.listarAlertas().find((alerta: any) => alerta.id_alerta === motivoNovo.id_alerta);
  assert.ok(alertaListado && alertaListado.submissoes_associadas.length >= 1);

  const bundle = FhirService.exportarBundleFhir(idDoente);
  assert.ok(bundle.entry.some((entrada: any) => entrada.resource.resourceType === 'Questionnaire' &&
    entrada.resource.id === formulario.id_formulario));
  assert.ok(bundle.entry.some((entrada: any) => entrada.resource.resourceType === 'DetectedIssue'));
  const detectedIssue = bundle.entry.find((entrada: any) => entrada.resource.resourceType === 'DetectedIssue')?.resource;
  assert.ok(detectedIssue.evidence.length > 0);
});

test('uma falha do motor não reverte a submissão e fica registada como avaliação com erro', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const opcao = formulario.perguntas.find((p: any) => p.id_pergunta === 'v2-a2-cefaleia-subita')
    .opcoes.find((o: any) => o.valor_codificado === 'SIM').id_opcao;
  db.prepare(`UPDATE RegraAlerta SET ativa = 0 WHERE id_regra = 'regra-v2-alarme'`).run();
  try {
    const resultado = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
      id_formulario: formulario.id_formulario,
      data_referencia_sintomas: new Date().toISOString().slice(0, 10),
      respostas: [{ id_pergunta: 'v2-a2-cefaleia-subita', id_opcao: opcao }]
    });
    assert.ok(db.prepare('SELECT 1 FROM SubmissaoMonitorizacao WHERE id_submissao = ?').get(resultado.id_submissao));
    assert.match(resultado.erroAvaliacao || '', /não está configurada ou ativa/);
    const avaliacao = db.prepare(`SELECT estado, erro FROM AvaliacaoAlgoritmo
      WHERE id_submissao = ? AND versao_parametros = '4.0'`).get(resultado.id_submissao) as {
        estado: string; erro: string;
      };
    assert.equal(avaliacao.estado, 'ERRO');
    assert.match(avaliacao.erro, /não está configurada ou ativa/);
  } finally {
    db.prepare(`UPDATE RegraAlerta SET ativa = 1 WHERE id_regra = 'regra-v2-alarme'`).run();
  }
});

// ---------- Medicação ----------

test('regista, suspende e termina medicação, validando os dados', () => {
  const hoje = new Date().toISOString().slice(0, 10);
  assert.throws(() => MedicoService.registarMedicacao(idDoente, idMedico, {
    codigo_atc: '', dose: '4 mg', via: 'ORAL', posologia: 'De manhã', data_inicio: hoje
  }), /medicamento e a dose/);
  assert.throws(() => MedicoService.registarMedicacao(idDoente, idMedico, {
    codigo_atc: 'XPTO', dose: '4 mg', via: 'ORAL', posologia: 'De manhã', data_inicio: hoje
  }), /código ATC/);
  // A posologia, a indicação e as observações são opcionais.
  const semPosologia = MedicoService.registarMedicacao(idDoente, idMedico, {
    codigo_atc: 'N02BE01', dose: '1 g', via: 'ORAL', data_inicio: hoje
  }) as { posologia: string | null; nome: string };
  assert.equal(semPosologia.posologia, null);
  assert.equal(semPosologia.nome, 'Paracetamol');
  assert.throws(() => MedicoService.registarMedicacao(idDoente, idMedico, {
    codigo_atc: 'H02AB02', dose: '4 mg', via: 'NASAL', posologia: 'De manhã', data_inicio: hoje
  }), /Via de administração/);
  const med = MedicoService.registarMedicacao(idDoente, idMedico, {
    codigo_atc: 'A03FA01', dose: '10 mg', via: 'ORAL', posologia: 'Até 3 vezes por dia', indicacao: 'Náuseas', data_inicio: hoje
  }) as { id_medicacao: string; estado: string; codigo_atc: string; nome: string };
  assert.equal(med.estado, 'ATIVA');
  assert.equal(med.codigo_atc, 'A03FA01');
  assert.equal(med.nome, 'Metoclopramida');
  const suspensa = MedicoService.alterarEstadoMedicacao(idDoente, med.id_medicacao, idMedico, 'SUSPENSA') as { estado: string; data_fim: string };
  assert.equal(suspensa.estado, 'SUSPENSA');
  assert.equal(suspensa.data_fim, hoje);
  const retomada = MedicoService.alterarEstadoMedicacao(idDoente, med.id_medicacao, idMedico, 'ATIVA') as { data_fim: string | null };
  assert.equal(retomada.data_fim, null);
  // Não se altera medicação de outro doente.
  assert.throws(() => MedicoService.alterarEstadoMedicacao('user-doente-002', med.id_medicacao, idMedico, 'TERMINADA'), /não pertence/);
  const processo = MedicoService.obterProcessoLongitudinal(idDoente) as any;
  assert.ok(processo.medicacoes.some((m: any) => m.id_medicacao === med.id_medicacao));
  // Na exportação FHIR a medicação sai com o código ATC e o diagnóstico com o código CID-10.
  const fhir = FhirService.exportarBundleFhir(idDoente);
  const declaracao = fhir.entry.find((e: any) => e.resource.id === med.id_medicacao).resource;
  assert.equal(declaracao.resourceType, 'MedicationStatement');
  assert.deepEqual(declaracao.medicationCodeableConcept.coding[0], { system: 'http://www.whocc.no/atc', code: 'A03FA01', display: 'Metoclopramida' });
  const condicao = fhir.entry.find((e: any) => e.resource.resourceType === 'Condition');
  if (condicao) assert.ok(condicao.resource.code.coding.some((c: any) => c.system === 'http://hl7.org/fhir/sid/icd-10-cm'));
  assert.equal(processo.medicacoes[0].estado, 'ATIVA');
});

test('v2: a mensagem livre (B20) é guardada como texto e não conta para o score nem para os alertas', () => {
  const formulario = SintomaService.obterFormularioAtivo();
  const b20 = formulario.perguntas.find((p: any) => p.codigo === 'B20');
  assert.equal(b20.tipo_resposta, 'TEXTO_LIVRE');
  assert.equal(b20.opcoes.length, 0);
  const hoje = new Date().toISOString().slice(0, 10);
  const { id_submissao, alertasGerados } = SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario, data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: b20.id_pergunta, texto: '  Tem tido soluços.  ' }]
  });
  const r = db.prepare('SELECT id_opcao, valor_numerico, texto FROM RespostaMonitorizacao WHERE id_submissao = ?').get(id_submissao) as any;
  assert.deepEqual({ ...r }, { id_opcao: null, valor_numerico: null, texto: 'Tem tido soluços.' });
  assert.equal(alertasGerados.length, 0);
  assert.equal(calcularScore({ B20: { valor: 3, naoAvaliavel: false } }).score, null);
  assert.throws(() => SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario, data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: b20.id_pergunta, texto: 'x'.repeat(501) }]
  }), /500 caracteres/);
  assert.throws(() => SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario, data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: b20.id_pergunta, texto: 'Soluços', frequencia: 'DIARIA' }]
  }), /não leva frequência/);
  // Uma pergunta com escala continua a precisar de uma opção.
  assert.throws(() => SintomaService.submeterMonitorizacao(idDoente, idCuidador, 'CUIDADOR', {
    id_formulario: formulario.id_formulario, data_referencia_sintomas: hoje,
    respostas: [{ id_pergunta: 'v2-b1-cefaleia', texto: 'Dói' }]
  }), /opção válida/);
});

test('o médico cria um doente com palavra-passe temporária, que fica a seu cargo', () => {
  const dados = { nome: 'Doente  Novo de Teste', email: 'Novo.Doente@example.invalid', numero_processo_clinico: 'pc-999001',
    data_nascimento: '1970-03-04', sexo: 'F' };
  const novo = MedicoService.criarDoente(idMedico, dados);
  assert.equal(novo.nome, 'Doente Novo de Teste');
  assert.equal(novo.numero_processo_clinico, 'PC-999001');
  assert.ok(novo.palavra_passe_temporaria.length >= 10);
  const sessao = AuthService.login('novo.doente@example.invalid', novo.palavra_passe_temporaria);
  assert.equal(sessao.utilizador.perfil, 'DOENTE');
  const medico = { id_utilizador: idMedico, nome: 'Médico', email: 'm', perfil: 'MEDICO' as const };
  assert.equal(AuthService.podeAcederDoente(medico, novo.id_doente), true);
  const plano = db.prepare("SELECT periodicidade_dias FROM PlanoMonitorizacao WHERE id_doente = ? AND estado = 'ATIVO'").get(novo.id_doente) as any;
  assert.equal(plano.periodicidade_dias, 7);
  assert.throws(() => MedicoService.criarDoente(idMedico, { ...dados, numero_processo_clinico: 'PC-999002' }), /email/);
  assert.throws(() => MedicoService.criarDoente(idMedico, { ...dados, email: 'outro@example.invalid' }), /n\.º de processo/);
  assert.throws(() => MedicoService.criarDoente(idMedico, { ...dados, email: 'x@example.invalid', numero_processo_clinico: 'PC-1', data_nascimento: '2999-01-01' }), /data de nascimento/);
  assert.throws(() => MedicoService.criarDoente(idMedico, { ...dados, email: 'y@example.invalid', numero_processo_clinico: 'PC-777', sexo: 'X' }), /sexo/);
});
