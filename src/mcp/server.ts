import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { Clock } from '../clock.js';
import { leadsToCsv } from '../domain/csv.js';
import { LeadFlowError } from '../domain/errors.js';
import { formatUsd } from '../domain/money.js';
import { summarizePipeline } from '../domain/pipeline.js';
import { renderScoringModel, scoreLeadRecord } from '../domain/scoring.js';
import {
  createLeadInputSchema,
  exportLeadsInputSchema,
  getLeadInputSchema,
  listDueFollowUpsInputSchema,
  logInteractionInputSchema,
  pipelineSummaryInputSchema,
  scheduleFollowUpInputSchema,
  scoreLeadInputSchema,
  searchLeadsInputSchema,
  setFollowUpStatusInputSchema,
  updateLeadInputSchema,
} from '../domain/schemas.js';
import type {
  CreateLeadInput,
  LeadActivity,
  LogInteractionInput,
  ScheduleFollowUpInput,
  UpdateLeadInput,
} from '../domain/types.js';
import type { LeadRepository } from '../db/repository.js';
import type { Logger } from '../logger.js';
import { SERVER_NAME, VERSION } from '../version.js';
import { formatDue, formatLeadLine, formatPipeline, formatScore } from './format.js';

export const PIPELINE_URI = 'leadflow://pipeline';
export const SCORING_URI = 'leadflow://scoring-model';

export function leadUri(id: string): string {
  return `leadflow://leads/${id}`;
}

export interface LeadFlowServices {
  repository: LeadRepository;
  logger: Logger;
  clock: Clock;
  staleAfterDays: number;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

type ToolResult = {
  content: [{ type: 'text'; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function createLeadFlowServer(services: LeadFlowServices): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerTools(server, services);
  registerResources(server, services);
  registerPrompts(server, services);
  return server;
}

function registerTools(server: McpServer, services: LeadFlowServices): void {
  const { repository, clock } = services;

  server.registerTool(
    'create_lead',
    {
      title: 'Create lead',
      description:
        'Add a lead to the shop pipeline. Money is integer cents (480000 = $4,800.00), never dollars. Pass an idempotencyKey when retrying so a duplicate submit returns the original lead. A reused key with a different payload is a conflict. The response includes the rule-based priority score.',
      inputSchema: createLeadInputSchema,
      annotations: WRITE,
    },
    async (args) =>
      runTool(services, 'create_lead', async () => {
        const created = await repository.createLead(toCreateInput(args), clock.now());
        const score = scoreLeadRecord(created.lead, clock.now());
        const replay = created.replay ? 'yes, existing lead returned' : 'no';
        return {
          text: `Created ${formatLeadLine(created.lead, score)}\nReplay: ${replay}`,
          data: { replay: created.replay, lead: created.lead, score },
        };
      }),
  );

  server.registerTool(
    'update_lead',
    {
      title: 'Update lead',
      description:
        'Change fields on one lead. Send only the fields that change. Pass expectedUpdatedAt from the last read to reject a stale write. Null clears phone, email, city, or notes. Money stays in integer cents.',
      inputSchema: updateLeadInputSchema,
      annotations: WRITE,
    },
    async (args) =>
      runTool(services, 'update_lead', async () => {
        const lead = await repository.updateLead(args.leadId, toUpdateInput(args), clock.now());
        const score = scoreLeadRecord(lead, clock.now());
        return {
          text: `Updated ${formatLeadLine(lead, score)}`,
          data: { lead, score },
        };
      }),
  );

  server.registerTool(
    'get_lead',
    {
      title: 'Get lead',
      description:
        'Read one lead with its priority score, interactions, and follow-ups. Use this before drafting outreach so the reply stays inside the recorded facts.',
      inputSchema: getLeadInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'get_lead', async () => {
        const view = await loadLeadView(repository, args.leadId, clock.now());
        return {
          text: formatScore(view.lead, view.score),
          data: view,
        };
      }),
  );

  server.registerTool(
    'search_leads',
    {
      title: 'Search leads',
      description:
        'Search the pipeline. Text matches name, service, city, email, phone, and notes, case-insensitive for ASCII. Results are ranked inside the 500 most recently updated matches. When truncated is true, narrow the query. Scores are computed, not stored.',
      inputSchema: searchLeadsInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'search_leads', async () => {
        const asOf = clock.now();
        const found = await repository.searchLeads({
          text: args.text ?? null,
          stage: args.stage ?? null,
          source: args.source ?? null,
          minScore: args.minScore ?? null,
          sort: args.sort ?? 'updated_at',
          limit: args.limit ?? 25,
          offset: args.offset ?? 0,
          asOf,
        });
        const rows = found.leads.map((lead) => ({ lead, score: scoreLeadRecord(lead, asOf) }));
        const lines = rows.map((row) => formatLeadLine(row.lead, row.score));
        const header = `${rows.length} lead${rows.length === 1 ? '' : 's'}${found.truncated ? ' (scan truncated at 500)' : ''}`;
        return {
          text: [header, ...lines].join('\n'),
          data: { leads: rows, truncated: found.truncated },
        };
      }),
  );

  server.registerTool(
    'score_lead',
    {
      title: 'Score lead',
      description:
        'Explain the priority score for one lead. The score is a published sum of source, reachability, urgency, value, stage, and recency, then a cap. It is not persisted and it does not call a model. Read leadflow://scoring-model for the rubric.',
      inputSchema: scoreLeadInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'score_lead', async () => {
        const asOf = args.asOf ? new Date(args.asOf) : clock.now();
        const lead = await requireLead(repository, args.leadId);
        const score = scoreLeadRecord(lead, asOf);
        return { text: formatScore(lead, score), data: { lead, score, asOf: asOf.toISOString() } };
      }),
  );

  server.registerTool(
    'log_interaction',
    {
      title: 'Log interaction',
      description:
        'Record a call, email, SMS, visit, or note on a lead. Summary should be the facts of the conversation, not a guess. Pass an idempotencyKey on retry. Omitting occurredAt stamps the server clock, and that default is not part of the idempotency hash.',
      inputSchema: logInteractionInputSchema,
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (args) =>
      runTool(services, 'log_interaction', async () => {
        const logged = await repository.logInteraction(toInteractionInput(args), clock.now());
        const replay = logged.replay ? 'yes' : 'no';
        return {
          text: `Logged ${logged.interaction.channel} ${logged.interaction.direction} on ${logged.interaction.leadId} at ${logged.interaction.occurredAt}.\nReplay: ${replay}\n${logged.interaction.summary}`,
          data: { replay: logged.replay, interaction: logged.interaction },
        };
      }),
  );

  server.registerTool(
    'schedule_follow_up',
    {
      title: 'Schedule follow-up',
      description:
        'Schedule a follow-up for a lead. dueAt may be in the past, which makes it due immediately. Pass an idempotencyKey on retry.',
      inputSchema: scheduleFollowUpInputSchema,
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (args) =>
      runTool(services, 'schedule_follow_up', async () => {
        const scheduled = await repository.scheduleFollowUp(toFollowUpInput(args), clock.now());
        const replay = scheduled.replay ? 'yes' : 'no';
        return {
          text: `Scheduled ${scheduled.followUp.id} for ${scheduled.followUp.leadId} at ${scheduled.followUp.dueAt}.\nReplay: ${replay}\n${scheduled.followUp.reason}`,
          data: { replay: scheduled.replay, followUp: scheduled.followUp },
        };
      }),
  );

  server.registerTool(
    'set_follow_up_status',
    {
      title: 'Set follow-up status',
      description:
        'Mark a follow-up scheduled, done, or cancelled. Setting the same status again is safe. Done and cancelled items drop out of list_due_follow_ups.',
      inputSchema: setFollowUpStatusInputSchema,
      annotations: { ...WRITE, idempotentHint: true },
    },
    async (args) =>
      runTool(services, 'set_follow_up_status', async () => {
        const followUp = await repository.setFollowUpStatus(
          args.followUpId,
          args.status,
          clock.now(),
        );
        return {
          text: `${followUp.id} is ${followUp.status}.`,
          data: { followUp },
        };
      }),
  );

  server.registerTool(
    'list_due_follow_ups',
    {
      title: 'List due follow-ups',
      description:
        'List scheduled follow-ups whose dueAt is at or before asOf (default: server clock). Ordered soonest first. This is the front desk call list.',
      inputSchema: listDueFollowUpsInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'list_due_follow_ups', async () => {
        const asOf = args.asOf ? new Date(args.asOf) : clock.now();
        const due = await repository.listDueFollowUps(asOf, args.limit ?? 50);
        return {
          text: formatDue(due, asOf.toISOString()),
          data: { asOf: asOf.toISOString(), followUps: due },
        };
      }),
  );

  server.registerTool(
    'pipeline_summary',
    {
      title: 'Pipeline summary',
      description:
        'Counts by stage, open pipeline value in cents, win rate among closed leads (won / (won + lost)), and open leads with no activity for staleAfterDays (default 7). Win rate is null when nothing has closed.',
      inputSchema: pipelineSummaryInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'pipeline_summary', async () => {
        const asOf = args.asOf ? new Date(args.asOf) : clock.now();
        const summary = summarizePipeline(
          await repository.listLeadActivity(),
          asOf,
          args.staleAfterDays ?? services.staleAfterDays,
        );
        return { text: formatPipeline(summary), data: { summary } };
      }),
  );

  server.registerTool(
    'export_leads_csv',
    {
      title: 'Export leads CSV',
      description:
        'Export leads as CSV text. Cells that start with =, +, -, or @ are prefixed with an apostrophe so a spreadsheet will not treat them as formulas. Quotes and newlines are escaped. The export caps at 5000 rows and sets truncated when that happens. Money is integer cents.',
      inputSchema: exportLeadsInputSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      runTool(services, 'export_leads_csv', async () => {
        const asOf = args.asOf ? new Date(args.asOf) : clock.now();
        const exported = await repository.leadsForExport(args.stage ?? null);
        const csv = leadsToCsv(exported.leads, asOf);
        const value = exported.leads.reduce((total, lead) => total + lead.estimatedValueCents, 0);
        return {
          text: `Exported ${exported.leads.length} lead${exported.leads.length === 1 ? '' : 's'}${exported.truncated ? ' (truncated at 5000)' : ''}. Value in view: ${formatUsd(value)}.\n${csv}`,
          data: {
            filename: 'leads.csv',
            rowCount: exported.leads.length,
            truncated: exported.truncated,
            csv,
          },
        };
      }),
  );
}

function registerResources(server: McpServer, services: LeadFlowServices): void {
  const { repository, clock, staleAfterDays } = services;

  server.registerResource(
    'pipeline',
    PIPELINE_URI,
    {
      title: 'Pipeline snapshot',
      description: 'Stage counts, win rate, open value, and stale leads as JSON.',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const summary = summarizePipeline(
          await repository.listLeadActivity(),
          clock.now(),
          staleAfterDays,
        );
        return {
          contents: [
            { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summary) },
          ],
        };
      } catch (error) {
        throw toProtocolError(error, uri.href);
      }
    },
  );

  server.registerResource(
    'scoring_model',
    SCORING_URI,
    {
      title: 'Scoring model',
      description: 'The published point rubric used by score_lead. No model is called.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderScoringModel() }],
    }),
  );

  server.registerResource(
    'lead',
    new ResourceTemplate('leadflow://leads/{leadId}', {
      list: async () => {
        const found = await repository.searchLeads({
          text: null,
          stage: null,
          source: null,
          minScore: null,
          sort: 'updated_at',
          limit: 100,
          offset: 0,
          asOf: clock.now(),
        });
        return {
          resources: found.leads.map((lead) => ({
            uri: leadUri(lead.id),
            name: lead.contactName,
            description: `${lead.stage} · ${lead.service}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Lead',
      description: 'One lead, its score, interactions, and follow-ups, as JSON.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const leadId = oneVariable(variables.leadId);
      try {
        const view = await loadLeadView(repository, leadId, clock.now());
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(view) }],
        };
      } catch (error) {
        throw toProtocolError(error, uri.href);
      }
    },
  );
}

function registerPrompts(server: McpServer, services: LeadFlowServices): void {
  const { repository, clock, staleAfterDays } = services;

  server.registerPrompt(
    'daily_follow_up_briefing',
    {
      title: 'Daily follow-up briefing',
      description:
        'Build a front-desk briefing from the live pipeline and the follow-ups that are due. The model must not invent prices, times, or promises.',
      argsSchema: z.object({
        staleAfterDays: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe(
            'Days without activity before an open lead is stale. Default is the server setting.',
          ),
        tone: z
          .enum(['friendly', 'concise'])
          .optional()
          .describe('Voice for the drafted lines. Default friendly.'),
      }),
    },
    async (args) => {
      const asOf = clock.now();
      const days = args.staleAfterDays ?? staleAfterDays;
      const tone = args.tone ?? 'friendly';
      const summary = summarizePipeline(await repository.listLeadActivity(), asOf, days);
      const due = await repository.listDueFollowUps(asOf, 50);
      const text = [
        'You are the front desk for a local service business using LeadFlow.',
        `Write a ${tone} briefing the owner can act on today.`,
        'Use only the JSON below. Do not invent prices, appointment times, discounts, or promises that are not written down.',
        'Order the work as: overdue follow-ups, then stale open leads, then one suggested next action each.',
        'If a fact is missing, say it is missing.',
        '',
        'Pipeline:',
        JSON.stringify(summary),
        '',
        'Due follow-ups:',
        JSON.stringify(due),
      ].join('\n');
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
      };
    },
  );

  server.registerPrompt(
    'draft_follow_up',
    {
      title: 'Draft follow-up',
      description:
        'Draft a follow-up for one lead from the recorded facts. The model must not invent discounts or appointment times.',
      argsSchema: z.object({
        leadId: z.string().describe('Lead id, for example lead_marina_cho.'),
        channel: z
          .enum(['call', 'email', 'sms'])
          .optional()
          .describe('Channel to draft for. Default call.'),
        tone: z.enum(['friendly', 'concise']).optional().describe('Default friendly.'),
      }),
    },
    async (args) => {
      let view: Awaited<ReturnType<typeof loadLeadView>>;
      try {
        view = await loadLeadView(repository, args.leadId, clock.now());
      } catch (error) {
        throw toProtocolError(error, leadUri(args.leadId));
      }
      const channel = args.channel ?? 'call';
      const tone = args.tone ?? 'friendly';
      const text = [
        `Draft a ${tone} ${channel} follow-up for this lead.`,
        'Use only the JSON below. Do not invent a price, a discount, or a time the shop did not already offer.',
        'Ask one question that would move the lead a single stage forward.',
        'If the notes say not to discount, do not offer one.',
        '',
        JSON.stringify(view),
      ].join('\n');
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
      };
    },
  );
}

async function loadLeadView(repository: LeadRepository, leadId: string, asOf: Date) {
  const lead = await requireLead(repository, leadId);
  return {
    lead,
    score: scoreLeadRecord(lead, asOf),
    interactions: await repository.listInteractions(lead.id),
    followUps: await repository.listFollowUps(lead.id),
  };
}

async function requireLead(repository: LeadRepository, leadId: string): Promise<LeadActivity> {
  const lead = await repository.getLead(leadId);
  if (!lead) throw new LeadFlowError('NOT_FOUND', `No lead with id "${leadId}".`);
  return lead;
}

function toCreateInput(args: z.infer<typeof createLeadInputSchema>): CreateLeadInput {
  return {
    contactName: args.contactName,
    phone: args.phone ?? null,
    email: args.email ?? null,
    service: args.service,
    source: args.source,
    stage: args.stage ?? 'new',
    estimatedValueCents: args.estimatedValueCents ?? 0,
    urgency: args.urgency ?? 'normal',
    city: args.city ?? null,
    notes: args.notes ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  };
}

function toUpdateInput(args: z.infer<typeof updateLeadInputSchema>): UpdateLeadInput {
  return {
    contactName: args.contactName,
    phone: args.phone,
    email: args.email,
    service: args.service,
    source: args.source,
    stage: args.stage,
    estimatedValueCents: args.estimatedValueCents,
    urgency: args.urgency,
    city: args.city,
    notes: args.notes,
    expectedUpdatedAt: args.expectedUpdatedAt,
  };
}

function toInteractionInput(args: z.infer<typeof logInteractionInputSchema>): LogInteractionInput {
  return {
    leadId: args.leadId,
    channel: args.channel,
    direction: args.direction,
    summary: args.summary,
    occurredAt: args.occurredAt ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  };
}

function toFollowUpInput(args: z.infer<typeof scheduleFollowUpInputSchema>): ScheduleFollowUpInput {
  return {
    leadId: args.leadId,
    dueAt: args.dueAt,
    reason: args.reason,
    idempotencyKey: args.idempotencyKey ?? null,
  };
}

function oneVariable(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function toProtocolError(error: unknown, uri: string): Error {
  if (error instanceof LeadFlowError && error.code === 'NOT_FOUND') {
    return new ResourceNotFoundError(uri, error.message);
  }
  if (error instanceof LeadFlowError) {
    return new ProtocolError(ProtocolErrorCode.InvalidParams, error.message);
  }
  if (error instanceof ProtocolError) return error;
  return new ProtocolError(
    ProtocolErrorCode.InternalError,
    'Unexpected error while reading the resource.',
  );
}

async function runTool(
  services: LeadFlowServices,
  tool: string,
  fn: () => Promise<{ text: string; data: Record<string, unknown> }>,
): Promise<ToolResult> {
  const started = performance.now();
  try {
    const result = await fn();
    services.logger.info('tool.ok', { tool, ms: elapsed(started) });
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: result.data,
    };
  } catch (error) {
    if (error instanceof LeadFlowError) {
      services.logger.warn('tool.error', { tool, code: error.code, ms: elapsed(started) });
      return {
        isError: true,
        content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
        structuredContent: { error: { code: error.code, message: error.message } },
      };
    }
    services.logger.error('tool.unhandled', {
      tool,
      ms: elapsed(started),
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return {
      isError: true,
      content: [{ type: 'text', text: 'INTERNAL: Unexpected error while running this tool.' }],
    };
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
