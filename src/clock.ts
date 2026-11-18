export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Returns a clock frozen at one instant. Each call returns a new Date with that time. */
export function fixedClock(instant: Date): Clock {
  const ms = instant.getTime();
  return {
    now: () => new Date(ms),
  };
}
