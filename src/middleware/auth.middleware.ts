import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'gbm-chsj-secret-2026';

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
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET) as UtilizadorAutenticado;
    next();
  } catch {
    res.status(403).json({ erro: 'Sessão inválida ou expirada.' });
  }
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