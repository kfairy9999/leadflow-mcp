import { ageInDays } from './time.js';
import type { LeadActivity, LeadSource, LeadStage, ScoreBand, Urgency } from './types.js';

export interface ScoreFactor {
  id: string;
  points: number;
  detail: string;
}

export interface LeadScore {
  score: number;
  band: ScoreBand;
  disposition: 'open' | 'won' | 'lost';
  factors: ScoreFactor[];
  summary: string;
}

export interface ScoreInput {
  source: LeadSource;
  stage: LeadStage;
  urgency: Urgency;
  estimatedValueCents: number;
  hasPhone: boolean;
  hasEmail: boolean;
  createdAt: string;
  lastInteractionAt: string | null;
  asOf: Date;
}

/**
 * Published rubric. `renderScoringModel` and `scoreLead` both read these
 * numbers so the resource a client fetches cannot drift from the code.
 */
export const SCORE_RULES = {
  source: {
    referral: 22,
    website: 14,
    walk_in: 12,
    phone: 8,
    other: 3,
  },
  phone: 10,
  email: 8,
  unreachable: -12,
  urgency: {
    low: 0,
    normal: 6,
    high: 20,
  },
  value: [
    { minCents: 500_000, points: 16, label: '$5,000 or more' },
    { minCents: 150_000, points: 12, label: '$1,500 to $4,999.99' },
    { minCents: 40_000, points: 8, label: '$400 to $1,499.99' },
    { minCents: 1, points: 4, label: 'under $400' },
  ],
  unknownValue: -4,
  stage: {
    new: 4,
    contacted: 7,
    qualified: 12,
    proposal: 16,
    won: 0,
    lost: 0,
  },
  recency: {
    within2Days: 16,
    within7Days: 8,
    quietOver14Days: -12,
    quietOver21Days: -18,
  },
  caps: {
    max: 100,
    min: 0,
    won: 40,
    lost: 15,
  },
  bands: {
    hot: 75,
    warm: 50,
    cool: 25,
  },
} as const;

const SOURCE_DETAIL: Record<LeadSource, string> = {
  referral: 'Referral is the strongest source in this rubric.',
  website: 'Website lead. Ahead of a cold inquiry, behind a referral.',
  walk_in: 'Walk-in. The person already showed up.',
  phone: 'Inbound phone lead.',
  other: 'Source is other, the weakest acquisition signal in this rubric.',
};

const STAGE_DETAIL: Record<LeadStage, string> = {
  new: 'Stage is new. Not yet worked.',
  contacted: 'Stage is contacted. A conversation has started.',
  qualified: 'Stage is qualified. The job looks real.',
  proposal: 'Stage is proposal. Closest open stage to a decision.',
  won: 'Stage is won. Kept for history, not for the chase queue.',
  lost: 'Stage is lost. Kept for history, not for the chase queue.',
};

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_RULES.bands.hot) return 'hot';
  if (score >= SCORE_RULES.bands.warm) return 'warm';
  if (score >= SCORE_RULES.bands.cool) return 'cool';
  return 'cold';
}

export function scoreLead(input: ScoreInput): LeadScore {
  const factors: ScoreFactor[] = [];

  factors.push({
    id: 'source',
    points: SCORE_RULES.source[input.source],
    detail: SOURCE_DETAIL[input.source],
  });

  if (input.hasPhone) {
    factors.push({
      id: 'phone',
      points: SCORE_RULES.phone,
      detail: 'A phone number is on file.',
    });
  }
  if (input.hasEmail) {
    factors.push({
      id: 'email',
      points: SCORE_RULES.email,
      detail: 'An email address is on file.',
    });
  }
  if (!input.hasPhone && !input.hasEmail) {
    factors.push({
      id: 'unreachable',
      points: SCORE_RULES.unreachable,
      detail: 'No phone or email is on file, so the lead is hard to reach.',
    });
  }

  factors.push({
    id: 'urgency',
    points: SCORE_RULES.urgency[input.urgency],
    detail:
      input.urgency === 'high'
        ? 'Urgency is high.'
        : input.urgency === 'normal'
          ? 'Urgency is normal.'
          : 'Urgency is low, so it adds nothing.',
  });

  factors.push(valueFactor(input.estimatedValueCents));

  const stagePoints = SCORE_RULES.stage[input.stage];
  if (stagePoints !== 0) {
    factors.push({
      id: 'stage',
      points: stagePoints,
      detail: STAGE_DETAIL[input.stage],
    });
  }

  factors.push(recencyFactor(input));

  let total = sum(factors);
  const ceiling =
    input.stage === 'lost'
      ? SCORE_RULES.caps.lost
      : input.stage === 'won'
        ? SCORE_RULES.caps.won
        : SCORE_RULES.caps.max;

  if (total > ceiling) {
    const detail =
      input.stage === 'lost'
        ? `Closed-lost leads are capped at ${ceiling} so they stay out of the chase queue.`
        : input.stage === 'won'
          ? `Won leads are capped at ${ceiling}. The score is informational, not a follow-up priority.`
          : `The raw total exceeded ${ceiling}, so the published ceiling was applied.`;
    factors.push({ id: 'cap', points: ceiling - total, detail });
    total = ceiling;
  }
  if (total < SCORE_RULES.caps.min) {
    factors.push({
      id: 'floor',
      points: SCORE_RULES.caps.min - total,
      detail: 'The raw total was below 0, so the published floor was applied.',
    });
    total = SCORE_RULES.caps.min;
  }

  const disposition = input.stage === 'won' || input.stage === 'lost' ? input.stage : 'open';
  const band = scoreBand(total);
  return {
    score: total,
    band,
    disposition,
    factors,
    summary: summarize(total, band, disposition, factors),
  };
}

export function scoreLeadRecord(lead: LeadActivity, asOf: Date): LeadScore {
  return scoreLead({
    source: lead.source,
    stage: lead.stage,
    urgency: lead.urgency,
    estimatedValueCents: lead.estimatedValueCents,
    hasPhone: Boolean(lead.phone),
    hasEmail: Boolean(lead.email),
    createdAt: lead.createdAt,
    lastInteractionAt: lead.lastInteractionAt,
    asOf,
  });
}

export function renderScoringModel(): string {
  const sourceLines = (Object.keys(SCORE_RULES.source) as LeadSource[])
    .map((source) => `- \`${source}\`: ${SCORE_RULES.source[source]}`)
    .join('\n');
  const valueLines = SCORE_RULES.value.map((tier) => `- ${tier.label}: ${tier.points}`).join('\n');
  const stageLines = (Object.keys(SCORE_RULES.stage) as LeadStage[])
    .map((stage) => `- \`${stage}\`: ${SCORE_RULES.stage[stage]}`)
    .join('\n');

  return [
    '# LeadFlow scoring model',
    '',
    'Priority is a published sum, then a cap. Nothing in this model calls a language model.',
    'The same constants drive `score_lead` and this document.',
    '',
    '## Source',
    sourceLines,
    '',
    '## Reachability',
    `- Phone on file: ${SCORE_RULES.phone}`,
    `- Email on file: ${SCORE_RULES.email}`,
    `- Neither phone nor email: ${SCORE_RULES.unreachable}`,
    '',
    '## Urgency',
    `- high: ${SCORE_RULES.urgency.high}`,
    `- normal: ${SCORE_RULES.urgency.normal}`,
    `- low: ${SCORE_RULES.urgency.low}`,
    '',
    '## Estimated value',
    valueLines,
    `- Unknown ($0): ${SCORE_RULES.unknownValue}`,
    '',
    '## Stage',
    stageLines,
    '',
    '## Recency',
    'Age is measured from the latest interaction, or from `createdAt` when nobody has logged one.',
    `- Under 2 days: ${SCORE_RULES.recency.within2Days}`,
    `- Under 7 days: ${SCORE_RULES.recency.within7Days}`,
    '- 7 to 14 days: 0',
    `- After 14 days: ${SCORE_RULES.recency.quietOver14Days}`,
    `- After 21 days: ${SCORE_RULES.recency.quietOver21Days}`,
    '',
    '## Caps',
    `- Open leads: ${SCORE_RULES.caps.min} to ${SCORE_RULES.caps.max}`,
    `- Won leads: ceiling ${SCORE_RULES.caps.won}`,
    `- Lost leads: ceiling ${SCORE_RULES.caps.lost}`,
    '',
    '## Bands',
    `- hot: ${SCORE_RULES.bands.hot} to ${SCORE_RULES.caps.max}`,
    `- warm: ${SCORE_RULES.bands.warm} to ${SCORE_RULES.bands.hot - 1}`,
    `- cool: ${SCORE_RULES.bands.cool} to ${SCORE_RULES.bands.warm - 1}`,
    `- cold: ${SCORE_RULES.caps.min} to ${SCORE_RULES.bands.cool - 1}`,
    '',
    'A factor list on a scored lead sums to the final score, including the cap or floor adjustment.',
    '',
  ].join('\n');
}

function valueFactor(cents: number): ScoreFactor {
  if (cents <= 0) {
    return {
      id: 'value',
      points: SCORE_RULES.unknownValue,
      detail: 'Estimated value is unknown, so the lead is slightly harder to prioritize.',
    };
  }
  for (const tier of SCORE_RULES.value) {
    if (cents >= tier.minCents) {
      return {
        id: 'value',
        points: tier.points,
        detail: `Estimated value is ${tier.label}.`,
      };
    }
  }
  return {
    id: 'value',
    points: SCORE_RULES.unknownValue,
    detail: 'Estimated value is unknown, so the lead is slightly harder to prioritize.',
  };
}

function recencyFactor(input: ScoreInput): ScoreFactor {
  const activityAt = input.lastInteractionAt ?? input.createdAt;
  const age = ageInDays(activityAt, input.asOf);
  if (age === null) {
    return {
      id: 'recency',
      points: SCORE_RULES.recency.quietOver14Days,
      detail: 'Activity timestamp could not be read, so the lead is treated as quiet.',
    };
  }
  if (age <= 2) {
    return {
      id: 'recency',
      points: SCORE_RULES.recency.within2Days,
      detail: 'Last activity was under 2 days ago.',
    };
  }
  if (age <= 7) {
    return {
      id: 'recency',
      points: SCORE_RULES.recency.within7Days,
      detail: 'Last activity was under 7 days ago.',
    };
  }
  if (age > 21) {
    return {
      id: 'recency',
      points: SCORE_RULES.recency.quietOver21Days,
      detail: `No activity for ${Math.floor(age)} days. The quiet-lead penalty increases after 21 days.`,
    };
  }
  if (age > 14) {
    return {
      id: 'recency',
      points: SCORE_RULES.recency.quietOver14Days,
      detail: `No activity for ${Math.floor(age)} days. Open leads go quiet after 14 days.`,
    };
  }
  return {
    id: 'recency',
    points: 0,
    detail: `Last activity was ${Math.floor(age)} days ago, still inside 14 days, so recency adds nothing.`,
  };
}

function summarize(
  score: number,
  band: ScoreBand,
  disposition: LeadScore['disposition'],
  factors: ScoreFactor[],
): string {
  if (disposition === 'won') {
    return `Won. Informational score ${score}/100 (${band}). This lead is already closed and is not a follow-up priority.`;
  }
  if (disposition === 'lost') {
    return `Lost. Score capped at ${score}/100 (${band}). Closed-lost leads stay out of the chase queue.`;
  }
  const top = factors
    .filter((factor) => factor.points > 0)
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id))[0];
  const signal = top ? ` Strongest signal: ${top.detail}` : '';
  return `${bandLabel(band)} follow-up priority, ${score}/100.${signal}`;
}

function bandLabel(band: ScoreBand): string {
  if (band === 'hot') return 'Hot';
  if (band === 'warm') return 'Warm';
  if (band === 'cool') return 'Cool';
  return 'Cold';
}

function sum(factors: ScoreFactor[]): number {
  return factors.reduce((total, factor) => total + factor.points, 0);
}
