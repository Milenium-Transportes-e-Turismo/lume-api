import type { UserPersonMatchCandidate } from '../../domain/identity/user-person-matching';

export interface RegistrationIdentityEvidence {
  readonly companyId: string;
  readonly cpf: string | null;
  readonly email: string | null;
}

/**
 * Canonical read seam shared by Identity and Documents while legacy records
 * are reconciled with the Cadastro Principal.
 */
export abstract class RegistrationIdentityCandidateReader {
  abstract findCandidates(
    evidence: RegistrationIdentityEvidence,
  ): Promise<readonly UserPersonMatchCandidate[]>;
}
