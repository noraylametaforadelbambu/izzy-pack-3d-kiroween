# Izzy Pack 3D

**Find a shipping box for your order and see how to pack it in 3D.**

**Live app: https://izzy-pack-3d.pages.dev/** (hosted on Cloudflare Pages, built from the `kiroween-release` branch of the private repository).

> **Start here:** on the home screen press the orange **Try a sample order** button (same place on phones and desktop). It loads three Halloween products. Then press **Choose a box**, **Recommend box**, **Use this box**, and **View report**.

Izzy Pack 3D takes an order of rectangular products (mixed sizes, quantities and weights), recommends the smallest box from your catalog that holds all of it, and shows the arrangement in an interactive 3D view. It runs in the browser; nothing is uploaded.
Built with React, TypeScript and Three.js (OrbitControls). Built for Kiroween 2026.

## What it does

- **Mixed orders**: up to 8 products, each with its own size, quantity, weight and color, in mm / cm / in and g / kg / lb.
- **CSV import**: load products from a local file. The file is validated completely first; errors are listed by row and nothing changes until you confirm the preview.
- **Box recommendation**: tries your shipping-box catalog from the smallest interior volume up and recommends the first box that holds the whole order within the weight limits. Next to the recommended box it says why each smaller box was not chosen: either its volume is below the order's (it was not searched, exact arithmetic), or the search placed only part of the order (a heuristic result, not a proof that it cannot fit). Sizes and volumes use the active unit.
- **3D viewer**: rotate, zoom and reset; Auto and Manual modes; optional Halloween mode (colors only).
- **Report**: pieces requested, placed and left out per product, volume, weight and notes, for the arrangement on screen.

## Why Frankenstein

Izzy Pack 3D is built from parts that were not made for each other, joined into one app:

- A React 19 interface and a Three.js scene (drawn with `InstancedMesh`) that share one layout model.
- A packing optimizer (`src/core/optimizer.ts`, a heuristic that combines layered slabs, grid slabs and extreme-point search) that runs in a Web Worker (`src/worker`) so the page stays responsive.
- A box-recommendation search that calls that same optimizer once per catalog box (`src/core/catalog.ts`).
- A CSV parser with unit-aware headers (`src/core/csv.ts`), a weight-aware wrapper around the optimizer (`src/core/weighted.ts`) and an exact unit model (sizes in mm, weights in grams).
- A Halloween theme in the 3D view: skull, black candle and jack-o’-lantern pictograms painted on a canvas and mapped onto the boxes as textures (`src/viewer/pictograms.ts`, `src/viewer/decals.ts`).

The optimizer makes no optimality claim; it keeps the best valid candidate it finds (see `docs/optimizer-benchmark.md`).

## How I used Kiro

The project was built in **Kiro Web** sessions. What you can check in this repository:

- **Specs**: `.kiro/specs/izzy-pack-3d/` has `requirements.md` (R1 to R17), `design.md` and `tasks.md`. Each feature (optimizer, weights, units, Web Worker, catalog, CSV and sections, sample order) was written down as numbered requirements first, then implemented against them. Tasks in `tasks.md` are checked only when done.
- **Tests as acceptance checks**: the requirements' acceptance values (for example the 600 × 400 × 400 mm sample, exact fit, unit round trip) are unit tests. `npx vitest --run --dir src` runs 324 tests (1 skipped).
- **History**: the commits are small and each message names one feature. Check them with `git log`.

This project does not use Kiro hooks, steering files or MCP servers.

## Run

```bash
npm install
npm run dev        # dev server, http://localhost:5173
npm test           # unit tests
npm run build      # type-check and production build into dist/
npm run preview    # serve dist/, http://localhost:4173
```

## GitHub Codespaces

Open the repository, choose **Code → Codespaces → Create codespace on main**. The dev container installs the dependencies and starts the dev server; the preview opens in a browser tab (port 5173). If it does not, run `npm run dev -- --host` in the terminal and open the forwarded port.

## Use

- Drag to rotate, scroll or pinch to zoom, press the reset button (top right) to restore the view.
- Dimensions can be entered in **mm, cm or in**, weights in **g, kg or lb**. Sizes and weights are stored in mm and grams, so switching units never changes the physical values or the layout.
- In **Your order**, add up to 8 products with **+ Type**: each has L, W, H, a quantity, and its own color. A blank quantity means "as many as fit". Delete a type with ×.
- Press **Choose a box**, then **Recommend box** (or **Use my own box**). Each product shows placed/requested in the result.
- Switching units converts the shown values and keeps the physical sizes and the result.
- **Optimize** runs `src/core/optimizer.ts`: it combines the six axis-aligned orientations and mixed product types, tries several strategies (layered slabs, grid slabs, extreme points), verifies every candidate (no overlaps, inside the container, 70% support) and keeps the best. It is a heuristic: the result is the best found, not proven optimal. Boxes that do not fit are reported. Large orders (over 250 items) group identical items into blocks; when the search is reduced the results panel says so (measurements and limits: `docs/optimizer-benchmark.md`).

## Guided flow

The app is a four-step guided flow, with the 3D view always next to the panel (on phones, above it). Each screen has one main button, a **Back** button and a step indicator ("Step 2 of 4").

1. **Home**: title, the 3D view, **Start an order** and **Try a sample order**.
2. **Your order**: name, size, quantity and weight per unit. **Import CSV** reads a file on your computer (columns `name, length_<unit>, width_<unit>, height_<unit>, quantity, weight_<unit>`, weight optional; the unit is in the header). **Template** downloads an example in the selected units. **Try a sample order** loads three Halloween products (skull masks, black candles and jack-o’-lanterns); if you edited your order it asks before replacing it. The CSV file is checked completely first: errors are listed by row and nothing changes until you confirm the preview. Limits: 8 products, 100,000 units, 512 KB. Main button: **Choose a box**; it stops and highlights any field that is not valid.
3. **Choose a box**: the shipping-box catalog, the weight limits and **Recommend box**, which shows the smallest box that holds the whole order and, next to it, why each smaller box was not chosen. Main button: **Recommend box**, then **Use this box**. **Use my own box** (a closed section) packs the order into a container you type, with **Pack in my own box**.
4. **Result**: the 3D view is the main thing, with the metrics (pieces placed and left out, volume, efficiency, weight). Main button: **View report**, a readable summary of the arrangement: box, pieces requested / placed / left out per product, volume, weight and notes. **Auto / Manual** is a secondary control above the 3D view.

**Back** and the step indicator keep everything you entered, the units, the recommendation and a result that is still valid. Changing the order, the weight limits or the container makes the result outdated: step 4 is disabled in the indicator, the view says "Previous result (outdated)", and a new result is made with **Use this box** or **Pack in my own box**. Changing a shipping box in the catalog clears the recommendation. Changing units never changes the result.

In the sample, each box carries a pictogram (skull, black candle or jack-o’-lantern) on an exposed face, drawn once per product type. **Halloween mode** is available on every screen.

When the whole order does not fit, the optimizer prefers **more pieces placed** (of the products with a quantity), then more placed volume. Products without a quantity never outrank those with one. It is a heuristic; see `docs/optimizer-benchmark.md` for what the rule costs and gains.

## Background optimization

**Optimize** runs in a Web Worker (`src/worker`), so the page stays responsive on large orders. While it runs, a status bar shows the current phase, the elapsed time and a **Cancel** button; the Optimize button is disabled, so only one job runs at a time. Cancel stops the computation for real (the worker is terminated) and keeps the previous result. If the optimizer fails, the message is shown and the previous result stays. Inputs edited while a job runs are not part of its result; the result is then marked as outdated.

## Shipping-box catalog

Under **Shipping boxes** you keep a list of interior sizes (add with **+ Box**, remove with ×; four examples are preloaded). **Recommend box** tries them by ascending interior volume and picks the first one where the optimizer places the **whole order**, within the weight limits from the Weight section (empty box weight and maximum gross weight apply to every box).

- Quantities must be explicit: a blank quantity means "as many as fit", so the app asks for numbers first.
- A box that holds only part of the order is never recommended, and the optimizer's rules for partial orders are unchanged. Under the recommended box, **Why not the smaller boxes** lists each box that was tried first with the reason taken from the search: *not searched: its volume is below the order's* or *placed N of M in this search* (plus held back by weight or reduced search, when that applies).
- If nothing fits completely, the message says no complete arrangement was found **in this search**. The search is a heuristic, so this is not a proof that none exists.
- **Use this box** copies the size into the container fields and shows the layout. The search runs in the same Web Worker as Optimize (progress, Cancel, one job at a time). Sizes follow the mm / cm / in selector; the catalog is not saved between sessions.

## Manual mode (optional)

Switch **Auto / Manual** at the top of the viewer. Automatic mode is the default and is unchanged.

- Manual mode starts empty. Use **+** next to a type to add a box, or **From auto** to copy the automatic layout.
- Click a box to select it (outlined). Drag it, or use the Step field with X/Y buttons. **Z** swaps the box with the one above or below in its stack.
- Rotate 90° around X, Y or Z. Remove returns the box to inventory.
- Boxes snap to walls and neighbouring faces, cannot overlap or leave the container, and need at least 70% of their base supported. Invalid moves are refused and the box keeps its position (a red preview shows while dragging).
- Undo / Redo / Reset, plus Ctrl+Z, Ctrl+Shift+Z and Delete. **Apply** rebuilds from the inputs and clears the manual arrangement.
- Statistics (placed, unplaced, used, free, efficiency) always reflect the boxes currently shown.

## Halloween mode (optional)

The **Halloween mode** button (top right of the viewer) changes only the colors of the 3D view: skull masks bone white `#F2E8D5`, black candles lavender `#A35BFF`, jack-o’-lanterns pumpkin orange `#F97316`, on a dark purple background with a pumpkin and bats in the corners. With more than three products the colors repeat, every second repeat a little lighter. Boxes, sizes, layouts, statistics and the camera are untouched, and turning it off restores the original colors. Auto and Manual modes work the same in both themes.

Spec: `.kiro/specs/izzy-pack-3d/`.
