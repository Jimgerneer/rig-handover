// Plan morning-digest § 1. The contract every part of § 2 builds against: commit this first,
// then the reader (src/digest/read.ts) and the page, JSON, board link and tests in parallel.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night. Times keep the offset from the log (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null; // null stays null here; views show it as '—'
  runs: number; // lines for this job, any status
  retries: number; // lines with status 'retry'
  lastStatus: RunStatus; // status of the job's latest line
  lastError: string | null; // error of the job's latest line that had one
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job; page and JSON use this order as-is (ADR 0001)
  badLines: number; // lines that did not parse, counted and never thrown
};

// null: no runs/<night>.jsonl (or night is not YYYY-MM-DD). The routes answer 404.
// An empty file is a Night with rows: [] ("nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;
