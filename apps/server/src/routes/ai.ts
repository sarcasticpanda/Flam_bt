import { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  AI_CACHE_TTL_MS, AI_INPUT_SCHEMAS, AI_OUTPUT_SCHEMAS, AI_RATE_ROOM_PER_MIN,
  AI_RATE_USER_PER_HOUR, AI_TIMEOUT_MS, aiFeatureSchema, type AIFeatureId,
} from '@board/shared';
import { buildPrompt } from '../ai/features.js';
import { extractJson } from '../ai/parse.js';
import { demo, gemini, groq, openrouter, resolveChain, type Provider } from '../ai/providers.js';

export const aiRouter = Router();

const CHAIN: Provider[] = resolveChain({ groq, gemini, openrouter, demo });
console.log(`[ai] provider chain: ${CHAIN.map((p) => p.id).join(' -> ') || '(none)'}`);

// ---------------------------------------------------------------------------
// Rate limiting — deliberately STRICTER than every upstream free tier, so we hit our own
// ceiling first and return a clean 429 instead of an opaque provider error.
// ---------------------------------------------------------------------------

const roomHits = new Map<string, number[]>();
const userHits = new Map<string, number[]>();

function rateLimited(room: string, userId: string): { limited: boolean; retryAfter: number } {
  const now = Date.now();

  const prune = (map: Map<string, number[]>, key: string, windowMs: number) => {
    const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
    map.set(key, hits);
    return hits;
  };

  const roomWindow = prune(roomHits, room, 60_000);
  if (roomWindow.length >= AI_RATE_ROOM_PER_MIN) {
    return { limited: true, retryAfter: Math.ceil((60_000 - (now - roomWindow[0]!)) / 1000) };
  }

  const userWindow = prune(userHits, userId, 3_600_000);
  if (userWindow.length >= AI_RATE_USER_PER_HOUR) {
    return { limited: true, retryAfter: Math.ceil((3_600_000 - (now - userWindow[0]!)) / 1000) };
  }

  roomWindow.push(now);
  userWindow.push(now);
  return { limited: false, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Result cache — demos re-run the same prompt constantly.
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; data: unknown; provider: string }>();

function cacheKey(feature: string, payload: unknown): string {
  return createHash('sha1').update(`${feature}:${JSON.stringify(payload)}`).digest('hex');
}

// ---------------------------------------------------------------------------

aiRouter.post('/:feature', async (req, res) => {
  const started = Date.now();

  const featureParse = aiFeatureSchema.safeParse(req.params.feature);
  if (!featureParse.success) {
    res.status(404).json({ ok: false, error: 'invalid_input', message: 'Unknown AI feature.' });
    return;
  }
  const feature: AIFeatureId = featureParse.data;

  const room = String(req.body?.room ?? '').trim();
  const userId = String(req.body?.userId ?? '').trim();
  if (!room || !userId) {
    res.status(400).json({ ok: false, error: 'invalid_input', message: 'Missing room or userId.' });
    return;
  }

  // Validate BEFORE the rate-limit check, so a malformed request never burns quota.
  const inputParse = AI_INPUT_SCHEMAS[feature].safeParse(req.body?.payload);
  if (!inputParse.success) {
    res.status(400).json({
      ok: false,
      error: 'invalid_input',
      message: inputParse.error.issues[0]?.message ?? 'Invalid input.',
    });
    return;
  }
  const payload = inputParse.data as Record<string, unknown>;

  const key = cacheKey(feature, payload);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < AI_CACHE_TTL_MS) {
    res.json({ ok: true, data: hit.data, provider: hit.provider, cached: true, ms: 0 });
    return;
  }

  const limit = rateLimited(room, userId);
  if (limit.limited) {
    res.status(429).set('Retry-After', String(limit.retryAfter)).json({
      ok: false,
      error: 'rate_limited',
      message: `Too many AI requests. Try again in ${limit.retryAfter}s.`,
      retryAfter: limit.retryAfter,
    });
    return;
  }

  if (CHAIN.length === 0) {
    res.status(503).json({
      ok: false,
      error: 'no_provider',
      message: 'No AI provider is configured on the server.',
    });
    return;
  }

  const prompt = buildPrompt(feature, payload);
  const schema = AI_OUTPUT_SCHEMAS[feature];
  const failures: string[] = [];

  for (const provider of CHAIN) {
    // One retry per provider, with the validation error appended so the model can correct
    // itself. Then fall through to the next provider rather than failing the request.
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      try {
        const userMessage =
          attempt === 0
            ? prompt.user
            : `${prompt.user}\n\nYour previous reply was rejected: ${failures[failures.length - 1]}\nReturn ONLY valid JSON matching the schema.`;

        const raw = await provider.complete(
          { system: prompt.system, user: userMessage, maxTokens: prompt.maxTokens },
          controller.signal,
        );

        const parsed = extractJson(raw);
        const validated = schema.safeParse(parsed);

        if (!validated.success) {
          const issue = validated.error.issues[0];
          failures.push(`${provider.id}: schema ${issue?.path.join('.')} — ${issue?.message}`);
          continue;
        }

        cache.set(key, { at: Date.now(), data: validated.data, provider: provider.id });
        res.json({
          ok: true,
          data: validated.data,
          provider: provider.id,
          cached: false,
          ms: Date.now() - started,
        });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${provider.id}: ${message}`);
        // A timeout will just happen again on retry; move to the next provider immediately.
        if (message.includes('abort')) break;
      } finally {
        clearTimeout(timer);
      }
    }
    console.warn(`[ai] ${feature}: ${provider.id} failed, trying next`);
  }

  // Every provider exhausted. Return an honest error — NEVER fabricate a result. Invented
  // shapes that look plausible are worse than a visible failure, because nobody checks them.
  console.error(`[ai] ${feature} failed on all providers:`, failures);
  res.status(502).json({
    ok: false,
    error: 'invalid_output',
    message: 'The AI could not produce a usable result. Try rephrasing, or try again.',
  });
});
