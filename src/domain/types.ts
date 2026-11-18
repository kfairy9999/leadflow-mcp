export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const OPEN_STAGES = ['new', 'contacted', 'qualified', 'proposal'] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

export const LEAD_SOURCES = ['referral', 'website', 'phone', 'walk_in', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const URGENCIES = ['low', 'normal', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const CHANNELS = ['call', 'email', 'sms', 'visit', 'note'] as const;
export type Channel = (typeof CHANNELS)[number];

export const DIRECTIONS = ['inbound', 'outbound'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FOLLOW_UP_STATUSES = ['scheduled', 'done', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const SCORE_BANDS = ['hot', 'warm', 'cool', 'cold'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export interface Lead {
  id: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  service: string;
  source: LeadSource;
  stage: LeadStage;
  estimatedValueCents: number;
  urgency: Urgency;
  city: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity extends Lead {
  lastInteractionAt: string | null;
}

export interface Interaction {
  id: string;
  leadId: string;
  channel: Channel;
  direction: Direction;
  summary: string;
  occurredAt: string;
}

export interface FollowUp {
  id: string;
  leadId: string;
  dueAt: string;
  reason: string;
  status: FollowUpStatus;
  createdAt: string;
}

export interface DueFollowUp extends FollowUp {
  contactName: string;
  service: string;
  stage: LeadStage;
  phone: string | null;
  email: string | null;
}

export interface CreateLeadInput {
  contactName: string;
  phone: string | null;
  email: string | null;
  service: string;
  source: LeadSource;
  stage: LeadStage;
  estimatedValueCents: number;
  urgency: Urgency;
  city: string | null;
  notes: string | null;
  idempotencyKey: string | null;
}

/**
 * `undefined` means "leave the stored value alone".
 * `null` on a nullable column clears it.
 * `expectedUpdatedAt` compares against the stored `updatedAt` when provided.
 */
export interface UpdateLeadInput {
  contactName: string | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  service: string | undefined;
  source: LeadSource | undefined;
  stage: LeadStage | undefined;
  estimatedValueCents: number | undefined;
  urgency: Urgency | undefined;
  city: string | null | undefined;
  notes: string | null | undefined;
  expectedUpdatedAt: string | undefined;
}

export interface LogInteractionInput {
  leadId: string;
  channel: Channel;
  direction: Direction;
  summary: string;
  occurredAt: string | null;
  idempotencyKey: string | null;
}

export interface ScheduleFollowUpInput {
  leadId: string;
  dueAt: string;
  reason: string;
  idempotencyKey: string | null;
}

export type LeadSort = 'updated_at' | 'created_at' | 'value' | 'score';

export interface SearchLeadsInput {
  text: string | null;
  stage: LeadStage | null;
  source: LeadSource | null;
  minScore: number | null;
  sort: LeadSort;
  limit: number;
  offset: number;
  asOf: Date;
}

export interface SearchLeadsResult {
  leads: LeadActivity[];
  truncated: boolean;
}
