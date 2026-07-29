# 05 — Design System

## Direction: *ink on paper*

The canvas is warm paper. The chrome is dark ink floating above it. This inverts the
all-white convention of Miro and FigJam and gives the product an immediate visual identity at a
glance — which matters when a screenshot is doing the talking.

### The signature rule

> **The interface is monochrome. Every saturated colour on screen belongs to a human.**

Toolbars, panels, buttons, and icons live entirely in the ink/graphite/paper range. The only
chroma in the chrome comes from participants: cursor labels, avatar rings, selection outlines,
comment pins, and the speaking indicator. When you're alone, the app is quiet greyscale; when
five people join, it comes alive with their colours.

This is a design rule with an engineering consequence: **do not introduce a brand accent
colour.** No blue primary buttons. A primary button is `ink` on `paper`, or `paper` on `ink`.
If something needs emphasis, use weight, size, and contrast — not hue. Semantic colours
(destructive red, success green) are the only exceptions and they appear only in confirmations
and toasts, never in ambient UI.

Sticky notes and shape fills are user-chosen content colours, not chrome — they're allowed.

---

## Palette

```css
--ink:        #14161A;   /* chrome surfaces, primary text on paper */
--slate:      #23272E;   /* elevated chrome: popovers, active tool wells */
--graphite:   #5C6270;   /* secondary text, icons at rest */
--chalk:      #E4E2DC;   /* hairlines, grid dots, dividers on paper */
--paper:      #FBFAF7;   /* canvas surface, text on ink */
--paper-dim:  #F2F0EB;   /* hover on paper, disabled fills */

--danger:     #C4442E;   /* destructive confirm only */
--success:    #2F7D5C;   /* save/connected only */
```

Note `--paper` is a *near-white* warm neutral, not a cream. Cream backgrounds with a terracotta
accent are the current AI-design house style; we're avoiding that whole neighbourhood.

### Participant palette (12)

Assigned round-robin, skipping colours already in the room. Each is legible as a 2px outline on
`--paper` and as a filled label chip with white text.

```css
#D1495B  #E36414  #C9A227  #4C956C  #2A9D8F  #3D7EA6
#4059AD  #6D4AA6  #9B3F8F  #B5476B  #7A5C3E  #46605B
```

### Sticky note palette (8)

Content colours — warm and desaturated, so 50 notes on screen don't scream.

```css
#FBE39A  #F9C7A6  #F5A7A7  #D9C2F0  #B7D9F2  #B6E3C6  #E6E2D8  #F2D0E3
```

---

## Typography

| Role | Face | Notes |
|---|---|---|
| Display | **Bricolage Grotesque** (variable) | Landing hero, board title, empty states. Used sparingly — it's characterful and would be exhausting in a toolbar. |
| UI / body | **Geist Sans** | All chrome, panels, menus, labels. |
| Utility | **Geist Mono** | Room codes, coordinates, perf HUD, shape counts, timestamps, version labels. |
| Canvas text | Geist Sans (default), user-switchable to Geist Mono or a handwriting face | Sticky notes and text shapes. |

Self-host via `@fontsource` — no render-blocking Google Fonts request, and the app works offline.

**Scale** (rem, 16px base):

```
display-lg  3.25 / 1.02  weight 600  tracking -0.03em   landing hero
display     2.00 / 1.10  weight 600  tracking -0.02em   modal headings
title       1.25 / 1.30  weight 600  tracking -0.01em   panel headers, board title
body        0.9375/1.50  weight 400                     default UI text
label       0.8125/1.40  weight 500  tracking  0.00em   buttons, tool labels
caption     0.75 / 1.35  weight 500  tracking  0.02em   metadata, hints
mono-sm     0.8125/1.40  weight 500  tracking  0.04em   room codes, HUD
```

Room codes always render in `mono-sm`, uppercase, with wide tracking and a hairline box per
character — a code is a thing you read aloud across a room, so it should look like one.

---

## Layout & chrome

- Canvas is full-bleed. All chrome **floats above it** — no fixed sidebars stealing canvas width.
- Floating surfaces: `--ink` at 96% opacity with `backdrop-filter: blur(12px)`, radius 14px,
  shadow `0 8px 28px rgba(20,22,26,.18)`, 1px inner hairline `rgba(251,250,247,.08)`.
- Positions: toolbar bottom-centre · style panel left-centre (appears on selection) ·
  presence + title + share top-right · zoom + perf bottom-left · minimap bottom-right ·
  AI command bar centred overlay.
- Spacing scale: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48. Nothing else.
- Radii: 6 (controls) / 10 (cards) / 14 (floating surfaces) / 999 (pills, avatars).
- Icon set: **Lucide**, 20px in the toolbar, 16px in panels, 1.75 stroke.

### Toolbar

A single horizontal ink pill. Each tool is a 40×40 icon button. The active tool is a
`--paper`-filled well with `--ink` icon — an inversion, not a colour change, consistent with the
signature rule. Tooltips show name + single-key shortcut in mono.

---

## Motion

Restrained. The canvas already moves constantly; the chrome should not.

```
instant   0ms     tool switch, selection change
quick     120ms   ease-out — hover, tooltip, button press
panel     180ms   cubic-bezier(.2,.8,.2,1) — panel/popover enter
ai        300ms   cubic-bezier(.33,1,.68,1) — AI shape repositioning, stagger 12ms
cursor    linear interpolation between awareness updates, ~80ms catch-up
```

The AI cleanup animation is the only place motion is allowed to be theatrical, and only there
because the transformation *is* the feature. Everything else: fast, then still.

`prefers-reduced-motion: reduce` → all AI transitions become instant jumps, cursor interpolation
is disabled, panels fade without translating.

---

## Copy rules

- Sentence case everywhere. No Title Case Buttons.
- Buttons name the outcome: "Create board", not "Submit". "Copy link", not "Share".
- The action keeps its name through the flow: "Save version" → toast "Version saved".
- Errors state what happened and what to do: "That file is 24MB. The limit is 10MB per file."
  Not "Upload failed."
- Empty board hint: "Pick a tool below, or press ⌘K to ask the AI for a starting point."
  It disappears on the first shape and does not come back.
- Never apologise in UI text. Never say "Oops".
- Connection states are stated plainly: "Connected" · "Reconnecting…" · "Offline — your changes
  are saved locally and will sync when you're back."

---

## Quality floor

- Visible focus ring on every interactive element: 2px `--paper` outline with 2px offset on ink
  surfaces, 2px `--ink` on paper surfaces.
- Minimum touch target 40×40.
- Contrast: all text ≥ 4.5:1 against its surface. Check `--graphite` on `--ink` specifically —
  raise to `#8A909E` where it's used for readable text rather than decorative labels.
- The canvas itself is not screen-reader accessible. State that in the README instead of
  pretending. Every canvas *action* still has a keyboard path through the chrome.
