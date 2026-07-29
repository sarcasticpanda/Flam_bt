/**
 * Yjs document structure and accessor helpers. Shared so the client and server can never
 * disagree about the shape of the document.
 *
 * Structure (docs/02-ARCHITECTURE.md §5):
 *
 *   Y.Doc
 *   ├── shapes   : Y.Map<ShapeId, Y.Map<field, value>>
 *   ├── meta     : Y.Map            title, background, gridMode
 *   ├── chat     : Y.Array<ChatMessage>
 *   └── assets   : Y.Map<FileId, AssetRecord>
 *
 * Why Y.Map-per-shape rather than a Y.Array of shapes: two users editing different properties
 * of the same shape merge cleanly at FIELD level, and a shape update is O(1) instead of an
 * array splice. The cost is losing implicit ordering, which fractional z-indexing solves.
 */
import * as Y from 'yjs';
import { generateKeyBetween } from 'fractional-indexing';
import { customAlphabet } from 'nanoid';
import type { ChatMessage, Shape, ShapeId, TransactionOrigin } from './shape.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, STICKY_SIZE } from './constants.js';

export const Y_SHAPES = 'shapes';
export const Y_META = 'meta';
export const Y_CHAT = 'chat';
export const Y_ASSETS = 'assets';

export type YShapeMap = Y.Map<unknown>;

export const getShapes = (doc: Y.Doc): Y.Map<YShapeMap> => doc.getMap(Y_SHAPES);
export const getMeta = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(Y_META);
export const getChat = (doc: Y.Doc): Y.Array<ChatMessage> => doc.getArray(Y_CHAT);
export const getAssets = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(Y_ASSETS);

// ---------------------------------------------------------------------------
// ID + code generation
// ---------------------------------------------------------------------------

const nanoShapeId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);
const nanoRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export const newShapeId = (): ShapeId => nanoShapeId();
export const newRoomCode = (): string => nanoRoomCode();

// ---------------------------------------------------------------------------
// Shape <-> Y.Map conversion
// ---------------------------------------------------------------------------

export function shapeToYMap(shape: Shape): YShapeMap {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(shape)) map.set(key, value);
  return map;
}

/**
 * Returns null for a malformed entry rather than throwing.
 *
 * A single corrupt shape must not take down the whole board render. Concurrent delete-while-
 * reading is a normal race in a CRDT, not an exceptional condition.
 */
export function yMapToShape(map: YShapeMap): Shape | null {
  const obj = map.toJSON() as Partial<Shape>;
  if (!obj || typeof obj.id !== 'string' || typeof obj.type !== 'string') return null;
  return obj as Shape;
}

export function readAllShapes(doc: Y.Doc): Shape[] {
  const out: Shape[] = [];
  getShapes(doc).forEach((yShape) => {
    const shape = yMapToShape(yShape);
    if (shape) out.push(shape);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Mutation helpers — EVERY document write goes through these
// ---------------------------------------------------------------------------

/**
 * The only sanctioned way to write to the document.
 *
 * `origin` is what makes undo safe in a shared doc: the UndoManager tracks only
 * `source: 'user'` transactions from the LOCAL userId, so undo can never revert a
 * collaborator's work. A write that bypasses this is a bug, not a shortcut.
 */
export function transact(doc: Y.Doc, origin: TransactionOrigin, fn: () => void): void {
  doc.transact(fn, origin);
}

export function addShape(doc: Y.Doc, origin: TransactionOrigin, shape: Shape): void {
  transact(doc, origin, () => {
    getShapes(doc).set(shape.id, shapeToYMap(shape));
  });
}

/** Insert many shapes as ONE transaction, so a single ctrl+Z removes the whole result. */
export function addShapes(doc: Y.Doc, origin: TransactionOrigin, shapes: Shape[]): void {
  transact(doc, origin, () => {
    const map = getShapes(doc);
    for (const shape of shapes) map.set(shape.id, shapeToYMap(shape));
  });
}

export function updateShape(
  doc: Y.Doc,
  origin: TransactionOrigin,
  id: ShapeId,
  patch: Partial<Shape>,
): void {
  transact(doc, origin, () => {
    const yShape = getShapes(doc).get(id);
    if (!yShape) return; // deleted concurrently — normal in a CRDT, not an error
    for (const [key, value] of Object.entries(patch)) yShape.set(key, value);
    yShape.set('updatedAt', Date.now());
  });
}

export function deleteShapes(doc: Y.Doc, origin: TransactionOrigin, ids: ShapeId[]): void {
  transact(doc, origin, () => {
    const map = getShapes(doc);
    for (const id of ids) map.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Z-ordering — fractional indices
// ---------------------------------------------------------------------------

/** Highest existing z, or null for an empty board. */
export function topZ(shapes: Shape[]): string | null {
  let max: string | null = null;
  for (const s of shapes) if (max === null || s.z > max) max = s.z;
  return max;
}

export function bottomZ(shapes: Shape[]): string | null {
  let min: string | null = null;
  for (const s of shapes) if (min === null || s.z < min) min = s.z;
  return min;
}

/** Next index above everything. Never renumbers existing shapes. */
export const zAbove = (shapes: Shape[]): string => generateKeyBetween(topZ(shapes), null);
export const zBelow = (shapes: Shape[]): string => generateKeyBetween(null, bottomZ(shapes));
export const zBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b);

/**
 * N sequential indices above everything.
 *
 * Needed because generateKeyBetween(top, null) called N times in a loop returns the SAME key
 * every time unless you thread the previous result through — which produces N shapes stacked at
 * one index and an unstable render order.
 */
export function zSequence(shapes: Shape[], count: number): string[] {
  const out: string[] = [];
  let prev = topZ(shapes);
  for (let i = 0; i < count; i++) {
    prev = generateKeyBetween(prev, null);
    out.push(prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape factories
// ---------------------------------------------------------------------------

interface FactoryCtx {
  userId: string;
  z: string;
}

function base(ctx: FactoryCtx, id = newShapeId()) {
  const now = Date.now();
  return {
    id,
    parentId: null,
    rotation: 0,
    locked: false,
    opacity: 1,
    z: ctx.z,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeRect(ctx: FactoryCtx, x: number, y: number, w: number, h: number): Shape {
  return {
    ...base(ctx),
    type: 'rect',
    x,
    y,
    w,
    h,
    stroke: 'var(--canvas-ink)',
    fill: 'transparent',
    strokeWidth: 2,
    dash: 'solid',
    radius: 4,
    text: '',
    textAlign: 'center',
    fontSize: 16,
  };
}

export function makeSticky(ctx: FactoryCtx, x: number, y: number, color: string, text = ''): Shape {
  return {
    ...base(ctx),
    type: 'sticky',
    x,
    y,
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    text,
    color,
    fontSize: 16,
    tags: [],
  };
}

export function makeFrame(
  ctx: FactoryCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
): Shape {
  return {
    ...base(ctx),
    type: 'frame',
    x,
    y,
    w,
    h,
    name,
    color: 'var(--chrome-fg-dim)',
    clipsContent: false,
  };
}

export function makeChatMessage(
  authorId: string,
  name: string,
  colorIndex: number,
  text: string,
): ChatMessage {
  return { id: newShapeId(), author: name, authorId, colorIndex, text, ts: Date.now() };
}
