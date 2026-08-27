import { randomUUID } from 'node:crypto';

import { validationError } from '../../core/errors/app-error';
import {
  isValidCnpj,
  isValidCpf,
} from '../../shared/utils/brazilian-documents';
import {
  normalizeEmail,
  normalizeTaxId,
  normalizeWhatsAppPhone,
} from '../../shared/utils/normalization';

export const REGISTRATION_TYPES = ['pf', 'pj'] as const;
export const REGISTRATION_STATUSES = ['active', 'inactive'] as const;
export const REGISTRATION_PHONE_TYPES = [
  'mobile',
  'commercial',
  'residential',
  'other',
] as const;
export const REGISTRATION_EMAIL_TYPES = [
  'personal',
  'commercial',
  'financial',
  'other',
] as const;

export const DEFAULT_REGISTRATION_ROLES = [
  { code: 'client', name: 'Cliente' },
  { code: 'supplier', name: 'Fornecedor' },
  { code: 'employee', name: 'Funcionário' },
  { code: 'service-provider', name: 'Prestador de serviço' },
  { code: 'partner', name: 'Parceiro' },
  { code: 'driver', name: 'Motorista' },
  { code: 'passenger', name: 'Passageiro' },
] as const;

export const DEFAULT_REGISTRATION_TAGS = [
  { code: 'commercial', name: 'Comercial' },
  { code: 'operations', name: 'Operacional' },
  { code: 'financial', name: 'Financeiro' },
  { code: 'human-resources', name: 'Recursos Humanos' },
  { code: 'personnel-department', name: 'Departamento Pessoal' },
  { code: 'maintenance', name: 'Manutenção' },
  { code: 'passenger', name: 'Passageiro' },
  { code: 'tourism', name: 'Turismo' },
] as const;

export type RegistrationType = (typeof REGISTRATION_TYPES)[number];
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export type RegistrationPhoneType = (typeof REGISTRATION_PHONE_TYPES)[number];
export type RegistrationEmailType = (typeof REGISTRATION_EMAIL_TYPES)[number];

export interface RegistrationPhoneInput {
  originalValue?: string | null;
  number: string;
  type?: RegistrationPhoneType;
  isPrimary?: boolean;
  hasWhatsApp?: boolean;
  whatsappContactId?: string | null;
}

export interface RegistrationEmailInput {
  address: string;
  type?: RegistrationEmailType;
  isPrimary?: boolean;
}

export interface RegistrationInput {
  type: RegistrationType;
  status?: RegistrationStatus;
  avicExternalId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  roleCodes: string[];
  tagCodes?: string[];
  phones?: RegistrationPhoneInput[];
  emails?: RegistrationEmailInput[];
}

export interface NormalizedRegistrationPhone {
  originalValue: string | null;
  normalizedValue: string;
  countryCode: string;
  areaCode: string | null;
  number: string;
  type: RegistrationPhoneType;
  isPrimary: boolean;
  hasWhatsApp: boolean;
  whatsappContactId: string | null;
}

export interface NormalizedRegistrationEmail {
  address: string;
  type: RegistrationEmailType;
  isPrimary: boolean;
}

export interface NormalizedRegistrationInput {
  type: RegistrationType;
  status: RegistrationStatus;
  avicExternalId: string | null;
  firstName: string | null;
  lastName: string | null;
  individualName: string | null;
  legalName: string;
  tradeName: string | null;
  cpf: string | null;
  cnpj: string | null;
  taxId: string;
  roleCodes: string[];
  tagCodes: string[];
  phones: NormalizedRegistrationPhone[];
  emails: NormalizedRegistrationEmail[];
  individualEmail: string | null;
  individualWhatsapp: string | null;
  individualPhones: { number: string; description: string | null }[];
  legalEmail: string | null;
  legalWhatsapp: string | null;
  legalPhones: { number: string; description: string | null }[];
}

export interface RegistrationGraphInput {
  localId: string;
  registration: RegistrationInput;
}

export interface RegistrationPromotionGraphInput {
  primaryLocalId: string;
  registrations: RegistrationGraphInput[];
  relationships?: RegistrationRelationshipInput[];
}

export type RegistrationPromotionPayload =
  RegistrationInput | RegistrationPromotionGraphInput;

export interface RegistrationRelationshipInput {
  sourceLocalId: string;
  targetLocalId: string;
  type: string;
  jobTitle?: string | null;
  department?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export interface NormalizedRegistrationGraphInput {
  localId: string;
  id: string;
  registration: NormalizedRegistrationInput;
}

function compactText(value?: string | null): string | null {
  return value?.replace(/\s+/g, ' ').trim() || null;
}

function hasMeaningfulName(value: string | null): value is string {
  return Boolean(value && (value.match(/\p{L}/gu)?.length ?? 0) >= 2);
}

function uniqueCodes(values: string[] | undefined, field: string): string[] {
  const codes = [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim().toLocaleLowerCase('pt-BR'))
        .filter(Boolean),
    ),
  ];
  if (codes.some((code) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code))) {
    throw validationError(`Há um código inválido em ${field}.`);
  }
  return codes;
}

function normalizedPhones(
  values: RegistrationPhoneInput[] | undefined,
): NormalizedRegistrationPhone[] {
  const seen = new Set<string>();
  const phones = (values ?? []).flatMap((value) => {
    let normalizedValue: string;
    try {
      normalizedValue = normalizeWhatsAppPhone(value.number);
    } catch {
      throw validationError('Informe telefones válidos com DDD.');
    }
    if (seen.has(normalizedValue)) return [];
    seen.add(normalizedValue);
    const countryCode = normalizedValue.startsWith('55')
      ? '55'
      : normalizedValue.slice(0, 2);
    const local = normalizedValue.slice(countryCode.length);
    const type = value.type ?? 'mobile';
    if (!REGISTRATION_PHONE_TYPES.includes(type)) {
      throw validationError('Selecione um tipo válido para o telefone.');
    }
    return [
      {
        originalValue: compactText(value.originalValue ?? value.number),
        normalizedValue,
        countryCode,
        areaCode: local.length >= 10 ? local.slice(0, 2) : null,
        number: local.length >= 10 ? local.slice(2) : local,
        type,
        isPrimary: value.isPrimary === true,
        hasWhatsApp: value.hasWhatsApp === true,
        whatsappContactId: value.whatsappContactId ?? null,
      },
    ];
  });
  if (phones.length > 0 && !phones.some((phone) => phone.isPrimary)) {
    phones[0] = { ...phones[0], isPrimary: true };
  }
  if (phones.filter((phone) => phone.isPrimary).length > 1) {
    throw validationError('Selecione apenas um telefone principal.');
  }
  return phones;
}

function normalizedEmails(
  values: RegistrationEmailInput[] | undefined,
): NormalizedRegistrationEmail[] {
  const seen = new Set<string>();
  const emails = (values ?? []).flatMap((value) => {
    const address = normalizeEmail(value.address);
    if (!address) return [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw validationError('Informe endereços de e-mail válidos.');
    }
    if (seen.has(address)) return [];
    seen.add(address);
    const type = value.type ?? 'personal';
    if (!REGISTRATION_EMAIL_TYPES.includes(type)) {
      throw validationError('Selecione um tipo válido para o e-mail.');
    }
    return [{ address, type, isPrimary: value.isPrimary === true }];
  });
  if (emails.length > 0 && !emails.some((email) => email.isPrimary)) {
    emails[0] = { ...emails[0], isPrimary: true };
  }
  if (emails.filter((email) => email.isPrimary).length > 1) {
    throw validationError('Selecione apenas um e-mail principal.');
  }
  return emails;
}

export function normalizeRegistrationInput(
  input: RegistrationInput,
  registrationId: string = randomUUID(),
): NormalizedRegistrationInput {
  if (!REGISTRATION_TYPES.includes(input.type)) {
    throw validationError('Selecione Pessoa Física ou Pessoa Jurídica.');
  }
  const status = input.status ?? 'active';
  if (!REGISTRATION_STATUSES.includes(status)) {
    throw validationError('Selecione uma situação válida para o Cadastro.');
  }

  const roleCodes = uniqueCodes(input.roleCodes, 'Papéis');
  if (roleCodes.length === 0) {
    throw validationError('Selecione pelo menos um Papel.');
  }
  const tagCodes = uniqueCodes(input.tagCodes, 'Marcadores');
  const phones = normalizedPhones(input.phones);
  const emails = normalizedEmails(input.emails);
  const firstName = compactText(input.firstName);
  const lastName = compactText(input.lastName);
  const individualName =
    [firstName, lastName].filter(Boolean).join(' ') || null;
  const legalName = compactText(input.legalName);
  const tradeName = compactText(input.tradeName);
  const cpf = normalizeTaxId(input.cpf ?? '') || null;
  const cnpj = normalizeTaxId(input.cnpj ?? '') || null;

  if (input.type === 'pf') {
    if (!hasMeaningfulName(firstName)) {
      throw validationError('Informe um nome válido para a pessoa.');
    }
    if (cpf && !isValidCpf(cpf)) throw validationError('CPF inválido.');
    if (phones.length === 0) {
      throw validationError('Pessoa Física precisa de pelo menos um telefone.');
    }
  } else {
    if (!hasMeaningfulName(legalName)) {
      throw validationError('Informe uma razão social válida.');
    }
    if (!cnpj || !isValidCnpj(cnpj))
      throw validationError('Informe um CNPJ válido.');
  }

  const primaryPhone = phones.find((phone) => phone.isPrimary) ?? null;
  const primaryEmail = emails.find((email) => email.isPrimary) ?? null;
  const legacyName = input.type === 'pf' ? individualName! : legalName!;
  const legacyAdditionalPhones = phones
    .filter((phone) => phone !== primaryPhone)
    .map((phone) => ({
      number: phone.normalizedValue,
      description: phone.type,
    }));

  return {
    type: input.type,
    status,
    avicExternalId: compactText(input.avicExternalId),
    firstName,
    lastName,
    individualName,
    legalName: legacyName,
    tradeName,
    cpf: input.type === 'pf' ? cpf : null,
    cnpj: input.type === 'pj' ? cnpj : null,
    taxId:
      input.type === 'pf'
        ? (cpf ?? `pf${registrationId.replace(/-/g, '').slice(0, 12)}`)
        : cnpj!,
    roleCodes,
    tagCodes,
    phones,
    emails,
    individualEmail:
      input.type === 'pf' ? (primaryEmail?.address ?? null) : null,
    individualWhatsapp:
      input.type === 'pf' && primaryPhone?.hasWhatsApp
        ? primaryPhone.normalizedValue
        : input.type === 'pf'
          ? (primaryPhone?.normalizedValue ?? null)
          : null,
    individualPhones: input.type === 'pf' ? legacyAdditionalPhones : [],
    legalEmail: input.type === 'pj' ? (primaryEmail?.address ?? null) : null,
    legalWhatsapp:
      input.type === 'pj' && primaryPhone?.hasWhatsApp
        ? primaryPhone.normalizedValue
        : input.type === 'pj'
          ? (primaryPhone?.normalizedValue ?? null)
          : null,
    legalPhones: input.type === 'pj' ? legacyAdditionalPhones : [],
  };
}

export function normalizeRegistrationGraph(
  registrations: RegistrationGraphInput[],
  relationships: RegistrationRelationshipInput[] = [],
): {
  registrations: NormalizedRegistrationGraphInput[];
  relationships: RegistrationRelationshipInput[];
} {
  if (registrations.length === 0) {
    throw validationError(
      'Inclua pelo menos um Cadastro para concluir a operação.',
    );
  }
  if (registrations.length > 10) {
    throw validationError(
      'Uma revisão pode promover no máximo 10 identidades relacionadas.',
    );
  }
  if (relationships.length > 30) {
    throw validationError(
      'Uma revisão pode confirmar no máximo 30 relacionamentos.',
    );
  }
  const localIds = new Set<string>();
  const normalized = registrations.map((entry) => {
    const localId = entry.localId.trim();
    if (!localId || localIds.has(localId)) {
      throw validationError(
        'Cada Cadastro da operação precisa de uma referência local única.',
      );
    }
    localIds.add(localId);
    const id = randomUUID();
    return {
      localId,
      id,
      registration: normalizeRegistrationInput(entry.registration, id),
    };
  });
  const normalizedRelationships = relationships.map((relationship) => {
    if (
      !localIds.has(relationship.sourceLocalId) ||
      !localIds.has(relationship.targetLocalId)
    ) {
      throw validationError(
        'Um relacionamento aponta para um Cadastro inexistente na operação.',
      );
    }
    if (relationship.sourceLocalId === relationship.targetLocalId) {
      throw validationError(
        'Um Cadastro não pode se relacionar consigo mesmo.',
      );
    }
    const type = compactText(relationship.type);
    if (!type) throw validationError('Informe o tipo do relacionamento.');
    return {
      ...relationship,
      type,
      jobTitle: compactText(relationship.jobTitle),
      department: compactText(relationship.department),
      notes: compactText(relationship.notes),
    };
  });
  return { registrations: normalized, relationships: normalizedRelationships };
}

export function isRegistrationPromotionGraphInput(
  value: RegistrationPromotionPayload,
): value is RegistrationPromotionGraphInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'registrations' in value &&
    Array.isArray(value.registrations)
  );
}

export function normalizeRegistrationPromotionPayload(
  payload: RegistrationPromotionPayload,
): {
  primaryLocalId: string;
  registrations: NormalizedRegistrationGraphInput[];
  relationships: RegistrationRelationshipInput[];
} {
  const graph = isRegistrationPromotionGraphInput(payload)
    ? payload
    : {
        primaryLocalId: 'primary',
        registrations: [{ localId: 'primary', registration: payload }],
        relationships: [],
      };
  const primaryLocalId = compactText(graph.primaryLocalId);
  if (!primaryLocalId) {
    throw validationError('Informe qual identidade é a principal da revisão.');
  }
  const normalized = normalizeRegistrationGraph(
    graph.registrations,
    graph.relationships ?? [],
  );
  if (
    !normalized.registrations.some(
      (registration) => registration.localId === primaryLocalId,
    )
  ) {
    throw validationError(
      'A identidade principal não está presente na estrutura confirmada.',
    );
  }
  return { primaryLocalId, ...normalized };
}

export function normalizeRegistrationSearch(
  value?: string,
): string | undefined {
  return compactText(value) ?? undefined;
}
