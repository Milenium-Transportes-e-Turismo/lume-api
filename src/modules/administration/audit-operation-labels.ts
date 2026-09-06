const ACTIONS: Readonly<Record<string, string>> = {
  'channel-created': 'Canal WhatsApp cadastrado',
  'configuration-updated': 'Configuração do canal atualizada',
  'qr-requested': 'QR Code solicitado',
  'connection-synchronized': 'Conexão do canal consultada',
  disconnected: 'Canal WhatsApp desconectado',
  'reconnect-requested': 'Reconexão do canal solicitada',
  'setup-cancelled': 'Configuração do canal cancelada',
  'operational-channel-disabled': 'Canal WhatsApp desativado',
  'provider-operation-failed': 'Falha de comunicação com Evolution',

  USER_CREATED: 'Usuário cadastrado',
  USER_UPDATED: 'Usuário atualizado',
  USER_ACCESS_UPDATED: 'Acessos do usuário atualizados',
  PASSWORD_CHANGED: 'Senha alterada',
  REGISTRATION_CREATED: 'Cadastro criado',
  REGISTRATION_UPDATED: 'Cadastro atualizado',
  REGISTRATION_PROMOTED_FROM_RECONCILIATION: 'Cadastro aprovado na conciliação',
  REGISTRATION_RELATIONSHIP_CREATED: 'Relacionamento cadastral adicionado',
  REGISTRATION_RELATIONSHIP_UPDATED: 'Relacionamento cadastral atualizado',
  REGISTRATION_RELATIONSHIP_REMOVED: 'Relacionamento cadastral removido',
  PRODUCTION_BOOTSTRAP_SYNCED: 'Configuração inicial sincronizada',
  'document.request.created': 'Documentos solicitados',
  'document.request.synchronize-profile': 'Exigências documentais atualizadas',
};
const MODULES: Readonly<Record<string, string>> = {
  'service-session': 'Sessões de atendimento',
  user: 'Usuários',
  registration: 'Cadastro',
  'routing-company': 'Cadastro',
  company: 'Configurações',
  'document-request': 'Gestão documental',
  'document-submission': 'Gestão documental',
  'whatsapp-channel': 'Canais WhatsApp',
  'ai-agent': 'Agentes IA',
};
export function auditOperationLabel(action: string, targetType: string) {
  const module =
    MODULES[targetType] ??
    (targetType.includes('document')
      ? 'Gestão documental'
      : targetType.includes('whatsapp')
        ? 'WhatsApp'
        : 'Administração');
  const verb = /create|created/i.test(action)
    ? 'Criação'
    : /update|updated|patch|sync/i.test(action)
      ? 'Atualização'
      : /delete|remove/i.test(action)
        ? 'Remoção'
        : /approve/i.test(action)
          ? 'Aprovação'
          : /login/i.test(action)
            ? 'Entrada na plataforma'
            : /disconnect/i.test(action)
              ? 'Desconexão'
              : 'Operação registrada';
  return { module, action: ACTIONS[action] ?? verb + ' em ' + module };
}
const FIELDS: Readonly<Record<string, string>> = {
  connectionStatus: 'Situação da conexão',
  organizationalStatus: 'Situação do canal',
  routingMode: 'Roteamento',
  departmentId: 'Departamento',
  name: 'Nome',
  displayName: 'Nome',
  legalName: 'Razão social',
  firstName: 'Nome',
  lastName: 'Sobrenome',
  tradeName: 'Nome fantasia',
  status: 'Situação',
  email: 'E-mail',
  departments: 'Departamentos',
  permissionCodes: 'Permissões',
  roles: 'Papéis',
  tags: 'Marcadores',
  phones: 'Telefones',
  emails: 'E-mails',
  address: 'Endereço',
  serviceInstructions: 'Instruções de atendimento',
  documentProfile: 'Perfil documental',
  isAdministrator: 'Autoridade administrativa',
  documentAccessMode: 'Tipo de conta',
  jobTitle: 'Função',
  maritalStatus: 'Situação civil',
  militaryDocumentStatus: 'Documentação militar',
  dependents: 'Dependentes',
};
export function auditChangedFields(before: unknown, after: unknown): string[] {
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  )
    return [];
  const previous = before as Record<string, unknown>,
    next = after as Record<string, unknown>;
  return [
    ...new Set(
      Object.keys(FIELDS)
        .filter(
          (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
        )
        .map((key) => FIELDS[key]),
    ),
  ];
}
