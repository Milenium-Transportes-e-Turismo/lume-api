# Exportação de contatos aprovados

A página Contatos exporta dados do Cadastro Principal em CSV para Google Contacts.
A agenda bruta de WhatsApp não é a origem da exportação.

## Elegibilidade e campos

São elegíveis cadastros canônicos ativos e não temporários. Candidatos de
conciliação não entram antes da promoção ao cadastro; propostas de alteração
pendentes também não substituem dados canônicos. Cadastros inativos, inclusive
duplicidades preservadas para histórico, não entram. Restrições por empresa e
por cadastro vinculado à conta são aplicadas no servidor.

Cada cadastro gera uma linha. São exportados nome, empresa (PJ), telefones
vigentes, e-mails, endereço cadastral e marcadores. O rótulo Lume identifica a
origem. Telefones/e-mails repetidos dentro do mesmo cadastro são deduplicados;
cadastros distintos que compartilham telefone permanecem separados. Campos
legados são utilizados somente se não existem contatos canônicos daquele tipo.
CPF/CNPJ, instruções internas e histórico não são exportados.

Cabeçalhos seguem o [modelo oficial do Google](https://support.google.com/contacts/answer/15147365?hl=pt-br).
O CSV usa UTF-8, vírgula e CRLF; preserva acentos, aspas, CEP com zero inicial e
telefones internacionais. Textos que iniciam fórmulas são neutralizados. Apenas
valores de telefone internacionais estritamente numéricos preservam o sinal +.

## Contrato

- GET /api/v1/registrations/contact-export?batch=1: total, tamanho/lotes e
  prévia de até 20 cadastros do lote.
- POST /api/v1/registrations/contact-export: recebe commandId UUID v4 e batch
  (padrão 1), retorna CSV privado com Content-Disposition.
- Cada lote contém até 3.000 cadastros, respeitando o limite de importação do
  Google. A ordenação por nome legal e ID é estável dentro da consulta.
- Consultar exige clients:view. Exportar exige também documents:view ou
  documents:manage. Não concede permissão adicional a quem só vê WhatsApp.
- O arquivo é gerado pela Tenant API com DataExchangeUseCase,
  DataExchangeConverter e DataExchangeRepository; usa quota, expiração,
  fingerprint, commandId e auditoria existentes. A categoria interna é
  conversion, com purpose approved-registration-contacts.
- Nenhum cadastro é alterado pela exportação. Não há integração autenticada nem
  importação automática no Google. A pessoa baixa o CSV e o importa no Google.

## Operação

Não requer variável de ambiente ou migration nova. Publicar API antes do Web.
A página /contacts passa a ser somente consulta e exportação; manutenção dos
dados ocorre em Cadastro. Endpoints legados da agenda WhatsApp são preservados
para compatibilidade, sem controles de importação/criação/edição na página.
