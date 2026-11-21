# Optimizer: large mixed orders

Second-round audit finding: volume utilization dropped sharply for orders of more than about 250 items.
This note explains the cause, the change, and how it was measured. **The optimizer is a heuristic. Nothing here is
proven optimal**, and "used" below is always compared with a 100% fill that exists by construction in the test
orders, not with a proven maximum.

## Cause

`optimize()` ran three kinds of search:

1. layered slabs (each product type gets its own slab along the container length),
2. grid slabs (fallback),
3. extreme points (item by item, several orders and orientation policies).

Extreme points only ran when the order had at most `epLimit = 250` items, because one pass costs roughly 6 x n²
placement checks (n = items; measured, see the table). Above 250 items only the slabs were left. Slabs waste the
container cross-section when there are many different types, so the result fell to **8.6% to 17.9%** on orders with many
types. There was also no message: `warnings` stayed empty.

## Change (`src/core/optimizer.ts`)

* **Blocks.** Identical items are grouped into regular a x b x c blocks (one orientation, flat top). The existing
  extreme-point search places the blocks and the leftover single items, then each block is expanded back into single
  items. A 400-item order with 25 types becomes about 40 pieces. Four block shapes (cube-like or flat, unlimited or at
  most 16 items) times four orderings are tried. Blocks need 90% support (single items 70%), and every expanded
  candidate goes through the same verification and repair as before.
* **Large orders.** Above `epLimit` (250) blocks run first, followed by one item-by-item pass over the largest 400 items
  (`PIECE_LIMIT`). The best valid candidate by placed volume wins.
* **Work limits.** `passQueryCap` (default 1,200,000 placement checks) stops a single pass; the block search has its
  own budget of `maxQueries / 2`. Orders up to 250 items keep the exact earlier search (blocks only add candidates, so
  the result cannot get worse).
* **Reporting.** `result.stats.effort = { reduced, notes }` (also copied to `warnings`) says when the search was
  reduced: more items than the item-by-item search covers, blocks used, passes stopped by the work limit, a pass cut by
  the cap. The results overlay shows these notes in automatic mode. `stats.blockPasses` counts the block passes.
* **Unchanged:** the placement rules (inside the container, no overlap, 70% support), weights (`optimizeWeighted`
  calls the same `optimize`), manual mode, determinism. `epLimit: 0` still switches off every extreme-point search.

## Method

* Container 600 x 400 x 400 mm, no weights, default options, 3 seeds per row, one run each.
* Orders are perfectly packable (generators in `src/core/benchmarkData.ts`, shared with the tests):
  * *many types N*: N pieces from random guillotine cuts on a 10 mm grid (many types, few items per type).
  * *K types ~N*: K regions of the container, each filled with a regular grid of identical items.
* Used = placed volume / container volume. Time = wall clock of `optimize()` on the sandbox CPU (single thread,
  headless Node 22). Heap = growth of `heapUsed` during one call after a forced GC (garbage included, not a true peak).
* Reproduce: `BENCH=1 NODE_OPTIONS=--expose-gc npx vitest --run src/core/optimizer.benchmark.test.ts`
  (reports the current optimizer only; the "before" columns were measured with the previous `optimizer.ts`, commit 442b3d5).

## Results

| Order | Items | Before: used avg (min) | ms | heap MB | After: used avg (min) | ms avg (max) | heap MB |
|---|---|---|---|---|---|---|---|
| many types 100 | 100 | 79.3% (78.0) | 497 | 4 | 80.5% (79.7) | 632 (712) | 6 |
| many types 250 | 250 | 81.1% (81.1) | 960 | 15 | 83.1% (81.5) | 1356 (1790) | 13 |
| many types 251 | 251 | 10.5% (9.7) | 5 | 9 | 81.8% (80.8) | 984 (1248) | 11 |
| many types 400 | 400 | 8.6% (7.2) | 4 | 11 | 82.5% (81.7) | 1300 (1355) | 9 |
| many types 600 | 600 | 11.0% (9.9) | 6 | 14 | 85.4% (84.5) | 1387 (1459) | 13 |
| many types 1000 | 1000 | 17.9% (15.2) | 14 | 15 | 84.6% (83.4) | 1168 (1264) | 11 |
| 10 types ~400 | 396 | 75.2% (73.3) | 13 | 9 | 84.7% (83.1) | 1794 (1988) | 15 |
| 10 types ~1000 | 1043 | 86.8% (84.9) | 38 | 15 | 86.8% (84.9) | 1173 (1367) | 12 |
| 25 types ~400 | 410 | 65.8% (60.5) | 8 | 12 | 85.9% (81.6) | 2155 (2373) | 14 |
| 25 types ~1000 | 954 | 72.7% (68.0) | 26 | 15 | 81.7% (78.8) | 1964 (2176) | 15 |
| 50 types ~400 | 410 | 54.7% (52.2) | 17 | 16 | 84.5% (82.8) | 2288 (2511) | 14 |
| 50 types ~1000 | 1016 | 65.8% (62.6) | 27 | 9 | 69.3% (62.6) | 2247 (2354) | 15 |

Quality: the cliff at 251 items is gone (10.5% to 81.8%), and every large order is equal or better than before.
Time: large orders now take about 1 to 2.5 s instead of milliseconds. That is the price of the search, and it runs on the
main thread, so the page is unresponsive meanwhile. Memory stays within about 15 MB of heap growth. The benchmark used
default options; all rows above 250 items report `reduced` in `stats.effort`.

## Limitations (known, not hidden)

* Heuristic. Perfectly packable orders reach 69% to 88%, never a guaranteed 100%. Results can differ by 10 points
  between seeds (see the min column).
* The weakest case is many mid-size groups in very large orders (50 types, ~1000 items: 69%). Blocks are rigid
  grids; a finer search over block shapes or splitting blocks would help and costs time.
* Above 400 pieces the item-by-item search only covers the largest 400 items. Smaller items placed by no candidate stay
  unplaced and are reported as such.
* No stacking-weight rule, no multi-box planning (a later phase).
* Time is single-threaded and measured on a sandbox CPU; a Web Worker (planned) would remove the freeze, not the cost.

## Follow-up: stability and performance

* **`passQueryCap` was shared by all passes (fixed).** The cap is documented as a limit for one pass, but it was compared
  with the running total of all passes. Once the passes together exceeded the cap, every later pass stopped at its first
  placement, returned an empty candidate and reported "cut short" although it was nowhere near the cap. It is now measured
  per pass (a test fails on the old code: `passQueryCap limits ONE pass, not the sum of all passes`). With the default cap
  (1,200,000) no benchmark order reached the old limit, so results did not change: the previous optimizer (`63e9133`) and
  the current one give **identical layouts on all 51 benchmark orders x seeds** (8 many-type sizes and 9 grouped sizes, 3 seeds).
* **Web Worker.** The optimization runs off the main thread (`src/worker`). Same code, same options: the tests compare the
  layout, statistics, weights, warnings and effort notes of the worker path with a direct call (7 orders, including large
  and weight-limited ones), and the browser check compares the numbers shown by the page with a direct computation.
  Measured in headless Chromium for a job of about 0.9 s: no long task, longest frame gap 100 to 117 ms (software WebGL
  rendering), where the same job used to block the page for its whole duration. Starting a job, getting the first
  progress message and showing the status takes about 100 to 180 ms (worker start-up included). Total time for the same
  order is unchanged within noise (the optimizer is the same code; a worker adds a start-up and one copy of the result).
* **Shader recompilation (fixed).** The viewer created new materials for every layout and disposed the old ones, so three.js
  recompiled its shader programs on every result. In a software-rendered browser that was a 360 to 560 ms stall right after
  each optimization. The materials are now created once per viewer; the stall is gone and the picture is identical.
* **Limit.** Cancel ends the job by terminating the worker (JavaScript cannot interrupt a running loop in any other
  way), so a cancelled job leaves no partial result. Progress is per phase and pass, not a percentage.

## Choice among candidates: pieces first (explicit quantities)

Until now the optimizer kept the candidate with the most placed **volume**. For orders with explicit quantities that do not
fit whole, the choice is now: (1) most pieces of the types with an explicit quantity, (2) most placed volume (this also
counts the "as many as fit" types), (3) smallest bounding box. "As many as fit" types never outrank explicit quantities,
and the weight limit is unchanged (`optimizeWeighted` ranks by explicit pieces, then all pieces, then volume).
When every requested quantity fits, all candidates have the same explicit count, so the choice is by volume as before.

To give the new rule candidates worth choosing between, two count-oriented candidates were added: a type order that places
the smallest types first (layered slabs) and two extreme-point passes that place the smallest items first. Both only run
when the layered patterns did not already complete the order. Everything remains a heuristic: **no optimality is claimed**.

Measured on the same generators as above (container 600 x 400 x 400 mm, 5 seeds, mean of the runs). "PARTIAL" rows take the
perfectly packable orders and multiply every quantity by 1.3, so they cannot fit whole. Previous = commit `df3a54d`.

| Order | Units | Previous: pieces | volume | ms | Now: pieces | volume | ms |
|---|---|---|---|---|---|---|---|
| many types 100 | 100 | 75 | 81.0% | 680 | 78 | 73.7% | 712 |
| many types 250 | 250 | 197 | 83.0% | 1415 | 199 | 79.0% | 1522 |
| many types 400 | 400 | 320 | 83.8% | 1392 | 321 | 81.6% | 1468 |
| many types 1000 | 1000 | 847 | 85.3% | 1295 | 852 | 85.3% | 1190 |
| 10 types ~400 | 397 | 327 | 87.1% | 1772 | 347 | 82.9% | 1614 |
| 25 types ~400 | 413 | 329 | 86.1% | 2267 | 342 | 76.7% | 2527 |
| 50 types ~400 | 413 | 319 | 83.9% | 2363 | 341 | 74.9% | 2651 |
| 25 types ~1000 | 961 | 722 | 79.5% | 2134 | 787 | 75.6% | 1737 |
| PARTIAL 3 types ~60 x1.3 | 79 | 54 | 93.3% | 92 | 57 | 87.8% | 85 |
| PARTIAL 5 types ~150 x1.3 | 202 | 128 | 93.4% | 1602 | 147 | 87.6% | 1688 |
| PARTIAL 10 types ~400 x1.3 | 520 | 325 | 89.2% | 1623 | 370 | 83.5% | 1617 |
| PARTIAL 25 types ~400 x1.3 | 547 | 306 | 85.7% | 2175 | 373 | 77.2% | 2546 |
| PARTIAL random 3 types | 183 | 164 | 76.6% | 85 | 176 | 73.2% | 124 |

Reading the table:

* More pieces are placed in every row (up to +22% for the partial orders), as the rule asks. The price is volume: 0 to 9
  points less of the container filled, because the winning layout uses more, smaller pieces.
* The first eight rows are orders that **can** be packed whole. Their heuristic result is also partial, so the same rule
  applies: it trades volume for pieces there too. This is a consequence of the rule (the optimizer cannot know that a
  complete packing exists), not a regression of the search itself.
* Time is about the same (Web Worker, one run per row, sandbox CPU).
* Orders that fit whole (for example the 600 x 400 x 400 mm box with 16 items of 220 x 150 x 90 mm) are not affected.
