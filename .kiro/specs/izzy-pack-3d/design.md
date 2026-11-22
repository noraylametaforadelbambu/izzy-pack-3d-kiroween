# Design: Izzy Pack 3D

## Architecture

Vite + React + TypeScript. Pure packing and unit logic is separate from React and Three.js so it is unit-testable.

```
src/
  core/
    units.ts        # mm/in conversion, display formatting
    validate.ts     # dimension validation
    pack.ts         # orientations, grid count, result metrics
  viewer/
    PackViewer.tsx  # React wrapper: canvas lifecycle, resize
    scene.ts        # Three.js scene building and updates
  ui/
    Controls.tsx    # fields, unit selector, Optimize
    Results.tsx     # count, % used, free volume, orientation
  App.tsx           # state, layout
```

Three.js is used directly (no react-three-fiber) to keep dependencies small. `OrbitControls` from `three/examples/jsm` provides rotate and zoom.

## Data model

```ts
type Unit = 'mm' | 'in';
interface Dims { l: number; w: number; h: number }          // always millimetres

interface Orientation {
  size: Dims;                  // item size along box l, w, h
  label: string;               // e.g. "220 × 150 × 90"
}

interface PackResult {
  orientation: Orientation | null;
  counts: { x: number; y: number; z: number };
  count: number;
  usedPct: number;             // 0..100
  freeVolumeMm3: number;
  boxVolumeMm3: number;
}
```

State in `App`: `boxMm`, `itemMm` (committed values in mm), `unit`, `draft` strings per field, `errors`, `result`.

## Core logic

### Units (`units.ts`)
- `MM_PER_IN = 25.4`.
- `toDisplay(mm, unit)` and `fromDisplay(value, unit)`.
- Source of truth is millimetres. On unit switch, only the display strings are regenerated from mm, so the round trip is lossless.
- Free volume: `mm3` or `mm3 / 25.4³` for in³, formatted with thousands separators.

### Validation (`validate.ts`)
A field is valid if it parses to a finite number greater than 0. Returns per-field error codes. If any field is invalid, Optimize does nothing and the previous result stays.

If the user edits a field after a unit switch, the draft string is parsed in the current unit and converted to mm on Optimize.

### Packing (`pack.ts`)
```ts
const ORDER = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const EPS = 1e-9;

function gridCount(box, size) {
  return Math.floor(box.l / size.l + EPS)
       * Math.floor(box.w / size.w + EPS)
       * Math.floor(box.h / size.h + EPS);
}
```
- For each permutation in `ORDER`, compute the count. Pick the strict maximum, so earlier entries win ties.
- `usedPct = count * itemVol / boxVol * 100`. `freeVolumeMm3 = boxVol - count * itemVol`.
- `EPS` guards cases like 0.3 / 0.1 = 2.9999999999999996. It is relative-safe because values are in mm.
- If the best count is 0, `orientation` is `null`.

Sample check (box 600 × 400 × 400, item 220 × 150 × 90):

| Orientation | Grid | Count |
|---|---|---|
| 220 × 150 × 90 | 2 × 2 × 4 | 16 |
| 220 × 90 × 150 | 2 × 4 × 2 | 16 |
| 150 × 220 × 90 | 4 × 1 × 4 | 16 |
| 150 × 90 × 220 | 4 × 4 × 1 | 16 |
| 90 × 220 × 150 | 6 × 1 × 2 | 12 |
| 90 × 150 × 220 | 6 × 2 × 1 | 12 |

The tie-break selects 220 × 150 × 90. Used volume is 16 × 2,970,000 = 47,520,000 mm³ of 96,000,000, which is 49.5%. Free volume is 48,480,000 mm³.

## 3D viewer

- `WebGLRenderer` with antialiasing, transparent background, device pixel ratio capped at 2.
- Box: `BoxGeometry` with a low-opacity material (about 0.08, `depthWrite: false`) plus `EdgesGeometry` lines.
- Items: one `InstancedMesh` of a unit box scaled to the item size, positioned on the grid starting at the box origin corner. Thin edge lines or a slight inset keep items visually distinct. Color varies subtly by layer.
- Scene is centered on the box, scaled so the longest side is a fixed number of scene units regardless of unit.
- Camera: perspective, default isometric-like position. `OrbitControls` with damping, zoom limits, and pan disabled. **Reset** button restores camera position and target.
- A `ResizeObserver` on the container resizes the renderer.
- Update path: on a new result, dispose old geometry and instances, then rebuild. Dispose renderer and controls on unmount.
- Initial load runs the sample case through the same `pack` function, so the launch view matches the R6.1 result.

## UI layout

- Desktop: viewer fills the left and center area (about 70% width, full height). A compact control panel sits on the right.
- Mobile (below 768 px): single column, viewer first (about 55vh), then controls and results.
- Controls: two labeled rows ("Box", "Item"), each with three small numeric inputs (L, W, H). A segmented **mm / in** control and a primary **Optimize** button follow. Results are four short label-value pairs, overlaid on the viewer's corner on desktop and under it on mobile.
- Overlay buttons on the viewer: Reset.
- Errors: inline red text under the affected field. "Item does not fit" appears in the results area.
- Accessibility: labeled inputs, `aria-live` on results and errors, the canvas has an `aria-label`.

## Testing

- Unit tests (Vitest) for `pack.ts`, `units.ts`, `validate.ts` covering R6.1 to R6.5.
- Property test: the count never exceeds `floor(boxVol / itemVol)`.
- Component test: unit switch round trip leaves the result unchanged.
- Viewer checked manually (rotate, zoom, reset, resize, mobile layout).


## Phase 3: Optimizer (`src/core/optimizer.ts`)

Reuses `layout.ts` (types, `layoutFromPlacements`), `pack.ts` (`orientations`) and `manual.ts` (`checkPlacement`, `EPS`, `MIN_SUPPORT`). No new dependencies. No existing file is changed.

Strategies, each producing a candidate that is verified before it can win:

1. **layer-dp-slabs**: types laid out as slabs along the container length (3 type orders; fixed quantities first). Inside a slab, a *layered* pattern: layers of one height class, each layer made of rows of identical footprints (both footprint orientations, rows along x or y). Layer counts and row counts are enumerated exhaustively, so the search is exact *within that family* only. Each slab is made as short as its quantity allows (bisection). Linear time; scales to tens of thousands of items.
2. **grid-slabs**: same slabs, one orientation and one regular grid per type. Valid by construction; used only if no layered candidate survives.
3. **extreme-points**: item by item at the lowest back-left candidate (corners of placed boxes and the point above each). The item drops to the highest surface under its footprint and must pass the support rule. Multi-start: 3 to 4 item orders x 4 orientation policies, plus seeded randomized passes. Runs only for orders of at most `epLimit` items (default 250), within a deterministic work budget (`maxQueries`, default 800,000 probes; the first pass always runs). Skipped when a complete candidate exists and no type is "as many as fit".

Performance: a uniform footprint bucket index makes each probe cost about the stack height instead of the box count. Verification: indexed verifier always; `checkPlacement` (O(n^2)) as well up to 1,500 boxes. The two are cross-checked in the tests.

Known limits: slabs waste cross-section when a type needs few columns; large mixed orders (> `epLimit`) only get layered slabs; no stacking-weight rule; volume is the objective, not piece count.


## Weight (`weight.ts`, `weighted.ts`)

- `weight.ts`: pure functions for g / kg conversion, parsing, display text, and `weightOf(placements, unitG, spec)` (product, gross, remaining, over-limit, ratio). Float-safe (1e-6 g tolerance).
- `weighted.ts`: `optimizeWeighted(box, items, spec, options)` wraps the unchanged `optimize()`.
  1. Run the spatial optimizer. If the result is within the payload (max gross - empty box), return it unchanged.
  2. Otherwise weight is binding. Select units under the payload in two orders (lightest first, and entered order), pack each selection spatially, and hand the weight of units that did not fit in space to more units of fully placed types (at most 3 rounds). Keep the candidate with the most placed units, then the most volume.
  3. Final check against the payload; topmost boxes are dropped if it were ever exceeded.
  Result: the optimizer's result plus `weight`, `weightLimited`, `heldBackByWeight`. Deterministic; a heuristic, not proven optimal.
- `remainingItems(items, layout)` returns what is left to pack. A future multi-box planner can call `optimizeWeighted` repeatedly on the remainder, one box at a time, with the same dimensional and weight rules.
- UI: `WeightPanel` (inputs, below the type list), weight block in the results overlay.

## Large orders (blocks)

`optimizer.ts` strategy 4, `block-extreme-points`: `buildBlockSet` groups identical items into a x b x c blocks (shape policies `cube` / `flat`, block size unlimited or at most 16), `epPass` places blocks and leftover items as virtual pieces (blocks need 90% support, items 70%), `expandBlocks` turns them back into single items, then the usual verify and repair. Orders up to `epLimit` (250) keep the item-by-item search unchanged and add the block candidates; larger orders run blocks first, then one item-by-item pass over the largest `PIECE_LIMIT` (400) items. Work is bounded by `maxQueries` (passes), `maxQueries / 2` (blocks) and `passQueryCap` (one pass). `stats.effort` reports every reduction. Test data and a benchmark are in `benchmarkData.ts` and `optimizer.benchmark.test.ts`; results in `docs/optimizer-benchmark.md`.

## Background optimization (`src/worker`)

* `jobs.ts`: `runJob` (runs `optimizeWeighted` and reports `progress` / `result` / `error` messages, never throws), `OptimizerRunner` (one job at a time, `JobBusyError`, `cancel()` terminates the worker and rejects with `JobCancelledError`, late messages ignored, worker errors rejected, `adoptIds` gives placements fresh main-thread ids), `InlineWorker` (same interface, runs in the page: fallback without Worker support, and tests).
* `optimizer.worker.ts` is the worker entry; `createWorker.ts` creates it. `optimize()` takes an optional `onProgress` callback (phase, step, steps) that never changes the result.
* UI: `JobStatus` (spinner, phase, elapsed time, Cancel), `busy` disables the main button. The initial sample layout is still computed synchronously at start-up.

## Shipping-box catalog (`catalog.ts`, `CatalogPanel.tsx`)

* `catalog.ts`: `CatalogRow` (same field model as the container, so unit switches never drift), `validateCatalog`, `sortByVolume`, and `recommendBox(catalog, items, spec, options, onProgress)`: blank quantities, empty catalog and an order heavier than the limit are answered before any search; otherwise each box (ascending volume) is skipped if the order's volume exceeds it, or searched with `optimizeWeighted`; the first box with `unplacedCount === 0`, status `complete` and no weight overrun is returned with its layout. Statuses: found, not-found, needs-quantities, empty-catalog, invalid-order, over-weight.
* `worker/jobs.ts`: a second request kind (`kind: 'recommend'`) and message (`recommendation`), `OptimizerRunner.recommend()`; same one-job-at-a-time, cancel and error handling as `run()`. Progress phases read "Box k of n: ...".
* UI: `CatalogPanel` under the Weight section; `App` keeps the rows and the latest recommendation (cleared by any input edit) and applies it with "Use this box".
* Why smaller boxes were skipped: `ui/trialReason.ts` turns each recorded `BoxTrial` into one sentence (`too-small` = not searched, volume below the order's; `partial` = placed N of M in this search, plus held back by weight and reduced search when set). `CatalogPanel` shows the list under the recommended box with sizes and volumes in the active unit. No new search and no change to `recommendBox` or the optimizer.
* Limits: the weight settings are shared by all boxes; the search time is the optimizer's time per box, up to 12 boxes.

## CSV, sections and the report

* `core/csv.ts`: `parseProductsCsv` (delimiter detection, RFC 4180 reading, header units, per-row validation, model limits) and `productsTemplate`. Pure functions. `core/boxTypes.ts` adds the product name to `TypeRow` and `rowsFromProducts`.
* UI: `Tabs` (ARIA tablist with arrow keys), `UnitsBar`, `ProductsTab` (cards, CSV import with error list / preview), `BoxesTab` (container, weight limits, `CatalogPanel`), `Results` (Result section), `ReportTab`. All four sections are rendered and hidden with the `hidden` attribute, so React state and DOM state survive tab changes. `App` keeps the whole state; the layout snapshot (`Config.labels`) keeps product names for the report after the list is replaced.
* Choice of the layout (`optimizer.ts`): `rank` = explicit pieces, volume, bounding box; extra count-oriented candidates (`smallest` sort, ascending-volume type order); `weighted.ts` ranks by original explicit pieces, all pieces, volume.


## Sample order, pictograms and Halloween mode

* `core/sampleOrder.ts`: the three sample products as CSV-style rows (names, sizes, quantities, weights), loaded through the same validation as an imported file; `core/pictogram.ts` names the pictogram kinds (`skull`, `candle`, `pumpkin`).
* `viewer/pictograms.ts` draws each kind on a canvas (bone white, black, lavender, orange, brown; no gold or green). `viewer/decals.ts` picks one exterior face per box (front, right or top, the largest free icon) and `PackViewer` draws one textured instanced mesh per kind, so three textures and at most three extra draw calls.
* `viewer/halloween.ts`: the theme palette (`#F2E8D5`, `#A35BFF`, `#F97316`, repeating with a lighter tint) and the scene colors. `PackViewer.setHalloween` only recolors instances, shell and outlines; `HalloweenDecor` adds the pumpkin and bats as static page elements.
* The **Try a sample order** button (`ProductsTab`, class `.psample .add.sample`) is styled in CSS only: solid `#F97316`, full width, `min-height: 44px`, focus ring. Same markup, same handler, same place on phones and desktop.
* The optimizer, worker, catalog, weights and Manual mode are untouched by these features.


## Guided flow (`App.tsx`, `ui/steps.ts`, `ui/StepIndicator.tsx`)

* `App` keeps all state, as before; a `screen` value (`home | order | box | result | report`) replaces the old tabs. Every screen stays mounted and is hidden with the `hidden` attribute, so going back loses nothing.
* `ui/steps.ts` (pure, tested): the four steps, `stepNumber`, `backTarget`, `canOpen` (the result opens only while it matches the inputs) and the mapping from a highlighted field to its screen (`stepOfKey`, `firstProblemStep`).
* `StepIndicator` shows "Step n of 4" and four stops; done stops are green, flagged ones carry "!", the result stop is disabled while outdated.
* Reused components: `ProductsTab` (Your order, with `showPlaced={false}`), `BoxesTab` (catalog first, weight limits, a closed "Use my own box" section), `CatalogPanel` (`hideActions`: the screen's main button does Recommend and Use), `Results`, `ReportTab`, `Toolbar`, `UnitsBar`, `JobStatus`. New: `ManualBoxes` (the "+" list for Manual mode) and `StepIndicator`. `Tabs` was removed.
* The main button is the form's submit button: Your order → validate and go on; Choose a box → `onRecommend` or, once a box is recommended, `onUseBox`; Result → report; Report → back to result. "Pack in my own box" calls the unchanged `onOptimize`.
* `produced` (a result exists for the user's order) and `stale` (inputs changed since) give `resultReady`. Until a result exists the view says "Example layout".
* Manual mode only works on the Result screen (drag, keyboard shortcuts and the selection card are off elsewhere); its arrangement survives Back and returning through the indicator.
