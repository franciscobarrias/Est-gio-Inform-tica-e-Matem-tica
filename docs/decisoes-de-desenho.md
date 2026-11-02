# Decisões de desenho

- **Imutabilidade:** as avaliações, motivos e instruções emitidas são registos de auditoria; triggers SQLite impedem atualização e remoção. Correções de algoritmo geram nova versão de parâmetros, não alteram a avaliação histórica.
- **Algoritmo e decisão humana separados:** a avaliação guarda prioridade algorítmica, motivos e instruções; triagem profissional guarda estado, prioridade atual e histórico de ações. O motor não substitui a decisão do profissional.
- **Versionamento:** cada submissão identifica o formulário/questionário usado; cada avaliação é identificada pela submissão e versão dos parâmetros. A mesma submissão pode ser avaliada sob versões distintas sem sobrescrever resultados.
- **Linha de base derivada:** a mediana é calculada a partir de registos elegíveis dentro do contexto clínico; não é um valor editável independente. O contexto considera fase clínica histórica, cirurgia e alterações KPS relevantes.
- **Falha isolada:** a submissão e respostas são confirmadas antes da avaliação. Falhas do motor são guardadas como avaliação com estado `ERRO` e mensagem, sem apagar a submissão.
- **Persistência atual:** a aplicação usa SQLite, `better-sqlite3` e SQL direto. TypeORM, repositórios e reprocessamento automático são arquitetura não implementada e não devem ser representados como componentes existentes.

As regras e thresholds atuais são exploratórios e não validados clinicamente. Ver [métodos e simulação](./metodos-e-simulacao.md) para os pressupostos e limites da coorte sintética.
