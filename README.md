# Izzy Pack 3D

Shows how many identical rectangular items fit in a box. The 3D view is the main screen.
Built with React, TypeScript and Three.js (OrbitControls).

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
- Enter the box (container) dimensions (L, W, H). Add up to 8 box types with **+ Type**: each has L, W, H, a quantity, and its own color. A blank quantity means "as many as fit". Delete a type with ×.
- Press **Optimize**. The **Placed** column shows placed/requested per type.
- Switching units converts the shown values and keeps the physical sizes and the result.
- **Optimize** runs `src/core/optimizer.ts`: it combines the six axis-aligned orientations and mixed product types, tries several strategies (layered slabs, grid slabs, extreme points), verifies every candidate (no overlaps, inside the container, 70% support) and keeps the best. It is a heuristic: the result is the best found, not proven optimal. Boxes that do not fit are reported. Large orders (over 250 items) group identical items into blocks; when the search is reduced the results panel says so (measurements and limits: `docs/optimizer-benchmark.md`).

## Sections

The panel is organized as **Products → Boxes → Result → Report**, with the 3D view always next to it (on phones, above it).

- **Products**: name, size, quantity and weight per unit. **Import CSV** reads a file on your computer (columns `name, length_<unit>, width_<unit>, height_<unit>, quantity, weight_<unit>`, weight optional; the unit is in the header). **Template** downloads an example in the selected units. **Try a sample order** loads three Halloween products (skull masks, black candles and jack-o’-lanterns, with different sizes, quantities and weights): then open Boxes, press **Recommend box**, **Use this box**, and read the Report. In the 3D view the sample's boxes carry a pictogram (skull, black candle or jack-o’-lantern) on an exposed face, drawn once per product type; ordinary orders are drawn as always. If you edited your order (or imported one), it asks before replacing it. The file is checked completely first: errors are listed by row and nothing changes until you confirm the preview. Limits: 8 products, 100,000 units, 512 KB.
- **Boxes**: the container, the weight limits and the shipping-box catalog with **Recommend box**.
- **Result**: pieces placed, left out, volume, efficiency, weight.
- **Report**: a readable summary of the arrangement on screen: box, pieces requested / placed / left out per product, volume, weight and notes.

Switching sections keeps everything you entered, the results, the units and Auto / Manual.

When the whole order does not fit, the optimizer prefers **more pieces placed** (of the products with a quantity), then more placed volume. Products without a quantity never outrank those with one. It is a heuristic; see `docs/optimizer-benchmark.md` for what the rule costs and gains.

## Background optimization

**Optimize** runs in a Web Worker (`src/worker`), so the page stays responsive on large orders. While it runs, a status bar shows the current phase, the elapsed time and a **Cancel** button; the Optimize button is disabled, so only one job runs at a time. Cancel stops the computation for real (the worker is terminated) and keeps the previous result. If the optimizer fails, the message is shown and the previous result stays. Inputs edited while a job runs are not part of its result; the result is then marked as outdated.

## Shipping-box catalog

Under **Shipping boxes** you keep a list of interior sizes (add with **+ Box**, remove with ×; four examples are preloaded). **Recommend box** tries them by ascending interior volume and picks the first one where the optimizer places the **whole order**, within the weight limits from the Weight section (empty box weight and maximum gross weight apply to every box).

- Quantities must be explicit: a blank quantity means "as many as fit", so the app asks for numbers first.
- A box that holds only part of the order is never recommended, and the optimizer's rules for partial orders are unchanged.
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

Spec: `.kiro/specs/izzy-pack-3d/`.
