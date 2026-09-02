# Cancelamento preserva a etapa do processo

`Cancelado` não será um estado genérico compartilhado por todo o ciclo. O Lume
distingue oportunidade abandonada, orçamento recusado, aceite cancelado,
viagem confirmada cancelada, viagem interrompida e contrato contínuo encerrado.
Cada evento registra etapa, solicitante ou executor, motivo, data/hora e
efeitos, sem apagar o histórico anterior.

Uma viagem que já iniciou não é cancelada: ela pode ser suspensa e retomada ou
interrompida e encerrada antecipadamente. Multas, reembolsos, liberação de
recursos, documentos e indicadores seguem a contratação e a versão da política
aplicável; exceções exigem a aprovação prevista na matriz da empresa operadora.
