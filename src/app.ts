import express from 'express';
import path from 'path';
import { inicializarBaseDados } from './database/dados-locais';
import { router } from './routes/api.routes';

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || !process.env.DATABASE_PATH)) {
  throw new Error('Em produção, defina JWT_SECRET e DATABASE_PATH para utilizar segredos e armazenamento dedicados.');
}

inicializarBaseDados();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', router);
app.use('/api', (_req, res) => res.status(404).json({ erro: 'Recurso da API não encontrado.' }));
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Erro de processamento do pedido:', err.message);
  const status = err.status === 413 ? 413 : err instanceof SyntaxError ? 400 : 500;
  res.status(status).json({
    erro: status === 413 ? 'O pedido excede o tamanho máximo permitido.' :
      status === 400 ? 'O conteúdo enviado não é um JSON válido.' : 'Ocorreu um erro ao processar o pedido.'
  });
});

app.listen(PORT, () => {
  console.log(`Servidor ativo em http://localhost:${PORT}`);
});