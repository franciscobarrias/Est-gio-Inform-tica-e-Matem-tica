import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from '../database/dados-locais';

export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

export interface UtilizadorAutenticado {
  id_utilizador: string;
  nome: string;
  email: string;
  perfil: 'DOENTE' | 'CUIDADOR' | 'ENFERMEIRO' | 'MEDICO';
}

declare global {
  namespace Express {
    interface Request {
      user?: UtilizadorAutenticado;
    }
  }
}

export function autenticarJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Não autenticado. Credenciais em falta (RF01).' });
    return;
  }
  let tokenUser: UtilizadorAutenticado;
  try {
    const token = authHeader.split(' ')[1];
    tokenUser = jwt.verify(token, JWT_SECRET) as UtilizadorAutenticado;
  } catch {
    res.status(403).json({ erro: 'Sessão inválida ou expirada.' });
    return;
  }
  const utilizadorAtual = db.prepare(`SELECT id_utilizador, nome, email, perfil, estado_conta
    FROM Utilizador WHERE id_utilizador = ?`).get(tokenUser.id_utilizador) as
    (UtilizadorAutenticado & { estado_conta: string }) | undefined;
  if (!utilizadorAtual || utilizadorAtual.estado_conta !== 'ATIVA') {
    res.status(401).json({ erro: 'A conta está inativa ou a sessão foi revogada.' });
    return;
  }
  req.user = utilizadorAtual;
  next();
}

export function exigirPerfis(...perfis: Array<'DOENTE' | 'CUIDADOR' | 'ENFERMEIRO' | 'MEDICO'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !perfis.includes(req.user.perfil)) {
      res.status(403).json({ erro: `Acesso restrito (RF02/RNF02). Perfil necessário: ${perfis.join(' ou ')}.` });
      return;
    }
    next();
  };
}