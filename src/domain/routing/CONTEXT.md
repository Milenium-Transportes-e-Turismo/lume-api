# Planejamento de Rotas

Este contexto produz e aprova planos de trajeto para uma viagem, sem representar
o estado comercial ou a execução operacional do serviço.

## Linguagem

**Plano de Rota**:
Planejamento versionado de trajeto, paradas, horários e recursos de uma viagem.
_Evite_: Rota executada, rota sem qualificação

**Plano Aprovado**:
Versão imutável do plano de rota autorizada para orientar a execução.
_Evite_: Rascunho editável

**Parada Planejada**:
Ponto ordenado de embarque, desembarque ou passagem pertencente a um plano.
_Evite_: Trecho, ocorrência

**Replanejamento**:
Nova versão do plano criada antes da execução ou como resposta formal a uma
necessidade operacional.
_Evite_: Desvio executado, edição do histórico
