# Métodos e simulação

## Métodos — dados, score e linha de base

As respostas são persistidas sem converter omissão ou «não consigo avaliar» em zero. O score ponderado é normalizado para 0–100 sobre as respostas avaliáveis, e a cobertura é a fração do peso máximo efetivamente observado. O score comparativo requer cobertura de pelo menos 60% e três registos anteriores elegíveis e comparáveis; estes têm de pertencer à mesma versão de parâmetros e contexto, e as janelas de recordação de sete dias não se podem sobrepor.

A linha de base é a mediana dos três primeiros scores elegíveis do contexto. O limiar ativo é `max(5, 0,1 × S₀, 2 × MAD)`, usando MAD não escalada. A camada comparativa e a regra de declínio neurológico usam registos elegíveis comparáveis. O contexto considera a fase clínica vigente à data do registo, a cirurgia mais recente e um marco KPS apenas quando a variação entre avaliações consecutivas é de pelo menos 20 pontos ou cruza 70. A expiração KPS aos 180 dias não cria, por si só, um novo contexto. Estas escolhas são parâmetros demonstrativos, não validados clinicamente.

O corte de duas respostas cognitivas não avaliáveis evita tratar uma única resposta desconhecida como evidência de insuficiência cognitiva global, sem a converter em ausência de sintoma; é uma regra operacional, ainda sem validação clínica. A janela KPS de 180 dias é uma política conservadora de atualidade para não aplicar indefinidamente uma avaliação funcional antiga; não representa uma validade clínica estabelecida e requer confirmação da equipa.

## Resultados — coorte sintética reproduzível

Executar `npx ts-node src/simulacoes/estudo-limiar.ts` imprime a tabela JSON. A simulação usa 500 trajetórias estáveis e 500 com progressão sintética, 52 observações semanais e sementes fixas. A coorte estável recebe ruído normal independente com desvio-padrão sorteado entre 2 e 5 pontos; a coorte progressiva começa a aumentar linearmente depois da semana 12. Mede-se a proporção de doentes estáveis com pelo menos um falso alarme por doente-mês, a taxa de deteção e a mediana de dias até à deteção entre os casos detetados.

Comparam-se a regra atual; MAD multiplicada por 1,4826; variação relativa de 10% do intervalo restante até 100; persistência de dois registos; e linhas de base com k=4 e k=5. O corte relativo de 10% é uma hipótese de simulação, não uma recomendação clínica. O script e a semente permitem repetir os valores; o resultado é apenas sensibilidade a pressupostos sintéticos e não estima desempenho clínico real.

| Variante | Falsos alarmes por doente-mês | Detetados | Mediana até deteção |
|---|---:|---:|---:|
| Atual: `max(5; 0,1×S₀; 2×MAD)` | 0,0589 | 62,0% | 21 dias |
| MAD escalada: `2×1,4826×MAD` | 0,0522 | 67,6% | 21 dias |
| Variação relativa de 10% | 0,0600 | 62,8% | 21 dias |
| Persistência: 2 registos | 0,0242 | 91,6% | 28 dias |
| Linha de base k=4 | 0,0639 | 62,8% | 21 dias |
| Linha de base k=5 | 0,0607 | 67,4% | 21 dias |

Com uma submissão semanal e linha de base de k registos, há `7 × k` dias desde o primeiro registo até à disponibilidade da camada comparativa (21 dias para k=3; 28 para k=4; 35 para k=5). A falta de cobertura ou intervalos maiores prolongam este período.
