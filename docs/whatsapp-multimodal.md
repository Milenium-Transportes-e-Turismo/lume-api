# WhatsApp multimodal

## Escopo e invariantes

A ingestão Evolution cria um `MediaAsset` tenant-isolated para cada mídia de
mensagem direta. Mensagens de grupo usam a infraestrutura própria de grupos,
preservam o binário quando disponível e mantêm IA desligada: elas não criam
`WhatsAppConversation`, `WhatsAppThread` ou `ServiceSession`.

- áudio, imagem, documento, planilha, localização e contato são elegíveis;
- vídeo e sticker/other são preservados como `UNSUPPORTED`, sem extração de
  frames, faixa de áudio ou chamada ao modelo;
- o índice único `(mediaAssetId, companyId)`, o advisory lock e o claim
  transacional garantem no máximo uma interpretação automática ou manual;
- falha de retenção/interpretação não apaga nem invalida a mensagem e uma
  falha não interrompe o lote do worker;
- interpretação e correção não alteram `ServiceSession.controlMode`;
- a correção humana é imutável, auditada por hash no `TenantAuditLog` e tem
  precedência sobre summary, transcription, extractedText e structuredData no
  contexto entregue à automação;
- documentos e planilhas recebem `validationStatus=HUMAN_REQUIRED`; o retorno
  preserva chunks, páginas e provenance por registro tenant-scoped.

## Persistência relacional e compatibilidade

`MediaInterpretation.validationStatus` é um campo explícito. Cada trecho fica
em `MediaInterpretationChunk`, relacionado por `(interpretationId, companyId)`,
com `ordinal`, `pageNumber`, conteúdo, SHA-256 e provenance própria. A chave
única `(companyId, interpretationId, ordinal)` impede duplicação dentro da
interpretação, enquanto `(mediaAssetId, companyId)` continua garantindo no
máximo uma interpretação por mídia.

Durante a transição, a conclusão faz dual-write: `validationStatus` e `chunks`
continuam presentes em `structuredData`, e a provenance resumida continua em
`MediaInterpretation.provenance`. A migration incremental retroalimenta os
registros relacionais a partir desses JSONs sem apagá-los ou reescrevê-los.
Leituras novas usam os campos relacionais. A correção humana permanece em
registro separado e sempre vence a interpretação original em
`effectiveContext`.

O parâmetro booleano `processDuringHumanControl` da versão ativa de runtime do
agente controla o processamento automático quando a sessão está em HUMAN. O
default seguro é `false`. A ação manual continua disponível com a permissão
operacional existente `whatsapp-conversations:manage`.

Esse controle já está funcional: o repositório carrega o parâmetro da versão
ativa do runtime do tenant e o caso de uso adia apenas a execução automática
quando ele está desligado. Não há configuração global nem alteração de
`controlMode` nesse fluxo.

## Credenciais e provider

O agente é selecionado por tenant pelo código exato `media-specialist`. A
configuração ativa fornece `credentialRef` e `credentialIdentifier`; somente o
`AgentCredentialResolver` server-side pode materializar a chave durante a
chamada. O adapter não lê `WHATSAPP_AI_OPENAI_API_KEY`, `OPENAI_API_KEY` ou a
credencial de outro agente.

OpenAI é o único adapter registrado hoje. O banco e os contratos persistem o
provider como string; `MediaInterpretationGatewayRegistry` mantém a fronteira
extensível sem habilitar providers alternativos nesta versão. Imagens e arquivos
são enviados pela Responses API. Áudio é transcrito server-side e então passa
pela mesma resposta estruturada.

## API operacional

- `GET /whatsapp/conversations/:conversationId/messages/:messageId/media-interpretation`
- `POST /whatsapp/conversations/:conversationId/messages/:messageId/actions/analyze-media`
- `POST /whatsapp/conversations/:conversationId/messages/:messageId/media-interpretation/correction`

O corpo de correção é `{ "correction": string, "feedback"?: string }`. Leituras
aceitam a permissão operacional de visualização; análise/correção exigem
`whatsapp-conversations:manage`. Todos os lookups incluem `companyId`,
`conversationId` e `messageId`.

## Wiring no WhatsAppModule

O módulo precisa registrar o controller e os providers abaixo. A fábrica evita
acoplar o caso de uso a Nest e o token de array preserva o registry extensível.

```ts
controllers: [
  // ...controllers existentes
  WhatsAppMediaInterpretationController,
],
providers: [
  PrismaMediaInterpretationRepository,
  {
    provide: MediaInterpretationRepository,
    useExisting: PrismaMediaInterpretationRepository,
  },
  HttpOpenAiMediaInterpretationGateway,
  {
    provide: MEDIA_INTERPRETATION_PROVIDER_ADAPTERS,
    useFactory: (openAi: HttpOpenAiMediaInterpretationGateway) => [openAi],
    inject: [HttpOpenAiMediaInterpretationGateway],
  },
  MediaInterpretationGatewayRegistry,
  {
    provide: MediaInterpretationGateway,
    useExisting: MediaInterpretationGatewayRegistry,
  },
  {
    provide: InterpretWhatsAppMediaUseCase,
    useFactory: (
      repository: MediaInterpretationRepository,
      gateway: MediaInterpretationGateway,
      storage: WhatsAppMediaStorage,
    ) => new InterpretWhatsAppMediaUseCase(repository, gateway, storage),
    inject: [
      MediaInterpretationRepository,
      MediaInterpretationGateway,
      WhatsAppMediaStorage,
    ],
  },
  MediaInterpretationWorker,
]
```

`AgentsFoundationModule` deve continuar fornecendo `AgentCredentialResolver` e
`AGENT_OPENAI_RESPONSES_FETCHER`. Não há export obrigatório; exporte
`InterpretWhatsAppMediaUseCase` somente se outro módulo precisar disparar a
análise.

## Limitações conhecidas

- não há extração local/OCR alternativo: indisponibilidade da OpenAI termina a
  tentativa única como `FAILED`;
- a qualidade de DOCX/XLSX depende do suporte de arquivo da Responses API;
- não há reanálise automática ou manual após um resultado terminal; uma nova
  análise exige um novo asset, por desenho;
- o worker usa polling local de cinco segundos; distribuição por fila pode ser
  adicionada depois sem mudar o caso de uso ou o claim transacional.
