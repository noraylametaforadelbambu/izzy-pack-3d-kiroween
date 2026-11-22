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

## Not done

- [ ] Orders that need several boxes, stacking-weight rules (heavy below light), saving the catalog. Out of scope so far (R9.7, R13.8, R16.5).
