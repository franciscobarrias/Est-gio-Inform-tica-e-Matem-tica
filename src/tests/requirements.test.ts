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
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'perg-cefaleia');
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
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'perg-cefaleia');
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
  const pergunta = formulario.perguntas.find((item: any) => item.id_pergunta === 'perg-marcha');
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
