import { describe, expect, it } from 'vitest';
import { SpatialIndex } from '../SpatialIndex.js';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('SpatialIndex', () => {
  it('finds a shape whose cell overlaps the query', () => {
    const idx = new SpatialIndex(512);
    idx.insert('a', R(10, 10, 100, 100));
    expect(idx.query(R(0, 0, 50, 50))).toContain('a');
  });

  it('excludes shapes in distant cells', () => {
    const idx = new SpatialIndex(512);
    idx.insert('a', R(0, 0, 10, 10));
    idx.insert('b', R(10_000, 10_000, 10, 10));
    const hits = idx.query(R(0, 0, 100, 100));
    expect(hits).toContain('a');
    expect(hits).not.toContain('b');
  });

  it('handles negative coordinates', () => {
    // Math.floor on negatives is the classic off-by-one in grid indexes: -1/512 truncates to 0
    // with |0 but floors to -1 correctly. An infinite canvas is half negative, so this matters.
    const idx = new SpatialIndex(512);
    idx.insert('neg', R(-1000, -1000, 100, 100));
    expect(idx.query(R(-1100, -1100, 300, 300))).toContain('neg');
    expect(idx.query(R(0, 0, 100, 100))).not.toContain('neg');
  });

  it('indexes a shape spanning many cells', () => {
    const idx = new SpatialIndex(512);
    idx.insert('big', R(0, 0, 5000, 5000));
    // Reachable from any corner of its span.
    expect(idx.query(R(4900, 4900, 10, 10))).toContain('big');
    expect(idx.query(R(2000, 2000, 10, 10))).toContain('big');
    expect(idx.query(R(0, 0, 1, 1))).toContain('big');
  });

  it('removes a shape from every cell it occupied', () => {
    const idx = new SpatialIndex(512);
    idx.insert('big', R(0, 0, 5000, 5000));
    idx.remove('big');
    expect(idx.query(R(2000, 2000, 10, 10))).toHaveLength(0);
    expect(idx.size).toBe(0);
    // Empty cells must be reclaimed, or repeated create/delete leaks the cell map forever.
    expect(idx.cellCount).toBe(0);
  });

  it('moves a shape between cells on update', () => {
    const idx = new SpatialIndex(512);
    idx.insert('a', R(0, 0, 10, 10));
    idx.update('a', R(5000, 5000, 10, 10));
    expect(idx.query(R(0, 0, 100, 100))).not.toContain('a');
    expect(idx.query(R(4990, 4990, 100, 100))).toContain('a');
  });

  it('updates stored bounds even when the cell range is unchanged (drag fast path)', () => {
    // The fast path skips re-indexing. If it also skipped updating bounds, hit testing would
    // use stale geometry for the entire duration of a drag.
    const idx = new SpatialIndex(512);
    idx.insert('a', R(10, 10, 10, 10));
    idx.update('a', R(20, 20, 10, 10));
    expect(idx.getBounds('a')).toEqual(R(20, 20, 10, 10));
  });

  it('treats insert of an existing id as an update, not a duplicate', () => {
    const idx = new SpatialIndex(512);
    idx.insert('a', R(0, 0, 10, 10));
    idx.insert('a', R(5000, 5000, 10, 10));
    expect(idx.size).toBe(1);
    expect(idx.query(R(0, 0, 100, 100))).not.toContain('a');
  });

  it('survives rapid create-delete-create of the same id without orphans', () => {
    const idx = new SpatialIndex(512);
    for (let i = 0; i < 50; i++) {
      idx.insert('churn', R(i * 100, 0, 10, 10));
      idx.remove('churn');
    }
    idx.insert('churn', R(0, 0, 10, 10));
    expect(idx.size).toBe(1);
    expect(idx.query(R(1000, 0, 4000, 100))).toHaveLength(0);
  });

  it('dedupes ids that occupy several queried cells', () => {
    const idx = new SpatialIndex(512);
    idx.insert('wide', R(0, 0, 2000, 100));
    const hits = idx.query(R(0, 0, 2000, 100));
    expect(hits.filter((id) => id === 'wide')).toHaveLength(1);
  });

  it('computes total bounds across all shapes', () => {
    const idx = new SpatialIndex(512);
    idx.insert('a', R(0, 0, 100, 100));
    idx.insert('b', R(500, 300, 100, 100));
    expect(idx.totalBounds()).toEqual(R(0, 0, 600, 400));
  });

  it('returns null total bounds when empty', () => {
    expect(new SpatialIndex(512).totalBounds()).toBeNull();
  });

  it('culls hard at 10k shapes — the entire performance claim rests on this', () => {
    const idx = new SpatialIndex(512);
    for (let i = 0; i < 10_000; i++) {
      idx.insert(`s${i}`, R((i % 100) * 400, Math.floor(i / 100) * 400, 80, 80));
    }
    const visible = idx.query(R(0, 0, 1600, 900));
    expect(idx.size).toBe(10_000);
    // A viewport covering ~0.16% of the board must not return anything close to all of it.
    expect(visible.length).toBeLessThan(100);
  });
});
