import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, registarAuditoria } from '../database/dados-locais';
import { JWT_SECRET, UtilizadorAutenticado } from '../middleware/auth.middleware';

export class AuthService {
  static gerarHashPassword(password: string): string {
    return crypto.scryptSync(password, 'salt_gbm_chsj', 64).toString('hex');
  }

  static login(email: string, password: string) {
    const hash = this.gerarHashPassword(password);
    const user = db.prepare(`
      SELECT id_utilizador, nome, email, perfil, estado_conta
      FROM Utilizador
      WHERE email = ? AND password_hash = ?
    `).get(email, hash) as any;

    if (!user || user.estado_conta !== 'ATIVA') {
      throw new Error('Credenciais inválidas ou conta inativa (RF01).');
    }

    registarAuditoria(user.id_utilizador, 'LOGIN', `Login efetuado com perfil ${user.perfil}`);

    const payload: UtilizadorAutenticado = {
      id_utilizador: user.id_utilizador,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    return { token, utilizador: payload };
  }

  static podeAcederDoente(user: UtilizadorAutenticado, idDoente: string): boolean {
    if (user.perfil === 'MEDICO' || user.perfil === 'ENFERMEIRO') return true;
    if (user.perfil === 'DOENTE' && user.id_utilizador === idDoente) return true;
    if (user.perfil === 'CUIDADOR') {
      const assoc = db.prepare(`
        SELECT id_associacao FROM DoenteCuidador
        WHERE id_doente = ? AND id_cuidador = ? AND autorizacao_validada = 1 AND ativa = 1
      `).get(idDoente, user.id_utilizador);
      return !!assoc;
    }
    return false;
  }
}