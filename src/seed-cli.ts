import fs from 'fs';
import path from 'path';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed não pode ser executado em produção.');
}

const argumentos = process.argv.slice(2);
const opcao = (nome: string) => argumentos.find(argumento => argumento.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const caminhoBaseDados = path.resolve(
  opcao('database') || process.env.npm_config_database || process.env.SEED_DATABASE_PATH || 'gbm-seed.db'
);
const dataReferencia = opcao('date') || process.env.npm_config_date || process.env.SEED_REFERENCE_DATE ||
  new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia) ||
    Number.isNaN(Date.parse(`${dataReferencia}T00:00:00Z`)) ||
    new Date(`${dataReferencia}T00:00:00Z`).toISOString().slice(0, 10) !== dataReferencia) {
  throw new Error('Use --date=AAAA-MM-DD para indicar uma data válida.');
}
if (fs.existsSync(caminhoBaseDados) && fs.statSync(caminhoBaseDados).size > 0) {
  throw new Error(`O ficheiro ${caminhoBaseDados} já existe e não está vazio. Indique outro --database.`);
}

process.env.DATABASE_PATH = caminhoBaseDados;
process.env.SEED_REFERENCE_DATE = dataReferencia;
require('./seed');
