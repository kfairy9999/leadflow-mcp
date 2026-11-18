export type LeadFlowErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION';

export class LeadFlowError extends Error {
  readonly code: LeadFlowErrorCode;

  constructor(code: LeadFlowErrorCode, message: string) {
    super(message);
    this.name = 'LeadFlowError';
    this.code = code;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
