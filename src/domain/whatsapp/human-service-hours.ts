import { validationError } from '../../core/errors/app-error';

export interface HumanServiceInterval {
  readonly start: string;
  readonly end: string;
}

export interface HumanServiceHours {
  readonly timeZone: string;
  readonly weekly: Readonly<
    Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, readonly HumanServiceInterval[]>>
  >;
  readonly holidays: readonly string[];
  readonly exceptions: Readonly<
    Record<string, readonly HumanServiceInterval[] | 'closed'>
  >;
}

type JsonObject = Readonly<Record<string, unknown>>;

function objectValue(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${field} deve ser um objeto.`);
  }
  return value as JsonObject;
}

function calendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw validationError(`${field} deve utilizar o formato YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw validationError(`${field} contém uma data inválida.`);
  }
  return value;
}

function localParts(
  at: Date,
  timeZone: string,
): {
  readonly date: string;
  readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly minutes: number;
} {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw validationError('O fuso horário do atendimento humano é inválido.');
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const weekdayMap: Readonly<Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6>> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayMap[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw validationError('Horário deve utilizar o formato HH:mm.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59)
    throw validationError('Horário fora do intervalo válido.');
  return hours * 60 + minutes;
}

function intervals(
  value: unknown,
  field: string,
): readonly HumanServiceInterval[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw validationError(`${field} deve conter no máximo 12 intervalos.`);
  }
  const normalized = value.map((candidate, index) => {
    const row = objectValue(candidate, `${field}[${index}]`);
    if (typeof row.start !== 'string' || typeof row.end !== 'string') {
      throw validationError(
        `${field}[${index}] exige start e end no formato HH:mm.`,
      );
    }
    const start = row.start.trim();
    const end = row.end.trim();
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (startMinutes >= endMinutes) {
      throw validationError(
        'Intervalos de atendimento devem terminar após o início no mesmo dia.',
      );
    }
    return { start, end, startMinutes, endMinutes };
  });
  normalized.sort((left, right) => left.startMinutes - right.startMinutes);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startMinutes < normalized[index - 1].endMinutes) {
      throw validationError(`${field} possui intervalos sobrepostos.`);
    }
  }
  return normalized.map(({ start, end }) => ({ start, end }));
}

export function parseHumanServiceHours(
  value: unknown,
  field = 'Horário de atendimento humano',
): HumanServiceHours | null {
  if (value === null || value === undefined) return null;
  const row = objectValue(value, field);
  const timeZone = typeof row.timeZone === 'string' ? row.timeZone.trim() : '';
  if (!timeZone || timeZone.length > 100) {
    throw validationError(`${field}.timeZone é obrigatório.`);
  }
  localParts(new Date('2026-01-05T12:00:00.000Z'), timeZone);

  const weeklyValue = objectValue(row.weekly, `${field}.weekly`);
  const weekly: Partial<
    Record<0 | 1 | 2 | 3 | 4 | 5 | 6, readonly HumanServiceInterval[]>
  > = {};
  for (const [weekday, candidate] of Object.entries(weeklyValue)) {
    if (!/^[0-6]$/u.test(weekday)) {
      throw validationError(`${field}.weekly possui um dia inválido.`);
    }
    weekly[Number(weekday) as 0 | 1 | 2 | 3 | 4 | 5 | 6] = intervals(
      candidate,
      `${field}.weekly.${weekday}`,
    );
  }

  if (!Array.isArray(row.holidays) || row.holidays.length > 366) {
    throw validationError(`${field}.holidays deve ser uma lista de datas.`);
  }
  const holidays = Array.from(
    new Set(
      row.holidays.map((date, index) =>
        calendarDate(date, `${field}.holidays[${index}]`),
      ),
    ),
  );

  const exceptionsValue = objectValue(row.exceptions, `${field}.exceptions`);
  if (Object.keys(exceptionsValue).length > 366) {
    throw validationError(`${field}.exceptions excede o limite anual.`);
  }
  const exceptions: Record<string, readonly HumanServiceInterval[] | 'closed'> =
    {};
  for (const [date, candidate] of Object.entries(exceptionsValue)) {
    const normalizedDate = calendarDate(date, `${field}.exceptions`);
    exceptions[normalizedDate] =
      candidate === 'closed'
        ? 'closed'
        : intervals(candidate, `${field}.exceptions.${date}`);
  }

  return { timeZone, weekly, holidays, exceptions };
}

function includesMinute(
  interval: HumanServiceInterval,
  minute: number,
): boolean {
  const start = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);
  if (start >= end) {
    throw validationError(
      'Intervalos de atendimento devem terminar após o início no mesmo dia.',
    );
  }
  return minute >= start && minute < end;
}

export function isHumanServiceOpen(input: {
  readonly at: Date;
  readonly tenantDefault: HumanServiceHours | null;
  readonly departmentOverride?: HumanServiceHours | null;
}): boolean {
  const schedule = input.departmentOverride ?? input.tenantDefault;
  if (!schedule) return true;
  const local = localParts(input.at, schedule.timeZone);
  const exception = schedule.exceptions[local.date];
  if (exception === 'closed') return false;
  if (exception)
    return exception.some((interval) =>
      includesMinute(interval, local.minutes),
    );
  if (schedule.holidays.includes(local.date)) return false;
  return (schedule.weekly[local.weekday] ?? []).some((interval) =>
    includesMinute(interval, local.minutes),
  );
}

export type HumanHandoffDecision =
  | { readonly action: 'continue-ai'; readonly customerMessage: null }
  | { readonly action: 'queue-human'; readonly customerMessage: string | null };

export function decideHumanHandoff(input: {
  readonly aiCanResolve: boolean;
  readonly humanServiceOpen: boolean;
  readonly offHoursMessageAlreadySent: boolean;
  readonly tenantOffHoursMessage: string;
}): HumanHandoffDecision {
  if (input.aiCanResolve)
    return { action: 'continue-ai', customerMessage: null };
  if (input.humanServiceOpen || input.offHoursMessageAlreadySent) {
    return { action: 'queue-human', customerMessage: null };
  }
  const message = input.tenantOffHoursMessage.trim();
  if (!message)
    throw validationError(
      'Configure a mensagem de encaminhamento fora do horário.',
    );
  return { action: 'queue-human', customerMessage: message };
}

export function openingHoursSideEffects(): {
  readonly sendAutomaticMessage: false;
  readonly changeControlMode: false;
  readonly activateAi: false;
} {
  return {
    sendAutomaticMessage: false,
    changeControlMode: false,
    activateAi: false,
  };
}
