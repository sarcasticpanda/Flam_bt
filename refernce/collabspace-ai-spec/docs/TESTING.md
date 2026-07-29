# Manual Test Checklist

The automated tests cover geometry, the spatial index, and AI output parsing. Everything else
in a collaborative canvas is caught by two browser windows and ten minutes. Run this at the end
of Phase 3, and again before the Phase 8 demo.

## Setup
Two browser windows (one normal, one incognito so identities differ), same board, side by side.

## Sync correctness — every operation, both directions

- [ ] Draw a rect in A → appears in B
- [ ] Draw a pen stroke in A → appears in B, smoothed identically
- [ ] Type text in A → streams into B as it's committed
- [ ] Create a sticky and edit its text in A → updates in B
- [ ] Move / resize / rotate a shape in A → follows in B
- [ ] Change style (colour, width, dash) in A → updates in B
- [ ] Delete in A → disappears in B
- [ ] Duplicate, copy/paste → correct in both
- [ ] Z-order change in A → matching stacking order in B
- [ ] Bind an arrow to a shape in A, move the shape in B → arrow follows in both

## Concurrency — the cases that actually break things

- [ ] Both users drag the *same* shape simultaneously → converges, no jitter loop, no duplicate
- [ ] A moves a shape while B deletes it → shape is gone in both, no ghost, no error
- [ ] Both users edit the *same* sticky's text at once → text merges character-wise, nothing lost
- [ ] Both create shapes at the same z position → distinct fractional indices, stable order
- [ ] A undoes while B is drawing → only A's own work is reverted
- [ ] Rapid create-delete-create of the same shape id → no orphan in the spatial index

## Offline & reconnect

- [ ] Kill A's network. Draw 20 shapes in A and 20 in B over 30s. Reconnect.
      → both documents identical, 40 shapes, nothing duplicated, nothing lost
- [ ] Kill the server entirely, keep drawing in both, restart the server
      → both reconnect and converge
- [ ] Reload A mid-session → document loads from persistence, matches B
- [ ] Cold-open a board with no live peers → loads the persisted snapshot correctly

## Presence

- [ ] Cursor in A glides in B (no teleporting), correct name and colour
- [ ] Closing A removes A's cursor and avatar from B within ~2s
- [ ] Follow mode in B tracks A's viewport, and releases when B pans manually
- [ ] Remote selection outlines appear in the correct user colour

## Files

- [ ] Drop a 20-page PDF in A → renders in B
- [ ] Annotate page 7 in A → annotation appears anchored to page 7 in B
- [ ] Zoom deep into a PDF page → re-renders sharp, annotations stay aligned
- [ ] Upload a file over the size limit → clear error naming the actual limit, nothing partial
- [ ] Reload both windows → files and annotations persist

## AI

- [ ] Each P0 feature produces valid shapes in A and appears in B
- [ ] One ctrl+Z in A removes the entire AI result as a single step
- [ ] Trigger an AI call, then disconnect mid-flight → clean error, no stuck spinner
- [ ] Exceed the rate limit → 429 with a real message, not a silent failure
- [ ] Cluster 60 sticky notes → all 60 land in a cluster, none dropped

## Meetings

- [ ] Audio connects both ways; mute state shows correctly in both windows
- [ ] Video tiles appear and can be dragged; camera toggle works
- [ ] Deny camera permission → specific message, call continues as audio-only
- [ ] Leave and rejoin the call → clean reconnection, no duplicate tiles

## Performance

- [ ] Seed 10,000 shapes → pan and zoom at ≥55fps
- [ ] Idle board with 10k shapes → CPU near 0% (dirty flag actually working)
- [ ] Draw a long pen stroke at 10k shapes → no dropped input, stroke follows the cursor
- [ ] Zoom out fully → LOD kicks in, no stall

## Access control

- [ ] View-only link: all mutating tools hidden **and** the websocket rejects updates
- [ ] Try to mutate from a view-only session via devtools → server refuses
