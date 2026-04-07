/**
 * Feed content sanitisation — strips instruction-like patterns that could
 * be used for prompt injection when feed item content enters Claude's context.
 */

const INJECTION_PATTERNS = [
  // Direct instruction patterns
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above\s+instructions/gi,
  /disregard\s+(all\s+)?previous/gi,
  /forget\s+(all\s+)?previous/gi,
  /override\s+(all\s+)?instructions/gi,
  /new\s+instructions?\s*:/gi,
  /system\s*prompt\s*:/gi,
  /you\s+are\s+now\s+a/gi,
  /act\s+as\s+if/gi,
  /pretend\s+you\s+are/gi,
  /switch\s+to\s+.*mode/gi,

  // Data exfiltration patterns
  /output\s+(the\s+)?(full|complete|entire)\s+(system|client|config)/gi,
  /reveal\s+(your|the)\s+(system|instructions|prompt)/gi,
  /what\s+are\s+your\s+(instructions|rules|guidelines)/gi,
  /show\s+me\s+(your|the)\s+(system|prompt|config)/gi,

  // Encoding/obfuscation attempts
  /base64\s*:/gi,
  /eval\s*\(/gi,
  /execute\s*:/gi,

  // Role manipulation
  /you\s+must\s+always/gi,
  /from\s+now\s+on/gi,
  /for\s+the\s+rest\s+of\s+this\s+conversation/gi,
];

export function sanitiseFeedContent(text: string): string {
  let cleaned = text;
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[FILTERED]');
  }
  return cleaned;
}
