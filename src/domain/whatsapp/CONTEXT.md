# Comunicação

Este contexto mantém a comunicação por canais como WhatsApp sem possuir os
processos comerciais, operacionais, financeiros ou documentais acompanhados
pela conversa.

## Linguagem

**Contato de Canal**:
Identidade inicialmente observada em um canal, que pode ser vinculada ao
cadastro principal após confirmação.
_Evite_: Cliente, pessoa confirmada

**Conversa**:
Histórico de mensagens trocadas com um contato por um canal.
_Evite_: Oportunidade, orçamento, viagem

**Departamento Responsável**:
Departamento que conduz a conversa naquele momento; somente um é responsável
por vez.
_Evite_: Proprietário do cliente

**Capacidade de Atendimento**:
Capacidade individual `whatsapp-conversations:attend`, disponível
transversalmente aos departamentos internos e excluída da Empresa Cliente.
_Evite_: Departamento Comercial, permissão administrativa de WhatsApp

**Responsável Atual**:
Usuário registrado como referência corrente da condução, sem funcionar como
bloqueio exclusivo contra outro usuário autorizado no mesmo escopo.
_Evite_: Mutex, proprietário permanente da conversa

**Transferência**:
Solicitação registrada de mudança do departamento responsável, com destino,
motivo, solicitante e data. A origem permanece responsável até o aceite.
_Evite_: Nova conversa

**Aceite da Transferência**:
Confirmação versionada por um usuário autorizado do departamento de destino
que conclui a transferência e atualiza o Responsável Atual.
_Evite_: Mudança direta de departamento, aceite somente no frontend

**Supervisão de Atendimento**:
Capacidade explícita de acompanhar ou intervir na condução, sem depender de um
cargo chamado supervisor e sem dispensar versão esperada ou auditoria.
_Evite_: Perfil Supervisor, override implícito

**Comunicação Proativa**:
Mensagem iniciada pelo Lume para uma finalidade definida, sujeita a horário,
intervalo, tentativas e preferência do destinatário.
_Evite_: Disparo livre

**Preferência de Comunicação**:
Escolha registrada por finalidade e canal, sem impedir automaticamente uma
comunicação necessária a um serviço contratado.
_Evite_: Bloqueio genérico
