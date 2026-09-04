# Knowledge Base

O módulo de Knowledge Base mantém conteúdo administrativo versionado e isolado
pelo `companyId` autenticado. O texto de documentos e arquivos é dado não
confiável: somente versões `published`, vigentes e autorizadas por scope podem
entrar no contexto de um agente. Drafts, versões superseded/archived, bases ou
documentos arquivados e conteúdo fora do departamento nunca são fontes de
recuperação.

## Ciclo de vida

- uma base ativa agrupa documentos do tenant;
- um artigo nasce com versão 1 em `draft` e pode ser editado apenas nesse
  estado, usando `expectedVersion` e `expectedContentHash`;
- uma nova revisão de artigo cria outra linha/version, sem modificar a versão
  anterior;
- publicar valida conteúdo extraído e ao menos um chunk, promove o draft e
  move a versão publicada anterior para `superseded` sem alterar seu payload;
- arquivar documento ou versão altera somente estado/data; não há delete físico;
- sugestões e gaps exigem revisão humana. Aprovar uma sugestão não publica nem
  treina automaticamente um agente.

Scopes aceitos são `tenant`, `department` (exatamente um departamento) e
`multi-department` (dois ou mais). Todos os departamentos são conferidos no
mesmo tenant. A visibilidade pode ser `customer-safe` ou `internal`; respostas
customer-facing recuperam somente `customer-safe`. `effectiveFrom` e
`effectiveUntil` exigem ISO 8601 com fuso explícito.

## Originais e extração

`POST /api/v1/knowledge/files` aceita um único original de até 10 MiB. O arquivo
é gravado no storage privado antes da transação de metadados, com chave derivada
de tenant, documento, versão e SHA-256. A chave interna nunca é retornada pela
API. O download autenticado refaz a verificação de tamanho e hash e usa
`Cache-Control: private, no-store` e `X-Content-Type-Options: nosniff`.

O adapter atual usa `KNOWLEDGE_STORAGE_DRIVER=filesystem`. Em desenvolvimento,
`KNOWLEDGE_STORAGE_PATH` usa `./var/knowledge`; em produção ele é obrigatório,
absoluto e deve apontar para volume privado persistente com backup alinhado ao
banco. A aplicação não expõe esse diretório como conteúdo estático.

Extração local disponível:

- TXT em UTF-8 estrito;
- CSV validado pelo conversor tabular existente;
- XLSX com preflight ZIP e limites de abas, linhas, colunas e células;
- DOCX por WordprocessingML, com preflight ZIP/CRC;
- PDF textual por `pdf-parse`/PDF.js, limitado a 500 páginas, sem JavaScript,
  recursos de rede, renderização ou fontes externas. O original continua
  preservado e cada chunk mantém a página de origem.

O texto extraído tem limite de 2 MiB e gera no máximo 500 chunks. Cada chunk
preserva ordinal, página quando disponível, hash, estimativa de tokens e
provenance do extrator. PDFs compostos somente por imagem continuam sem texto
extraível; não há OCR nesta entrega.

## API e permissões

Todas as rotas abaixo exigem JWT e derivam o tenant exclusivamente do usuário:

- `GET /api/v1/knowledge/departments`, para selecionar scopes sem digitar UUIDs;
- `GET/POST /api/v1/knowledge/bases`;
- `GET /api/v1/knowledge/documents` e
  `GET /api/v1/knowledge/documents/:documentId`;
- `POST /api/v1/knowledge/articles` e `POST /api/v1/knowledge/files`;
- `POST /api/v1/knowledge/documents/:documentId/drafts`;
- `PATCH /api/v1/knowledge/documents/:documentId/versions/:versionId/draft`;
- `POST .../publish`, `POST .../archive` e download `GET .../original`;
- listagem/revisão em `/api/v1/knowledge/suggestions` e
  `/api/v1/knowledge/gaps`.

Os identificadores publicados por `GET /api/v1/knowledge/departments` são UUIDs
RFC 4122. Uma restrição no banco impede que seeds ou integrações persistam os
valores de 128 bits não RFC que o tipo `uuid` do PostgreSQL também aceitaria.

`knowledge:view` lê metadados, versões, originais, sugestões e gaps;
`knowledge:manage` cria/edita/arquiva e revisa; `knowledge:publish` é obrigatório
para publicar. Cada mutação usa `commandId` para replay idempotente e registra
auditoria tenant-scoped.

### Observações provenientes dos agentes

O runtime autenticado por `ServiceIdentityGuard` pode registrar observações em:

- `POST /api/v1/internal/knowledge/suggestions`;
- `POST /api/v1/internal/knowledge/gaps`.

Ambas exigem `commandId`, `serviceSessionId`, `agentExecutionId` e de uma a cinco
mensagens persistidas como evidência. O tenant e a identidade de serviço vêm do
Bearer interno, nunca do payload. O repositório confirma que identidade,
sessão, execução e mensagens pertencem ao mesmo tenant e que a execução está
`running` ou `succeeded`.

Uma sugestão nasce obrigatoriamente `pending`, sem documento resultante e sem
publicação. Aprovação humana posterior continua separada da criação de draft e
da publicação. Uma lacuna nova nasce `open`; observações do mesmo tópico
normalizado incrementam `occurrenceCount` sob lock transacional. O agente não
altera uma decisão humana já `acknowledged`, `resolved` ou `dismissed`.

Evidência não armazena o texto da conversa: somente IDs opacos das mensagens,
direção, tipo e instante. Cada observação guarda no máximo cinco referências e
cada gap retém no máximo doze observações. Evidência legada fora desse formato é
devolvida e regravada apenas como `legacy-redacted`. Títulos, tópicos e conteúdo
sugerido têm limites rígidos e recusam URLs, credenciais e identificadores
pessoais diretos. Não existe campo de URL, busca externa ou ferramenta de
internet nesses endpoints.

O runtime de agentes expõe as funções `knowledge_gap_observe` e
`knowledge_suggestion_create` somente ao `knowledge-specialist`, que possui o
grant explícito `safe-write`; a policy server-side ainda exige
`service:respond`. Os schemas aceitam apenas o tópico ou o título/conteúdo
proposto. Tenant, sessão, execução e de uma a cinco mensagens inbound recentes
do mesmo contato são derivados novamente pelo servidor — nenhum desses
identificadores pode ser fornecido pelo modelo.

Cada chamada estruturada é reautorizada com os argumentos reais, registrada em
`AgentToolCall` e executada por comando determinístico/idempotente enquanto a
execução continua `running`. O resultado devolvido ao modelo contém somente IDs,
estado, contadores e os invariantes `automaticPublication=false`/
`reviewRequired=true`; tópico, conteúdo sugerido, PII e evidência não retornam.
Uma segunda passagem usa o mesmo agente/runtime com `tools=[]` e trata o
resultado como dado não confiável. Ausência de fonte deve gerar
`knowledge_gap_observe` como sinal estruturado, não inferência por texto livre.
`knowledge_suggestion_create` sempre cria `pending` para revisão humana: não há
publicação, promoção a draft, aprendizado automático ou consulta à internet.

## Operação

Banco e volume de originais formam uma unidade de backup/restauração. Monitore
espaço, permissões do diretório, falhas de integridade e drafts com extração
`unsupported`. Restaurar apenas um dos dois lados deixa metadados ou arquivos
órfãos; não substitua originais ausentes silenciosamente. Uma falha transacional
ambígua não apaga o objeto content-addressed, pois outra instância pode ter
concluído o mesmo comando idempotente. A reconciliação operacional pode remover
somente objetos comprovadamente sem referência no banco.
