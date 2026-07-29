import { PARTICIPANT_COUNT, newShapeId } from '@board/shared';

/**
 * Local identity. Persisted so a reload keeps the same name and colour.
 *
 * Anonymous-by-default is deliberate: a reviewer opening the link should be drawing within two
 * seconds, not creating an account. Auth is the documented next step, not the MVP.
 */
export interface Identity {
  userId: string;
  name: string;
  colorIndex: number;
}

const KEY = 'board:identity';

const ADJECTIVES = ['Quick', 'Calm', 'Bright', 'Bold', 'Keen', 'Warm', 'Swift', 'Clear'];
const ANIMALS = ['Otter', 'Falcon', 'Heron', 'Ibex', 'Marten', 'Lynx', 'Crane', 'Fox'];

function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
  return `${a} ${b}`;
}

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.userId && parsed.name && typeof parsed.colorIndex === 'number') {
        return parsed as Identity;
      }
    }
  } catch {
    /* corrupt entry — fall through and mint a fresh identity */
  }

  const identity: Identity = {
    userId: newShapeId(),
    name: randomName(),
    colorIndex: Math.floor(Math.random() * PARTICIPANT_COUNT),
  };
  saveIdentity(identity);
  return identity;
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* private mode — identity just won't survive a reload */
  }
}

/**
 * Pick a colour not already in use in the room.
 *
 * Two people sharing a colour breaks the entire presence model — the whole point of the design
 * is that a colour identifies a person. Falls back to the assigned index only when all 12 are
 * taken, which requires 13 simultaneous peers.
 */
export function pickFreeColor(preferred: number, taken: Set<number>): number {
  if (!taken.has(preferred)) return preferred;
  for (let i = 0; i < PARTICIPANT_COUNT; i++) {
    const candidate = (preferred + i) % PARTICIPANT_COUNT;
    if (!taken.has(candidate)) return candidate;
  }
  return preferred;
}
