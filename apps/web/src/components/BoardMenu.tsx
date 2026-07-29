import { useEffect, useRef, useState } from 'react';
import {
  FileJson, Image as ImageIcon, LayoutTemplate, MoreHorizontal, Sparkles, Upload,
} from 'lucide-react';

/**
 * Board overflow menu.
 *
 * Groups the actions that are used occasionally — templates, export, import — so they stay
 * discoverable without permanently occupying canvas edge. The frequently used controls
 * (tools, style, zoom, presence) keep their dedicated positions.
 */
export function BoardMenu({
  onTemplates,
  onAI,
  onExportPNG,
  onExportJSON,
  onImportJSON,
  disabled,
}: {
  onTemplates: () => void;
  onAI: () => void;
  onExportPNG: (scale: number, transparent: boolean) => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Board menu"
        aria-expanded={open}
        className="surface grid h-10 w-10 place-items-center transition-colors hover:bg-[var(--chrome-raised)]"
        style={{ color: 'var(--chrome-fg)' }}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="surface absolute top-12 right-0 w-60 overflow-hidden p-1.5">
          <Group label="Create" />
          <Item
            icon={<LayoutTemplate size={15} strokeWidth={1.75} />}
            label="Templates"
            hint="Flowchart, kanban, SWOT…"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onTemplates();
            }}
          />
          <Item
            icon={<Sparkles size={15} strokeWidth={1.75} />}
            label="Ask the AI"
            hint="⌘K"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onAI();
            }}
          />

          <Divider />
          <Group label="Export" />
          <Item
            icon={<ImageIcon size={15} strokeWidth={1.75} />}
            label="PNG (2x)"
            hint="Whole board"
            onClick={() => {
              setOpen(false);
              onExportPNG(2, false);
            }}
          />
          <Item
            icon={<ImageIcon size={15} strokeWidth={1.75} />}
            label="PNG, transparent"
            hint="No background"
            onClick={() => {
              setOpen(false);
              onExportPNG(2, true);
            }}
          />
          <Item
            icon={<FileJson size={15} strokeWidth={1.75} />}
            label="JSON"
            hint="Re-importable"
            onClick={() => {
              setOpen(false);
              onExportJSON();
            }}
          />

          <Divider />
          <Item
            icon={<Upload size={15} strokeWidth={1.75} />}
            label="Import JSON"
            hint="Replaces this board"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportJSON(file);
              // Reset so choosing the same file twice fires change again.
              e.target.value = '';
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <div
      className="px-2.5 pt-1.5 pb-1"
      style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--chrome-fg-dim)' }}
    >
      {label}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px" style={{ background: 'var(--chrome-hairline)' }} />;
}

function Item({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 text-left transition-colors hover:bg-[var(--chrome-raised)] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ minHeight: 36, color: 'var(--chrome-fg)' }}
    >
      <span style={{ color: 'var(--chrome-fg-dim)' }}>{icon}</span>
      <span className="min-w-0 flex-1" style={{ fontSize: 13 }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 10, color: 'var(--chrome-fg-dim)', fontFamily: 'var(--font-mono)' }}>
          {hint}
        </span>
      )}
    </button>
  );
}
