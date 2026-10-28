import { Request, Response } from 'express';
import { db, registarAuditoria } from '../database/dados-locais';
import { AuthService } from '../services/auth.service';
import { SintomaService } from '../services/sintoma.service';
import { MedicoService } from '../services/medico.service';
import { AlertaService } from '../services/alerta.service';
import { FhirService } from '../services/fhir.service';

export class ApiController {
  static login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      res.json(AuthService.login(email, password));
    } catch (e: any) {
      res.status(401).json({ erro: e.message });
    }
  }

  static obterFormularioAtivo(_req: Request, res: Response) {
    try { res.json(SintomaService.obterFormularioAtivo()); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static listarDoentes(req: Request, res: Response) {
    const user = req.user!;
    if (user.perfil === 'MEDICO') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email, dg.localizacao_tumoral, dg.fase_clinica_atual
        FROM Doente d JOIN Utilizador u ON d.id_doente = u.id_utilizador
        LEFT JOIN DiagnosticoGB dg ON d.id_doente = dg.id_doente
        WHERE d.id_medico_responsavel = ?`).all(user.id_utilizador));
      return;
    }
    if (user.perfil === 'ENFERMEIRO') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email, dg.localizacao_tumoral, dg.fase_clinica_atual
        FROM Doente d JOIN Utilizador u ON d.id_doente = u.id_utilizador
        LEFT JOIN DiagnosticoGB dg ON d.id_doente = dg.id_doente`).all());
      return;
    }
    if (user.perfil === 'DOENTE') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email FROM Doente d JOIN Utilizador u ON d.id_doente = u.id_utilizador WHERE d.id_doente = ?`).all(user.id_utilizador));
      return;
    }
    if (user.perfil === 'CUIDADOR') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email, dc.grau_parentesco
        FROM DoenteCuidador dc JOIN Doente d ON dc.id_doente = d.id_doente
        JOIN Utilizador u ON d.id_doente = u.id_utilizador
        WHERE dc.id_cuidador = ? AND dc.ativa = 1 AND dc.autorizacao_validada = 1`).all(user.id_utilizador));
      return;
    }
  }

  static obterProcessoDoente(req: Request, res: Response) {
    try {
      const { idDoente } = req.params;
      if (!AuthService.podeAcederDoente(req.user!, idDoente)) {
        res.status(403).json({ erro: 'Sem permissão.' });
        return;
      }
      const processo = MedicoService.obterProcessoLongitudinal(idDoente);
      registarAuditoria(req.user!.id_utilizador, 'CONSULTA_PROCESSO_CLINICO', `Consulta do processo ${idDoente}`);
      if (req.user!.perfil === 'DOENTE' || req.user!.perfil === 'CUIDADOR') {
        res.json({
          doente: {
            id_doente: processo.doente.id_doente,
            nome: processo.doente.nome,
            ultimo_kps: processo.doente.ultimo_kps,
            participacao_cuidador_obrigatoria: processo.doente.participacao_cuidador_obrigatoria
          },
          avaliacoesKps: processo.avaliacoesKps,
          submissoes: processo.submissoes,
          lembrete: processo.lembrete
        });
        return;
      }
      res.json(processo);
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static submeterMonitorizacao(req: Request, res: Response) {
    try {
      const { idDoente } = req.params;
      if (!['DOENTE', 'CUIDADOR'].includes(req.user!.perfil)) {
        res.status(403).json({ erro: 'Apenas o doente ou o cuidador autorizado pode preencher este formulário.' });
        return;
      }
      if (!AuthService.podeAcederDoente(req.user!, idDoente)) {
        res.status(403).json({ erro: 'Sem autorização para registar informação por este doente.' });
        return;
      }
      res.status(201).json(SintomaService.submeterMonitorizacao(idDoente, req.user!.id_utilizador, req.user!.perfil, req.body));
    } catch (e: any) { res.status(400).json({ erro: e.message, camposEmFalta: e.camposEmFalta || [] }); }
  }

  static registarKps(req: Request, res: Response) {
    if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
      res.status(403).json({ erro: 'Sem autorização para atualizar este processo clínico.' });
      return;
    }
    if (!req.body || req.body.score_kps === '' || req.body.score_kps === undefined) {
      res.status(400).json({ erro: 'Indique uma classificação KPS.' });
      return;
    }
    try { res.status(201).json(MedicoService.registarAvaliacaoKarnofsky(req.params.idDoente, req.user!.id_utilizador, Number(req.body.score_kps))); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static atualizarDiagnostico(req: Request, res: Response) {
    try {
      if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
        res.status(403).json({ erro: 'Sem autorização para atualizar este processo clínico.' });
        return;
      }
      res.json(MedicoService.atualizarDiagnostico(req.params.idDoente, req.user!.id_utilizador, req.body));
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static associarCuidador(req: Request, res: Response) {
    try {
      if (!['DOENTE', 'MEDICO'].includes(req.user!.perfil) ||
          !AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
        res.status(403).json({ erro: 'A associação requer autorização do doente ou do médico responsável.' });
        return;
      }
      res.status(201).json(MedicoService.associarCuidador(
        req.params.idDoente, req.body.email_cuidador, req.body.grau_parentesco,
        req.user!.id_utilizador,
        req.user!.perfil === 'DOENTE' || req.body.consentimento_confirmado === true
      ));
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static definirPlano(req: Request, res: Response) {
    if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
      res.status(403).json({ erro: 'Sem autorização para atualizar este processo clínico.' });
      return;
    }
    try { res.status(201).json(MedicoService.definirPlanoMonitorizacao(req.params.idDoente, req.user!.id_utilizador, 'Ad hoc', Number(req.body.periodicidade_dias), req.body.fase_clinica_atual)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static registarTratamento(req: Request, res: Response) {
    if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
      res.status(403).json({ erro: 'Sem autorização para atualizar este processo clínico.' });
      return;
    }
    try { res.status(201).json(MedicoService.registarTratamento(req.params.idDoente, req.user!.id_utilizador, req.body)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static listarAlertas(req: Request, res: Response) {
    const alertas = AlertaService.listarAlertas() as Array<{ id_doente: string }>;
    const autorizados = alertas.filter(alerta => AuthService.podeAcederDoente(req.user!, alerta.id_doente));
    registarAuditoria(req.user!.id_utilizador, 'CONSULTA_ALERTAS', `Consulta de ${autorizados.length} alerta(s) autorizados.`);
    res.json(autorizados);
  }

  static triarAlerta(req: Request, res: Response) {
    try {
      const alerta = db.prepare(`SELECT s.id_doente FROM AlertaClinico a
        JOIN SubmissaoMonitorizacao s ON s.id_submissao = a.id_submissao
        WHERE a.id_alerta = ?`).get(req.params.idAlerta) as { id_doente: string } | undefined;
      if (!alerta) {
        res.status(404).json({ erro: 'Alerta não encontrado.' });
        return;
      }
      if (!AuthService.podeAcederDoente(req.user!, alerta.id_doente)) {
        res.status(403).json({ erro: 'Sem autorização para consultar este alerta.' });
        return;
      }
      res.json(AlertaService.registarTriagemAlerta(req.params.idAlerta, req.user!.id_utilizador, req.body.estado_novo, req.body.prioridade, req.body.nota_triagem));
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static registarDecisao(req: Request, res: Response) {
    if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
      res.status(403).json({ erro: 'Sem autorização para atualizar este processo clínico.' });
      return;
    }
    try { res.status(201).json(MedicoService.registarDecisaoAcompanhamento(req.params.idDoente, req.user!.id_utilizador, req.body)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static exportarFhir(req: Request, res: Response) {
    try {
      if (!AuthService.podeAcederDoente(req.user!, req.params.idDoente)) {
        res.status(403).json({ erro: 'Sem autorização para consultar este processo clínico.' });
        return;
      }
      registarAuditoria(req.user!.id_utilizador, 'EXPORTACAO_FHIR', `Exportação do processo ${req.params.idDoente}`);
      res.json(FhirService.exportarBundleFhir(req.params.idDoente));
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }
}