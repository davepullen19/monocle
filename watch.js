#!/usr/bin/env node
/*
 * GitHub Actions orchestrator.
 *
 * 1. runs check.js for WATCH_DATE / WATCH_PARTY (env or repo variables)
 * 2. compares the result to the last committed state (state.json)
 * 3. emits step outputs so the workflow can email you ONLY on a change
 * 4. writes the new state.json (the workflow commits it back to the repo)
 *
 * Exit codes: always 0 so the workflow doesn't go "red" on a transient site error.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATE  = process.env.WATCH_DATE  || '2026-08-31';
const PARTY = process.env.WATCH_PARTY || '4,6';
const STATE = path.join(__dirname, 'state.json');
const BOOK_URL = 'https://www.sevenrooms.com/experiences/thameslido/swim-lunch-2026-6037758771150848';

function emit(kv) {
  const file = process.env.GITHUB_OUTPUT;
  let s = '';
  for (const [k, v] of Object.entries(kv)) {
    const val = String(v == null ? '' : v);
    if (val.includes('\n')) s += `${k}<<__WATCH_EOF__\n${val}\n__WATCH_EOF__\n`;
    else s += `${k}=${val}\n`;
  }
  if (file) fs.appendFileSync(file, s);
  else console.log('\n[step outputs]\n' + s);
}

const target = `${DATE}|${PARTY}`;

// previous state — only trusted if it was for the SAME date+party
let prev = null;
try {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (st.target === target) prev = st.available;
} catch { /* no state yet */ }

const res = spawnSync('node', [path.join(__dirname, 'check.js'), '--date', DATE, '--party', PARTY],
                      { encoding: 'utf8', timeout: 180000 });
const output = (res.stdout || '') + (res.stderr || '');
console.log(output);

let available;
if (res.status === 0) available = true;
else if (res.status === 1) available = false;
else {
  console.error(`check.js errored (status ${res.status}) — leaving state unchanged, no email.`);
  emit({ changed: 'false' });
  process.exit(0);
}

fs.writeFileSync(STATE, JSON.stringify(
  { target, available, checked_at: new Date().toISOString() }, null, 2) + '\n');

let changed = false, subject = '', body = '';
if (prev === null) {
  // first run for this target: only alert if it's already available
  if (available) {
    changed = true;
    subject = `✅ Thames Lido Swim & Lunch OPEN for ${DATE} (party ${PARTY})`;
    body = `A table appears to be available.\n\n${BOOK_URL}\n\n${output}`;
  }
} else if (available !== prev) {
  changed = true;
  if (available) {
    subject = `✅ Thames Lido now OPEN for ${DATE} (party ${PARTY})`;
    body = `Availability just opened up — book fast:\n${BOOK_URL}\n\n${output}`;
  } else {
    subject = `⚠️ Thames Lido no longer available for ${DATE} (party ${PARTY})`;
    body = `It was available and now isn't.\n\n${output}`;
  }
}

console.log(`target=${target} available=${available} prev=${prev} changed=${changed}`);
emit({ changed: String(changed), available: String(available), subject, body });
process.exit(0);
