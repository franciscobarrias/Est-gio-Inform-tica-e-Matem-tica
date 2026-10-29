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
| Médico | `medico@chsj.pt` |
| Enfermeiro | `enfermeiro@chsj.pt` |
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

## Funcionalidades implementadas

- Autenticação por perfil, hashes scrypt com sal individual, tokens de sessão e autorização por processo.
- Associação autorizada do cuidador pelo doente ou médico responsável; participação do cuidador exigida quando a última avaliação KPS é ≤ 70.
- Atualização de diagnóstico, tratamentos, avaliações KPS, plano individual de monitorização e decisões médicas.
- Formulário estruturado para sintomas gerais, domínios neurológicos e autonomia; permite submissões parciais e regista frequência opcional.
- Respostas «Ausente», «Não consigo avaliar» e perguntas omitidas são representadas separadamente. Só respostas efetivamente fornecidas são persistidas.
- Histórico com autor e data/hora, lembretes, gráficos cronológicos de KPS e de respostas comparáveis.
- Alertas determinísticos, triagem e prioridade, com histórico de ações e registo de auditoria. A prioridade é graduada (limiares demonstrativos):
  - **Crítica:** alteração neurológica grave ou alteração do estado de consciência moderada ou grave;
  - **Alta:** alteração neurológica moderada, sintoma geral grave ou dependência total;
  - **Média:** restantes agravamentos;
  - um KPS ≤ 70 sobe um nível, sem chegar a Crítica. O motivo fica escrito no resumo do alerta.
- Interface por separadores (Alertas, Resumo clínico, Evolução, Registos do doente e Gestão clínica), com o doente em consulta sempre identificado.
- Exportação autenticada de um bundle HL7 FHIR para o processo clínico.
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

O token de sessão passa entre páginas no `sessionStorage` e é apagado ao terminar sessão ou ao fechar o separador. Abrir a página de outro perfil leva de volta à página do próprio perfil. Esta divisão serve só a interface: quem decide o que cada perfil pode ver e alterar é sempre o servidor.

## Verificação

```powershell
npm run typecheck
npm run test
```

Os testes usam uma base de dados temporária e não alteram `data.db`.

## Limites de utilização

Esta versão é um **protótipo**, não um sistema clínico validado nem adequado para produção. Usa apenas dados fictícios. Os limiares e regras de alerta são demonstrativos e têm de ser revistos e validados pela equipa clínica antes de qualquer utilização assistencial. A exportação FHIR é uma base de interoperabilidade, não substitui validação de conformidade ou integração institucional.

Em `NODE_ENV=production`, a aplicação exige `JWT_SECRET` e `DATABASE_PATH` dedicados. A configuração de produção, a avaliação de impacto RGPD, a gestão de consentimento institucional, cópias de segurança, retenção e monitorização operacional carecem de implementação e validação próprias.
