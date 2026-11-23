# Implementation Tasks: Izzy Pack 3D

- [x] 1. Scaffold the project
  - Vite + React + TypeScript, add `three` and `@types/three`, Vitest.
  - Do not overwrite existing documentation (README or others) if present.
  - _Requirements: all_

- [x] 2. Core logic (`src/core`)
  - [x] 2.1 `units.ts`: mm/in conversion, display formatting, free-volume formatting. _R3_
  - [x] 2.2 `validate.ts`: positive finite number check with per-field errors. _R6.4_
  - [x] 2.3 `pack.ts`: six orientations, tolerance-safe grid count, deterministic tie-break, metrics. _R4, R5_
  - [x] 2.4 Unit tests: sample case, unit round trip, exact fit, invalid input, item does not fit. _R6_

- [x] 3. 3D viewer (`src/viewer`)
  - [x] 3.1 Scene setup: renderer, camera, lights, OrbitControls (rotate, zoom), resize handling. _R1_
  - [x] 3.2 Transparent box with edges and instanced items from a `PackResult`. _R1, R5_
  - [x] 3.3 Reset view button; dispose resources on rebuild and unmount. _R1.2_

- [x] 4. UI (`src/ui`, `App.tsx`)
  - [x] 4.1 Controls: Box and Item fields, mm/in selector, Optimize button, inline errors. _R2, R6.4_
  - [x] 4.2 Unit switching from mm-based state without cumulative rounding. _R3_
  - [x] 4.3 Results panel: count, % used, free volume in selected unit, orientation, "Item does not fit" state. _R5, R6.5_
  - [x] 4.4 Responsive layout: viewer first on mobile, large viewer on desktop. _R1.3_

- [x] 5. Launch state
  - Run the sample case on load so the viewer shows packed items immediately. _R1.1, R6.1_

- [x] 6. Verify
  - Run tests and a production build.
  - Manually check rotate, zoom, reset, mobile layout, unit round trip.
  - Confirm each acceptance check in R6.

- [x] 7. Documentation
  - Add or extend README with run and test instructions, preserving existing content.

- [x] 8. Publish (only after explicit approval)
  - Commit, push, and open a pull request.


## Phase 3: Automatic optimization

- [x] 9. Core engine `src/core/optimizer.ts` (layered slabs, extreme points, verification, repair, caps). _R7_
- [x] 10. Tests `src/core/optimizer.test.ts` (sample >= 24, quantities, upright, weight, limits, determinism, verifier agreement with `checkPlacement`, random orders never worse than `packTypes`). _R7_
- [x] 11. Decide the objective for partial orders: explicit pieces first, then volume, then bounding box. _R7.10, R16_
- [x] 12. Run `optimize` in a Web Worker (`src/worker`) and show progress and Cancel. _R12_
- [x] 13. Box recommendation from a catalog (`catalog.ts`, loop over the optimizer, smallest box where everything fits). _R13_
- [x] 14. cm unit, kg/lb display, product list with CSV import (`csv.ts`). _R10, R14_
- [x] 15. Tabbed UI: Products, Boxes, Result, Report. _R15_

## Weight, units and large orders

- [x] 16. Weight per unit, empty box weight and maximum gross weight; weight-aware optimization (`weight.ts`, `weighted.ts`). _R9_
- [x] 17. Large mixed orders: block grouping, effort reporting, benchmark (`docs/optimizer-benchmark.md`). _R11_

## Sample order and Halloween mode

- [x] 18. **Try a sample order** button in Products: three Halloween products through the CSV import path, confirmation before replacing edited products. _R17.1 to R17.4_
- [x] 19. Pictograms (skull, black candle, jack-o’-lantern) on one exterior face of each sample box in the 3D view (`pictogram.ts`, `viewer/pictograms.ts`, `viewer/decals.ts`). _R17.5_
- [x] 20. Halloween mode: a color-only theme for the 3D view with distinct colors per product (bone white, lavender, pumpkin orange) and a pumpkin and bats in the corners (`viewer/halloween.ts`, `HalloweenDecor`). _R18_
- [x] 21. Highlight the existing **Try a sample order** button (orange, full width, 44 px tall) on phones and desktop; no change to its behavior. _R17.6_
- [x] 22. Update README (tagline, what it does, Why Frankenstein, How I used Kiro, Halloween mode) and this spec. _R15, R17, R18_

## Recommendation explanation and hosting

- [x] 23. Next to the recommended box, explain why each smaller box was discarded, from the existing trials (`BoxTrial`), in the active unit (`ui/trialReason.ts`, `CatalogPanel`). The optimizer and `recommendBox` are unchanged. _R13.9_
- [x] 24. Hosted app on Cloudflare Pages: https://izzy-pack-3d.pages.dev/ (builds the `kiroween-release` branch). README links it.

## Guided flow

- [x] 25. Guided flow: Home, Your order, Choose a box, Result (+ Report), one main button per screen, Back without losing data, step indicator. _R19.1, R19.2_
- [x] 26. Validation on Your order; changes mark the result outdated and clear the recommendation. _R19.3, R19.4_
- [x] 27. "Use my own box" option; Manual as a secondary control on the Result screen. _R19.1, R19.5_
- [x] 28. Tested in Chromium with WebGL, on a 1280×900 and a 390×844 screen: Start an order, Try a sample order, Back, validation, CSV, own box, Manual, report, Halloween mode. `ui/steps.test.ts` covers the step rules.

## Home animation

- [x] 29. Figure data and timing (`viewer/frankenstein.ts`) with tests: green, lilac and black boxes of different sizes, stacked from the feet up, brief, plays once. _R20.1, R20.2_
- [x] 30. Separate Three.js scene (`FrankensteinScene.ts`), Home component with a discreet Replay button, reduced-motion static figure, framing for phone and desktop. _R20.2 to R20.5_
- [x] 31. Checked in Chromium with WebGL 2, 1280×900 and 390×844, with and without reduced motion: plays once, Replay restarts it, no loop, the buttons are not covered, the sample flow still gives 26/26 and 50.8 %, pictograms intact, no console errors. _R20_

## Pictograms in the product list

- [x] 32. Small pictogram icon before the name of each sample product in Your order (`ui/PictogramIcon.tsx`, drawn with the viewer's `drawPictogram`, from the row's `pictogram` field); none for ordinary orders. Tested in Chromium on a 390×844 screen and on desktop; `core/pictogram.test.ts`. _R17.7_

## Temple bolts

- [x] 33. Two metal screws on the monster's temples (`temple-bolt-*` parts, `metal` color, shiny material), stacked last, visible in the finished and the static figure; tests for their place and order. Checked in Chromium on 1280×900 and 390×844, animated and with reduced motion. _R20.1_

## Result in sight on phones

- [x] 34. After Use this box / Pack in my own box, scroll the 3D view into sight on phones (390 px), none on desktop. Checked from the bottom button with the sample order: 26/26, 50.8 %, 5.24 kg; with and without reduced motion. README test count corrected (343 tests, 1 skipped). _R19.7_

## Entrance of the sample order

- [x] 35. The 26 boxes drop into their real positions after Use this box (sample order only), once per confirmation, cleaned up on leaving; reduced motion skips it. Timing tested in `viewer/entrance.test.ts`. _R21.1, R21.3, R21.4_
- [x] 36. Translucent schematic lid with a zipper seam and one soft bolt, then the lid lifts and fades (`viewer/lid.ts`). _R21.1, R21.2_
- [x] 37. Checked in Chromium with WebGL 2 on 390×844 and 1280×900: phases pieces, lid, zip, bolt, hold, leave; 26/26, 0 left out, 50.8 %, 5.24 kg and the pictograms are right during and after; no replay on Back, report or Manual; ordinary orders have no entrance; no console errors. README test count: 354. _R21.5_

## Not done

- [ ] Orders that need several boxes, stacking-weight rules (heavy below light), saving the catalog. Out of scope so far (R9.7, R13.8, R16.5).
