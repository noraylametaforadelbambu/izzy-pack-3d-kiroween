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
- [ ] 11. Decide the objective for partial orders (volume vs piece count). _R7.10_
- [ ] 12. Run `optimize` in a Web Worker and show progress. _R8_
- [ ] 13. Box recommendation from a catalog (loop over `optimize`, smallest box where everything fits). _R8_
- [ ] 14. cm unit, kg/lb display, product table with CSV import. _R8_
- [ ] 15. Tabbed UI: Products, Boxes, Result, Report. _R8_

Rule for Kiro sessions: work on `src/core` only unless the task says otherwise; do not edit `manual.ts` or `viewer/`.
