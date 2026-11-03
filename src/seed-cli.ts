import fs from 'fs';
import path from 'path';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed não pode ser executado em produção.');
}

const argumentos = process.argv.slice(2);
const opcao = (nome: string) => argumentos.find(argumento => argumento.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const caminhoBaseDados = path.resolve(
  opcao('database') || process.env.npm_config_database || process.env.SEED_DATABASE_PATH || process.env.DATABASE_PATH || 'data.db'
);
const dataReferencia = opcao('date') || process.env.npm_config_date || process.env.SEED_REFERENCE_DATE ||
  new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia) ||
    Number.isNaN(Date.parse(`${dataReferencia}T00:00:00Z`)) ||
    new Date(`${dataReferencia}T00:00:00Z`).toISOString().slice(0, 10) !== dataReferencia) {
  throw new Error('Use --date=AAAA-MM-DD para indicar uma data válida.');
}
// Os dados são sintéticos: a base é sempre criada de novo (com a estrutura atual).
// O servidor tem de estar parado, senão o Windows não deixa apagar o ficheiro.
for (const ficheiro of [caminhoBaseDados, `${caminhoBaseDados}-wal`, `${caminhoBaseDados}-shm`]) {
  try {
    if (fs.existsSync(ficheiro)) fs.rmSync(ficheiro);
  } catch {
    throw new Error(`Não foi possível apagar ${ficheiro}. Pare o servidor (Ctrl+C ou Stop-Process -Name node -Force) e volte a correr «npm run seed».`);
  }
}
console.log(`A criar a base de dados de demonstração em ${caminhoBaseDados} (data de referência ${dataReferencia})...`);

process.env.DATABASE_PATH = caminhoBaseDados;
process.env.SEED_REFERENCE_DATE = dataReferencia;
require('./seed');
