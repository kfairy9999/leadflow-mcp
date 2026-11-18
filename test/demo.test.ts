import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runDemo } from '../scripts/demo.js';

describe('demo transcript', () => {
  it('matches the checked-in transcript of a real session', async () => {
    const transcript = (await runDemo()).replace(/lead_[0-9a-f]{16}/g, 'lead_<generated>');
    const checkedIn = readFileSync(new URL('../docs/demo-transcript.txt', import.meta.url), 'utf8');
    expect(transcript).toBe(checkedIn);
  });
});
