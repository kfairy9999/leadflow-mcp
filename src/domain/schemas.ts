import * as z from 'zod/v4';

import {
  CHANNELS,
  DIRECTIONS,
  FOLLOW_UP_STATUSES,
  LEAD_SOURCES,
  LEAD_STAGES,
  URGENCIES,
} from './types.js';

const phonePattern = /^[0-9+().\-\s]+$/;

export const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(phonePattern, 'Phone may contain only digits and + ( ) . - spaces')
  .refine(
    (value) => (value.match(/\d/g) ?? []).length >= 7,
    'Phone must contain at least 7 digits',
  );

export const emailSchema = z.email().max(200);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency keys may contain letters, digits, and _ . : -');

export const isoDateTimeSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}, 'Expected an ISO-8601 datetime with a timezone, for example 2026-11-18T15:00:00.000Z');

export const leadIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/, 'Lead ids contain letters, digits, underscores, or hyphens');

export const followUpIdSchema = leadIdSchema;

export const stageSchema = z.enum(LEAD_STAGES);
export const sourceSchema = z.enum(LEAD_SOURCES);
export const urgencySchema = z.enum(URGENCIES);
export const channelSchema = z.enum(CHANNELS);
export const directionSchema = z.enum(DIRECTIONS);
export const followUpStatusSchema = z.enum(FOLLOW_UP_STATUSES);

export const createLeadInputSchema = z.object({
  contactName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('Person to call back. Not a company name.'),
  phone: phoneSchema
    .nullable()
    .optional()
    .describe('Optional. Digits, spaces, and + ( ) . - only.'),
  email: emailSchema
    .nullable()
    .optional()
    .describe('Optional. Use null when the caller did not give one.'),
  service: z.string().trim().min(1).max(200).describe('The job in the customer’s words.'),
  source: sourceSchema.describe('How the lead arrived.'),
  stage: stageSchema.optional().describe('Defaults to new.'),
  estimatedValueCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional()
    .describe('Integer cents, not dollars. 480000 means $4,800.00. Use 0 when unknown.'),
  urgency: urgencySchema.optional().describe('Defaults to normal.'),
  city: z.string().trim().min(1).max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema
    .optional()
    .describe(
      'Send the same key on retry to avoid a duplicate lead. A different payload with the same key is a conflict.',
    ),
});

export const updateLeadInputSchema = z.object({
  leadId: leadIdSchema,
  contactName: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.nullable().optional().describe('Null clears the phone number.'),
  email: emailSchema.nullable().optional().describe('Null clears the email address.'),
  service: z.string().trim().min(1).max(200).optional(),
  source: sourceSchema.optional(),
  stage: stageSchema.optional(),
  estimatedValueCents: z.number().int().min(0).max(100_000_000).optional(),
  urgency: urgencySchema.optional(),
  city: z.string().trim().min(1).max(80).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  expectedUpdatedAt: isoDateTimeSchema
    .optional()
    .describe(
      'Optimistic concurrency token. Pass the updatedAt you last read. The update is rejected if the lead changed.',
    ),
});

export const getLeadInputSchema = z.object({
  leadId: leadIdSchema,
});

export const searchLeadsInputSchema = z.object({
  text: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Case-insensitive ASCII match on name, service, city, email, phone, and notes.'),
  stage: stageSchema.optional(),
  source: sourceSchema.optional(),
  minScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Inclusive priority score floor. Applied after the scan.'),
  sort: z
    .enum(['updated_at', 'created_at', 'value', 'score'])
    .optional()
    .describe('Default updated_at, newest first.'),
  limit: z.number().int().min(1).max(100).optional().describe('Page size. Default 25.'),
  offset: z.number().int().min(0).max(10_000).optional().describe('Default 0.'),
});

export const scoreLeadInputSchema = z.object({
  leadId: leadIdSchema,
  asOf: isoDateTimeSchema
    .optional()
    .describe('Score as of this instant. Default is the server clock.'),
});

export const logInteractionInputSchema = z.object({
  leadId: leadIdSchema,
  channel: channelSchema,
  direction: directionSchema,
  summary: z.string().trim().min(1).max(2000).describe('What was said. Facts only.'),
  occurredAt: isoDateTimeSchema
    .optional()
    .describe('When it happened. Default is the server clock.'),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const scheduleFollowUpInputSchema = z.object({
  leadId: leadIdSchema,
  dueAt: isoDateTimeSchema.describe(
    'Allowed in the past. Past items show up in list_due_follow_ups immediately.',
  ),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const setFollowUpStatusInputSchema = z.object({
  followUpId: followUpIdSchema,
  status: followUpStatusSchema,
});

export const listDueFollowUpsInputSchema = z.object({
  asOf: isoDateTimeSchema
    .optional()
    .describe('Include follow-ups due at or before this instant. Default is the server clock.'),
  limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
});

export const pipelineSummaryInputSchema = z.object({
  asOf: isoDateTimeSchema.optional(),
  staleAfterDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe('Open leads with no activity for this many days are stale. Default 7.'),
});

export const exportLeadsInputSchema = z.object({
  stage: stageSchema.optional(),
  asOf: isoDateTimeSchema.optional(),
});
