/**
 * Defensive JSON extraction from model output.
 *
 * Models wrap JSON in markdown fences, prepend "Here's your JSON:", and occasionally emit
 * trailing commas — regardless of how firmly the system prompt says not to. `JSON.parse(raw)` on
 * model output is a bug waiting for a demo.
 */

export class ParseError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Strip fences, find the first balanced JSON object, and parse it.
 *
 * Brace counting rather than a regex: a regex cannot match balanced braces, and nested objects
 * are the normal case here (themes containing ideas, clusters containing ids).
 */
export function extractJson(raw: string): unknown {
  if (!raw || !raw.trim()) throw new ParseError('Model returned empty content', raw);

  let text = raw.trim();

  // ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) throw new ParseError('No JSON object found in model output', raw);

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    // Braces inside a string literal are not structure.
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) throw new ParseError('Unbalanced JSON in model output (likely truncated)', raw);

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    // One rescue attempt for trailing commas, the single most common malformation.
    try {
      return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1'));
    } catch (err) {
      throw new ParseError(
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw,
      );
    }
  }
}
