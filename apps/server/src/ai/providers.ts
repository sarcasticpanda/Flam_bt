import type { AIProviderId } from '@board/shared';

export interface CompleteRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface Provider {
  id: AIProviderId;
  isConfigured(): boolean;
  complete(req: CompleteRequest, signal: AbortSignal): Promise<string>;
}

const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? 4000);

// ---------------------------------------------------------------------------
// Groq — OpenAI-compatible. Fastest and cleanest JSON of the three. Primary.
// ---------------------------------------------------------------------------

export const groq: Provider = {
  id: 'groq',
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),

  async complete(req, signal) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
        max_tokens: Math.min(req.maxTokens, MAX_TOKENS),
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });

    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('groq returned empty content');
    return content;
  },
};

// ---------------------------------------------------------------------------
// Gemini — three verified traps, all of which fail SILENTLY. See comments.
// ---------------------------------------------------------------------------

export const gemini: Provider = {
  id: 'gemini',
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),

  async complete(req, signal) {
    // Use the `-latest` alias: dated Gemini slugs get retired for new keys and return
    // 404 model-not-found, NOT 401 — which reads like a bad key and wastes an hour.
    const model = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        signal,
        headers: {
          'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            // Modern Gemini models are THINKING models: they spend output budget on internal
            // reasoning before emitting a token of JSON. Measured at 2000 tokens, the entire
            // budget went to thinking and content came back EMPTY. Never lower this.
            maxOutputTokens: Math.max(req.maxTokens, MAX_TOKENS),
            temperature: 0.7,
          },
        }),
      },
    );

    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    const candidate = json.candidates?.[0];

    // Distinguish "ran out of budget" from "returned bad JSON" — otherwise the retry loop
    // retries a parse that was never going to succeed.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      const partial = joinParts(candidate);
      if (!partial.trim()) {
        throw new Error('gemini hit MAX_TOKENS with empty content (raise AI_MAX_TOKENS)');
      }
    }

    // Responses arrive as MULTIPLE parts, and thinking models interleave a thoughtSignature.
    // Reading parts[0].text yields a truncated fragment that fails to parse.
    const text = joinParts(candidate);
    if (!text.trim()) throw new Error('gemini returned no text parts');
    return text;
  },
};

function joinParts(candidate: { content?: { parts?: Array<{ text?: string }> } } | undefined): string {
  return (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

// ---------------------------------------------------------------------------
// OpenRouter — free slugs churn; verify before any demo.
// ---------------------------------------------------------------------------

export const openrouter: Provider = {
  id: 'openrouter',
  isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),

  async complete(req, signal) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'THE-BOARD',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-20b:free',
        max_tokens: Math.min(req.maxTokens, MAX_TOKENS),
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });

    if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (json.error) throw new Error(`openrouter: ${json.error.message}`);
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('openrouter returned empty content');
    return content;
  },
};

// ---------------------------------------------------------------------------
// Demo — deterministic, no network. The app must never hard-fail in front of a reviewer.
// ---------------------------------------------------------------------------

export { demo } from './demoProvider.js';

export function resolveChain(providers: Record<string, Provider>): Provider[] {
  const order = (process.env.AI_PROVIDER_ORDER ?? 'groq,gemini,openrouter,demo')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const chain: Provider[] = [];
  for (const id of order) {
    const provider = providers[id];
    // Skip unconfigured providers silently — an empty key is a normal state, not an error.
    if (provider?.isConfigured()) chain.push(provider);
  }
  return chain;
}
