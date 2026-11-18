import { LeadFlowError } from '../domain/errors.js';
import { requestHash } from '../domain/hash.js';
import { scoreLeadRecord } from '../domain/scoring.js';
import { canonicalInstant } from '../domain/time.js';
import { createId } from '../ids.js';
import type {
  CreateLeadInput,
  DueFollowUp,
  FollowUp,
  FollowUpStatus,
  Interaction,
  Lead,
  LeadActivity,
  LeadSource,
  LeadStage,
  LogInteractionInput,
  ScheduleFollowUpInput,
  SearchLeadsInput,
  SearchLeadsResult,
  UpdateLeadInput,
  Urgency,
} from '../domain/types.js';
import {
  CHANNELS,
  DIRECTIONS,
  FOLLOW_UP_STATUSES,
  LEAD_SOURCES,
  LEAD_STAGES,
  URGENCIES,
} from '../domain/types.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type SqlDatabase,
  type SqlExecutor,
} from './sql.js';

const SEARCH_SCAN_CAP = 500;
const EXPORT_CAP = 5_000;

interface LeadRow {
  id: string;
  contact_name: string;
  phone: string | null;
  email: string | null;
  service: string;
  source: string;
  stage: string;
  estimated_value_cents: number;
  urgency: string;
  city: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  last_interaction_at?: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  resource_id: string;
}

export interface SeedBundle {
  leads: readonly Lead[];
  interactions: readonly Interaction[];
  followUps: readonly FollowUp[];
}

const LEAD_SELECT = `
  id, contact_name, phone, email, service, source, stage,
  estimated_value_cents, urgency, city, notes, created_at, updated_at,
  (SELECT MAX(occurred_at) FROM interactions WHERE interactions.lead_id = leads.id) AS last_interaction_at
`;

export class LeadRepository {
  constructor(private readonly db: SqlDatabase) {}

  async countLeads(): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leads');
    return row?.n ?? 0;
  }

  async clearBusinessData(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM follow_ups');
      await tx.run('DELETE FROM interactions');
      await tx.run('DELETE FROM idempotency_keys');
      await tx.run('DELETE FROM leads');
    });
  }

  async importSeed(bundle: SeedBundle): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const lead of bundle.leads) await insertLead(tx, lead);
      for (const interaction of bundle.interactions) await insertInteraction(tx, interaction);
      for (const followUp of bundle.followUps) await insertFollowUp(tx, followUp);
    });
  }

  async createLead(
    input: CreateLeadInput,
    now: Date,
  ): Promise<{ lead: LeadActivity; replay: boolean }> {
    const hash = requestHash({
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      service: input.service,
      source: input.source,
      stage: input.stage,
      estimatedValueCents: input.estimatedValueCents,
      urgency: input.urgency,
      city: input.city,
      notes: input.notes,
    });
    const iso = now.toISOString();
    const lead: Lead = {
      id: createId('lead'),
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      service: input.service,
      source: input.source,
      stage: input.stage,
      estimatedValueCents: input.estimatedValueCents,
      urgency: input.urgency,
      city: input.city,
      notes: input.notes,
      createdAt: iso,
      updatedAt: iso,
    };
    try {
      await this.db.transaction(async (tx) => {
        await insertLead(tx, lead);
        if (input.idempotencyKey) {
          await insertIdempotency(tx, 'create_lead', input.idempotencyKey, hash, lead.id, iso);
        }
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        return { lead: await this.replay('create_lead', input.idempotencyKey, hash), replay: true };
      }
      throw error;
    }
    return { lead: await this.requireLead(lead.id), replay: false };
  }

  async updateLead(id: string, patch: UpdateLeadInput, now: Date): Promise<LeadActivity> {
    const current = await this.getLead(id);
    if (!current) throw new LeadFlowError('NOT_FOUND', `No lead with id "${id}".`);
    if (!hasBusinessChange(patch)) {
      throw new LeadFlowError('VALIDATION', 'Update needs at least one field to change.');
    }
    if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== current.updatedAt) {
      throw new LeadFlowError(
        'CONFLICT',
        'The lead changed since it was read. Read it again and retry.',
      );
    }
    const next = applyPatch(current, patch, now.toISOString());
    const result = await this.db.run(
      `UPDATE leads SET
        contact_name = ?, phone = ?, email = ?, service = ?, source = ?, stage = ?,
        estimated_value_cents = ?, urgency = ?, city = ?, notes = ?, updated_at = ?
       WHERE id = ? AND updated_at = ?`,
      [
        next.contactName,
        next.phone,
        next.email,
        next.service,
        next.source,
        next.stage,
        next.estimatedValueCents,
        next.urgency,
        next.city,
        next.notes,
        next.updatedAt,
        id,
        current.updatedAt,
      ],
    );
    if (result.changes === 0) {
      throw new LeadFlowError(
        'CONFLICT',
        'The lead changed since it was read. Read it again and retry.',
      );
    }
    return this.requireLead(id);
  }

  async getLead(id: string): Promise<LeadActivity | null> {
    const row = await this.db.get<LeadRow>(`SELECT ${LEAD_SELECT} FROM leads WHERE id = ?`, [id]);
    return row ? mapLead(row) : null;
  }

  async listLeadActivity(): Promise<LeadActivity[]> {
    const rows = await this.db.all<LeadRow>(`SELECT ${LEAD_SELECT} FROM leads`);
    return rows.map((row) => mapLead(row));
  }

  async searchLeads(query: SearchLeadsInput): Promise<SearchLeadsResult> {
    const pattern = query.text ? likeContains(query.text) : null;
    const rows = await this.db.all<LeadRow>(
      `SELECT ${LEAD_SELECT}
       FROM leads
       WHERE (? IS NULL OR stage = ?)
         AND (? IS NULL OR source = ?)
         AND (
           ? IS NULL
           OR lower(contact_name) LIKE ? ESCAPE '\\'
           OR lower(service) LIKE ? ESCAPE '\\'
           OR lower(coalesce(city, '')) LIKE ? ESCAPE '\\'
           OR lower(coalesce(email, '')) LIKE ? ESCAPE '\\'
           OR lower(coalesce(phone, '')) LIKE ? ESCAPE '\\'
           OR lower(coalesce(notes, '')) LIKE ? ESCAPE '\\'
         )
       ORDER BY updated_at DESC
       LIMIT ?`,
      [
        query.stage,
        query.stage,
        query.source,
        query.source,
        pattern,
        pattern ?? '',
        pattern ?? '',
        pattern ?? '',
        pattern ?? '',
        pattern ?? '',
        pattern ?? '',
        SEARCH_SCAN_CAP + 1,
      ],
    );
    const truncated = rows.length > SEARCH_SCAN_CAP;
    let leads = rows.slice(0, SEARCH_SCAN_CAP).map((row) => mapLead(row));
    if (query.minScore !== null) {
      const minimum = query.minScore;
      leads = leads.filter((lead) => scoreLeadRecord(lead, query.asOf).score >= minimum);
    }
    leads.sort((a, b) => compareLeads(a, b, query));
    return {
      leads: leads.slice(query.offset, query.offset + query.limit),
      truncated,
    };
  }

  async leadsForExport(
    stage: LeadStage | null,
  ): Promise<{ leads: LeadActivity[]; truncated: boolean }> {
    const rows = await this.db.all<LeadRow>(
      `SELECT ${LEAD_SELECT} FROM leads WHERE (? IS NULL OR stage = ?) ORDER BY created_at ASC LIMIT ?`,
      [stage, stage, EXPORT_CAP + 1],
    );
    return {
      leads: rows.slice(0, EXPORT_CAP).map((row) => mapLead(row)),
      truncated: rows.length > EXPORT_CAP,
    };
  }

  async logInteraction(
    input: LogInteractionInput,
    now: Date,
  ): Promise<{ interaction: Interaction; replay: boolean }> {
    await this.requireLead(input.leadId);
    const occurredAtInput = input.occurredAt === null ? null : canonicalInstant(input.occurredAt);
    const occurredAt = occurredAtInput ?? now.toISOString();
    const hash = requestHash({
      leadId: input.leadId,
      channel: input.channel,
      direction: input.direction,
      summary: input.summary,
      occurredAt: occurredAtInput,
    });
    const interaction: Interaction = {
      id: createId('int'),
      leadId: input.leadId,
      channel: input.channel,
      direction: input.direction,
      summary: input.summary,
      occurredAt,
    };
    try {
      await this.db.transaction(async (tx) => {
        await insertInteraction(tx, interaction);
        await tx.run('UPDATE leads SET updated_at = ? WHERE id = ?', [
          now.toISOString(),
          input.leadId,
        ]);
        if (input.idempotencyKey) {
          await insertIdempotency(
            tx,
            'log_interaction',
            input.idempotencyKey,
            hash,
            interaction.id,
            now.toISOString(),
          );
        }
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.replayResource('log_interaction', input.idempotencyKey, hash);
        return { interaction: await this.requireInteraction(existing), replay: true };
      }
      if (isForeignKeyViolation(error)) {
        throw new LeadFlowError('NOT_FOUND', `No lead with id "${input.leadId}".`);
      }
      throw error;
    }
    return { interaction, replay: false };
  }

  async listInteractions(leadId: string): Promise<Interaction[]> {
    await this.requireLead(leadId);
    const rows = await this.db.all<InteractionRow>(
      `SELECT id, lead_id, channel, direction, summary, occurred_at
       FROM interactions WHERE lead_id = ? ORDER BY occurred_at DESC, id ASC`,
      [leadId],
    );
    return rows.map((row) => mapInteraction(row));
  }

  async scheduleFollowUp(
    input: ScheduleFollowUpInput,
    now: Date,
  ): Promise<{ followUp: FollowUp; replay: boolean }> {
    await this.requireLead(input.leadId);
    const dueAt = canonicalInstant(input.dueAt);
    const hash = requestHash({
      leadId: input.leadId,
      dueAt,
      reason: input.reason,
    });
    const iso = now.toISOString();
    const followUp: FollowUp = {
      id: createId('fu'),
      leadId: input.leadId,
      dueAt,
      reason: input.reason,
      status: 'scheduled',
      createdAt: iso,
    };
    try {
      await this.db.transaction(async (tx) => {
        await insertFollowUp(tx, followUp);
        await tx.run('UPDATE leads SET updated_at = ? WHERE id = ?', [iso, input.leadId]);
        if (input.idempotencyKey) {
          await insertIdempotency(
            tx,
            'schedule_follow_up',
            input.idempotencyKey,
            hash,
            followUp.id,
            iso,
          );
        }
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.replayResource(
          'schedule_follow_up',
          input.idempotencyKey,
          hash,
        );
        return { followUp: await this.requireFollowUp(existing), replay: true };
      }
      if (isForeignKeyViolation(error)) {
        throw new LeadFlowError('NOT_FOUND', `No lead with id "${input.leadId}".`);
      }
      throw error;
    }
    return { followUp, replay: false };
  }

  async setFollowUpStatus(id: string, status: FollowUpStatus, now: Date): Promise<FollowUp> {
    const current = await this.getFollowUp(id);
    if (!current) throw new LeadFlowError('NOT_FOUND', `No follow-up with id "${id}".`);
    if (current.status === status) return current;
    const iso = now.toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE follow_ups SET status = ? WHERE id = ?', [status, id]);
      await tx.run('UPDATE leads SET updated_at = ? WHERE id = ?', [iso, current.leadId]);
    });
    return { ...current, status };
  }

  async listFollowUps(leadId: string): Promise<FollowUp[]> {
    await this.requireLead(leadId);
    const rows = await this.db.all<FollowUpRow>(
      `SELECT id, lead_id, due_at, reason, status, created_at
       FROM follow_ups WHERE lead_id = ? ORDER BY due_at ASC, id ASC`,
      [leadId],
    );
    return rows.map((row) => mapFollowUp(row));
  }

  async listDueFollowUps(asOf: Date, limit: number): Promise<DueFollowUp[]> {
    const rows = await this.db.all<DueRow>(
      `SELECT f.id, f.lead_id, f.due_at, f.reason, f.status, f.created_at,
              l.contact_name, l.service, l.stage, l.phone, l.email
       FROM follow_ups f
       JOIN leads l ON l.id = f.lead_id
       WHERE f.status = 'scheduled' AND f.due_at <= ?
       ORDER BY f.due_at ASC, f.id ASC
       LIMIT ?`,
      [asOf.toISOString(), limit],
    );
    return rows.map((row) => ({
      ...mapFollowUp(row),
      contactName: row.contact_name,
      service: row.service,
      stage: parseStage(row.stage),
      phone: row.phone,
      email: row.email,
    }));
  }

  private async replay(scope: string, key: string, hash: string): Promise<LeadActivity> {
    const id = await this.replayResource(scope, key, hash);
    return this.requireLead(id);
  }

  private async replayResource(scope: string, key: string, hash: string): Promise<string> {
    const row = await this.db.get<IdempotencyRow>(
      'SELECT request_hash, resource_id FROM idempotency_keys WHERE scope = ? AND idempotency_key = ?',
      [scope, key],
    );
    if (!row) {
      throw new LeadFlowError(
        'CONFLICT',
        'Idempotency key collided but no stored request was found.',
      );
    }
    if (row.request_hash !== hash) {
      throw new LeadFlowError(
        'CONFLICT',
        'That idempotency key was already used with a different request. Retry the original request or choose a new key.',
      );
    }
    return row.resource_id;
  }

  private async requireLead(id: string): Promise<LeadActivity> {
    const lead = await this.getLead(id);
    if (!lead) throw new LeadFlowError('NOT_FOUND', `No lead with id "${id}".`);
    return lead;
  }

  private async getFollowUp(id: string): Promise<FollowUp | null> {
    const row = await this.db.get<FollowUpRow>(
      'SELECT id, lead_id, due_at, reason, status, created_at FROM follow_ups WHERE id = ?',
      [id],
    );
    return row ? mapFollowUp(row) : null;
  }

  private async requireFollowUp(id: string): Promise<FollowUp> {
    const followUp = await this.getFollowUp(id);
    if (!followUp) throw new LeadFlowError('NOT_FOUND', `No follow-up with id "${id}".`);
    return followUp;
  }

  private async requireInteraction(id: string): Promise<Interaction> {
    const row = await this.db.get<InteractionRow>(
      'SELECT id, lead_id, channel, direction, summary, occurred_at FROM interactions WHERE id = ?',
      [id],
    );
    if (!row) throw new LeadFlowError('NOT_FOUND', `No interaction with id "${id}".`);
    return mapInteraction(row);
  }
}

function hasBusinessChange(patch: UpdateLeadInput): boolean {
  return (
    patch.contactName !== undefined ||
    patch.phone !== undefined ||
    patch.email !== undefined ||
    patch.service !== undefined ||
    patch.source !== undefined ||
    patch.stage !== undefined ||
    patch.estimatedValueCents !== undefined ||
    patch.urgency !== undefined ||
    patch.city !== undefined ||
    patch.notes !== undefined
  );
}

function applyPatch(
  current: LeadActivity,
  patch: UpdateLeadInput,
  updatedAt: string,
): LeadActivity {
  return {
    ...current,
    contactName: patch.contactName ?? current.contactName,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    email: patch.email === undefined ? current.email : patch.email,
    service: patch.service ?? current.service,
    source: patch.source ?? current.source,
    stage: patch.stage ?? current.stage,
    estimatedValueCents: patch.estimatedValueCents ?? current.estimatedValueCents,
    urgency: patch.urgency ?? current.urgency,
    city: patch.city === undefined ? current.city : patch.city,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    updatedAt,
  };
}

async function insertLead(tx: SqlExecutor, lead: Lead): Promise<void> {
  await tx.run(
    `INSERT INTO leads (
      id, contact_name, phone, email, service, source, stage,
      estimated_value_cents, urgency, city, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      lead.notes,
      lead.createdAt,
      lead.updatedAt,
    ],
  );
}

async function insertInteraction(tx: SqlExecutor, interaction: Interaction): Promise<void> {
  await tx.run(
    `INSERT INTO interactions (id, lead_id, channel, direction, summary, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      interaction.id,
      interaction.leadId,
      interaction.channel,
      interaction.direction,
      interaction.summary,
      canonicalInstant(interaction.occurredAt),
    ],
  );
}

async function insertFollowUp(tx: SqlExecutor, followUp: FollowUp): Promise<void> {
  await tx.run(
    `INSERT INTO follow_ups (id, lead_id, due_at, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      followUp.id,
      followUp.leadId,
      canonicalInstant(followUp.dueAt),
      followUp.reason,
      followUp.status,
      followUp.createdAt,
    ],
  );
}

async function insertIdempotency(
  tx: SqlExecutor,
  scope: string,
  key: string,
  hash: string,
  resourceId: string,
  createdAt: string,
): Promise<void> {
  await tx.run(
    `INSERT INTO idempotency_keys (scope, idempotency_key, request_hash, resource_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [scope, key, hash, resourceId, createdAt],
  );
}

function mapLead(row: LeadRow): LeadActivity {
  return {
    id: row.id,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    service: row.service,
    source: parseSource(row.source),
    stage: parseStage(row.stage),
    estimatedValueCents: row.estimated_value_cents,
    urgency: parseUrgency(row.urgency),
    city: row.city,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInteractionAt: row.last_interaction_at ?? null,
  };
}

interface InteractionRow {
  id: string;
  lead_id: string;
  channel: string;
  direction: string;
  summary: string;
  occurred_at: string;
}

function mapInteraction(row: InteractionRow): Interaction {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: parseEnum(row.channel, CHANNELS),
    direction: parseEnum(row.direction, DIRECTIONS),
    summary: row.summary,
    occurredAt: row.occurred_at,
  };
}

interface FollowUpRow {
  id: string;
  lead_id: string;
  due_at: string;
  reason: string;
  status: string;
  created_at: string;
}

interface DueRow extends FollowUpRow {
  contact_name: string;
  service: string;
  stage: string;
  phone: string | null;
  email: string | null;
}

function mapFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    leadId: row.lead_id,
    dueAt: row.due_at,
    reason: row.reason,
    status: parseEnum(row.status, FOLLOW_UP_STATUSES),
    createdAt: row.created_at,
  };
}

function parseStage(value: string): LeadStage {
  return parseEnum(value, LEAD_STAGES);
}

function parseSource(value: string): LeadSource {
  return parseEnum(value, LEAD_SOURCES);
}

function parseUrgency(value: string): Urgency {
  return parseEnum(value, URGENCIES);
}

function parseEnum<T extends string>(value: string, allowed: readonly T[]): T {
  const match = allowed.find((item) => item === value);
  if (!match) throw new LeadFlowError('VALIDATION', `Stored value "${value}" is not recognized.`);
  return match;
}

function likeContains(text: string): string {
  const escaped = text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function compareLeads(a: LeadActivity, b: LeadActivity, query: SearchLeadsInput): number {
  if (query.sort === 'score') {
    const delta = scoreLeadRecord(b, query.asOf).score - scoreLeadRecord(a, query.asOf).score;
    return delta || b.updatedAt.localeCompare(a.updatedAt);
  }
  if (query.sort === 'value') {
    return b.estimatedValueCents - a.estimatedValueCents || b.updatedAt.localeCompare(a.updatedAt);
  }
  if (query.sort === 'created_at') return b.createdAt.localeCompare(a.createdAt);
  return b.updatedAt.localeCompare(a.updatedAt);
}
