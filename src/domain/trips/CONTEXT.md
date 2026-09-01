# Operação de Viagens

Este contexto mantém o serviço operacional programado e o que efetivamente
ocorre durante sua execução, sem confundi-lo com a negociação ou o plano de
rota.

## Linguagem

**Viagem**:
Serviço operacional criado manualmente a partir de um serviço confirmado ou de
um contrato contínuo.
_Evite_: Orçamento, serviço proposto, rota

**Origem da Viagem**:
Referência versionada ao serviço confirmado ou contrato contínuo que autorizou
a criação da viagem.
_Evite_: Texto de origem, conversa do WhatsApp

**Trecho**:
Parte ordenada de uma viagem, como ida, volta, deslocamento local, linha ou
turno.
_Evite_: Parada, viagem independente

**Programação da Viagem**:
Plano operacional vigente de data e trechos de uma viagem antes do início da
execução.
_Evite_: Execução da rota, orçamento

**Versão Programada**:
Retrato imutável de uma programação autorizada em um momento específico.
_Evite_: Rascunho editável

**Plano de Rota Selecionado**:
Versão aprovada de um Plano de Rota escolhida para orientar uma Viagem. A
seleção é congelada no início e não representa, por si só, o trajeto realizado.
_Evite_: Programação da Viagem, rota executada

**Execução da Viagem**:
Período iniciado em que fatos operacionais passam a representar o que ocorreu,
e não alterações comuns da programação.
_Evite_: Programação, plano de rota

**Ocorrência**:
Registro de um fato relevante observado durante a execução, com responsável,
motivo, momento e evidências aplicáveis.
_Evite_: Observação livre, edição da programação

**Desvio de Execução**:
Ocorrência que identifica diferença entre a programação vigente e aquilo que
foi efetivamente executado.
_Evite_: Revisão da programação

**Suspensão**:
Parada temporária e reversível de uma viagem em execução.
_Evite_: Interrupção, cancelamento

**Interrupção**:
Decisão definitiva de não retomar uma viagem que já iniciou, sustentada por
motivo e evidências.
_Evite_: Suspensão, cancelamento

**Encerramento Antecipado**:
Resultado terminal de uma viagem interrompida, preservando a execução realizada
até aquele momento.
_Evite_: Cancelamento

**Cancelamento de Viagem**:
Encerramento de uma viagem programada antes do início de sua execução.
_Evite_: Recusa de orçamento, interrupção
