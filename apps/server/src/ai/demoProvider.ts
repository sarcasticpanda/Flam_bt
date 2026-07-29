import type { Provider } from './providers.js';

/**
 * Deterministic local "AI". No network, no key, always available.
 *
 * This is NOT a stub that returns lorem ipsum. It does real work — keyword-overlap clustering,
 * theme grouping, role inference from connection counts — and returns schema-valid output.
 *
 * It exists because free-tier quotas run out and free model slugs get retired without notice,
 * and neither should mean the product breaks while someone is looking at it.
 *
 * The UI labels which provider answered. When it is this one, it says "Demo". Presenting this
 * output as a live model result would be dishonest.
 */

const STOP = new Set([
  'the','a','an','and','or','but','to','of','in','on','for','with','is','are','be','it',
  'this','that','we','our','you','your','can','will','should','how','what','why','when',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const demo: Provider = {
  id: 'demo',
  isConfigured: () => true,

  async complete(req) {
    const feature = req.user.match(/^\[feature:(\w+)]/)?.[1] ?? 'brainstorm';
    const payload = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1)) as Record<string, unknown>;

    switch (feature) {
      case 'brainstorm':
        return JSON.stringify(brainstorm(String(payload.prompt ?? ''), Number(payload.count ?? 12)));
      case 'cluster':
        return JSON.stringify(cluster(payload.notes as Array<{ id: string; text: string }>));
      case 'cleanup':
        return JSON.stringify(
          cleanup(
            payload.shapes as Array<{ id: string; text?: string }>,
            payload.connections as Array<{ from: string; to: string }>,
          ),
        );
      case 'mindmap':
        return JSON.stringify(mindmap(String(payload.topic ?? '')));
      default:
        throw new Error(`demo provider: unknown feature ${feature}`);
    }
  },
};

// ---------------------------------------------------------------------------

const LENSES = [
  { label: 'Reduce friction', verbs: ['Simplify', 'Remove', 'Shorten', 'Auto-fill'] },
  { label: 'Build trust', verbs: ['Show', 'Explain', 'Confirm', 'Reassure about'] },
  { label: 'Recover drop-offs', verbs: ['Remind about', 'Re-engage on', 'Save', 'Restore'] },
  { label: 'Measure and learn', verbs: ['Instrument', 'A/B test', 'Track', 'Segment'] },
];

function brainstorm(prompt: string, count: number) {
  const subject = tokens(prompt).slice(0, 3).join(' ') || 'the flow';
  const perTheme = Math.max(2, Math.ceil(count / LENSES.length));

  return {
    themes: LENSES.map((lens) => ({
      label: lens.label,
      ideas: lens.verbs
        .slice(0, perTheme)
        .map((verb) => `${verb} ${subject}`.slice(0, 90)),
    })),
  };
}

/**
 * Real clustering by keyword overlap, not a fixed partition.
 *
 * Seeds a cluster from the most common token, absorbs every note sharing it, repeats. Whatever
 * is left lands in "Unsorted" — never dropped, which is the property the client asserts.
 */
function cluster(notes: Array<{ id: string; text: string }>) {
  const remaining = new Map(notes.map((n) => [n.id, tokens(n.text)]));
  const clusters: Array<{ label: string; noteIds: string[] }> = [];

  while (remaining.size > 0 && clusters.length < 7) {
    const freq = new Map<string, number>();
    for (const words of remaining.values()) {
      for (const w of new Set(words)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    let best = '';
    let bestCount = 0;
    for (const [word, n] of freq) {
      if (n > bestCount) {
        best = word;
        bestCount = n;
      }
    }

    // Nothing shared any keyword — everything left is genuinely miscellaneous.
    if (bestCount < 2) break;

    const members: string[] = [];
    for (const [id, words] of remaining) {
      if (words.includes(best)) {
        members.push(id);
        remaining.delete(id);
      }
    }
    clusters.push({ label: titleCase(best), noteIds: members });
  }

  if (remaining.size > 0) {
    clusters.push({ label: 'Unsorted', noteIds: [...remaining.keys()] });
  }
  // The schema requires at least 2 clusters.
  while (clusters.length < 2 && notes.length >= 2) {
    const donor = clusters[0]!;
    if (donor.noteIds.length < 2) break;
    clusters.push({ label: 'Also considered', noteIds: [donor.noteIds.pop()!] });
  }

  return { clusters };
}

/** Infer role from in/out degree — genuinely the same signal a model would use. */
function cleanup(
  shapes: Array<{ id: string; text?: string }>,
  connections: Array<{ from: string; to: string }>,
) {
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const c of connections) {
    outDeg.set(c.from, (outDeg.get(c.from) ?? 0) + 1);
    inDeg.set(c.to, (inDeg.get(c.to) ?? 0) + 1);
  }

  // Topological-ish ordering: start nodes first, then breadth-first along the edges.
  const order: string[] = [];
  const seen = new Set<string>();
  const starts = shapes.filter((s) => (inDeg.get(s.id) ?? 0) === 0).map((s) => s.id);
  const queue = starts.length > 0 ? [...starts] : shapes.map((s) => s.id).slice(0, 1);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const c of connections) if (c.from === id && !seen.has(c.to)) queue.push(c.to);
  }
  for (const s of shapes) if (!seen.has(s.id)) order.push(s.id);

  return {
    orientation: 'vertical' as const,
    layout: order.map((id, i) => {
      const inD = inDeg.get(id) ?? 0;
      const outD = outDeg.get(id) ?? 0;
      const role =
        inD === 0 && outD > 0 ? 'start'
        : outD === 0 && inD > 0 ? 'end'
        : outD >= 2 ? 'decision'
        : 'process';
      return { id, role: role as 'start' | 'end' | 'decision' | 'process', row: i, col: 0 };
    }),
  };
}

function mindmap(topic: string) {
  const subject = tokens(topic).slice(0, 4).join(' ') || 'Topic';
  const branches = ['Inputs', 'Constraints', 'Options', 'Risks', 'Next steps'];
  return {
    root: {
      label: titleCase(subject).slice(0, 40),
      children: branches.map((b) => ({
        label: b,
        children: [
          { label: `${b} — first` },
          { label: `${b} — second` },
          { label: `${b} — third` },
        ],
      })),
    },
  };
}
