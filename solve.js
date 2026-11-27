// solve.js — a fast, dependency-free reimplementation of makefun-diff 1.0.0.
//
// Same output as makefun-diff 1.0.0's diffPatch({old, new}) for every input:
// line splitting on \n only, Myers greedy search with deletion preferred on
// ties, common prefix/suffix trim, hunks with up to 3 context lines, runs at
// most 6 kept lines apart sharing a hunk, trailing-no-newline lines written
// with one + a "%" line, identical texts = first line alone.
//
// How it is faster than the house baseline (which builds a linked list of
// path-component objects per diagonal per edit distance and compares strings):
//   * every distinct line is interned once to a small integer id, so all line
//     comparisons in the search are integer compares on typed arrays;
//   * the Myers search keeps one V snapshot per edit distance (an
//     Int32Array per d, diagonal k at index k+d), with no per-step
//     allocation at all in the inner loop;
//   * the edit script is rebuilt by backtracking over those snapshots;
//   * output is assembled from the split parts without ever building the
//     per-line strings (no `line + "\n"` temporaries until the final join).

const KEEP = 0;
const DEL = 1;
const INS = 2;

/** Number of lines in a text split on '\n' (parts from split). */
function lineCount(parts) {
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
}

/** makefun-diff 1.0.0's answer for one case's input: its patch of {old, new}. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Identical texts: the first line alone.
  if (oldText === newText) {
    const n = lineCount(oldText.split('\n'));
    return `makefun-diff/1 old=${n} new=${n} hunks=0 deleted=0 inserted=0\n`;
  }

  const oldParts = oldText.split('\n');
  const newParts = newText.split('\n');
  const oldN = lineCount(oldParts);
  const newN = lineCount(newParts);

  // Intern lines: a line's id is (base id of its text) << 1, plus 1 when the
  // line ends with '\n'. The last line of a text without a trailing newline
  // therefore never equals a line that has one, exactly as the spec says.
  const map = new Map();
  let nextId = 0;
  const oldIds = new Int32Array(oldN);
  const newIds = new Int32Array(newN);
  {
    const lastO = oldParts.length - 1;
    for (let i = 0; i < lastO; i++) {
      const s = oldParts[i];
      let base = map.get(s);
      if (base === undefined) { base = nextId++; map.set(s, base); }
      oldIds[i] = (base << 1) | 1;
    }
    if (oldParts[lastO] !== '') {
      const s = oldParts[lastO];
      let base = map.get(s);
      if (base === undefined) { base = nextId++; map.set(s, base); }
      oldIds[oldN - 1] = base << 1;
    }
    const lastN = newParts.length - 1;
    for (let i = 0; i < lastN; i++) {
      const s = newParts[i];
      let base = map.get(s);
      if (base === undefined) { base = nextId++; map.set(s, base); }
      newIds[i] = (base << 1) | 1;
    }
    if (newParts[lastN] !== '') {
      const s = newParts[lastN];
      let base = map.get(s);
      if (base === undefined) { base = nextId++; map.set(s, base); }
      newIds[newN - 1] = base << 1;
    }
  }

  // Common prefix, then common suffix of what is left.
  let prefix = 0;
  const pn = oldN < newN ? oldN : newN;
  while (prefix < pn && oldIds[prefix] === newIds[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldN - prefix && suffix < newN - prefix &&
    oldIds[oldN - 1 - suffix] === newIds[newN - 1 - suffix]
  ) suffix++;

  const a0 = prefix;
  const aN = oldN - suffix;
  const b0 = prefix;
  const bN = newN - suffix;
  const n = aN - a0;
  const m = bN - b0;

  // Edit ops of the middle region, forward order, as [kind, count] pairs.
  const midOps = myersOps(oldIds, a0, n, newIds, b0, m);

  // Change runs: maximal stretches of deletions/insertions between keeps.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  const feed = (kind, count) => {
    if (kind === KEEP) { o += count; p += count; return; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) { c.dels += count; o += count; deleted += count; }
    else { c.ins += count; p += count; inserted += count; }
  };
  if (prefix > 0) feed(KEEP, prefix);
  for (let i = 0; i < midOps.length; i++) feed(midOps[i][0], midOps[i][1]);
  if (suffix > 0) feed(KEEP, suffix);

  // Hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${oldN} new=${newN} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = first.o - 3 < 0 ? 0 : first.o - 3;
    const newStart = first.p - (first.o - oldStart);
    const after = oldN - (last.o + last.dels) < 3 ? oldN - (last.o + last.dels) : 3;
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) pushLine(out, '=', oldParts, at);
      for (let i = 0; i < c.dels; i++) pushLine(out, '-', oldParts, c.o + i);
      for (let i = 0; i < c.ins; i++) pushLine(out, '+', newParts, c.p + i);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) pushLine(out, '=', oldParts, at);
  }
  return out.join('');
}

/** A line as the patch writes it: op + line, a newline, and "%" on a line of its own when it had none. */
function pushLine(out, op, parts, idx) {
  if (idx < parts.length - 1) out.push(op + parts[idx] + '\n');
  else out.push(op + parts[idx] + '\n%\n');
}

/**
 * The edit ops turning a[a0 .. a0+n) into b[b0 .. b0+m), forward order.
 * Myers greedy search, deletion preferred on ties, no edge pruning — the
 * same recurrence as makefun-diff 1.0.0 — with one V snapshot per edit
 * distance and a backtrack that re-derives each step from the snapshots.
 */
function myersOps(a, a0, n, b, b0, m) {
  if (n === 0) return m === 0 ? [] : [[INS, m]];
  if (m === 0) return [[DEL, n]];
  const A = a.subarray(a0, a0 + n);
  const B = b.subarray(b0, b0 + m);

  // V snapshots: snaps[d] is an Int32Array of length 2d+1; diagonal k lives
  // at index j = k + d, holding x (old lines consumed) or -1 for no path.
  // One array per d: no growth, no copying, and the previous snapshot stays
  // a plain local through the whole inner loop.
  const snaps = [];
  let D = -1;
  let kEnd = 0;
  let xEnd = 0;
  outer:
  for (let d = 0; d <= n + m; d++) {
    const cur = new Int32Array(2 * d + 1);
    snaps.push(cur);
    if (d === 0) {
      let x = 0;
      let y = 0;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      cur[0] = x;
      if (x >= n && y >= m) { D = 0; kEnd = 0; xEnd = x; break; }
      continue;
    }
    const prev = snaps[d - 1];
    const last = 2 * d; // j runs 0..2d step 2; k = j - d
    for (let j = 0; j <= last; j += 2) {
      const k = j - d;
      // Candidates from d-1: deletion from diagonal k-1 (prev index j-2),
      // insertion from diagonal k+1 (prev index j). A candidate is void
      // past the end of either text.
      const delX = j >= 2 ? prev[j - 2] : -1;
      const insX = j <= last - 2 ? prev[j] : -1;
      const delValid = delX >= 0 && delX < n;
      const insValid = insX >= 0 && insX - k <= m;
      let x;
      if (!delValid && !insValid) { cur[j] = -1; continue; }
      if (delValid && (!insValid || delX + 1 >= insX)) x = delX + 1;
      else x = insX;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      cur[j] = x;
      if (x >= n && y >= m) { D = d; kEnd = k; xEnd = x; break outer; }
    }
  }

  // Backtrack: re-derive each step from the snapshots, newest first.
  // rev holds [kind, count] in reverse order (snake keeps, then the edit).
  const rev = [];
  let x = xEnd;
  let k = kEnd;
  for (let d = D; d >= 1; d--) {
    const prev = snaps[d - 1];
    const j = k + d;
    const delX = j >= 2 ? prev[j - 2] : -1;
    const insX = j <= 2 * d - 2 ? prev[j] : -1;
    const delValid = delX >= 0 && delX < n;
    const insValid = insX >= 0 && insX - k <= m;
    const isDel = delValid && (!insValid || delX + 1 >= insX);
    const xPrev = isDel ? delX : insX;
    const xStart = isDel ? xPrev + 1 : xPrev;
    const keep = x - xStart;
    if (keep > 0) rev.push([KEEP, keep]);
    rev.push([isDel ? DEL : INS, 1]);
    x = xPrev;
    k = isDel ? k - 1 : k + 1;
  }
  if (x > 0) rev.push([KEEP, x]);
  rev.reverse();
  return rev;
}
