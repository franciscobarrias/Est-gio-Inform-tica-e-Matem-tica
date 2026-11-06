# Plataforma de Monitorização de Glioblastoma

Protótipo de acompanhamento longitudinal para o Serviço de Neurocirurgia CHSJ. A aplicação usa Express, TypeScript e SQLite e inclui uma interface em português europeu.

## Executar em desenvolvimento

Requer Node.js 22 e npm. Na pasta do projeto:

```powershell
npm install
npm run seed   # cria (ou recria) a base de dados com os dados de demonstração
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). O script seleciona Node.js 22 para compatibilidade com o módulo nativo `better-sqlite3`.

Contas fictícias de demonstração (palavra-passe `123456`):

| Perfil | Email |
|---|---|
| Médico | `medico1@chsj.min-saude.pt` |
| Enfermeiro | `enfermeiro1@chsj.min-saude.pt` |
| Doente | `doente@chsj.pt` |
| Cuidador | `cuidador@chsj.pt` |

O médico só consulta processos pelos quais é responsável. No protótipo, a enfermagem representa a equipa do serviço e acompanha os doentes registados nesse serviço. Doentes e cuidadores só consultam processos próprios ou associações ativas e autorizadas.

## Dados de demonstração

O arranque cria/atualiza o esquema e o formulário estruturado no ficheiro `data.db`. Para apontar a aplicação a uma base de dados de desenvolvimento separada:

```powershell
$env:DATABASE_PATH = "C:\temp\gbm-dev.db"
npm run dev
```

**Atenção:** `npm run seed` apaga o ficheiro da base de dados (`data.db`, ou o indicado em `DATABASE_PATH` ou `--database`) e cria-o de novo com dados sintéticos. Pare o servidor antes de o correr. Não o use numa base de dados que pretenda conservar.

Os nomes, números de processo e datas são **fictícios** e não correspondem a pessoas reais. A palavra-passe de todas as contas é `123456`. Os profissionais aparecem como «Médico 1», «Enfermeiro 1», etc., para não coincidirem com profissionais reais. Contas principais: `medico1@chsj.min-saude.pt` (Médico 1), `enfermeiro1@chsj.min-saude.pt` (Enfermeiro 1), `cuidador@chsj.pt` (Luísa Ferreira, cuidadora de António Ferreira) e `doente@chsj.pt` (António Ferreira). Os restantes doentes entram com endereços de demonstração `@example.invalid`.

| N.º | Doente | Cenário de demonstração |
|---|---|---|
| 1 | António Ferreira | Dependência crescente (KPS 80 → 60), preenchido pela cuidadora; alerta encaminhado; mensagem para a equipa |
| 2 | Maria do Céu Lopes | Estável |
| 3 | Joaquim Pereira | Agravamento progressivo; alerta concluído com decisão médica; mensagem para a equipa |
| 4 | Helena Sousa | Agravamento súbito: dor de cabeça, vómitos e sonolência (Crítica, encaminhado) |
| 5 | Manuel Rodrigues | Melhoria gradual; perna inchada no último registo (Alta, sem triagem fora do prazo) |
| 6 | Rosa Martins | Respostas muito parciais; duas quedas (em análise pela enfermagem) |
| 7 | José Carvalho | «Não consigo avaliar» em vários itens cognitivos; concluído pela enfermagem |
| 8 | Fernanda Almeida | Preenchimento pelo cuidador; deixou de andar (encaminhado) |
| 9 | Carlos Ribeiro | Declínio neurológico (encaminhado) |
| 10 | Isabel Gomes | Histórico prolongado; diarreia por temozolomida (encaminhado) |
| 11 | Luís Teixeira | Autonomia variável; disfagia grave (concluído com decisão médica) |
| 12 | Teresa Moreira | Tratamentos múltiplos; febre em quimioterapia (Crítica, encaminhado) |
| 13 | Fernando Costa | Agravamento neurológico agudo (Crítica, encaminhado) |
| 14 | Ana Paula Mendes | Agravamento com cuidador; hipertensão intracraniana possível (sem triagem) |

## Funcionalidades implementadas

- Autenticação por perfil, hashes scrypt com sal individual, tokens de sessão e autorização por processo.
- Associação do cuidador feita só pelo médico responsável, que confirma a autorização do doente; participação do cuidador exigida quando a última avaliação KPS é ≤ 70.
- Atualização de diagnóstico, tratamentos, avaliações KPS, plano individual de monitorização e decisões médicas.
- Questionário v2 (`form-gbm-v2`) em quatro blocos: **A** sinais de alarme (Sim/Não, últimas 24 horas), **B** sintomas (últimos 7 dias, de «Não tive» a «Grave»), **C** movimento e funções, **D** autonomia. Algumas perguntas têm perguntas de detalhe que só aparecem quando a principal tem resposta (por exemplo, o tipo de dor de cabeça). Nos sintomas pode indicar-se a frequência e se é «novo ou pior do que o habitual». Permite submissões parciais.
- Respostas «Não tive», «Não consigo avaliar» e perguntas omitidas são representadas separadamente. Só respostas efetivamente fornecidas são persistidas.
- Histórico com autor e data/hora, lembretes, gráficos cronológicos de KPS e de respostas comparáveis.
- Alertas determinísticos, triagem e prioridade, com histórico de ações e registo de auditoria. O motor do questionário v2 (`src/services/motor-alertas-v2.ts`) avalia por camadas (limiares demonstrativos, **não validados clinicamente**):
  1. **Sinais de alarme** (Bloco A, ou sonolência B4 em nível 3): **Crítica** quando a instrução é ligar 112 ou contactar já, **Alta** quando é contactar hoje (A7, A8 e convulsão única com recuperação), com indicação imediata ao doente (ligar 112, contactar já ou contactar hoje). Na convulsão (A1) pergunta-se a duração, o número e se recuperou: uma só, com menos de 5 minutos e recuperação → Alta e contactar hoje; várias curtas com recuperação → contactar já (a validar); restantes casos ou detalhes em falta → 112. Enquanto o doente responde, a recomendação mais urgente fica fixa no topo do formulário;
  2. **Combinações de sintomas**: hipertensão intracraniana provável (Crítica) ou possível (Alta), toxicidade da temozolomida, declínio neurológico face ao habitual do doente, quedas repetidas (Alta); sintoma grave isolado (Média);
  3. **Score de evolução** 0–100 ponderado, comparado com a mediana dos três primeiros registos elegíveis (cobertura ≥ 60%). O limiar demonstrativo é `max(5, 0,1 × S₀, 2 × MAD)`;
  4. **Ajustes**: KPS ≤ 70 e frequência diária ou constante sobem um nível cada, sem passar de Alta.
  Dois ou mais indicadores cognitivos «não consigo avaliar» geram um motivo de dados insuficientes, sem os converter em zero. Os registos com recordação de sete dias só são comparados quando distam pelo menos sete dias; a linha de base muda com a fase clínica vigente à data do registo, uma nova cirurgia ou uma variação KPS de pelo menos 20 pontos/cruzamento de 70. A expiração KPS aos 180 dias não reinicia a linha de base. KPS ausente ou expirado não é tratado como 100 nem ajusta a prioridade. A deduplicação compara motivos concretos; motivos repetidos associam registos ao alerta aberto, enquanto motivos novos criam alerta ligado ao anterior. A submissão é persistida antes da avaliação; se o motor falhar, a falha fica registada sem perder as respostas. O formulário v2 é o único motor de alertas; alertas e submissões históricas v1 permanecem disponíveis para consulta.
- Separador **Diagnóstico e medicação**, para todos os perfis: diagnóstico, linha do tempo dos tratamentos e medicação (ativa e anterior). Só o médico regista diagnóstico, tratamentos e medicação, e pode suspender, retomar ou terminar uma medicação; a enfermagem, o doente e o cuidador consultam.
- Identificação do doente no topo de todas as páginas: nome, n.º de processo, data de nascimento e idade, sexo, médico responsável e cuidador. O cuidador vê «Está a registar por…».
- Interface por separadores (Alertas, Doentes, Resumo clínico, Diagnóstico e medicação, Evolução, Registos do doente e Gestão clínica). O médico e a enfermagem começam sem doente escolhido: escolhem-no no separador **Doentes** (pesquisa por nome ou n.º de processo; primeiro os que têm alertas por concluir ou registos em atraso) ou a partir de um alerta.
- Exportação autenticada em JSON FHIR R4 num Bundle do tipo `collection`, limitada a Patient, Condition com `clinicalStatus` e `subject` obrigatórios, e Observations de lateralidade/IDH/MGMT, KPS e score. O construtor centraliza a criação e valida os elementos obrigatórios destes recursos; o [mapeamento FHIR R4](./docs/mapeamento-fhir-r4.xlsx) serve como referência, não como entrada automática do construtor.
- Interface responsiva para telemóveis, tablets e computadores, com navegação horizontal e tabelas deslocáveis em ecrãs estreitos; utilizável por teclado e sem dependência de bibliotecas de gráficos externas.

## Estrutura da interface

A interface está dividida por perfil. Todas as páginas usam os mesmos estilos e o mesmo código comum.

| Ficheiro | Para quê |
|---|---|
| `public/index.html` + `js/login.js` | Entrada: autentica e abre a página do perfil |
| `public/medico.html` + `js/medico.js` | Alertas encaminhados, resumo, evolução, registos e gestão clínica |
| `public/enfermeiro.html` + `js/enfermeiro.js` | Triagem de alertas e consulta do processo |
| `public/doente.html` + `js/doente.js` | Doente e cuidador: registo de sintomas, evolução, histórico e associação de cuidador |
| `js/comum.js` | Sessão, pedidos à API, mensagens, separadores, barra do doente, gráficos e histórico |
| `js/clinico.js` | Lista de alertas e resumo clínico, partilhados pelo médico e pela enfermagem |
| `css/estilos.css` | Estilos comuns |

As perguntas, opções e pesos do questionário v2 estão em `src/database/formulario-v2.ts` e `src/services/motor-alertas-v2.ts`. O esquema completo da base de dados está em `src/database/dados-locais.ts` (sem migrações: como os dados são sintéticos, quando a estrutura muda recria-se a base com `npm run seed`; se a aplicação encontrar uma base antiga, diz que é preciso recriá-la). Ao arrancar, o formulário v2 passa a ser o ativo (o v1 fica inativo). Pode escolher outro ficheiro e uma data de referência com `npm run seed -- --database=C:\dados\demo.db --date=2026-11-02`.

O score usa os pesos 3/2/1 como importância relativa proposta (função/autonomia, cognição/deglutição e restantes sintomas). A soma é uma aproximação de rastreio sobre respostas ordinais, não uma medida intervalar validada. O limiar adaptativo é `max(5, 0,1 × S₀, 2 × MAD)`, pelo que varia com o nível e a variabilidade basais. Sensibilidade no cenário de subida 0→2 em D1, C4 e B7: com pesos 3/2/1 a variação é 11,9 pontos (16/135); com pesos iguais é 7,9 (6/76). O B20 é texto livre para a equipa e não entra no score. A cobertura mínima de 60% e a regra de MAD também são parâmetros exploratórios, sem validação clínica. O script e as hipóteses da comparação sintética estão em [docs/metodos-e-simulacao.md](./docs/metodos-e-simulacao.md).

As bases SQLite e os ficheiros WAL/SHM são locais e ignorados pelo Git. Use `npm run seed` para gerar dados sintéticos; não distribua nem inclua bases de dados locais em ZIPs.

O token de sessão passa entre páginas no `sessionStorage` e é apagado ao terminar sessão ou ao fechar o separador. Abrir a página de outro perfil leva de volta à página do próprio perfil. Esta divisão serve só a interface: quem decide o que cada perfil pode ver e alterar é sempre o servidor.

## Modelo de dados e arquitetura

[docs/dicionario-de-dados.md](./docs/dicionario-de-dados.md) documenta as 27 tabelas canónicas, as colunas, relações, domínios, respostas do questionário, nulabilidade e artefactos locais legados. [Modelos e arquitetura](./docs/modelos-e-dicionario.md) descreve as responsabilidades dos serviços e o modelo físico; as [decisões de desenho](./docs/decisoes-de-desenho.md) registam imutabilidade, separação algoritmo/decisão humana, versionamento e linha de base derivada. O runtime usa Express e `better-sqlite3` com SQL direto; não usa TypeORM nem repositórios e ainda não implementa reprocessamento de avaliações.

## Verificação

```powershell
npm run typecheck
npm run test
```

Requer Node.js 22, que é também a versão fixada na integração contínua; os testes usam uma base de dados temporária e não alteram `data.db`.

## Limites de utilização

Esta versão é um **protótipo**, não um sistema clínico validado nem adequado para produção. Usa apenas dados fictícios. Os limiares e regras de alerta são demonstrativos e têm de ser revistos e validados pela equipa clínica antes de qualquer utilização assistencial. A exportação FHIR é uma base de interoperabilidade, não substitui validação de conformidade ou integração institucional.

Em `NODE_ENV=production`, a aplicação exige `JWT_SECRET` e `DATABASE_PATH` dedicados. A configuração de produção, a avaliação de impacto RGPD, a gestão de consentimento institucional, cópias de segurança, retenção e monitorização operacional carecem de implementação e validação próprias.
