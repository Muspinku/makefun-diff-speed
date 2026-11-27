# makefun-diff-speed

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Muspinku/makefun-diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Muspinku/makefun-diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: the exact same line patch, computed by an interned-line Myers search with V-snapshot backtracking — about 3–4× faster than the house baseline on the practice set.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json`, answers each one with `run()` from `solve.js`, and writes `$MAKEFUN_OUTPUT_DIR/answers.json`. It runs on Node 22+ with nothing to install.

## About

`run(input)` returns makefun-diff 1.0.0's patch of `{old, new}` as one string, byte for byte: lines split on `\n` only, Myers greedy search with deletion preferred on ties, common prefix/suffix trim, hunks with up to 3 context lines (runs at most 6 kept lines apart share a hunk), trailing-no-newline lines written with one plus a `%` line, and identical texts answered by the first line alone.

Speed comes from doing the same search cheaper, not from a different one:

- every distinct line is interned once to a small integer id, so the search compares integers on typed arrays instead of strings;
- the Myers search keeps one V snapshot per edit distance (an `Int32Array` per `d`, diagonal `k` at index `k+d`) with no per-step allocation in the inner loop;
- the edit script is rebuilt by backtracking over those snapshots, re-deriving each step from the same recurrence and tie-break;
- output is assembled from the split parts without ever building per-line strings.

Correctness was checked against the house baseline: all 4 practice cases match the reference exactly, and 3,082 differential cases (edge cases, CRLF, bare endings, empty texts, moved blocks, repeated lines, tiny alphabets) all match makefun-diff 1.0.0 exactly.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
