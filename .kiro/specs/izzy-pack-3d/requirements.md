# Requirements: Izzy Pack 3D

A web app that shows how many identical rectangular items fit inside a box, with a 3D view as the main focus.

Stack: React, TypeScript, Three.js. All UI text and code are in English.

## Glossary

- **Box**: the interior dimensions (length, width, height) of the container.
- **Item**: the identical rectangular item (length, width, height).
- **Orientation**: one of the six axis-aligned permutations of the item's dimensions.
- **Grid packing**: all items share one orientation and sit in a regular grid, `floor(Bx/ix) × floor(By/iy) × floor(Bz/iz)`.

## Requirements

### R1. 3D viewer is the focus
1. On launch, the viewer shows a large transparent box with sample items already arranged inside, using the sample values in R6.1.
2. The user can rotate, zoom, and reset the view (reset restores the default camera).
3. The viewer takes most of the screen. On narrow screens (below 768 px), the viewer is shown first, above the controls.
4. On-screen text is limited to short labels and essential feedback (errors, empty states).

### R2. Compact controls
1. Fields: box length, width, height; item length, width, height.
2. One **mm / in** selector applies to all six fields and to the free-volume display.
3. One **Optimize** button runs the calculation and updates the view and results.
4. Fields accept decimal numbers and are grouped into two compact rows or blocks labeled "Box" and "Item".

### R3. Unit switching
1. Switching units converts the displayed values (1 in = 25.4 mm exactly).
2. Physical sizes are preserved. Switching mm to in and back restores the original values and the same layout and result.
3. The app stores the underlying values in millimetres. Display values are derived, so repeated switching does not accumulate rounding error.
4. Displayed values are rounded for display only (up to 3 decimals in inches, up to 2 in mm, trailing zeros trimmed).
5. Free volume is shown in mm³ or in³ to match the selected unit.

### R4. Optimization
1. Evaluate all six axis-aligned orientations of the item.
2. For each, compute the grid count. Choose the orientation with the highest count.
3. Ties are broken by a fixed order: (L,W,H), (L,H,W), (W,L,H), (W,H,L), (H,L,W), (H,W,L). The first one with the maximum wins, so results are deterministic.
4. Duplicate orientations (items with equal sides) are allowed. The tie-break covers them.

### R5. Results
After Optimize, show:
- Item count
- Percentage of box volume used (one decimal)
- Free volume (mm³ or in³ per the unit selector)
- Selected orientation (the item's dimensions along box length × width × height, with unit)

The 3D view updates to show the chosen arrangement, with items drawn inside the transparent box.

### R6. Acceptance checks
1. **Sample case** (Phase 1 single-grid `pack()`): box 600 × 400 × 400 mm, item 220 × 150 × 90 mm gives 16 items, 49.5% used, 48,480,000 mm³ free. This is the *baseline*. The Phase 3 optimizer must place at least 24 (R7.4) because a valid 24-box layered arrangement exists.
2. **Unit round trip**: switch the sample case to inches and back. Values, layout, and results are unchanged. In inches the free volume is 48,480,000 / 25.4³ ≈ 2,958.4 in³.
3. **Exact fit**: item equal to box (or box an exact multiple of the item) gives full use, 100.0%, 0 free volume. Floating-point error must not drop the count (use a small tolerance, see design).
4. **Invalid dimensions**: empty, non-numeric, zero, negative, or non-finite values show an inline error on the field. Optimize is blocked and the previous result stays visible.
5. **Item does not fit**: if every orientation gives 0, show "Item does not fit", count 0, 0.0% used, free volume equal to the full box volume. The viewer shows the empty box.

## Out of scope
Non-axis-aligned rotation, saving or sharing layouts. (Multiple item types, mixed orientations, item weight, CSV import and box recommendation are now in scope: see R7 to R16.)


## Phase 3: Automatic optimization (core engine)

The product goal is **automatic** packing for businesses. Manual mode and the viewer are kept unchanged.

### R7. Optimizer (`src/core/optimizer.ts`)
1. `optimize(box, items, options)` is pure, synchronous and deterministic (same inputs and seed, same result).
2. Items have id, color, dimensions (mm), quantity (whole number >= 1, or null = "as many as fit"), optional `weightKg`, optional `upright`.
3. Orientations: all six axis-aligned ones; `upright` keeps the item's own height vertical.
4. Sample case (R6.1 box and item) places at least 24 boxes, verified.
5. Rules are those of manual mode: inside container, no overlap, at least 70% support. Every returned arrangement is verified; an invalid candidate is repaired by dropping under-supported boxes or discarded.
6. "As many as fit" types are filled after fixed quantities, so they cannot starve other types, and are capped (default 20,000).
7. Orders above `maxItems` (100,000) and invalid input are rejected with a message; the layout is empty.
8. Result: the standard `Layout` (viewer and manual mode consume it unchanged), status (complete, partial, none, rejected), chosen strategy, total weight in kg, bounding extent, volume bounds, warnings, statistics.
9. **No optimality is claimed.** The result is the best candidate found. The only certificate reported is the volume bound (`exceedsContainer`).
10. Objective: see R16 (pieces of explicit quantities first, then placed volume, then smallest bounding box). Before R16 it was placed volume first.

### R8. Later phases
Delivered after Phase 3: weights (R9), cm and lb (R10), large mixed orders (R11), Web Worker (R12), box recommendation (R13), CSV import (R14), tabbed UI (R15), pieces-first choice (R16), sample order (R17) and Halloween mode (R18). Still open: heavy-below-light stacking rule and several boxes per order.


## Weight management (added after Phase 3)

### R9. Weight
1. Each box type has an optional weight per unit. The empty shipping box has an optional weight. The maximum gross weight per box is optional (blank = no limit). Weights are entered in **g** or **kg** with one selector for all weight fields. Values are stored in grams, so switching g / kg never changes the weight.
2. Weight fields accept zero or positive numbers; blank is allowed. Anything else is flagged and Optimize is blocked. A maximum that is not above the empty box weight is refused with a message.
3. Shown in real time, from the boxes actually placed (automatic and manual): product weight, gross weight (products + empty box), the maximum, capacity left, and a progress bar.
4. A warning is shown when the arrangement is over the limit (manual mode can exceed it), and a notice when more units would fit in space but were held back by the limit.
5. **Weight-aware optimization:** the automatic optimizer decides space and weight together. It never returns an arrangement above the limit, and maximizes the number of units placed under it. Unplaced units include those held back by weight.
6. Items without a weight add 0 g. With no maximum set, results are identical to the Phase 3 optimizer.
7. Not in scope yet: stacking-weight rules (heavy below light), orders that need several boxes.

### R10. Units: cm and lb
1. The dimension selector offers **mm, cm, in** (1 cm = 10 mm, 1 in = 25.4 mm). Volumes show as mm³, cm³ or in³.
2. The weight selector offers **g, kg, lb** (1 lb = 453.59237 g). 
3. Sizes are stored in mm and weights in grams. Switching units only re-renders the text, so dimensions, weights and layouts never change, and returning to the first unit restores the exact values.

### R11. Large mixed orders (audit round 2)
1. Orders above 250 items must not fall back to slabs alone. Identical items are grouped into blocks and searched with the extreme-point method; the best valid candidate by placed volume wins.
2. Every candidate is verified (bounds, no overlap, 70% support); blocks are expanded to single items first. Nothing is placed that the project placement check would refuse.
3. Whenever the search is reduced (large order, work limit, a pass cut by the probe cap), `stats.effort` and `warnings` say so, and the results overlay shows it in automatic mode.
4. Weights, units, Auto and Manual modes are unchanged.
5. No optimality is claimed. Measured utilization and time: `docs/optimizer-benchmark.md`.

### R12. Background optimization
1. Optimize and Apply run the optimizer in a Web Worker. The page stays responsive; a status bar shows the phase, elapsed time and a Cancel button.
2. Only one job runs at a time. The main button is disabled while it runs and a second start is refused.
3. Cancel terminates the worker and keeps the previous result. Worker or optimizer errors are shown and keep the previous result.
4. The result is the same as a direct call of the optimizer (same layout, statistics, weights, warnings, effort notes). Placement ids are made unique on the main thread.
5. Inputs edited while a job runs are not part of its result; the result is marked as outdated.
6. `passQueryCap` limits each extreme-point pass separately.

### R13. Shipping-box catalog and recommendation
1. The user keeps a catalog of interior box sizes (add, edit, remove; at most 12), entered in the selected length unit (mm, cm, in) and stored in mm.
2. **Recommend box** tries the catalog by ascending interior volume (ties keep catalog order, identical sizes once) and returns the first box in which the existing optimizer places every requested unit within the configured weight limits (empty box weight, maximum gross weight).
3. Quantities must be explicit. With a blank quantity nothing is searched; the types to fix are named and highlighted.
4. A box where only part of the order fits is never recommended. The optimizer, its partial-order behavior and its weight handling are unchanged.
5. If no box holds the whole order, the message says no complete arrangement was found in this search, lists what each box achieved, and states that this is not a proof of impossibility. Two exact statements are allowed: a box whose volume is below the order's volume was not searched, and an order whose products plus empty box exceed the maximum gross weight fits no single box.
6. The search runs in the Web Worker with progress and Cancel, under the one-job-at-a-time rule shared with Optimize.
7. **Use this box** sets the container size and shows the recommended layout. Editing any input clears the recommendation.
8. Out of scope: per-box weights or prices, saving the catalog, CSV import, several boxes per order.
9. Next to the recommended box the app lists the smaller boxes that were tried first and why each was not chosen, using only what the search recorded (`BoxTrial`): "not searched: its volume is below the order's" (exact arithmetic) or "placed N of M in this search", plus the units held back by the weight limit and a "search reduced" note when they apply. Box sizes and volumes are shown in the active length unit. The text never claims that the order cannot fit. The optimizer and `recommendBox` are not changed.

### R14. CSV import of products
1. Products can be imported from a local CSV file (read in the browser; nothing is uploaded). A template with the selected units can be downloaded and imports cleanly.
2. Columns: `name`, `length_<unit>`, `width_<unit>`, `height_<unit>` (mm, cm or in), `quantity` (whole number 1 to 100,000) and an optional `weight_<unit>` (g, kg or lb; a blank cell means no weight). The unit is part of the header; a header without a unit is an error. Comma, semicolon or tab separated; a comma decimal is accepted only in non-comma files, so "1,500" is never guessed.
3. The file is validated completely before anything changes. Problems are listed by row and column (up to 30). With any error nothing is imported and the current products stay.
4. A valid file is shown as a preview and replaces the products only when the user confirms. It does not start an optimization.
5. Model limits: at most 8 products, at most 100,000 units in total, sides up to 100 m, names up to 60 characters, files up to 512 KB.

### R15. Sections: Products, Boxes, Result, Report
1. The panel has four sections in this order: Products (list, CSV), Boxes (container, weight limits, shipping-box catalog and recommendation), Result (statistics) and Report. The units selectors and the Optimize / Apply button are always visible.
2. The 3D viewer, the Auto / Manual switch and the camera controls are visible in every section; the viewer has an accessible description.
3. All sections stay mounted, so switching sections keeps inputs, the catalog, the recommendation, results, validation messages, units and the Auto / Manual state.
4. Fields with problems flag their section; Optimize opens the first one. After Optimize or "Use this box" the Result section is shown.
5. The Report shows the interior size and volume of the box, per product the requested, placed and not placed pieces (with size, weight and placed volume), totals, used and free volume, the weight summary, a Complete / Partial verdict, and notes (held back by weight, reduced search effort, heuristic disclaimer). It describes the arrangement on screen, automatic or manual.

### R16. Choice among candidate layouts
1. Among valid candidate layouts the optimizer prefers (a) the most pieces of the types with an explicit quantity, (b) the most placed volume, (c) the smallest bounding box. When every requested quantity fits, (a) is equal for all candidates, so the choice is by volume.
2. Types without a quantity ("as many as fit") never take priority over explicit quantities. Weight limits keep priority over everything: no result exceeds the maximum gross weight.
3. Count-oriented candidates (smallest types first) are tried when the layered patterns do not complete the order.
4. This is a heuristic and no optimality is claimed. The trade-off (more pieces, less volume) is measured in `docs/optimizer-benchmark.md`.
5. Out of scope: several boxes per order.

### R17. Try a sample order
1. Products has a **Try a sample order** button. It loads three Halloween products (skull masks, black candles, jack-o’-lanterns) with different sizes, quantities and weights, through the same path as a CSV import (units, validation and limits are the same).
2. If the current products were edited or imported, a confirmation is shown first ("Keep my products" has the focus); the untouched start-up order and the untouched sample are replaced without asking. A pending CSV preview is closed.
3. Loading the sample changes only the products. It does not run Optimize, change the container, catalog, weights limits, units, results or the Auto / Manual mode.
4. The sample is recommended a box from the example catalog (Boxes -> Recommend box), can be used (Use this box), shown in 3D and reported (Report).
5. In the 3D view each box of the sample order shows a pictogram (skull, black candle or jack-o’-lantern, by product; bone white, black, lavender, orange and brown only: no gold, no green, no ornaments) on one exterior face that the default camera sees: front, right or top. A face is exterior when no other box touches the icon area; the face with the largest icon wins. Boxes completely surrounded by others cannot show one. Textures and materials are created once per product type (three in total) and drawn as one instanced mesh per type (at most three extra draw calls). Boxes, sizes, layout, statistics, selection and camera are unchanged. Ordinary orders (typed, imported or edited into other products) have no pictograms and render exactly as before.
6. The **Try a sample order** button is highlighted (solid pumpkin orange, full width, at least 44 px tall, visible focus ring) on phones and desktop. Its position, label and behavior are unchanged.

### R18. Halloween mode
1. A **Halloween mode** button at the top right of the viewer turns a color-only theme on and off. It is off at start-up.
2. In the theme the product types are painted bone white `#F2E8D5`, lavender `#A35BFF` and pumpkin orange `#F97316`, in list order. With more types the colors repeat, and every second repeat is lighter, so neighbours stay distinguishable.
3. The theme also changes the container shell and outline colors and shows a pumpkin and bats in the corners of the viewer. Boxes, sizes, layout, statistics, selection and camera are unchanged; turning the theme off restores the original colors exactly.
4. Auto and Manual modes, and the sample's pictograms, behave the same with the theme on or off. The optimizer is not involved.
