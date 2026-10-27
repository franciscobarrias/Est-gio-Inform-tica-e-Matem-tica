import { Request, Response } from 'express';
import { db } from '../database/dados-locais';
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
    if (user.perfil === 'MEDICO' || user.perfil === 'ENFERMEIRO') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email, dg.localizacao_tumoral, dg.fase_clinica_atual FROM Doente d JOIN Utilizador u ON d.id_doente = u.id_utilizador LEFT JOIN DiagnosticoGB dg ON d.id_doente = dg.id_doente`).all());
      return;
    }
    if (user.perfil === 'DOENTE') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email FROM Doente d JOIN Utilizador u ON d.id_doente = u.id_utilizador WHERE d.id_doente = ?`).all(user.id_utilizador));
      return;
    }
    if (user.perfil === 'CUIDADOR') {
      res.json(db.prepare(`SELECT d.*, u.nome, u.email, dc.grau_parentesco FROM DoenteCuidador dc JOIN Doente d ON dc.id_doente = d.id_doente JOIN Utilizador u ON d.id_doente = u.id_utilizador WHERE dc.id_cuidador = ? AND dc.ativa = 1`).all(user.id_utilizador));
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
      res.json(MedicoService.obterProcessoLongitudinal(idDoente));
    } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static submeterMonitorizacao(req: Request, res: Response) {
    try {
      const { idDoente } = req.params;
      res.status(201).json(SintomaService.submeterMonitorizacao(idDoente, req.user!.id_utilizador, req.user!.perfil, req.body));
    } catch (e: any) { res.status(400).json({ erro: e.message, camposEmFalta: e.camposEmFalta || [] }); }
  }

  static registarKps(req: Request, res: Response) {
    try { res.status(201).json(MedicoService.registarAvaliacaoKarnofsky(req.params.idDoente, req.user!.id_utilizador, Number(req.body.score_kps))); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static definirPlano(req: Request, res: Response) {
    try { res.status(201).json(MedicoService.definirPlanoMonitorizacao(req.params.idDoente, req.user!.id_utilizador, 'Ad hoc', Number(req.body.periodicidade_dias), req.body.fase_clinica_atual)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static registarTratamento(req: Request, res: Response) {
    try { res.status(201).json(MedicoService.registarTratamento(req.params.idDoente, req.user!.id_utilizador, req.body)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static listarAlertas(_req: Request, res: Response) { res.json(AlertaService.listarAlertas()); }

  static triarAlerta(req: Request, res: Response) {
    try { res.json(AlertaService.registarTriagemAlerta(req.params.idAlerta, req.user!.id_utilizador, req.body.estado_novo, req.body.prioridade, req.body.nota_triagem)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static registarDecisao(req: Request, res: Response) {
    try { res.status(201).json(MedicoService.registarDecisaoAcompanhamento(req.params.idDoente, req.user!.id_utilizador, req.body)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }

  static exportarFhir(req: Request, res: Response) {
    try { res.json(FhirService.exportarBundleFhir(req.params.idDoente)); } catch (e: any) { res.status(400).json({ erro: e.message }); }
  }
}