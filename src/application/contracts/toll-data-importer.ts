export interface TollImportContext {
  readonly source: string;
  readonly sourceReference: string;
  readonly sourceUpdatedAt: Date | null;
  readonly importedAt: Date;
  readonly dataKind: 'official' | 'manual' | 'development-fixture';
}

export interface TollImportResult {
  readonly imported: number;
  readonly updated: number;
  readonly rejected: number;
  readonly source: string;
}

/**
 * Port for audited ANTT, state agency and concessionaire import jobs.
 * Implementations must normalize and validate data before publishing it.
 */
export abstract class TollDataImporter {
  abstract importTollPoints(
    context: TollImportContext,
    sourceFile: string,
  ): Promise<TollImportResult>;

  abstract importTollTariffs(
    context: TollImportContext,
    sourceFile: string,
  ): Promise<TollImportResult>;
}
