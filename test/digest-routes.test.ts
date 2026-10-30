import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Temp runs dir with our own fixtures. runs/ is read-only and never touched here.
let runsDir: string;

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };

const JOBS = ['a/job', 'b/job', 'c/job', 'd/job'];

// Fixture night: lines are out of job order on purpose.
// a/job: ok, owner lane-07. b/job: 3 retries then ok, owner null (warn: retries >= 3).
// c/job: fail, owner lane-03 (warn: lastStatus fail). d/job: 2 retries, last retry (no warn).
const NORMAL = [
  { at: '2026-10-28T23:10:00+01:00', job: 'd/job', status: 'retry', owner: 'lane-07' },
  { at: '2026-10-28T23:00:02+01:00', job: 'a/job', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-28T23:05:00+01:00', job: 'c/job', status: 'fail', owner: 'lane-03', error: 'exit 2' },
  { at: '2026-10-28T23:01:00+01:00', job: 'b/job', status: 'retry', owner: null },
  { at: '2026-10-28T23:02:00+01:00', job: 'b/job', status: 'retry', owner: null },
  { at: '2026-10-28T23:03:00+01:00', job: 'b/job', status: 'retry', owner: null },
  { at: '2026-10-28T23:04:00+01:00', job: 'b/job', status: 'ok', owner: null },
  { at: '2026-10-28T23:06:00+01:00', job: 'd/job', status: 'retry', owner: 'lane-07' },
];

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

beforeAll(() => {
  runsDir = mkdtempSync(path.join(os.tmpdir(), 'rig-runs-'));
  config.runsDir = runsDir;
  writeFileSync(path.join(runsDir, '2026-10-28.jsonl'), jsonl(NORMAL));
  // Empty night: the file exists, no lines.
  writeFileSync(path.join(runsDir, '2026-10-27.jsonl'), '');
  // Night with one good line and one truncated line.
  writeFileSync(
    path.join(runsDir, '2026-10-26.jsonl'),
    jsonl([{ at: '2026-10-26T23:00:02+01:00', job: 'a/job', status: 'ok', owner: 'lane-07' }]) + '{"at":"2026-10-2\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The page for a night, asserting 200 first so a missing route fails with a clear message.
async function pageHtml(night: string): Promise<string> {
  const res = await createApp(config).request(`/digest/${night}`);
  expect(res.status).toBe(200);
  return res.text();
}

// The <tr> block that holds a given job's row on the page, or undefined.
function rowFor(html: string, job: string): string | undefined {
  return html.match(/<tr[\s\S]*?<\/tr>/g)?.find((r) => r.includes(job));
}

describe('GET /digest/:night (page)', () => {
  it('renders a normal night: 200, heading, one row per job', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/<h1[^>]*>digest · 2026-10-28<\/h1>/);
    expect(html).toContain('<table');
    for (const job of JOBS) {
      expect(rowFor(html, job), `row for ${job}`).toBeDefined();
    }
  });

  it('sorts rows by job', async () => {
    const html = await pageHtml('2026-10-28');
    const positions = JOBS.map((job) => html.indexOf(job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('shows a null owner as an em dash', async () => {
    const html = await pageHtml('2026-10-28');
    expect(rowFor(html, 'b/job')).toContain('—');
    expect(rowFor(html, 'a/job')).toContain('lane-07');
  });

  it('marks retries >= 3 and lastStatus fail as warn, nothing else', async () => {
    const html = await pageHtml('2026-10-28');
    expect(rowFor(html, 'b/job')).toContain('class="warn"');
    expect(rowFor(html, 'c/job')).toContain('class="warn"');
    expect(rowFor(html, 'a/job')).not.toContain('class="warn"');
    expect(rowFor(html, 'd/job')).not.toContain('class="warn"');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-10-25');
    expect(res.status).toBe(404);
  });

  it('renders the empty night as "nothing ran"', async () => {
    const res = await createApp(config).request('/digest/2026-10-27');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('still renders a night with a bad line and reports the count', async () => {
    const res = await createApp(config).request('/digest/2026-10-26');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line(s) could not be read');
    expect(rowFor(html, 'a/job')).toBeDefined();
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('returns the Night object for a normal night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe('2026-10-28');
    expect(night.badLines).toBe(0);
    expect(night.counts).toEqual({ ok: 2, retry: 5, fail: 1 });
    expect(night.rows.map((r) => r.job)).toEqual(JOBS);
    const b = night.rows.find((r) => r.job === 'b/job');
    expect(b).toMatchObject({ owner: null, runs: 4, retries: 3, lastStatus: 'ok' });
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-25');
    expect(res.status).toBe(404);
  });

  it('returns empty rows for the empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-27');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.rows).toEqual([]);
  });

  it('counts a bad line without failing the request', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-26');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['a/job']);
  });
});

describe('page and JSON agree', () => {
  it('lists the same jobs in the same order', async () => {
    const app = createApp(config);
    const pageRes = await app.request('/digest/2026-10-28');
    const html = await pageRes.text();
    const jsonRes = await app.request('/api/digest/2026-10-28');
    expect(pageRes.status).toBe(200);
    expect(jsonRes.status).toBe(200);
    const night = (await jsonRes.json()) as Night;
    const jsonJobs = night.rows.map((r) => r.job);
    const pageJobs = [...jsonJobs].sort((x, y) => html.indexOf(x) - html.indexOf(y));
    expect(jsonJobs).toEqual(pageJobs);
    expect(jsonJobs).toEqual(JOBS);
  });
});
