import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { DigestRow } from '../src/digest/types.js';

function row(rows: DigestRow[], job: string): DigestRow {
  const found = rows.find((r) => r.job === job);
  if (found === undefined) throw new Error(`no row for ${job}`);
  return found;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs, sorted, and counts the truncated last line as bad', () => {
    expect(night).not.toBeNull();
    if (night === null) return;
    expect(night.night).toBe('2026-10-28');
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps a null owner', () => {
    expect(row(night?.rows ?? [], 'digest/render').owner).toBeNull();
  });

  it('fixtures/refresh: 3 retries, last ok, last error kept, offsets kept', () => {
    expect(row(night?.rows ?? [], 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('notes/backup ends in fail', () => {
    const r = row(night?.rows ?? [], 'notes/backup');
    expect(r.lastStatus).toBe('fail');
    expect(r.lastError).toBe('quota exceeded');
  });
});

describe('readNight edges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
  });

  it('reads an empty file as nothing ran', () => {
    writeFileSync(join(dir, '2026-02-02.jsonl'), '');
    expect(readNight(dir, '2026-02-02')).toEqual({
      night: '2026-02-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts wrong-shape lines as bad and skips blank lines', () => {
    const lines = [
      '{"at":"2026-03-03T01:00:00+02:00","job":"a","status":"ok","owner":null}',
      '{"at":"2026-03-03T02:00:00+02:00","job":"a","status":"maybe","owner":null}',
      '[1,2]',
      '',
      '{"at":"2026-03-03T03:00:00+02:00","job":"a","status":"fail","owner":"x","error":"boom"}',
      '{"at":"2026-03-03T04:00:00+02:00","job":"a","status":"retry","owner":"x"}',
      '',
    ];
    writeFileSync(join(dir, '2026-03-03.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-03-03');
    expect(night?.badLines).toBe(2);
    expect(night?.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 3,
        retries: 1,
        lastStatus: 'retry',
        lastError: 'boom',
        firstAt: '2026-03-03T01:00:00+02:00',
        lastAt: '2026-03-03T04:00:00+02:00',
      },
    ]);
  });
});
