import { Injectable } from '@nestjs/common';

import {
  RegistrationIdentityCandidateReader,
  type RegistrationIdentityEvidence,
} from '../../../application/contracts/registration-identity-candidate.reader';
import type { UserPersonMatchCandidate } from '../../../domain/identity/user-person-matching';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaRegistrationIdentityCandidateReader implements RegistrationIdentityCandidateReader {
  constructor(private readonly prisma: PrismaService) {}

  async findCandidates(
    evidence: RegistrationIdentityEvidence,
  ): Promise<readonly UserPersonMatchCandidate[]> {
    const filters = [
      ...(evidence.cpf ? [{ cpf: evidence.cpf }] : []),
      ...(evidence.email
        ? [
            { individualEmail: evidence.email },
            {
              registrationEmails: {
                some: { address: evidence.email },
              },
            },
          ]
        : []),
    ];
    if (filters.length === 0) return [];

    const candidates = await this.prisma.routingCompany.findMany({
      where: {
        companyId: evidence.companyId,
        OR: filters,
      },
      select: {
        id: true,
        companyId: true,
        clientType: true,
        cpf: true,
        individualEmail: true,
        registrationEmails: { select: { address: true } },
      },
      orderBy: { id: 'asc' },
    });

    return candidates.map((candidate) => ({
      registrationId: candidate.id,
      companyId: candidate.companyId,
      type: candidate.clientType === 'PF' ? 'pf' : 'pj',
      cpf: candidate.cpf,
      emails: [
        ...(candidate.individualEmail ? [candidate.individualEmail] : []),
        ...candidate.registrationEmails.map((email) => email.address),
      ],
    }));
  }
}
