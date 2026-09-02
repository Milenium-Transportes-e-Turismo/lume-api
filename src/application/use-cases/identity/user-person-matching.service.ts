import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AppError,
  conflict,
  notFound,
  validationError,
} from '../../../core/errors/app-error';
import {
  decideUserPersonMatch,
  LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING,
} from '../../../domain/identity/user-person-matching';
import { PrismaService } from '../../../infra/database/prisma/prisma.service';
import { rethrowKnownPrismaConflict } from '../../../infra/database/prisma/prisma-errors';
import type { Prisma } from '../../../infra/database/prisma/generated/client';
import { isValidCpf } from '../../../shared/utils/brazilian-documents';
import {
  normalizeCpf,
  normalizeEmail,
} from '../../../shared/utils/normalization';
import { RegistrationIdentityCandidateReader } from '../../contracts/registration-identity-candidate.reader';
import type { AuthenticatedPrincipal } from '../../presenters/user.presenter';

export interface UserPersonAssociationInput {
  readonly mode: 'automatic' | 'confirmed';
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly personRegistrationId?: string;
  readonly confirmed?: boolean;
  readonly reason?: string;
}

function canonicalFingerprint(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

const personAssociationSelect = {
  id: true,
  companyId: true,
  clientType: true,
  cpf: true,
  individualEmail: true,
  registrationEmails: { select: { address: true } },
  individualName: true,
  legalName: true,
  isTemporary: true,
  regularizationDueAt: true,
} satisfies Prisma.RoutingCompanySelect;

@Injectable()
export class UserPersonMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: RegistrationIdentityCandidateReader,
  ) {}

  private async loadUser(companyId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id_companyId: { id: userId, companyId } },
      select: {
        id: true,
        companyId: true,
        name: true,
        cpfNormalized: true,
        emailNormalized: true,
        routingCompanyId: true,
        personRegistrationId: true,
        personAssociationVersion: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw notFound('Usuário');
    return user;
  }

  private async replay(
    companyId: string,
    userId: string,
    commandId: string,
    commandFingerprint: string,
  ) {
    const repeated = await this.prisma.userPersonAssociationHistory.findUnique({
      where: { companyId_commandId: { companyId, commandId } },
    });
    if (!repeated) return null;
    if (
      repeated.userId !== userId ||
      repeated.commandFingerprint !== commandFingerprint
    ) {
      throw conflict('O commandId já foi usado com outros dados.');
    }
    return {
      ...(repeated.resultSnapshot as Record<string, unknown>),
      idempotent: true,
    };
  }

  async associate(
    current: AuthenticatedPrincipal,
    userId: string,
    input: UserPersonAssociationInput,
  ) {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw validationError('Informe uma versão esperada válida do vínculo.');
    }
    const commandFingerprint = canonicalFingerprint({
      companyId: current.companyId,
      actorUserId: current.id,
      userId,
      ...input,
    });
    const replayed = await this.replay(
      current.companyId,
      userId,
      input.commandId,
      commandFingerprint,
    );
    if (replayed) return replayed;

    const subject = await this.loadUser(current.companyId, userId);
    const candidates = await this.candidates.findCandidates({
      companyId: current.companyId,
      cpf: subject.cpfNormalized,
      email: subject.emailNormalized,
    });
    const decision = decideUserPersonMatch({
      subject: {
        userId: subject.id,
        companyId: subject.companyId,
        cpf: subject.cpfNormalized,
        email: subject.emailNormalized,
      },
      candidates,
    });
    const selection = (() => {
      if (input.mode === 'automatic') {
        if (decision.decision === 'automatic') {
          return {
            personRegistrationId: decision.personRegistrationId,
            source: 'unique-exact-cpf' as const,
            reason: null,
            createProvisional: false as const,
            provisionalCpf: null,
          };
        }
        const normalizedSubjectCpf = normalizeCpf(subject.cpfNormalized);
        return {
          personRegistrationId: null,
          source: 'provisional' as const,
          reason: decision.reason,
          createProvisional: true as const,
          provisionalCpf:
            decision.decision === 'provisional' &&
            decision.reason === 'no-exact-cpf-match' &&
            normalizedSubjectCpf &&
            isValidCpf(normalizedSubjectCpf)
              ? normalizedSubjectCpf
              : null,
        };
      }

      const reason = input.reason?.replace(/\s+/g, ' ').trim() ?? '';
      if (
        input.confirmed !== true ||
        !input.personRegistrationId ||
        reason.length < 3
      ) {
        throw validationError(
          'A escolha manual exige confirmação explícita, Pessoa e motivo.',
        );
      }
      const selected = candidates.find(
        (candidate) =>
          candidate.companyId === current.companyId &&
          candidate.registrationId === input.personRegistrationId,
      );
      if (!selected || selected.type !== 'pf') {
        throw validationError(
          'A Pessoa escolhida não está entre os candidatos compatíveis.',
        );
      }
      const subjectCpf = normalizeCpf(subject.cpfNormalized);
      const selectedCpf = normalizeCpf(selected.cpf);
      const exactCpf =
        Boolean(subjectCpf) &&
        Boolean(selectedCpf) &&
        isValidCpf(subjectCpf!) &&
        isValidCpf(selectedCpf!) &&
        subjectCpf === selectedCpf;
      const subjectEmail = normalizeEmail(subject.emailNormalized);
      const exactEmail =
        Boolean(subjectEmail) &&
        selected.emails.some(
          (candidateEmail) => normalizeEmail(candidateEmail) === subjectEmail,
        );
      if (!exactCpf && !exactEmail) {
        throw validationError(
          'A escolha manual exige CPF ou e-mail idêntico confirmado.',
        );
      }
      return {
        personRegistrationId: selected.registrationId,
        source: exactCpf
          ? ('human-confirmed-cpf' as const)
          : ('human-confirmed-email' as const),
        reason,
        createProvisional: false as const,
        provisionalCpf: null,
      };
    })();

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const repeated =
          await transaction.userPersonAssociationHistory.findUnique({
            where: {
              companyId_commandId: {
                companyId: current.companyId,
                commandId: input.commandId,
              },
            },
          });
        if (repeated) {
          if (
            repeated.userId !== userId ||
            repeated.commandFingerprint !== commandFingerprint
          ) {
            throw conflict('O commandId já foi usado com outros dados.');
          }
          return {
            ...(repeated.resultSnapshot as Record<string, unknown>),
            idempotent: true,
          };
        }

        const currentUser = await transaction.user.findUnique({
          where: {
            id_companyId: { id: userId, companyId: current.companyId },
          },
          select: {
            id: true,
            companyId: true,
            name: true,
            cpfNormalized: true,
            emailNormalized: true,
            personRegistrationId: true,
            personAssociationVersion: true,
            deletedAt: true,
          },
        });
        if (!currentUser || currentUser.deletedAt) throw notFound('Usuário');
        if (currentUser.personRegistrationId) {
          throw conflict('O Usuário já está associado a uma Pessoa.');
        }
        if (currentUser.personAssociationVersion !== input.expectedVersion) {
          throw conflict(
            `O vínculo foi alterado por outro comando. Versão atual: ${currentUser.personAssociationVersion}.`,
          );
        }

        let person: Prisma.RoutingCompanyGetPayload<{
          select: typeof personAssociationSelect;
        }> | null;
        if (selection.createProvisional) {
          const personId = randomUUID();
          const fullName = currentUser.name.replace(/\s+/g, ' ').trim();
          const [firstName, ...lastNameParts] = fullName.split(' ');
          const createdAt = new Date();
          const regularizationDueAt = new Date(createdAt);
          regularizationDueAt.setUTCDate(regularizationDueAt.getUTCDate() + 7);
          const regularizationRequirements = [
            ...(selection.provisionalCpf ? [] : ['cpf-before-regularization']),
            'phone-before-regularization',
          ];
          const createdPerson = await transaction.routingCompany.create({
            data: {
              id: personId,
              companyId: current.companyId,
              taxId:
                selection.provisionalCpf ??
                `pf${personId.replace(/-/g, '').slice(0, 12)}`,
              legalName: fullName,
              clientType: 'PF',
              firstName,
              lastName: lastNameParts.join(' ') || null,
              individualName: fullName,
              cpf: selection.provisionalCpf,
              individualEmail: currentUser.emailNormalized,
              isTemporary: true,
              temporaryReason: `Identidade provisória criada para o Usuário ${userId}: ${selection.reason}.`,
              regularizationDueAt,
              regularizationRequirements,
              temporaryResponsibleUserId: current.id,
              createdByUserId: current.id,
              registrationEmails: {
                create: [
                  {
                    address: currentUser.emailNormalized,
                    type: 'personal',
                    isPrimary: true,
                  },
                ],
              },
            },
            select: personAssociationSelect,
          });
          person = createdPerson;
          await transaction.routingCompanyHistory.create({
            data: {
              companyId: current.companyId,
              routingCompanyId: createdPerson.id,
              actorUserId: current.id,
              commandId: input.commandId,
              action: 'REGISTRATION_CREATED_FOR_USER_IDENTITY',
              afterSnapshot: json({
                id: createdPerson.id,
                type: 'pf',
                isTemporary: true,
                regularizationDueAt: regularizationDueAt.toISOString(),
                regularizationRequirements,
              }),
            },
          });
        } else {
          person = await transaction.routingCompany.findUnique({
            where: {
              id_companyId: {
                id: selection.personRegistrationId,
                companyId: current.companyId,
              },
            },
            select: personAssociationSelect,
          });
        }
        const personEmails = person
          ? [
              ...(person.individualEmail ? [person.individualEmail] : []),
              ...person.registrationEmails.map((email) => email.address),
            ]
          : [];
        const evidenceStillMatches =
          selection.source === 'provisional'
            ? Boolean(person)
            : selection.source === 'unique-exact-cpf' ||
                selection.source === 'human-confirmed-cpf'
              ? Boolean(
                  person &&
                  Boolean(normalizeCpf(currentUser.cpfNormalized)) &&
                  isValidCpf(normalizeCpf(currentUser.cpfNormalized)!) &&
                  normalizeCpf(person.cpf) ===
                    normalizeCpf(currentUser.cpfNormalized),
                )
              : Boolean(
                  person &&
                  normalizeEmail(currentUser.emailNormalized) &&
                  personEmails.some(
                    (email) =>
                      normalizeEmail(email) ===
                      normalizeEmail(currentUser.emailNormalized),
                  ),
                );
        if (!person || person.clientType !== 'PF' || !evidenceStillMatches) {
          throw conflict(
            'A evidência de identidade mudou; revise os candidatos antes de associar.',
          );
        }

        const updated = await transaction.user.updateMany({
          where: {
            id: userId,
            companyId: current.companyId,
            personRegistrationId: null,
            personAssociationVersion: input.expectedVersion,
          },
          data: {
            personRegistrationId: person.id,
            personAssociationVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw conflict(
            'O vínculo foi alterado por outro comando. Recarregue e tente novamente.',
          );
        }

        const occurredAt = new Date();
        const resultSnapshot = {
          userId,
          personRegistrationId: person.id,
          associationVersion: input.expectedVersion + 1,
          source: selection.source,
          reason: selection.reason,
          needsRegularization: person.isTemporary,
          person: {
            id: person.id,
            displayName: person.individualName || person.legalName,
            isTemporary: person.isTemporary,
            regularizationDueAt:
              person.regularizationDueAt?.toISOString() ?? null,
          },
          associatedAt: occurredAt.toISOString(),
        };
        await transaction.userPersonAssociationHistory.create({
          data: {
            companyId: current.companyId,
            userId,
            personRegistrationId: person.id,
            beforePersonRegistrationId: null,
            commandId: input.commandId,
            commandFingerprint,
            actorUserId: current.id,
            action: 'USER_PERSON_ASSOCIATED',
            source: resultSnapshot.source,
            reason: selection.reason,
            expectedVersion: input.expectedVersion,
            resultingVersion: input.expectedVersion + 1,
            needsRegularization: resultSnapshot.needsRegularization,
            resultSnapshot: json(resultSnapshot),
            occurredAt,
          },
        });
        await transaction.tenantAuditLog.create({
          data: {
            companyId: current.companyId,
            actorUserId: current.id,
            action: 'USER_PERSON_ASSOCIATED',
            targetType: 'user',
            targetId: userId,
            metadata: json({
              commandId: input.commandId,
              personRegistrationId: person.id,
              source: resultSnapshot.source,
              resultingVersion: input.expectedVersion + 1,
            }),
          },
        });
        return { ...resultSnapshot, idempotent: false };
      });
    } catch (error) {
      if (
        isUniqueConflict(error) ||
        (error instanceof AppError && error.code === 'CONFLICT')
      ) {
        const replayed = await this.replay(
          current.companyId,
          userId,
          input.commandId,
          commandFingerprint,
        );
        if (replayed) return replayed;
      }
      rethrowKnownPrismaConflict(error);
    }
  }

  async history(current: AuthenticatedPrincipal, userId: string) {
    await this.loadUser(current.companyId, userId);
    const entries = await this.prisma.userPersonAssociationHistory.findMany({
      where: { companyId: current.companyId, userId },
      select: {
        id: true,
        commandId: true,
        action: true,
        source: true,
        reason: true,
        personRegistrationId: true,
        expectedVersion: true,
        resultingVersion: true,
        needsRegularization: true,
        actor: { select: { id: true, name: true } },
        occurredAt: true,
        createdAt: true,
      },
      orderBy: [{ resultingVersion: 'asc' }, { createdAt: 'asc' }],
    });
    return entries.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  async preview(current: AuthenticatedPrincipal, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id_companyId: { id: userId, companyId: current.companyId } },
      select: {
        id: true,
        companyId: true,
        cpfNormalized: true,
        emailNormalized: true,
        routingCompanyId: true,
        personRegistrationId: true,
        personAssociationVersion: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw notFound('Usuário');

    const candidates = await this.candidates.findCandidates({
      companyId: current.companyId,
      cpf: user.cpfNormalized,
      email: user.emailNormalized,
    });

    const decision = decideUserPersonMatch({
      subject: {
        userId: user.id,
        companyId: user.companyId,
        cpf: user.cpfNormalized,
        email: user.emailNormalized,
      },
      candidates,
    });

    return {
      persisted: Boolean(user.personRegistrationId),
      association: user.personRegistrationId
        ? {
            personRegistrationId: user.personRegistrationId,
            version: user.personAssociationVersion,
          }
        : null,
      existingContextualRegistrationId: user.routingCompanyId,
      existingContextualLinkMeaning: user.routingCompanyId
        ? LEGACY_CONTEXTUAL_REGISTRATION_LINK_MEANING
        : null,
      decision,
    };
  }
}
