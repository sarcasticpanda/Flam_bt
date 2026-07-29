/**
 * The shape model. One flat discriminated union, `type` is the discriminant.
 *
 * Two rules that matter more than they look (docs/02-ARCHITECTURE.md §4):
 *
 *  1. NEVER store binary in a shape. Images carry a `url`, never a base64 blob — a base64 image
 *     in a CRDT is replicated to every peer on every update.
 *  2. `points` arrays are RELATIVE to the shape origin. Moving a 400-point pen stroke is then a
 *     two-field update instead of a 400-point rewrite. This is the difference between a smooth
 *     drag and a stuttering one on a shared board.
 */

export type ShapeId = string;

export const SHAPE_TYPES = [
  'rect',
  'ellipse',
  'line',
  'arrow',
  'draw',
  'text',
  'sticky',
  'image',
  'frame',
  'aiCard',
] as const;

export type ShapeType = (typeof SHAPE_TYPES)[number];

export type Point = readonly [x: number, y: number];

export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
export type BlendMode = 'normal' | 'multiply';

export interface BaseShape {
  id: ShapeId;
  type: ShapeType;
  /** World coords — top-left of the UNROTATED bounds. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians. */
  rotation: number;
  /**
   * Fractional index STRING, not a number.
   *
   * Inserting between two shapes never renumbers the others — which would otherwise be a
   * full-document write and a merge nightmare every time someone pressed "bring forward".
   */
  z: string;
  parentId: ShapeId | null;
  locked: boolean;
  opacity: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** AI provenance, source refs, etc. */
  meta?: Record<string, unknown>;
}

export interface RectShape extends BaseShape {
  type: 'rect';
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: DashStyle;
  radius: number;
  text: string;
  textAlign: TextAlign;
  fontSize: number;
}

export interface EllipseShape extends Omit<RectShape, 'type' | 'radius'> {
  type: 'ellipse';
}

export interface LineShape extends BaseShape {
  type: 'line';
  points: Point[];
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  arrowheads: [start: boolean, end: boolean];
  label: string;
}

export interface ArrowShape extends Omit<LineShape, 'type'> {
  type: 'arrow';
  /** Endpoint bindings — the arrow follows a bound shape when it moves. */
  bindStart: ShapeId | null;
  bindEnd: ShapeId | null;
}

export interface DrawShape extends BaseShape {
  type: 'draw';
  points: Point[];
  stroke: string;
  strokeWidth: number;
  blend: BlendMode;
}

export interface TextShape extends BaseShape {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: TextAlign;
  /** Auto-width until the user drags a width, then wraps. */
  autoWidth: boolean;
}

export interface StickyShape extends BaseShape {
  type: 'sticky';
  text: string;
  color: string;
  fontSize: number;
  tags: string[];
}

export interface ImageShape extends BaseShape {
  type: 'image';
  url: string;
  naturalW: number;
  naturalH: number;
}

export interface FrameShape extends BaseShape {
  type: 'frame';
  name: string;
  color: string;
  clipsContent: boolean;
}

export interface AICardShape extends BaseShape {
  type: 'aiCard';
  kind: 'notes' | 'explain';
  markdown: string;
}

export type Shape =
  | RectShape
  | EllipseShape
  | LineShape
  | ArrowShape
  | DrawShape
  | TextShape
  | StickyShape
  | ImageShape
  | FrameShape
  | AICardShape;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export const isRect = (s: Shape): s is RectShape => s.type === 'rect';
export const isEllipse = (s: Shape): s is EllipseShape => s.type === 'ellipse';
export const isLine = (s: Shape): s is LineShape => s.type === 'line';
export const isArrow = (s: Shape): s is ArrowShape => s.type === 'arrow';
export const isDraw = (s: Shape): s is DrawShape => s.type === 'draw';
export const isText = (s: Shape): s is TextShape => s.type === 'text';
export const isSticky = (s: Shape): s is StickyShape => s.type === 'sticky';
export const isImage = (s: Shape): s is ImageShape => s.type === 'image';
export const isFrame = (s: Shape): s is FrameShape => s.type === 'frame';
export const isAICard = (s: Shape): s is AICardShape => s.type === 'aiCard';

/** Shapes whose geometry is a point list rather than a box. */
export const isPathLike = (s: Shape): s is LineShape | ArrowShape | DrawShape =>
  s.type === 'line' || s.type === 'arrow' || s.type === 'draw';

/** Shapes that carry editable text content. */
export const hasText = (s: Shape): s is RectShape | EllipseShape | TextShape | StickyShape =>
  s.type === 'rect' || s.type === 'ellipse' || s.type === 'text' || s.type === 'sticky';

// ---------------------------------------------------------------------------
// Presence (ephemeral — lives on Yjs awareness, NEVER in the document)
// ---------------------------------------------------------------------------

export interface PresenceState {
  userId: string;
  name: string;
  /** Index into PARTICIPANT_HUES. */
  colorIndex: number;
  cursor: { x: number; y: number } | null;
  selection: ShapeId[];
  camera: { x: number; y: number; zoom: number } | null;
  following: string | null;
  /** Media state rides on awareness, not on the peer connection — see 02-ARCHITECTURE.md §11. */
  inCall: boolean;
  muted: boolean;
  cameraOn: boolean;
  isSpeaking: boolean;
}

export interface ChatMessage {
  id: string;
  author: string;
  authorId: string;
  colorIndex: number;
  text: string;
  ts: number;
}

/** Wraps every ydoc.transact call. The UndoManager filters on this. */
export interface TransactionOrigin {
  userId: string;
  source: 'user' | 'ai' | 'remote';
}
