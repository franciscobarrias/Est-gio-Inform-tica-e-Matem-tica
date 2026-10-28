import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, registarAuditoria } from '../database/dados-locais';
import { JWT_SECRET, UtilizadorAutenticado } from '../middleware/auth.middleware';

export class AuthService {
  static gerarHashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  private static verificarPassword(password: string, passwordHash: string): boolean {
    const [algorithm, salt, expectedHash] = passwordHash.split('$');
    if (algorithm === 'scrypt' && salt && expectedHash) {
      const actualHash = crypto.scryptSync(password, salt, 64);
      const expected = Buffer.from(expectedHash, 'hex');
      return expected.length === actualHash.length && crypto.timingSafeEqual(actualHash, expected);
    }

    // Upgrade hashes created by older versions after a successful login.
    const legacyHash = crypto.scryptSync(password, 'salt_gbm_chsj', 64);
    const expected = Buffer.from(passwordHash, 'hex');
    return expected.length === legacyHash.length && crypto.timingSafeEqual(legacyHash, expected);
  }

  static login(email: string, password: string) {
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      throw new Error('Introduza o email e a palavra-passe.');
    }
    const user = db.prepare(`
      SELECT id_utilizador, nome, email, perfil, estado_conta, password_hash
      FROM Utilizador
      WHERE email = ?
    `).get(email.trim().toLowerCase()) as any;

    if (!user || user.estado_conta !== 'ATIVA' || !this.verificarPassword(password, user.password_hash)) {
      throw new Error('Credenciais inválidas ou conta inativa (RF01).');
    }

    registarAuditoria(user.id_utilizador, 'LOGIN', `Login efetuado com perfil ${user.perfil}`);
    if (!user.password_hash.startsWith('scrypt$')) {
      db.prepare('UPDATE Utilizador SET password_hash = ? WHERE id_utilizador = ?')
        .run(this.gerarHashPassword(password), user.id_utilizador);
    }

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
    if (user.perfil === 'MEDICO') {
      return !!db.prepare('SELECT 1 FROM Doente WHERE id_doente = ? AND id_medico_responsavel = ?')
        .get(idDoente, user.id_utilizador);
    }
    // The prototype models the neuro-oncology nursing team as responsible for its service patients.
    if (user.perfil === 'ENFERMEIRO') return !!db.prepare('SELECT 1 FROM Doente WHERE id_doente = ?').get(idDoente);
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