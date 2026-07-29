import type { Camera, Engine } from '@board/canvas-engine';
import type { Shape, ShapeId, DashStyle, TextAlign } from '@board/shared';
import type { BoardDoc } from '../../collab/BoardDoc';

export type ToolId =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky';

/** Normalised pointer event. Tools never see raw DOM coordinates. */
export interface CanvasPointerEvent {
  world: { x: number; y: number };
  screen: { x: number; y: number };
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  button: number;
  pointerId: number;
  native: PointerEvent;
}

/** Current default style. Changing a style with nothing selected updates these. */
export interface StyleDefaults {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dash: DashStyle;
  opacity: number;
  fontSize: number;
  textAlign: TextAlign;
  stickyColor: string;
}

export interface ToolContext {
  engine: Engine;
  doc: BoardDoc;
  userId: string;
  style: StyleDefaults;

  getSelection(): ShapeId[];
  setSelection(ids: ShapeId[]): void;

  setTool(id: ToolId): void;
  /** Open the inline on-canvas text editor for a shape. */
  editText(shape: Shape): void;
  /** Chrome needs to re-render (selection count changed, tool changed). */
  notify(): void;
}

/**
 * Every tool is an explicit state machine.
 *
 * `onCancel` is not optional in spirit: Escape must always return the canvas to a sane state,
 * and a tool that leaves a half-drawn shape behind on Escape is the fastest way to make an
 * editor feel broken.
 */
export interface Tool {
  readonly id: ToolId;
  readonly cursor: string;

  onPointerDown(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerMove(e: CanvasPointerEvent, ctx: ToolContext): void;
  onPointerUp(e: CanvasPointerEvent, ctx: ToolContext): void;
  onDoubleClick?(e: CanvasPointerEvent, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean;
  onCancel(ctx: ToolContext): void;

  /** Draw in-progress geometry on the ACTIVE layer (never the static layer). */
  drawPreview?(rc: CanvasRenderingContext2D, camera: Camera, ctx: ToolContext): void;

  /** Called when switching away from this tool. */
  onDeactivate?(ctx: ToolContext): void;
}

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  m: 'highlighter',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
  n: 'sticky',
};
