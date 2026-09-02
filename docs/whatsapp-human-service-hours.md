# Horário de atendimento humano no WhatsApp

## Regra funcional

A IA continua disponível 24 horas por dia. O horário configurado é consultado
somente quando uma decisão já determinou que a sessão precisa ser encaminhada
para atendimento humano; ele não limita geração normal da IA nem cria um
agendador de abertura.

O destino segue esta precedência, sempre dentro do mesmo tenant:

1. departamento explicitamente decidido pelo fluxo;
2. departamento atual da conversa;
3. departamento proprietário do canal, quando os anteriores não puderem ser
   resolvidos.

A fila ativa de maior peso do departamento é usada. Quando o departamento ainda
não possui fila, é criado idempotentemente o destino padrão `Atendimento`; não
existe uma fila paralela de “triagem humana”.

## Formato da configuração

`Company.humanServiceHours` contém o padrão do tenant e
`TenantDepartment.humanServiceHoursOverride` pode substituí-lo integralmente:

```json
{
  "timeZone": "America/Sao_Paulo",
  "weekly": {
    "1": [{ "start": "08:00", "end": "18:00" }],
    "2": [{ "start": "08:00", "end": "18:00" }],
    "3": [{ "start": "08:00", "end": "18:00" }],
    "4": [{ "start": "08:00", "end": "18:00" }],
    "5": [{ "start": "08:00", "end": "18:00" }]
  },
  "holidays": ["2026-09-07"],
  "exceptions": {
    "2026-12-24": [{ "start": "08:00", "end": "12:00" }],
    "2026-12-25": "closed"
  }
}
```

Os dias usam `0` para domingo e `6` para sábado. O início é inclusivo, o fim é
exclusivo e cada intervalo deve terminar no mesmo dia. Exceções têm precedência
sobre feriados, que têm precedência sobre a semana regular. Fusos IANA, datas,
intervalos e sobreposições são validados antes do roteamento. Configuração nula
preserva o comportamento legado de atendimento humano sempre disponível.

`Company.offHoursHandoffMessage` é a única mensagem do tenant usada fora do
horário. Ela deve ser voltada ao cliente e não deve expor detalhes internos de
fila, nomes de agentes ou infraestrutura.

## Fronteira transacional

O `forward` automático é uma única mutação em
`PrismaWhatsAppRepository.transition`:

- bloqueia o comando e a conversa por tenant;
- revalida versão e autoria da execução de IA;
- resolve departamento, horário e fila;
- muda a sessão para `WAITING_HUMAN`, `controlMode=HUMAN` e associa a fila;
- encerra a atribuição ativa e cria uma atribuição automática na fila;
- quando fora do horário, grava `offHoursHandoffNotifiedAt` junto da mudança de
  sessão e só então considera adquirida a notificação única;
- persiste mensagem `pending` e tentativa antes do outbox
  `whatsapp.outbound.requested`;
- grava `ServiceSessionEvent`, `WhatsAppConversationTransition` e
  `TenantAuditLog` com versões e decisão de horário.

O lock da conversa, o predicado otimista `ServiceSession.version` e as chaves
únicas de comando impedem duas decisões concorrentes de adquirirem o mesmo
claim. Se a sessão já possui `offHoursHandoffNotifiedAt`, ela continua na fila e
em controle humano sem criar outra mensagem. Durante o horário, a resposta
contextual gerada pela IA é persistida pelo mesmo outbox antes da transferência.

O início posterior do expediente não envia mensagens, não remove a sessão da
fila, não troca `controlMode` e não reativa a IA. Um atendente pode responder
fora do horário pelas regras operacionais já existentes.

## Prioridade da sessão

A decisão silenciosa do orquestrador pode produzir `low`, `normal`, `high` ou
`urgent` com justificativa. O provider carrega essa decisão durável até a mesma
transação que persiste o outbound ou o handoff. A sessão recebe
`prioritySource=AI_AGENT`, atualização por versão esperada e um
`ServiceSessionEvent` atribuído ao agente; a execução de agente precisa pertencer
ao tenant e à sessão e estar concluída com sucesso.

## Operação atual

Esta fatia apenas consome os campos de configuração introduzidos pela migration
`20260829000400_human_service_hours`; ela não adiciona um endpoint administrativo
novo. Até existir uma tela contratada para configurações do tenant, alterações
devem passar pelo procedimento administrativo controlado, com JSON validado pelo
mesmo formato acima. Nenhuma migration é aplicada automaticamente por este
fluxo.
