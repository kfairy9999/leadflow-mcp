import type { FollowUp, Interaction, Lead } from '../domain/types.js';
import { hoursBefore, hoursAfter } from '../domain/time.js';
import { LeadRepository, type SeedBundle } from './repository.js';
import type { SeedMode } from '../config.js';
import { isUniqueViolation, type SqlDatabase } from './sql.js';
import { migrate } from './migrate.js';
import type { Logger } from '../logger.js';

/**
 * Fictional shop: Northglass Plumbing in the invented town of Harborton.
 * Every person is invented. Phones use the 555-0100 range reserved for fiction.
 * Emails use example.com. Nothing here is a real customer.
 */
export const SEED_LEAD_COUNT = 10;

export function buildSeed(now: Date): SeedBundle {
  const leads: Lead[] = [
    lead(
      'lead_marina_cho',
      'Marina Cho',
      '(555) 010-0101',
      'marina.cho@example.com',
      'Tankless water heater install',
      'referral',
      'proposal',
      480_000,
      'high',
      'Harborton',
      'Wants the unit in the garage. HOA quiet hours after 7pm.',
      240,
      20,
      now,
    ),
    lead(
      'lead_ellis_ward',
      'Ellis Ward',
      null,
      'ellis.ward@example.com',
      'Kitchen sink leak',
      'website',
      'new',
      35_000,
      'normal',
      'Harborton',
      'Drips only when the dishwasher runs.',
      5,
      5,
      now,
    ),
    lead(
      'lead_priya_nandakumar',
      'Priya Nandakumar',
      '(555) 010-0102',
      'priya.nandakumar@example.com',
      'Main line clog',
      'phone',
      'contacted',
      90_000,
      'high',
      'Harborton',
      'Backup into the laundry sink.',
      96,
      72,
      now,
    ),
    lead(
      'lead_jonah_feldman',
      'Jonah Feldman',
      '(555) 010-0103',
      'jonah.feldman@example.com',
      'Primary bathroom remodel',
      'walk_in',
      'proposal',
      1_240_000,
      'normal',
      'Harborton',
      'Asked for a written proposal before Friday.',
      400,
      20,
      now,
    ),
    lead(
      'lead_helen_okonkwo',
      'Helen Okonkwo',
      '(555) 010-0104',
      'helen.okonkwo@example.com',
      'Sump pump replacement',
      'referral',
      'won',
      160_000,
      'normal',
      'Harborton',
      'Paid in full. Left a referral card.',
      480,
      144,
      now,
    ),
    lead(
      'lead_chris_dalton',
      'Chris Dalton',
      '(555) 010-0105',
      'chris.dalton@example.com',
      'Whole-house repipe quote',
      'other',
      'lost',
      1_800_000,
      'normal',
      'Harborton',
      'Lost to a lower bid. Do not discount to win this back.',
      360,
      288,
      now,
    ),
    lead(
      'lead_samira_adeyemi',
      'Samira Adeyemi',
      null,
      'samira.adeyemi@example.com',
      'Water heater flush',
      'website',
      'contacted',
      22_000,
      'normal',
      'Harborton',
      'Requested a Saturday morning.',
      500,
      432,
      now,
    ),
    lead(
      'lead_luis_ortega',
      'Luis Ortega',
      '(555) 010-0106',
      null,
      'No hot water',
      'phone',
      'new',
      0,
      'high',
      null,
      'Caller was not sure whether the tank or the pilot is the problem.',
      48,
      48,
      now,
    ),
    lead(
      'lead_rowan_blake',
      'Rowan Blake',
      '(555) 010-0107',
      'rowan.blake@example.com',
      'Outdoor faucet winterize',
      'walk_in',
      'qualified',
      18_000,
      'low',
      'Harborton',
      'Two hose bibs on the south wall.',
      240,
      192,
      now,
    ),
    lead(
      'lead_quinn_harper',
      'Quinn Harper',
      '(555) 010-0108',
      'quinn.harper@example.com',
      'Sewer scope and cleanout',
      'referral',
      'proposal',
      220_000,
      'normal',
      'Harborton',
      'Neighbor Marina Cho referred them.',
      72,
      12,
      now,
    ),
  ];

  const interactions: Interaction[] = [
    interaction(
      'int_marina_cho',
      'lead_marina_cho',
      'visit',
      'inbound',
      'Walked the garage and confirmed a 1998 tank.',
      20,
      now,
    ),
    interaction(
      'int_priya_nandakumar',
      'lead_priya_nandakumar',
      'call',
      'outbound',
      'Left a voicemail with a morning arrival window.',
      72,
      now,
    ),
    interaction(
      'int_jonah_feldman',
      'lead_jonah_feldman',
      'visit',
      'inbound',
      'Measured the primary bath. Waiting on the written number.',
      20,
      now,
    ),
    interaction(
      'int_helen_okonkwo',
      'lead_helen_okonkwo',
      'call',
      'inbound',
      'Confirmed the pump is running and the invoice is paid.',
      144,
      now,
    ),
    interaction(
      'int_chris_dalton',
      'lead_chris_dalton',
      'email',
      'outbound',
      'Sent the repipe proposal. They declined on price.',
      288,
      now,
    ),
    interaction(
      'int_samira_adeyemi',
      'lead_samira_adeyemi',
      'email',
      'outbound',
      'Offered two flush appointments. No reply.',
      432,
      now,
    ),
    interaction(
      'int_rowan_blake',
      'lead_rowan_blake',
      'visit',
      'inbound',
      'Showed the two hose bibs. Qualified the winterize.',
      192,
      now,
    ),
    interaction(
      'int_quinn_harper',
      'lead_quinn_harper',
      'call',
      'inbound',
      'Described a slow downstairs drain and asked for a scope.',
      12,
      now,
    ),
  ];

  const followUps: FollowUp[] = [
    followUp(
      'fu_marina_cho',
      'lead_marina_cho',
      hoursBefore(now, 2),
      'Confirm the tankless install window.',
      30,
      now,
    ),
    followUp(
      'fu_priya_nandakumar',
      'lead_priya_nandakumar',
      hoursBefore(now, 26),
      'Main line is still unanswered.',
      80,
      now,
    ),
    followUp(
      'fu_luis_ortega',
      'lead_luis_ortega',
      hoursBefore(now, 0.5),
      'Call back about the no-hot-water emergency.',
      40,
      now,
    ),
    followUp(
      'fu_jonah_feldman',
      'lead_jonah_feldman',
      hoursAfter(now, 48),
      'Deliver the bathroom proposal.',
      10,
      now,
    ),
    followUp(
      'fu_quinn_harper',
      'lead_quinn_harper',
      hoursAfter(now, 5),
      'Schedule the sewer scope.',
      6,
      now,
    ),
  ];

  return { leads, interactions, followUps };
}

export async function bootstrap(
  db: SqlDatabase,
  options: { seed: SeedMode; now: Date; logger: Logger },
): Promise<{ repository: LeadRepository; seeded: boolean }> {
  await migrate(db, options.now);
  const repository = new LeadRepository(db);
  if (options.seed === 'never') return { repository, seeded: false };
  if (options.seed === 'always') {
    await repository.clearBusinessData();
    await repository.importSeed(buildSeed(options.now));
    options.logger.info('seed.applied', { mode: 'always', leads: SEED_LEAD_COUNT });
    return { repository, seeded: true };
  }
  if ((await repository.countLeads()) > 0) return { repository, seeded: false };
  try {
    await repository.importSeed(buildSeed(options.now));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    options.logger.info('seed.skipped', { reason: 'concurrent_insert' });
    return { repository, seeded: false };
  }
  options.logger.info('seed.applied', { mode: 'auto', leads: SEED_LEAD_COUNT });
  return { repository, seeded: true };
}

function lead(
  id: string,
  contactName: string,
  phone: string | null,
  email: string | null,
  service: string,
  source: Lead['source'],
  stage: Lead['stage'],
  estimatedValueCents: number,
  urgency: Lead['urgency'],
  city: string | null,
  notes: string,
  createdHoursAgo: number,
  activityHoursAgo: number,
  now: Date,
): Lead {
  return {
    id,
    contactName,
    phone,
    email,
    service,
    source,
    stage,
    estimatedValueCents,
    urgency,
    city,
    notes,
    createdAt: hoursBefore(now, createdHoursAgo),
    updatedAt: hoursBefore(now, activityHoursAgo),
  };
}

function interaction(
  id: string,
  leadId: string,
  channel: Interaction['channel'],
  direction: Interaction['direction'],
  summary: string,
  hoursAgo: number,
  now: Date,
): Interaction {
  return {
    id,
    leadId,
    channel,
    direction,
    summary,
    occurredAt: hoursBefore(now, hoursAgo),
  };
}

function followUp(
  id: string,
  leadId: string,
  dueAt: string,
  reason: string,
  createdHoursAgo: number,
  now: Date,
): FollowUp {
  return {
    id,
    leadId,
    dueAt,
    reason,
    status: 'scheduled',
    createdAt: hoursBefore(now, createdHoursAgo),
  };
}
