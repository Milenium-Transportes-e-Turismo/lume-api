export interface TollTariffPeriod {
  readonly id: string;
  readonly axles: number | null;
  readonly price: number;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

export class TollTariffService {
  select(
    tariffs: readonly TollTariffPeriod[],
    travelDate: Date,
    axles: number,
  ): TollTariffPeriod | null {
    return (
      tariffs
        .filter(
          (tariff) =>
            (tariff.axles === null || tariff.axles === axles) &&
            tariff.validFrom <= travelDate &&
            (tariff.validUntil === null || tariff.validUntil >= travelDate),
        )
        .sort((left, right) => {
          const axlePriority =
            Number(right.axles === axles) - Number(left.axles === axles);
          if (axlePriority !== 0) return axlePriority;
          return right.validFrom.getTime() - left.validFrom.getTime();
        })[0] ?? null
    );
  }
}
