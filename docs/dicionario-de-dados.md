# Dicionário de dados

## Âmbito e convenções

Este documento descreve o esquema SQLite implementado pela aplicação Express/TypeScript. O esquema é criado em `src/database/dados-locais.ts` e evolui pelas migrações v1–v4 em `src/database/migrations.ts` e `src/database/migracao_v4_delta.sql`. A ligação usa `better-sqlite3` com chaves estrangeiras ativas.

O modelo canónico tem **27 tabelas**. Os nomes de tabela e coluna são os nomes físicos, em `PascalCase` e `snake_case`, respetivamente. Os tipos SQLite (`TEXT`, `INTEGER`, `REAL`) são afinidades: datas, horas, enumerações e JSON também são armazenados como texto. Salvo indicação, não existe validação SQL de formato para estes textos.

* `PK`: chave primária; `FK`: chave estrangeira; `UQ`: valor único; `NN`: `NOT NULL`; `DF`: valor predefinido; `CHECK`: domínio imposto pela base de dados.
* Várias chaves primárias `TEXT` foram declaradas sem `NOT NULL` explícito. Embora sejam identificadores obrigatórios no modelo e na aplicação, o SQLite pode aceitar `NULL` em algumas chaves primárias não inteiras. Não se deve interpretar a ausência de `NN` como garantia SQL de não nulidade.
* Datas são guardadas como `AAAA-MM-DD`; instantes são textos ISO 8601, normalmente UTC (`...Z`). A aplicação compara os textos de data e hora neste formato.
* Flags inteiras são usadas como booleanos (`0` = não/falso; `1` = sim/verdadeiro), exceto quando o campo representa uma escala.
* `NULL` significa desconhecido, não fornecido, não aplicável ou ainda sem valor, conforme descrito por campo. Não é sinónimo de zero, resposta negativa ou pergunta omitida.

## Índice de tabelas

| Domínio | Tabelas |
|---|---|
| Identidade e acesso | `Utilizador`, `Doente`, `Medico`, `Enfermeiro`, `Cuidador`, `DoenteCuidador` |
| Processo clínico | `DiagnosticoGB`, `FaseClinica`, `Tratamento`, `AvaliacaoKarnofsky`, `Medicacao`, `PlanoMonitorizacao`, `DecisaoAcompanhamento` |
| Questionários | `Formulario`, `PerguntaFormulario`, `OpcaoResposta`, `SubmissaoMonitorizacao`, `RespostaMonitorizacao` |
| Motor e alertas | `RegraAlerta`, `AvaliacaoAlgoritmo`, `MotivoEvidencia`, `InstrucaoEmitida`, `AlertaClinico`, `AlertaSubmissao`, `HistoricoAcaoAlerta` |
| Operação e auditoria | `RegistoAuditoria`, `SchemaMigracao` |

## Identidade e acesso

### `Utilizador`

Entidade de identidade comum aos quatro perfis. `Doente`, `Medico`, `Enfermeiro` e `Cuidador` são especializações por chave partilhada.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_utilizador` | TEXT, PK | Identificador da conta e das especializações. |
| `nome` | TEXT, NN | Nome apresentado. |
| `email` | TEXT, NN, UQ | Identificador de login; a autenticação normaliza o email recebido para minúsculas e remove espaços exteriores. |
| `password_hash` | TEXT, NN | Hash de palavra-passe. O formato atual é `scrypt$<salt>$<hash>`; nunca contém a palavra-passe em claro. |
| `perfil` | TEXT, NN, CHECK | `DOENTE`, `CUIDADOR`, `ENFERMEIRO` ou `MEDICO`. |
| `estado_conta` | TEXT, NN, DF `ATIVA`, CHECK | `ATIVA`, `INATIVA` ou `SUSPENSA`. Só contas ativas autenticam. |
| `criado_em` | TEXT, NN | Instante de criação da conta. |

### `Doente`

Especialização de `Utilizador`; o respetivo `id_doente` é simultaneamente FK para `Utilizador`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_doente` | TEXT, PK, FK → `Utilizador.id_utilizador` | Conta que representa o doente. |
| `numero_processo_clinico` | TEXT, NN, UQ | Número de processo clínico. |
| `data_nascimento` | TEXT, NN | Data de nascimento. |
| `sexo` | TEXT, NN, CHECK | `M`, `F` ou `OUTRO`. |
| `id_medico_responsavel` | TEXT, NN, FK → `Medico.id_medico` | Médico responsável atual. |

### `Medico`

Especialização de `Utilizador`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_medico` | TEXT, PK, FK → `Utilizador.id_utilizador` | Identificador do médico. |
| `cedula_profissional` | TEXT, NN | Número de cédula profissional. |
| `especialidade` | TEXT, NN | Especialidade. |

### `Enfermeiro`

Especialização de `Utilizador`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_enfermeiro` | TEXT, PK, FK → `Utilizador.id_utilizador` | Identificador do enfermeiro. |
| `cedula_profissional` | TEXT, NN | Número de cédula profissional. |
| `servico_hospitalar` | TEXT, NN | Serviço hospitalar a que pertence. |

### `Cuidador`

Especialização de `Utilizador`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_cuidador` | TEXT, PK, FK → `Utilizador.id_utilizador` | Identificador do cuidador. |
| `telefone_contacto` | TEXT, NN | Telefone de contacto. |

### `DoenteCuidador`

Associação entre um doente e um cuidador. O histórico é preservado através das datas e das flags, em vez de apagar necessariamente a associação.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_associacao` | TEXT, PK | Identificador da associação. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente associado. |
| `id_cuidador` | TEXT, NN, FK → `Cuidador.id_cuidador` | Cuidador associado. |
| `grau_parentesco` | TEXT, NN | Relação declarada com o doente. |
| `data_inicio` | TEXT, NN | Início da associação. |
| `data_fim` | TEXT, NULL | Fim, se conhecida; `NULL` enquanto não registada. |
| `autorizacao_validada` | INTEGER, NN, DF `1` | Regista se a autorização do doente foi validada (`0`/`1`). |
| `ativa` | INTEGER, NN, DF `1` | Indica se a associação está ativa (`0`/`1`). |

## Processo clínico

### `DiagnosticoGB`

O modelo admite no máximo um diagnóstico por doente (`id_doente` é único). O tratamento liga-se diretamente ao doente, não a esta tabela.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_diagnostico` | TEXT, PK | Identificador do diagnóstico. |
| `id_doente` | TEXT, NN, UQ, FK → `Doente.id_doente` | Doente diagnosticado; UQ implementa a relação 1:1. |
| `data_diagnostico` | TEXT, NN | Data do diagnóstico. |
| `localizacao_tumoral` | TEXT, NN | Localização tumoral registada. |
| `lateralidade` | TEXT, NN | Lateralidade registada. |
| `estatuto_idh` | TEXT, NN | Estatuto IDH registado. |
| `metilacao_mgmt` | TEXT, NN | Estado de metilação MGMT registado. |
| `fase_clinica_atual` | TEXT, NN | Fase atual no diagnóstico/resumo clínico. O histórico usado para contextualizar registos está em `FaseClinica`. |

### `FaseClinica`

Histórico temporal de fases clínicas; a fase em vigor num dado dia é derivada da linha mais recente cuja `data_inicio` não seja posterior a esse dia.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_fase_clinica` | TEXT, PK | Identificador da ocorrência. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente a que a fase pertence. |
| `fase_clinica` | TEXT, NN | Valor/nome da fase; não há enumeração SQL fechada. |
| `data_inicio` | TEXT, NN | Data a partir da qual a fase se aplica. |

### `Tratamento`

Linha temporal de tratamentos associados diretamente ao doente.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_tratamento` | TEXT, PK | Identificador do tratamento. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente tratado. |
| `tipo` | TEXT, NN | Tipo de tratamento; texto sem enumeração SQL. |
| `estado` | TEXT, NN | Estado do tratamento; texto sem enumeração SQL. |
| `data_inicio` | TEXT, NN | Início do tratamento. |
| `data_fim` | TEXT, NULL | Fim, quando conhecido. |
| `descricao_esquema` | TEXT, NN | Descrição do esquema terapêutico. |

### `AvaliacaoKarnofsky`

Registo histórico da escala de Karnofsky, introduzido por um médico. A validade temporal de 180 dias é uma regra de aplicação, não uma restrição da tabela.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_avaliacao_kps` | TEXT, PK | Identificador da avaliação. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente avaliado. |
| `id_medico` | TEXT, NN, FK → `Medico.id_medico` | Médico que registou a avaliação. |
| `data_avaliacao` | TEXT, NN | Data da avaliação. |
| `score_kps` | INTEGER, NN, CHECK 0–100 | Score KPS. |

### `Medicacao`

Medicação registada pelo médico. A alteração de estado mantém a linha histórica.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_medicacao` | TEXT, PK | Identificador da medicação. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente a quem se destina. |
| `nome` | TEXT, NN | Nome do medicamento. |
| `dose` | TEXT, NN | Dose prescrita, em texto. |
| `via` | TEXT, NN, CHECK | `ORAL`, `ENDOVENOSA`, `SUBCUTANEA`, `INTRAMUSCULAR` ou `OUTRA`. |
| `posologia` | TEXT, NN | Frequência/instruções de toma. |
| `indicacao` | TEXT, NULL | Indicação terapêutica, quando registada. |
| `data_inicio` | TEXT, NN | Data de início. |
| `data_fim` | TEXT, NULL | Data de fim, quando aplicável. |
| `estado` | TEXT, NN, CHECK | `ATIVA`, `SUSPENSA` ou `TERMINADA`. |
| `observacoes` | TEXT, NULL | Observações clínicas. |
| `id_medico_registo` | TEXT, NN, FK → `Medico.id_medico` | Médico que registou a medicação. |
| `data_hora_registo` | TEXT, NN | Instante em que foi registada. |

### `PlanoMonitorizacao`

Plano de periodicidade da monitorização. A aplicação conserva planos anteriores por estado.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_plano` | TEXT, PK | Identificador do plano. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente abrangido. |
| `id_medico` | TEXT, NN, FK → `Medico.id_medico` | Médico que definiu o plano. |
| `modo_periodicidade` | TEXT, NN | Modo de periodicidade; texto sem domínio imposto por SQL. |
| `periodicidade_dias` | INTEGER, NN | Intervalo configurado em dias. |
| `data_definicao` | TEXT, NN | Data em que o plano foi definido. |
| `estado` | TEXT, NN, CHECK | `ATIVO`, `INATIVO` ou `HISTORICO`. |

### `DecisaoAcompanhamento`

Regista a decisão profissional separadamente da recomendação algorítmica.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_decisao` | TEXT, PK | Identificador da decisão. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente a que respeita. |
| `id_medico` | TEXT, NN, FK → `Medico.id_medico` | Médico responsável pela decisão. |
| `id_alerta` | TEXT, NULL, FK → `AlertaClinico.id_alerta` | Alerta associado; `NULL` para decisão não ligada a alerta. |
| `data_hora_decisao` | TEXT, NN | Instante da decisão. |
| `decisao_medica` | TEXT, NN | Ação/decisão tomada. |
| `fundamentacao_clinica` | TEXT, NN | Fundamentação registada. |

## Questionários e respostas

### `Formulario`

Catálogo versionado dos questionários.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_formulario` | TEXT, PK | Identificador estável do formulário. |
| `nome` | TEXT, NN | Nome apresentado. |
| `versao` | INTEGER, NN | Versão do questionário. |
| `estado` | TEXT, NN, CHECK | `ATIVO` ou `INATIVO`. O arranque ativa o formulário v2 e desativa os restantes. |

### `PerguntaFormulario`

Definição de uma pergunta e, se aplicável, da sua condição de apresentação.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_pergunta` | TEXT, PK | Identificador estável da pergunta. |
| `id_formulario` | TEXT, NN, FK → `Formulario.id_formulario` | Formulário a que pertence. |
| `categoria` | TEXT, NN | Categoria/bloco funcional; por exemplo, `ALARME`, `SINTOMA`, `FUNCAO`, `AUTONOMIA` ou `DETALHE`. Não existe CHECK SQL. |
| `enunciado` | TEXT, NN | Texto apresentado ao doente. |
| `tipo_resposta` | TEXT, NN | Tipo de entrada; por exemplo, seleção ou texto livre. |
| `obrigatoria` | INTEGER, NN, DF `1` | Flag de obrigatoriedade. O formulário v2 é submetível parcialmente e as suas perguntas são inseridas como não obrigatórias. |
| `ordem` | INTEGER, NN | Ordem de apresentação dentro do formulário. |
| `ativa` | INTEGER, NN, DF `1` | Flag que indica se a pergunta está ativa. |
| `codigo` | TEXT, NULL | Código funcional (A1, B1, C1, D1, etc.) usado em relatórios e regras. |
| `id_pergunta_pai` | TEXT, NULL, FK → `PerguntaFormulario.id_pergunta` | Pergunta principal que condiciona esta pergunta de detalhe. |
| `valor_minimo_pai` | INTEGER, NULL | Valor mínimo da resposta à pergunta-pai para apresentar o detalhe. |
| `enunciado_cuidador` | TEXT, NULL | Variante do enunciado para o cuidador; se ausente, usa-se o enunciado normal. |

### `OpcaoResposta`

Opções disponíveis para perguntas de seleção.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_opcao` | TEXT, PK | Identificador da opção. |
| `id_pergunta` | TEXT, NN, FK → `PerguntaFormulario.id_pergunta` | Pergunta a que pertence. |
| `rotulo` | TEXT, NN | Texto apresentado ao doente. |
| `valor_codificado` | TEXT, NN | Código estável usado por regras, exportação e análise. |
| `ordem` | INTEGER, NN | Ordem de apresentação. |
| `valor_numerico` | INTEGER, NULL | Valor ordinal/quantitativo da opção, quando aplicável; não avaliável não recebe valor clínico zero. |
| `rotulo_cuidador` | TEXT, NULL | Variante do rótulo para respostas prestadas pelo cuidador. |

### `SubmissaoMonitorizacao`

Cabeçalho imutável do registo submetido. As respostas efetivamente fornecidas ficam em `RespostaMonitorizacao`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_submissao` | TEXT, PK | Identificador da submissão. |
| `id_doente` | TEXT, NN, FK → `Doente.id_doente` | Doente monitorizado. |
| `id_autor` | TEXT, NN, FK → `Utilizador.id_utilizador` | Utilizador que submeteu. |
| `id_formulario` | TEXT, NN, FK → `Formulario.id_formulario` | Versão exata do questionário respondido. |
| `id_plano` | TEXT, NULL, FK → `PlanoMonitorizacao.id_plano` | Plano de monitorização associado, se existente. |
| `data_hora_submissao` | TEXT, NN | Instante efetivo da submissão. |
| `data_referencia_sintomas` | TEXT, NN | Data de referência das respostas/sintomas. |
| `perfil_autor_no_registo` | TEXT, NN | Perfil do autor no momento do registo; preserva o contexto de autoria. |

### `RespostaMonitorizacao`

Uma linha por pergunta respondida numa submissão. O índice único `(id_submissao, id_pergunta)` impede respostas duplicadas à mesma pergunta no mesmo registo.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_resposta` | TEXT, PK | Identificador da resposta. |
| `id_submissao` | TEXT, NN, FK → `SubmissaoMonitorizacao.id_submissao` | Submissão a que pertence. |
| `id_pergunta` | TEXT, NN, FK → `PerguntaFormulario.id_pergunta` | Pergunta respondida. |
| `id_opcao` | TEXT, NULL, FK → `OpcaoResposta.id_opcao` | Opção escolhida. É `NULL` para texto livre ou quando não há uma opção associada. |
| `valor_numerico` | INTEGER, NULL | Valor derivado da opção, se houver. `NULL` mais `motivo_nao_avaliavel = 1` representa resposta não avaliável; `0` representa uma resposta avaliável de nível zero. |
| `motivo_nao_avaliavel` | INTEGER, NN, DF `0` | Flag que distingue explicitamente uma resposta fornecida, mas impossível de avaliar (`1`). |
| `frequencia` | TEXT, NULL | Frequência indicada quando a pergunta a admite; é independente da intensidade. |
| `novo_ou_pior` | INTEGER, NULL | Flag de sintoma novo/pior (`0`/`1`); `NULL` significa não indicado/não aplicável. |
| `texto` | TEXT, NULL | Resposta livre, como a mensagem B20 para a equipa. |

## Questionário de monitorização v2

A versão ativa tem o identificador `form-gbm-v2`, definido em `src/database/formulario-v2.ts`. Os códigos são armazenados em `PerguntaFormulario.codigo`; os textos exatos e as opções estão nessa fonte, que é a definição normativa do formulário. A coluna `id_pergunta` é a chave persistida e não deve ser substituída pelo código funcional.

| Código(s) | Categoria | Conteúdo |
|---|---|---|
| A1; A1a–A1c | Alarme; detalhes | Convulsão; duração, número e recuperação. |
| A2–A9 | Alarme | Cefaleia súbita; sonolência/confusão súbita; défice neurológico súbito; temperatura; falta de ar/dor torácica; perna inchada/quente/dolorosa; hemorragia/equimoses; vómitos persistentes. |
| B1; B1a–B1c | Sintoma; detalhes | Cefaleia; relação com manhã/noite, analgesia e diferença do habitual. |
| B2–B5 | Sintomas | Náuseas, vómitos, sonolência diurna e cansaço. |
| B3a | Detalhe | Número de episódios de vómito nas últimas 24 horas. |
| B6; B6a | Sintoma; detalhe | Visão turva/dupla; confirmação de visão dupla. |
| B7–B14 | Sintomas | Memória/concentração, fala, compreensão, comportamento, tristeza, ansiedade, apetite e dormência/formigueiros. |
| B15; B15a | Sintoma; detalhe | Diarreia; dejeções acima do habitual por dia. |
| B16–B19 | Sintomas | Obstipação, sono, deglutição/engasgamento e confusão/desorientação. |
| B18a | Detalhe | Engasgamento com líquidos. |
| B20 | Texto livre | Outra preocupação para a equipa; não é score ordinal nem entra nas regras do motor. |
| C1–C4 | Função | Marcha/equilíbrio, força, quedas nos últimos sete dias e controlo da bexiga. |
| D1 | Autonomia | Ajuda necessária nas atividades do dia a dia. |

As perguntas A usam em geral `NAO`/`SIM` (valores numéricos 0/1), e os detalhes usam as opções específicas declaradas no formulário. Sintomas e funções usam escalas ordinais próprias, com opções codificadas, normalmente de `AUSENTE` a `GRAVE`. As perguntas que suportam essa opção também disponibilizam `IMPOSSIVEL_AVALIAR`, com `motivo_nao_avaliavel = 1` e `valor_numerico = NULL`. A combinação de opção, pergunta e versão deve ser consultada no catálogo; não se deve inferir significado clínico só a partir do número.

## Motor de alertas e triagem

### `RegraAlerta`

Catálogo descritivo associado aos alertas. As regras executáveis e pesos atuais residem no código do motor, não são carregados dinamicamente desta tabela.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_regra` | TEXT, PK | Identificador da regra. |
| `nome` | TEXT, NN | Nome legível. |
| `tipo_regra` | TEXT, NN | Código de agrupamento. |
| `criterio_documentado` | TEXT, NN | Descrição do critério. |
| `referencia_literatura` | TEXT, NN | Referência ou nota documental; não implica validação clínica. |
| `versao` | TEXT, NN | Versão documental da regra. |
| `validada_clinicamente` | INTEGER, NN, DF `1` | Flag de validação declarada (`0`/`1`); os limiares desta aplicação são demonstrativos e não validados clinicamente. |
| `ativa` | INTEGER, NN, DF `1` | Flag de ativação (`0`/`1`). |

### `AvaliacaoAlgoritmo`

Resultado de uma execução do motor sobre uma submissão e uma versão de parâmetros. Chave primária composta `(id_submissao, versao_parametros)`. Sem `ON DELETE CASCADE`: a avaliação é um registo de auditoria. Triggers impedem `UPDATE` e `DELETE`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_submissao` | TEXT, NN, PK composta, FK → `SubmissaoMonitorizacao.id_submissao` | Submissão avaliada. |
| `versao_parametros` | TEXT, NN, PK composta | Identificador da versão do motor/parâmetros. Permite avaliações distintas da mesma submissão. |
| `score` | REAL, NULL | Score calculado quando a camada comparativa pode ser avaliada. |
| `cobertura` | REAL, NULL | Fração de cobertura das respostas avaliáveis. |
| `linha_de_base` | REAL, NULL | Mediana de score de referência, quando disponível. É dado derivado. |
| `variabilidade_linha_de_base` | REAL, NULL | MAD não escalada da linha de base, quando calculável. |
| `limiar_score` | REAL, NULL | Limiar usado na comparação. |
| `dados_nao_avaliaveis` | TEXT, NN, DF `[]` | JSON com itens/respostas não avaliáveis. |
| `motivos_json` | TEXT, NN, DF `[]` | JSON legado/compacto com motivos; os motivos normalizados também estão em `MotivoEvidencia`. |
| `prioridade_algoritmo` | TEXT, NULL | Prioridade produzida pelo motor; `NULL` quando não há motivo que gere prioridade. Não é a prioridade humana após triagem. |
| `tipo_regra` | TEXT, NULL | Tipo de regra principal associado, quando aplicável. |
| `contexto_linha_base` | TEXT, NN, DF `{}` | JSON do contexto usado para selecionar registos comparáveis. |
| `data_hora_avaliacao` | TEXT, NN | Instante em que o motor foi executado. |
| `estado` | TEXT, NN, DF `CONCLUIDA`, CHECK | `CONCLUIDA` ou `ERRO`. |
| `erro` | TEXT, NULL | Mensagem técnica se `estado = 'ERRO'`; não representa um resultado clínico. |

### `MotivoEvidencia`

Motivo individual que fundamenta uma avaliação. PK composta `(id_submissao, versao_parametros, ordem)` e FK composta para `AvaliacaoAlgoritmo`. Triggers impedem atualização e remoção.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_submissao` | TEXT, NN, PK composta | Submissão avaliada. |
| `versao_parametros` | TEXT, NN, PK composta | Versão da avaliação. |
| `ordem` | INTEGER, NN, PK composta | Posição do motivo na avaliação. |
| `texto` | TEXT, NN | Explicação legível do motivo. |
| `prioridade` | TEXT, NN | Prioridade atribuída ao motivo. |
| `tipo` | TEXT, NN | Tipo específico do motivo. |
| `codigos_json` | TEXT, NN | JSON com códigos/perguntas que constituem a evidência. |

### `InstrucaoEmitida`

Instrução emitida na avaliação. PK composta `(id_submissao, versao_parametros, ordem)` e FK composta para `AvaliacaoAlgoritmo`. Triggers impedem atualização e remoção.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_submissao` | TEXT, NN, PK composta | Submissão avaliada. |
| `versao_parametros` | TEXT, NN, PK composta | Versão da avaliação. |
| `ordem` | INTEGER, NN, PK composta | Ordem das instruções. |
| `codigo` | TEXT, NN, CHECK | `LIGAR_112`, `CONTACTAR_JA` ou `CONTACTAR_HOJE`. |

### `AlertaClinico`

Alerta apresentado para triagem. A prioridade guardada em `prioridade` pode ser ajustada pelo profissional; `prioridade_algoritmo` preserva a recomendação automática.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_alerta` | TEXT, PK | Identificador do alerta. |
| `id_submissao` | TEXT, NN, FK → `SubmissaoMonitorizacao.id_submissao` | Submissão que originou o alerta. |
| `id_regra` | TEXT, NN, FK → `RegraAlerta.id_regra` | Regra/categoria documental associada. |
| `data_hora_geracao` | TEXT, NN | Instante de geração. |
| `origem_gatilho` | TEXT, NN | Código/contexto que desencadeou o alerta. |
| `prioridade` | TEXT, NN, CHECK | Prioridade atual: `Baixa`, `Média`, `Alta` ou `Crítica`. |
| `estado_atual` | TEXT, NN, CHECK | `Pendente`, `Em análise`, `Encaminhado` ou `Concluído`. |
| `resumo_agravamento` | TEXT, NN | Resumo para triagem. |
| `prioridade_algoritmo` | TEXT, NULL | Prioridade inicial do motor, distinta da prioridade atual. |
| `id_alerta_anterior` | TEXT, NULL, FK autorreferente → `AlertaClinico.id_alerta` | Alerta anterior ligado a um escalonamento. |

### `AlertaSubmissao`

Relação muitos-para-muitos entre alertas e submissões associadas; permite mostrar todos os registos relacionados com um alerta. PK `(id_alerta, id_submissao)`. As duas FKs usam `ON DELETE CASCADE`.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_alerta` | TEXT, NN, PK composta, FK → `AlertaClinico.id_alerta` | Alerta relacionado. |
| `id_submissao` | TEXT, NN, PK composta, FK → `SubmissaoMonitorizacao.id_submissao` | Submissão relacionada. |
| `tipo_associacao` | TEXT, NN, DF `ORIGINAL`, CHECK | `ORIGINAL`, `MOTIVO_REPETIDO`, `MOTIVO_NOVO` ou `ESCALONAMENTO`. |

### `HistoricoAcaoAlerta`

Histórico de alterações de triagem. Não substitui a avaliação imutável do algoritmo.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_acao` | TEXT, PK | Identificador da ação. |
| `id_alerta` | TEXT, NN, FK → `AlertaClinico.id_alerta` | Alerta alterado. |
| `id_utilizador` | TEXT, NN, FK → `Utilizador.id_utilizador` | Profissional que realizou a ação. |
| `data_hora_acao` | TEXT, NN | Instante da ação. |
| `tipo_acao` | TEXT, NN | Tipo de ação registada. |
| `estado_anterior` | TEXT, NN | Estado antes da ação. |
| `estado_novo` | TEXT, NN | Estado depois da ação. |
| `nota_triagem` | TEXT, NN | Nota/motivo da triagem. |
| `prioridade_anterior` | TEXT, NULL | Prioridade antes da ação, se alterada/conhecida. |
| `prioridade_nova` | TEXT, NULL | Prioridade depois da ação, se alterada/conhecida. |

## Operação e auditoria

### `RegistoAuditoria`

Registo de eventos de auditoria da aplicação. Os detalhes são texto descritivo, não uma estrutura JSON com esquema garantido.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `id_auditoria` | TEXT, PK | Identificador do evento. |
| `id_utilizador` | TEXT, NN, FK → `Utilizador.id_utilizador` | Utilizador responsável pelo evento. |
| `acao` | TEXT, NN | Código da ação. |
| `detalhes` | TEXT, NN | Descrição contextual. |
| `data_hora` | TEXT, NN | Instante do evento. |

### `SchemaMigracao`

Controlo interno das migrações aplicadas; não contém dados clínicos.

| Campo | Tipo e restrições | Significado |
|---|---|---|
| `versao` | INTEGER, PK | Número sequencial da migração aplicada. |
| `aplicada_em` | TEXT, NN | Instante em que a migração foi registada. |

## Integridade, índices e imutabilidade

* As FKs são verificadas pelo SQLite (`foreign_keys = ON`). Salvo `AlertaSubmissao`, não há cascatas de eliminação declaradas no esquema canónico. A remoção de entidades referenciadas é, por omissão, recusada (`NO ACTION`).
* O diagnóstico impõe unicidade de `id_doente`; o email e o número de processo também são únicos.
* Índices funcionais: `(id_submissao, id_pergunta)` único em `RespostaMonitorizacao`; `(id_doente, data_hora_submissao)` em `SubmissaoMonitorizacao`; `(id_doente, id_formulario, data_referencia_sintomas, data_hora_submissao)` para comparação temporal; `(contexto_linha_base, id_submissao, versao_parametros)` para avaliações; e `(id_doente, data_inicio, id_fase_clinica)` para fases.
* Seis triggers da migração v4 rejeitam `UPDATE` e `DELETE` em `AvaliacaoAlgoritmo`, `MotivoEvidencia` e `InstrucaoEmitida`. Estes resultados são append-only; uma nova versão dos parâmetros cria uma nova avaliação.
* Não há uma tabela física de linha de base: score, linha de base, cobertura e contexto são resultados derivados e persistidos por execução em `AvaliacaoAlgoritmo`.

## Semântica dos nulos e ausências

| Situação | Representação persistida | Interpretação |
|---|---|---|
| Resposta avaliável negativa/ausente | Linha em `RespostaMonitorizacao`, `valor_numerico = 0`, `motivo_nao_avaliavel = 0` | Resposta efetiva de nível zero; não significa omissão. |
| Resposta avaliável positiva | Linha existente, valor ordinal/numérico, flag `0` | Valor efetivamente escolhido. |
| Resposta «Não consigo avaliar» | Linha existente, `valor_numerico = NULL`, `motivo_nao_avaliavel = 1` | Pergunta respondida, dado não avaliável; não se converte em zero. |
| Pergunta omitida | Sem linha em `RespostaMonitorizacao` para aquela pergunta/submissão | Não foi fornecida resposta; diferente de «não consigo avaliar». Submissões parciais são permitidas. |
| Texto livre | Linha com `texto`; normalmente `id_opcao` e `valor_numerico` a `NULL` | Texto não ordinal; B20 não entra no score/regras. |
| Frequência não indicada | `frequencia = NULL` | Não foi informada frequência; não equivale a intensidade ou frequência zero. |
| Novo/pior não indicado | `novo_ou_pior = NULL` | Sem indicação para a flag; `0` e `1` são respostas explícitas. |
| Sem KPS vigente | Não há avaliação aplicável, ou a mais recente excede 180 dias à data de referência | KPS desconhecido/expirado; não tratar como 100 nem 0. |
| Sem prioridade algorítmica | `AvaliacaoAlgoritmo.prioridade_algoritmo = NULL` | Execução concluída sem prioridade calculada; não é a prioridade decidida pela equipa. |
| Motor falhou | `estado = 'ERRO'`, `erro` preenchido | Submissão e respostas persistem; score, cobertura e prioridade não representam resultado válido. |
| Sem alerta associado a decisão | `DecisaoAcompanhamento.id_alerta = NULL` | Decisão profissional sem ligação a um alerta específico. |
| Data de fim desconhecida/em curso | Campo `data_fim = NULL` nas tabelas aplicáveis | Não há data de fim registada; verificar o estado antes de concluir que está em curso. |

## Dados derivados e interoperabilidade

* Idade, KPS vigente/expirado, cobertura do plano e linha de base são calculados pela aplicação; não são colunas próprias de `Doente`.
* A linha de base é a mediana dos primeiros três scores elegíveis e comparáveis do contexto. O limiar atual é `max(5, 0,1 × S₀, 2 × MAD)` com MAD não escalada e cobertura mínima de 60%. Estes são parâmetros demonstrativos, não validados clinicamente.
* A fase clínica histórica está em `FaseClinica`; a fase aplicável ao registo é determinada pela data de referência. Contexto de score também considera cirurgia e alterações KPS relevantes, sem uma coluna física dedicada a «linha de base».
* A exportação FHIR constrói recursos a partir dos dados atuais (por exemplo, `Patient`, `Condition`, `Observation`, `Questionnaire`, `QuestionnaireResponse` e `DetectedIssue`). Estes recursos não são tabelas persistidas pelo esquema canónico.

## Artefactos locais fora do esquema canónico

Foi observada no ficheiro local `data.db` a existência das tabelas `FhirPatientSync` e `FhirSyncState`. Não estão declaradas em `src/database`, não são referenciadas pelo código atual e não são criadas pelas migrações versionadas; podem ser resíduos de uma experiência anterior. São listadas para explicar a diferença entre uma base local existente e uma base criada apenas pelo código atual, mas **não fazem parte do modelo suportado**:

| Tabela | Campos observados na base local | Observação |
|---|---|---|
| `FhirPatientSync` | `server_url` (TEXT, PK composta), `fhir_patient_id` (TEXT, PK composta), `id_doente` (TEXT, FK → `Doente.id_doente`, UQ por servidor/doente), `last_updated` (TEXT) | Mapeamento de paciente por servidor, sem consumidor no código atual. |
| `FhirSyncState` | `server_url` (TEXT, PK), `last_updated` (TEXT) | Estado de sincronização por servidor, sem consumidor no código atual. |

Não remover estas tabelas de uma base existente sem verificar a origem e a eventual necessidade de compatibilidade.
