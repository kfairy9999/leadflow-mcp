import { scoreLeadRecord } from './scoring.js';
import { ageInDays } from './time.js';
import { LEAD_STAGES, OPEN_STAGES, type LeadActivity, type LeadStage } from './types.js';

export interface StaleLead {
  id: string;
  contactName: string;
  service: string;
  stage: LeadStage;
  daysSinceActivity: number;
}

export interface PipelineSummary {
  asOf: string;
  staleAfterDays: number;
  stages: Record<LeadStage, number>;
  totalLeads: number;
  openLeads: number;
  won: number;
  lost: number;
  closed: number;
  /** Won divided by won+lost. Null when nothing has closed. */
  winRate: number | null;
  winRateLabel: string;
  openValueCents: number;
  staleCount: number;
  staleLeads: StaleLead[];
  staleTruncated: boolean;
}

const STALE_LIST_CAP = 50;

export function summarizePipeline(
  leads: readonly LeadActivity[],
  asOf: Date,
  staleAfterDays: number,
): PipelineSummary {
  const stages = emptyStages();
  let openValueCents = 0;
  const stale: StaleLead[] = [];

  for (const lead of leads) {
    stages[lead.stage] += 1;
    if (isOpen(lead.stage)) {
      openValueCents += lead.estimatedValueCents;
      const days = daysSinceActivity(lead, asOf);
      if (days !== null && days >= staleAfterDays) {
        stale.push({
          id: lead.id,
          contactName: lead.contactName,
          service: lead.service,
          stage: lead.stage,
          daysSinceActivity: Math.floor(days),
        });
      }
    }
  }

  stale.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity || a.id.localeCompare(b.id));
  const won = stages.won;
  const lost = stages.lost;
  const closed = won + lost;

  return {
    asOf: asOf.toISOString(),
    staleAfterDays,
    stages,
    totalLeads: leads.length,
    openLeads: OPEN_STAGES.reduce((total, stage) => total + stages[stage], 0),
    won,
    lost,
    closed,
    winRate: closed === 0 ? null : won / closed,
    winRateLabel: formatWinRate(won, lost),
    openValueCents,
    staleCount: stale.length,
    staleLeads: stale.slice(0, STALE_LIST_CAP),
    staleTruncated: stale.length > STALE_LIST_CAP,
  };
}

export function daysSinceActivity(lead: LeadActivity, asOf: Date): number | null {
  return ageInDays(lead.lastInteractionAt ?? lead.createdAt, asOf);
}

/** Attach a score without persisting it. */
export function withScore<T extends LeadActivity>(
  lead: T,
  asOf: Date,
): T & { score: number; band: string } {
  const scored = scoreLeadRecord(lead, asOf);
  return { ...lead, score: scored.score, band: scored.band };
}

function emptyStages(): Record<LeadStage, number> {
  return {
    new: 0,
    contacted: 0,
    qualified: 0,
    proposal: 0,
    won: 0,
    lost: 0,
  };
}

function isOpen(stage: LeadStage): boolean {
  return (OPEN_STAGES as readonly LeadStage[]).includes(stage);
}

export function formatWinRate(won: number, lost: number): string {
  const closed = won + lost;
  if (closed === 0) return 'n/a (no closed leads)';
  const tenths = Math.round((won * 1000) / closed);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${won}/${closed} (${whole}.${frac}%)`;
}

export function stageOrder(): readonly LeadStage[] {
  return LEAD_STAGES;
}
