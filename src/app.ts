import express from 'express';
import path from 'path';
import { inicializarBaseDados } from './database/dados-locais';
import { router } from './routes/api.routes';

const app = express();
const PORT = process.env.PORT || 3000;

inicializarBaseDados();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', router);

app.listen(PORT, () => {
  console.log(`Servidor ativo em http://localhost:${PORT}`);
});