# Plataforma de Monitorização de Glioblastoma

Protótipo de acompanhamento longitudinal para o Serviço de Neurocirurgia CHSJ. A aplicação usa Express, TypeScript e SQLite e inclui uma interface em português europeu.

## Executar em desenvolvimento

Requer Node.js 22 e npm. Na pasta do projeto:

```powershell
npm install
npm run seed   # apenas na primeira execução; cria dados de demonstração
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). O script seleciona Node.js 22 para compatibilidade com o módulo nativo `better-sqlite3`.

Contas fictícias de demonstração (palavra-passe `123456`):

| Perfil | Email |
|---|---|
| Médico | `medico1@chsj.min-saude.pt` (também `medico2`, `medico3`) |
| Enfermeiro | `enfermeiro1@chsj.min-saude.pt` (também `enfermeiro2`, `enfermeiro3`) |
| Doente | `doente@chsj.pt` |
| Cuidador | `cuidador@chsj.pt` |

O médico só consulta processos pelos quais é responsável. No protótipo, a enfermagem representa a equipa do serviço e acompanha os doentes registados nesse serviço. Doentes e cuidadores só consultam processos próprios ou associações ativas e autorizadas.

## Dados de demonstração

O arranque cria/atualiza o esquema e o formulário estruturado no ficheiro `data.db`. Para apontar a aplicação a uma base de dados de desenvolvimento separada:

```powershell
$env:DATABASE_PATH = "C:\temp\gbm-dev.db"
npm run dev
```

**Atenção:** `npm run seed` apaga e recria os registos da base de dados indicada em `DATABASE_PATH` (ou `data.db`, se não for indicada), usando dados sintéticos. Execute-o apenas na primeira configuração ou numa base descartável; não o execute numa base de dados que pretenda conservar.

Os nomes, números de processo e datas são **fictícios** e não correspondem a pessoas reais. A palavra-passe de todas as contas é `123456`. Os profissionais aparecem como «Médico 1», «Enfermeiro 1», etc., para não coincidirem com profissionais reais. Contas principais: `medico1@chsj.min-saude.pt` (Médico 1), `enfermeiro1@chsj.min-saude.pt`, `cuidador@chsj.pt` (Luísa Ferreira, cuidadora de António Ferreira) e `doente@chsj.pt` (António Ferreira). Os restantes doentes entram com `doenteN@example.invalid`.

| N.º | Doente | Cenário de demonstração |
|---|---|---|
| 1 | António Ferreira | Dependência crescente (KPS 80 → 60), preenchido pela cuidadora |
| 2 | Maria do Céu Lopes | Estável |
| 3 | Joaquim Pereira | Agravamento progressivo |
| 4 | Helena Sousa | Agravamento súbito: dor de cabeça, vómitos e sonolência (alerta Crítica) |
| 5 | Manuel Rodrigues | Melhoria gradual |
| 6 | Rosa Martins | Respostas muito parciais |
| 7 | José Carvalho | «Não consigo avaliar» |
| 8 | Fernanda Almeida | Preenchimento pelo cuidador |
| 9 | Carlos Ribeiro | Alertas e triagem |
| 10 | Isabel Gomes | Histórico prolongado |
| 11 | Luís Teixeira | Autonomia variável |
| 12 | Teresa Moreira | Tratamentos múltiplos |
| 13 | Fernando Costa | Agravamento neurológico agudo (alerta Crítica) |
| 14 | Ana Paula Mendes | Agravamento ligeiro com cuidador |

## Funcionalidades implementadas

- Autenticação por perfil, hashes scrypt com sal individual, tokens de sessão e autorização por processo.
- Associação do cuidador feita só pelo médico responsável, que confirma a autorização do doente; participação do cuidador exigida quando a última avaliação KPS é ≤ 70.
- Atualização de diagnóstico, tratamentos, avaliações KPS, plano individual de monitorização e decisões médicas.
- Questionário v2 (`form-gbm-v2`) em quatro blocos: **A** sinais de alarme (Sim/Não, últimas 24 horas), **B** sintomas (últimos 7 dias, de «Não tive» a «Grave»), **C** movimento e funções, **D** autonomia. Algumas perguntas têm perguntas de detalhe que só aparecem quando a principal tem resposta (por exemplo, o tipo de dor de cabeça). Nos sintomas pode indicar-se a frequência e se é «novo ou pior do que o habitual». Permite submissões parciais.
- Respostas «Não tive», «Não consigo avaliar» e perguntas omitidas são representadas separadamente. Só respostas efetivamente fornecidas são persistidas.
- Histórico com autor e data/hora, lembretes, gráficos cronológicos de KPS e de respostas comparáveis.
- Alertas determinísticos, triagem e prioridade, com histórico de ações e registo de auditoria. O motor do questionário v2 (`src/services/motor-alertas-v2.ts`) avalia por camadas (limiares demonstrativos, **não validados clinicamente**):
  1. **Sinais de alarme** (Bloco A, ou sonolência B4 em nível 3): **Crítica**, com indicação imediata ao doente (ligar 112, contactar já ou contactar hoje). Na convulsão (A1) pergunta-se a duração, o número e se recuperou: uma só, com menos de 5 minutos e recuperação → Alta e contactar hoje; várias curtas com recuperação → contactar já (a validar); restantes casos ou detalhes em falta → 112. Enquanto o doente responde, a recomendação mais urgente fica fixa no topo do formulário;
  2. **Combinações de sintomas**: hipertensão intracraniana provável (Crítica) ou possível (Alta), toxicidade da temozolomida, declínio neurológico face ao habitual do doente, quedas repetidas (Alta); sintoma grave isolado (Média);
  3. **Score de evolução** 0–100 ponderado, comparado com a mediana dos três primeiros registos elegíveis (cobertura ≥ 60%). O limiar demonstrativo é adaptado à linha de base e à variabilidade individual (MAD), com mínimo de 10 pontos;
  4. **Ajustes**: KPS ≤ 70 e frequência diária ou constante sobem um nível cada, sem passar de Alta.
  Indicadores cognitivos assinalados como «não consigo avaliar» são preservados como sinal de dados insuficientes, não como zero. Os registos com recordação de sete dias só são comparados quando distam pelo menos sete dias; a linha de base reinicia quando muda a fase clínica, há uma nova cirurgia registada ou uma nova avaliação KPS vigente. KPS ausente ou com mais de 180 dias não é tratado como 100 nem ajusta a prioridade. Alertas repetidos do mesmo tipo ficam ligados ao novo registo sem criar novo alerta enquanto o anterior estiver aberto. O formulário v2 é o único motor de alertas; alertas e submissões históricas v1 permanecem disponíveis para consulta.
- Separador **Diagnóstico e medicação**, para todos os perfis: diagnóstico, linha do tempo dos tratamentos e medicação (ativa e anterior). Só o médico regista diagnóstico, tratamentos e medicação, e pode suspender, retomar ou terminar uma medicação; a enfermagem, o doente e o cuidador consultam.
- Identificação do doente no topo de todas as páginas: nome, n.º de processo, data de nascimento e idade, sexo, médico responsável e cuidador. O cuidador vê «Está a registar por…».
- Interface por separadores (Alertas, Doentes, Resumo clínico, Diagnóstico e medicação, Evolução, Registos do doente e Gestão clínica). O médico e a enfermagem começam sem doente escolhido: escolhem-no no separador **Doentes** (pesquisa por nome ou n.º de processo; primeiro os que têm alertas por concluir ou registos em atraso) ou a partir de um alerta.
- Exportação autenticada de um bundle HL7 FHIR para o processo clínico, incluindo Questionnaire, QuestionnaireResponse completa mesmo quando parcial, score/linha de base e alertas.
- Interface responsiva, utilizável por teclado e sem dependência de bibliotecas de gráficos externas.

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

As perguntas, opções e pesos do questionário v2 estão em `src/database/formulario-v2.ts` e `src/services/motor-alertas-v2.ts`. As alterações ao esquema são aplicadas por migrações versionadas em `src/database/migrations.ts`; ao arrancar, o formulário v2 passa a ser o ativo (o v1 fica inativo). Para ter os dados de demonstração no v2, corra `npm run seed`.

O score usa os pesos 3/2/1 como importância relativa proposta (função/autonomia, cognição/deglutição e restantes sintomas). A soma é uma aproximação de rastreio sobre respostas ordinais, não uma medida intervalar validada. O limiar adaptativo é `max(5, 10% da linha de base, 2 × MAD)`, pelo que varia com o nível e a variabilidade basais. Sensibilidade no cenário de subida 0→2 em D1, C4 e B7: com pesos 3/2/1 a variação é 11,6 pontos (16/138); com pesos iguais é 7,8 (6/77). O caso dispara com limiares absolutos 8 ou 10, mas não com 15 ou 20; logo a escolha muda a decisão e carece de validação clínica. A cobertura mínima de 60% e a regra de MAD também são parâmetros exploratórios, sem validação clínica.

As bases SQLite e os ficheiros WAL/SHM são locais e ignorados pelo Git. Use `npm run seed` para gerar dados sintéticos; não distribua nem inclua bases de dados locais em ZIPs.

O token de sessão passa entre páginas no `sessionStorage` e é apagado ao terminar sessão ou ao fechar o separador. Abrir a página de outro perfil leva de volta à página do próprio perfil. Esta divisão serve só a interface: quem decide o que cada perfil pode ver e alterar é sempre o servidor.

## Diagramas

`docs/modelo-dados-gbm.drawio` tem o modelo de dados completo (abre em [diagrams.net](https://app.diagrams.net) ou na extensão Draw.io do VS Code). A verde está o que foi acrescentado nesta versão: a tabela `Medicacao` e as colunas para o texto do cuidador.

## Verificação

```powershell
npm run typecheck
npm run test
```

Requer Node.js 22, que é também a versão fixada na integração contínua; os testes usam uma base de dados temporária e não alteram `data.db`.

## Limites de utilização

Esta versão é um **protótipo**, não um sistema clínico validado nem adequado para produção. Usa apenas dados fictícios. Os limiares e regras de alerta são demonstrativos e têm de ser revistos e validados pela equipa clínica antes de qualquer utilização assistencial. A exportação FHIR é uma base de interoperabilidade, não substitui validação de conformidade ou integração institucional.

Em `NODE_ENV=production`, a aplicação exige `JWT_SECRET` e `DATABASE_PATH` dedicados. A configuração de produção, a avaliação de impacto RGPD, a gestão de consentimento institucional, cópias de segurança, retenção e monitorização operacional carecem de implementação e validação próprias.
