# Empresas, frota e contratos de transporte

`RoutingCompany` continua sendo a identidade canônica de PF/PJ para clientes e
funcionários. Os CNPJs próprios do tenant são entidades `TransportSupplierProfile`,
com CNPJ, razão social (`legalName`), nome fantasia (`tradeName`), situação e versão
próprios. Criar uma empresa do tenant não cria um cadastro de cliente/funcionário.
`RoutingContract` permanece sendo a identidade canônica do contrato.

A migração `20260910000100_tenant_legal_entities` preserva os IDs e referências
existentes, mantendo `legacyRegistrationId` apenas para o histórico. As identidades
legadas dessas empresas deixam de aparecer no Cadastro. O nome de compatibilidade
`registrationId` na empresa e `supplierRegistrationId` em seus vínculos identifica
a entidade própria do tenant, não exige uma nova `RoutingCompany`. As referências
de negócio usam identidade e tenant para impedir vínculos entre empresas distintas.

## Endpoints e concorrência

Base `/api/v1/transport`. Listas aceitam `page` (1 por padrão), `pageSize` (25,
máximo 100), `search` e, em catálogos, `kind`. Resposta `{items,total,page,pageSize}`.
Detalhes: `GET /{recurso}/{id}`. Auditoria paginada: `GET /{recurso}/{id}/history`.

| Recurso      | Campos principais                                                                                                                   | Capacidade exigida                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| companies    | cnpj, legalName, tradeName, registrationId opcional, active                                                                         | clients:view/create/update ou manage   |
| fleet        | fleetCode, supplierRegistrationId obrigatórios; plate, serviceTypeId, vehicleTypeId, categoryId, axles, passengers, model opcionais | trips:view/create/update ou manage     |
| catalogs     | kind (service-type, vehicle-type, category), name, active; code gerado pela API                                                     | trips:view/create/update ou manage     |
| affiliations | registrationId, supplierRegistrationId, role (client/employee), validFrom, validUntil                                               | clients:view/create/update ou manage   |
| contracts    | clientRegistrationId, supplierRegistrationId, code, name, modality, validFrom, validUntil, status                                   | contracts:view/create/update ou manage |
| routes       | provider, externalId opcional, name                                                                                                 | contracts:view/create/update ou manage |

`POST /{recurso}` exige `commandId` UUID e `expectedVersion:0`. `PATCH
/{recurso}/{id}` exige `commandId` novo e `expectedVersion` da resposta atual.
Todos retornam o item completo. Campos não reconhecidos são rejeitados; `companyId`
vem exclusivamente da identidade autenticada. Falha de versão exige recarregar.
Repetição do mesmo comando retorna a resposta original, mesmo após outra edição.
O reaproveitamento de commandId com outro conteúdo/alvo/autor falha em conflito.
Auditoria, recibo e alterações são atômicos em transação Serializable, com lock
por tenant e verificação otimista também nos registros canônicos.

`DELETE /companies/{id}` recebe os mesmos controles no corpo e **inativa apenas o
perfil**, conservando todas as referências e histórico. Diretoria/gerência são
obrigatórias além da capacidade de edição, inclusive para administrador técnico.
`PATCH active:false` aplica a mesma restrição. As entradas canônicas de clientes,
cadastros e revisão de CNPJ também preservam identidade e restrição de inativação.
CNPJ/tipo de prestadora com perfil não são substituíveis por outro documento.
Frota e catálogos usam active; contratos usam draft/active/suspended/ended.

`POST /catalogs/initialize` (`commandId`, `expectedVersion:0`) cria os padrões
idempotentemente e preserva itens já existentes: Contínuo, Eventual e Locação;
Ônibus, Van, Mini Van, Carro e Micro-ônibus; Convencional, Executivo, Executivo/DD
e Comercial. Tipos adicionais são cadastráveis. Tipo de serviço da frota NÃO
classifica viagens: modalidade é atributo explícito do contrato Lume.

Para contratos já cadastrados, `GET /contracts/candidates` lista, de forma paginada,
os contratos canônicos que ainda não possuem perfil de transporte. `POST /contracts`
aceita `existingContractId`; os dados canônicos enviados devem coincidir com a
seleção e são preservados. A operação cria apenas o perfil, reaproveitando ID e
histórico anteriores, sem exigir um novo contrato. A prestadora e modalidade
são configuradas explicitamente nesse perfil.

## Vínculos por vigência

Datas de vigência são civis ISO `YYYY-MM-DD`, com fim inclusivo. Início e fim no
mesmo dia são válidos. Para trocar o titular no dia 10, encerre o vínculo anterior
no dia 9. Intervalos sobrepostos são rejeitados sob lock transacional; a rota
pode pertencer somente a um contrato por dia. Uma condição contratual por dia.
Condições/vínculos devem caber no período contratual. Não existe rateio implícito.

Vínculos de clientes e funcionários apontam cadastros principais, sem exigir que
um funcionário tenha usuário de acesso. Papel employee exige cadastro PF. Editar
um vínculo permite encerrá-lo; início/identidades/papel e vigências já encerradas
não são ampliados ou reabertos por edição. Encerramentos podem antecipar o fim, com
auditoria antes/depois. Crie outro vínculo a partir da nova vigência. Contratos podem
simultaneamente atribuir outra empresa responsável ao mesmo cliente.

Frota aceita `validFrom` opcional na criação; quando omitida, a titularidade inicia
na data de cadastro. Históricos anteriores NÃO são atribuídos implicitamente a
essa empresa. Informe a vigência histórica conhecida. `GET /fleet/{id}` retorna
`ownerships`, com os fornecedores de cada período. O supplierRegistrationId da
frota guarda a empresa inicial; o dono na data da viagem deve ser resolvido pelos
vínculos, sem depender de alterações atuais no cadastro.

- `POST /fleet/{id}/ownerships`: supplierRegistrationId, validFrom, validUntil.
- `PATCH /fleet/{id}/ownerships/{periodId}`: validUntil para encerrar.
- `POST /routes/{id}/assignments`: contractId, validFrom, validUntil.
- `PATCH /routes/{id}/assignments/{periodId}`: validUntil para encerrar.
- `POST /contracts/{id}/conditions`: validFrom, validUntil, period (daily/monthly),
  allowanceKm (decimal textual opcional/nulo), includeGarage (boolean obrigatório),
  transitionMonth (YYYY-MM opcional), transitionAllowanceKm (decimal textual).
- `PATCH /contracts/{id}/conditions/{periodId}`: validUntil para encerrar.

Essas operações usam `expectedVersion` do proprietário (frota/rota/contrato),
retornando o proprietário completo com nova versão e seus vínculos/condições.
Condições são acrescentadas e encerradas com histórico, sem editar silenciosamente
a franquia de viagens anteriores. Cliente, prestadora e modalidade de um contrato
não são substituídos retroativamente. Para mudanças nessas identidades, encerre o
contrato e crie o seguinte. Para alterar somente franquia, crie nova condição.

## Identidades externas e medições

A API mantém `provider` e `externalVehicleId` na frota, preenchidos juntos quando
o vínculo com a origem estiver confirmado. Esses campos técnicos não aparecem no
formulário de Frota; a remoção visual não cria um mapeamento automático. O número
da frota é a identificação operacional e não substitui implicitamente o ID exigido
pela Avic. IDs externos são strings, inclusive inteiros acima do limite seguro
JavaScript. Rota externa mantém provider/externalId/name; nomes são informação para
revisão, não prova de identidade. Uma rota sem externalId fica disponível para
mapeamento, sem atribuição automática pelo nome. Não se cria RoutingRoute (plano
local) a partir de uma linha Avic.

Os novos contratos usam UNSPECIFIED nos campos legados de tipo/período de
planejamento; demais campos antigos obrigatórios permanecem vazios/zero como
não configurados. Esses campos não são medições, franquias nem dados de uma rota
real. As análises utilizam exclusivamente condições vigentes do perfil comercial.
Antes de usar o contrato no planejador legado, os dados específicos precisam ser
configurados pelo fluxo desse domínio.

Franquia ausente é desconhecida/não definida, não zero. Franquia zero é explícita.
Precisão armazenada: três casas decimais, sem conversão por Number. Condição mensal
não produz meta diária. Uma franquia específica de transição exige mês contido na
vigência e periodicidade mensal. Excluir garagem exige medições que permitam
separar trechos; falta de evidência deve produzir dados insuficientes. Nenhum
campo deste módulo representa penalidade, custo, receita ou lucro.

## Validação e implantação

Testes focados cobrem CNPJ, vigência civil real, IDs grandes, campos desconhecidos,
permissão por domínio, restrição de inativação, tenant, franquia nula/zero,
concorrência, reuso de commandId, auditoria única e sobreposição de rotas.
Os diretórios oficiais de desenvolvimento na VPS são
`/home/taiane/lume/lume-staging/lume-tenant-api` e
`/home/taiane/lume/lume-staging/lume-tenant-web`, ambos na branch `develop`.
As migrações de Transportes, CNPJs próprios e códigos numéricos devem preceder a
Web correspondente. Consulte [implantação](production.md): testes em banco
descartável, publicação no Git e atualização de um serviço são operações distintas.

## Códigos numéricos automáticos

TransportCatalogItem.code é gerado pelo PostgreSQL como texto numérico, com sequência atômica. A API rejeita atribuição manual do código em criação e edição. A migração preserva UUIDs, relacionamentos e o código anterior em legacyCode, incrementando a versão dos registros convertidos.

Os itens iniciais mantêm seedKey independente do nome e do código exibido. Repetir a inicialização não duplica itens nem desfaz renomeações. Catálogos existentes são convertidos antes de implantar a Web que dispensa o campo Código.
