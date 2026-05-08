// ---------------------------------------------------------------------------
// Classifier versioning — deterministic hash of prompt + model + ruleset.
// When any input changes, version changes, enabling A/B comparison.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { CLASSIFIER_MODEL } from './constants';

// Bump this when deterministic mapping logic changes
const DETERMINISTIC_RULESET_VERSION = '1';

// Bump this when LLM prompt template changes
const LLM_PROMPT_VERSION = '1';

export function getDeterministicVersion(): string {
  return hash(`deterministic:${DETERMINISTIC_RULESET_VERSION}`);
}

export function getLlmVersion(): string {
  return hash(`llm:${CLASSIFIER_MODEL}:${LLM_PROMPT_VERSION}`);
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
