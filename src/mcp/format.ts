import { formatUsd } from '../domain/money.js';
import type { PipelineSummary, StaleLead } from '../domain/pipeline.js';
import type { LeadScore } from '../domain/scoring.js';
import type { DueFollowUp, LeadActivity } from '../domain/types.js';

export function formatLeadLine(lead: LeadActivity, score: LeadScore): string {
  const value = formatUsd(lead.estimatedValueCents);
  return `${lead.id} · ${lead.contactName} · ${lead.stage} · ${score.score}/100 ${score.band} · ${value} · ${lead.service}`;
}

export function formatScore(lead: LeadActivity, score: LeadScore): string {
  const lines = [
    formatLeadLine(lead, score),
    score.summary,
    ...score.factors.map(
      (factor) => `${formatPoints(factor.points)} ${factor.id} — ${factor.detail}`,
    ),
    `= ${score.score}`,
  ];
  return lines.join('\n');
}

export function formatPipeline(summary: PipelineSummary): string {
  const stages = Object.entries(summary.stages)
    .map(([stage, count]) => `${stage} ${count}`)
    .join(', ');
  const stale = summary.staleLeads.map((lead) => `- ${formatStale(lead)}`).join('\n');
  return [
    `Pipeline as of ${summary.asOf}`,
    `Open: ${summary.openLeads} · Won: ${summary.won} · Lost: ${summary.lost} · Win rate: ${summary.winRateLabel}`,
    `Open value: ${formatUsd(summary.openValueCents)}`,
    `Stages: ${stages}`,
    `Stale (>${summary.staleAfterDays}d): ${summary.staleCount}${summary.staleTruncated ? ' (list truncated)' : ''}`,
    stale,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function formatDue(followUps: readonly DueFollowUp[], asOf: string): string {
  if (followUps.length === 0) return `No follow-ups due as of ${asOf}.`;
  const lines = followUps.map(
    (item) =>
      `- ${item.id} · ${item.contactName} · ${item.leadId} · due ${item.dueAt} · ${item.reason}`,
  );
  return [
    `${followUps.length} follow-up${followUps.length === 1 ? '' : 's'} due as of ${asOf}`,
    ...lines,
  ].join('\n');
}

export function formatPoints(points: number): string {
  if (points > 0) return `+${points}`;
  return String(points);
}

function formatStale(lead: StaleLead): string {
  return `${lead.id} · ${lead.contactName} · ${lead.stage} · ${lead.service} · ${lead.daysSinceActivity}d quiet`;
}
