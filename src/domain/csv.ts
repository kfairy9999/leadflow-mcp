import { scoreLeadRecord } from './scoring.js';
import type { LeadActivity } from './types.js';

const COLUMNS = [
  'id',
  'contact_name',
  'phone',
  'email',
  'service',
  'source',
  'stage',
  'estimated_value_cents',
  'urgency',
  'city',
  'score',
  'band',
  'notes',
  'created_at',
  'updated_at',
  'last_interaction_at',
] as const;

export function leadsToCsv(leads: readonly LeadActivity[], asOf: Date): string {
  const lines = [COLUMNS.join(',')];
  for (const lead of leads) {
    const scored = scoreLeadRecord(lead, asOf);
    lines.push(
      [
        lead.id,
        lead.contactName,
        lead.phone,
        lead.email,
        lead.service,
        lead.source,
        lead.stage,
        lead.estimatedValueCents,
        lead.urgency,
        lead.city,
        scored.score,
        scored.band,
        lead.notes,
        lead.createdAt,
        lead.updatedAt,
        lead.lastInteractionAt,
      ]
        .map((value) => csvField(value))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * RFC 4180 quoting, plus a leading apostrophe on formula triggers so a
 * spreadsheet does not execute a cell that starts with =, +, -, or @.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const neutralized = neutralizeFormula(String(value));
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

function neutralizeFormula(value: string): string {
  // Excel and Sheets trim leading whitespace before treating a cell as a formula.
  // A tab or CR in the first position is itself a trigger, even with nothing after it.
  if (/^[\t\r\n ]*[=+\-@]/.test(value) || /^[\t\r]/.test(value)) return `'${value}`;
  return value;
}
