# Coordenação de prioridade entre atendimentos

## Regra efetiva

Cada `ServiceSession` possui uma urgência (`LOW`, `NORMAL`, `HIGH` ou
`URGENT`) e herda um peso organizacional configurável. O peso usado é o da
`ServiceQueue` explicitamente vinculada à sessão; sem fila explícita, usa-se a
fila habilitada de maior `priorityWeight` no departamento atual; sem ambos, o
peso é zero.

A urgência é sempre a dimensão primária. O peso organizacional desempata
somente sessões na mesma faixa de urgência. Isso impede que um peso elevado
rebaixe semanticamente uma urgência real.

Empate exato preserva o foreground atual (`current-foreground-wins`). Essa
política é deliberadamente estável e evita alternância entre duas sessões com
o mesmo score.

## Transição operacional

Os comandos reais de atendimento (`assume`, `transfer`, `change-priority` e
`close-human`) convergem em `PrismaServiceSessionManagementRepository.mutate`.
A coordenação ocorre dentro da mesma transação `Serializable` do comando:

1. adquire locks consultivos por `companyId + commandId` e por
   `companyId + threadId`;
2. revalida tenant, acesso, versão e foreground;
3. se o desafiante for estritamente superior, muda o foreground atual para
   `PAUSED_BY_HIGHER_PRIORITY` e promove o desafiante;
4. quando o foreground superior fecha, restaura o predecessor elegível ligado
   ao evento de interrupção;
5. persiste eventos e auditoria para as duas sessões.

`controlMode`, assignment, departamento, fila e `sourceChannelId` não são
alterados pela pausa ou retomada. Cada update lateral usa CAS com
`companyId + version + isForeground`. Uma falha concorrente aborta toda a
transação.

## Pilha de retomada

O vínculo `interruptedBySessionId` é gravado no metadata do evento
`priority-interrupted`. Ao fechar ou perder prioridade, uma sessão só pode
retomar predecessores pausados cujo evento mais recente a aponte como
interrompedora. Entre predecessores elegíveis, vence a prioridade efetiva;
persistindo empate, vence a pausa mais recente e depois o menor `sessionId`.

Os eventos laterais usam `commandId` derivado deterministicamente do comando
principal. O replay do comando principal retorna o estado persistido sem
reaplicar pausa, retomada ou auditoria.

## Limite atual

O encerramento humano passa por essa coordenação. O worker de encerramento
automático da IA ainda vive no façade legado `PrismaWhatsAppRepository` e deve
usar a mesma política antes de fechar a conversa legada quando houver um
predecessor pausado; até essa integração, o fechamento automático não promove
um predecessor.
