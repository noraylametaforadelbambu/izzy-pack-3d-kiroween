import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_TYPES,
  cloneRow,
  editRowField,
  editRowWeight,
  rowLabel,
  rowsFromProducts,
  switchRowWeight,
  newRow,
  nextColor,
  PALETTE,
  switchRow,
  validateRows,
  type TypeRow,
} from './core/boxTypes'
import {
  dimsToFields,
  editField,
  fieldFromMm,
  switchField,
  switchFields,
  validateFields,
  type DimsFields,
  type Field,
} from './core/fields'
import {
  EXAMPLE_BOXES,
  editCatalogRow,
  newCatalogRow,
  recommendBox,
  switchCatalogRow,
  validateCatalog,
  type CatalogRow,
  type Recommendation,
} from './core/catalog'
import { CSV_MAX_BYTES, parseProductsCsv } from './core/csv'
import type { PictogramKind } from './core/pictogram'
import { isUntouchedOrder, orderSignature, rowsFromSample } from './core/sampleOrder'
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from './core/history'
import { layoutFromPlacements, type Placement } from './core/layout'
import { MANUAL_MAX_BOXES, addBox, moveBy, removeBox, resolveDrop, rotate, type Axis, type Change } from './core/manual'
import type { PackItem } from './core/optimizer'
import { optimizeWeighted, type WeightedResult } from './core/weighted'
import type { OptimizeProgress } from './core/optimizer'
import { blankW, editW, switchW, weightOf, type WeightSpec, type WeightUnit, type WField } from './core/weight'
import { SAMPLE_BOX, SAMPLE_ITEM, type Dims } from './core/pack'
import type { Unit } from './core/units'
import { BoxesTab } from './ui/BoxesTab'
import { CatalogPanel } from './ui/CatalogPanel'
import { FrankensteinHome } from './ui/FrankensteinHome'
import { HalloweenDecor } from './ui/HalloweenDecor'
import { SoundToggle } from './ui/SoundToggle'
import { EntranceSound } from './viewer/entranceSound'
import type { SoundEvent } from './viewer/entrance'
import { ProductsTab, type CsvState } from './ui/ProductsTab'
import { ManualBoxes } from './ui/ManualBoxes'
import { ReportTab } from './ui/ReportTab'
import { StepIndicator } from './ui/StepIndicator'
import { backTarget, firstProblemStep, stepOfKey, type StepId } from './ui/steps'
import { UnitsBar } from './ui/UnitsBar'
import { JobStatus } from './ui/JobStatus'
import { Results } from './ui/Results'
import { SelectionCard } from './ui/SelectionCard'
import { Toolbar, type Mode } from './ui/Toolbar'
import type { Interaction } from './viewer/PackViewer'
import { createOptimizerWorker } from './worker/createWorker'
import { JobCancelledError, OptimizerRunner } from './worker/jobs'
import { PackViewerView, type ViewerHandle } from './viewer/PackViewerView'

/** Sample start: one box type, "as many as fit" (blank quantity). */
function sampleRows(): TypeRow[] {
  return [newRow(SAMPLE_ITEM, '', PALETTE[0], 'mm')]
}

/** The box and box types the layouts are built from (set by Optimize / Apply). */
interface Config {
  box: Dims
  types: PackItem[]
  weight: WeightSpec
  /** Name and color of each product when the layout was made, so the report still reads well after the list is replaced. */
  labels: Record<string, { name: string; color: string }>
  /** Pictogram of the products that have one (the sample order). Empty for ordinary orders. */
  pictograms: Record<string, PictogramKind>
}

const snapshotPictograms = (rows: TypeRow[]): Config['pictograms'] =>
  Object.fromEntries(rows.flatMap((r) => (r.pictogram ? [[r.id, r.pictogram] as const] : [])))

const snapshotLabels = (rows: TypeRow[]): Config['labels'] => Object.fromEntries(rows.map((r, i) => [r.id, { name: rowLabel(r, i), color: r.color }]))

const DEFAULT_STEP_MM = 10

export default function App() {
  const [unit, setUnit] = useState<Unit>('mm')
  const [box, setBox] = useState<DimsFields>(() => dimsToFields(SAMPLE_BOX, 'mm'))
  const [rows, setRows] = useState<TypeRow[]>(sampleRows)
  const [config, setConfig] = useState<Config>(() => {
    const v = validateRows(rows)
    return { box: SAMPLE_BOX, types: 'types' in v ? v.types : [], weight: { emptyG: 0, maxG: null }, labels: snapshotLabels(rows), pictograms: snapshotPictograms(rows) }
  })
  const [wUnit, setWUnit] = useState<WeightUnit>('kg')
  const [emptyW, setEmptyW] = useState<WField>(blankW)
  const [maxW, setMaxW] = useState<WField>(blankW)
  // Automatic layout from the weight-aware optimizer (a heuristic: best found, not proven optimal).
  const [opt, setOpt] = useState<WeightedResult>(() => optimizeWeighted(config.box, config.types, config.weight))
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
  const [stale, setStale] = useState(false)
  const [mode, setMode] = useState<Mode>('auto')
  const [hist, setHist] = useState<History<Placement[]>>(() => createHistory<Placement[]>([]))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [step, setStep] = useState<Field>(() => fieldFromMm(DEFAULT_STEP_MM, 'mm'))
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const noticeTimer = useRef<number>(0)
  // Optimization runs in a Web Worker, one job at a time. `job` is set while it runs.
  const runner = useRef<OptimizerRunner | null>(null)
  const [job, setJob] = useState<{ kind: 'optimize' | 'recommend'; progress: OptimizeProgress | null } | null>(null)
  // Shipping-box catalog (interior sizes) and the latest recommendation for the current inputs.
  const [catalog, setCatalog] = useState<CatalogRow[]>(() => EXAMPLE_BOXES.map((d) => newCatalogRow(d, 'mm')))
  const [rec, setRec] = useState<{ recommendation: Recommendation; types: PackItem[]; spec: WeightSpec } | null>(null)
  const editVersion = useRef(0)
  // The guided flow: Home, Your order, Choose a box, Result (+ Report). All screens stay mounted, so going back never loses state.
  const [screen, setScreen] = useState<StepId>('home')
  // True once a result was made for the user's order (Use this box / Pack in my own box). Until then the view shows the example layout.
  const [produced, setProduced] = useState(false)
  // Token of the entrance animation of the sample order: a new one per "Use this box" on the sample (never for ordinary orders).
  const [entrance, setEntrance] = useState(0)
  // While the entrance animation of the sample runs, the placement numbers wait: they appear when the seam and the bolt are done.
  const [metricsHidden, setMetricsHidden] = useState(false)
  const [csv, setCsv] = useState<CsvState | null>(null)
  const [confirmSample, setConfirmSample] = useState(false)
  // The order the app starts with: replacing it (or the untouched sample) needs no confirmation.
  const startSignature = useRef(orderSignature(sampleRows()))
  // Halloween mode: colors of the 3D view only. Off by default and not saved; nothing else reads it.
  const [halloween, setHalloween] = useState(false)
  // Sound effects (Web Audio, synthesized): off at start and not saved. Audio can only start after a gesture, so the engine
  // is created and unlocked by the Sound button (and resumed by the clicks that start an animation).
  const [soundOn, setSoundOn] = useState(false)
  const soundOnRef = useRef(false)
  const audio = useRef<EntranceSound | null>(null)
  const soundButton = useRef<HTMLDivElement>(null)
  const viewer = useRef<ViewerHandle>(null)
  const stage = useRef<HTMLElement>(null)
  const revealStage = useRef(false)
  // The Home animation plays once per visit to the app; coming back to Home shows the finished figure.
  const [frankPlayed, setFrankPlayed] = useState(false)

  const manual = mode === 'manual'
  const typeNumbers = useMemo(() => new Map(rows.map((r, i) => [r.id, i + 1])), [rows])
  const autoLayout = opt.layout
  const manualLayout = useMemo(
    () => layoutFromPlacements(config.box, config.types, hist.present),
    [config, hist.present],
  )
  const layout = manual ? manualLayout : autoLayout
  const summaries = useMemo(() => new Map(layout.types.map((t) => [t.typeId, t])), [layout])
  const weight = useMemo(
    () => weightOf(layout.placements, new Map(config.types.map((t) => [t.id, (t.weightKg ?? 0) * 1000])), config.weight),
    [layout, config],
  )
  const selected = manual && screen === 'result' ? hist.present.find((p) => p.id === selectedId) : undefined

  function notify(text: string, tone: 'error' | 'info' = 'error') {
    setNotice({ text, tone })
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2800)
  }
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  useEffect(() => () => runner.current?.cancel(), [])

  /** Marks the inputs as changed since the last optimization. */
  function edited() {
    editVersion.current++
    setStale(true)
    setRec(null) // a recommendation belongs to the inputs it was made for
  }

  function clearInvalid(key: string) {
    setInvalid((s) => {
      if (!s.has(key)) return s
      const n = new Set(s)
      n.delete(key)
      return n
    })
  }

  // ---- Container and box types -------------------------------------------------

  function onEditBox(key: keyof Dims, text: string) {
    setBox((b) => ({ ...b, [key]: editField(text, unit) }))
    clearInvalid(`box.${key}`)
    edited()
  }

  function onEditType(id: string, field: keyof Dims | 'qty', text: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? editRowField(r, field, text, unit) : r)))
    clearInvalid(`${id}.${field}`)
    edited()
  }

  function onEditName(id: string, text: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, name: text } : r))) // cosmetic: no new optimization needed
  }

  // ---- CSV import: validate first, change the order only when the user confirms -----

  async function onCsvFile(file: File) {
    const fail = (message: string) => setCsv({ fileName: file.name, result: { ok: false, errors: [{ row: null, column: null, message }], truncated: false } })
    if (file.size > CSV_MAX_BYTES) return fail(`The file is too large (limit ${CSV_MAX_BYTES / 1024} KB)`)
    try {
      setCsv({ fileName: file.name, result: parseProductsCsv(await file.text()) })
    } catch {
      fail('The file could not be read')
    }
  }

  function onCsvApply() {
    if (!csv || !csv.result.ok) return
    const imported = rowsFromProducts(csv.result.products, unit, wUnit)
    const old = new Set(rows.map((r) => r.id))
    setRows(imported)
    setInvalid((s) => new Set([...s].filter((k) => !old.has(k.split('.')[0]))))
    setCsv(null)
    edited()
    notify(`Imported ${imported.length} ${imported.length === 1 ? 'product' : 'products'}. Check them, then choose a box.`, 'info')
  }

  // ---- "Try a sample order": same path as a CSV import --------------------------------

  function loadSample() {
    const sample = rowsFromSample(unit, wUnit)
    const old = new Set(rows.map((r) => r.id))
    setRows(sample)
    setInvalid((s) => new Set([...s].filter((k) => !old.has(k.split('.')[0]))))
    setCsv(null)
    setConfirmSample(false)
    edited()
    notify('Sample order loaded: 3 Halloween products. Check them, then choose a box.', 'info')
  }

  function onTrySample() {
    setCsv(null) // a pending CSV preview would be replaced too
    setScreen('order') // the order is where the user sees the sample, or the question about replacing their products
    if (isUntouchedOrder(rows, startSignature.current)) loadSample()
    else setConfirmSample(true) // the user edited the order: ask first
  }

  function onAddType() {
    if (rows.length >= MAX_TYPES) return
    // A new type starts as a copy of the last one, so it is valid in the current unit.
    setRows((rs) => [...rs, cloneRow(rs[rs.length - 1], nextColor(rs))])
    edited()
  }

  function onDeleteType(id: string) {
    if (rows.length <= 1) return
    setRows((rs) => rs.filter((r) => r.id !== id))
    setInvalid((s) => new Set([...s].filter((k) => !k.startsWith(`${id}.`))))
    edited()
  }

  function onUnit(u: Unit) {
    if (u === unit) return
    setUnit(u)
    setBox((b) => switchFields(b, u))
    setRows((rs) => rs.map((r) => switchRow(r, u)))
    setCatalog((cs) => cs.map((c) => switchCatalogRow(c, u)))
    setStep((s) => switchField(s, u))
  }

  function onEditWeight(key: string, text: string) {
    const f = editW(text, wUnit)
    if (key === 'empty') setEmptyW(f)
    else if (key === 'max') setMaxW(f)
    else setRows((rs) => rs.map((r) => (r.id === key ? editRowWeight(r, text, wUnit) : r)))
    clearInvalid(key === 'empty' ? 'w.empty' : key === 'max' ? 'w.max' : `${key}.wt`)
    edited()
  }

  function onWeightUnit(u: WeightUnit) {
    if (u === wUnit) return
    setWUnit(u)
    setEmptyW((f) => switchW(f, u))
    setMaxW((f) => switchW(f, u))
    setRows((rs) => rs.map((r) => switchRowWeight(r, u)))
  }

  const rowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows])

  // After "Use this box" / "Pack in my own box" on a phone (one column: viewer above the panel), the confirm button
  // is at the bottom of the page. Show the 3D view without a manual scroll. Wide screens show both side by side: no scroll.
  useEffect(() => {
    if (screen !== 'result' || !revealStage.current) return
    revealStage.current = false
    if (!window.matchMedia('(max-width: 767px)').matches) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    stage.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [screen])

  /** Opens the first step that has a field to fix, so the highlighted field is not hidden in another screen. */
  function showFirstProblem(bad: ReadonlySet<string>) {
    const first = firstProblemStep(bad, rowIds)
    if (first) setScreen(first)
  }

  /** Weight settings as grams; flags invalid fields in `bad`. The maximum must be above the empty box weight. */
  function readSpec(bad: Set<string>): WeightSpec {
    if (!emptyW.valid) bad.add('w.empty')
    if (!maxW.valid) bad.add('w.max')
    const spec: WeightSpec = { emptyG: emptyW.g ?? 0, maxG: maxW.g }
    if (bad.size === 0 && spec.maxG !== null && spec.maxG <= spec.emptyG) {
      bad.add('w.max')
      notify('Max gross weight must be above the empty box weight')
    }
    return spec
  }

  // ---- Shipping-box catalog ----------------------------------------------------

  function onEditCatalog(id: string, key: keyof Dims, text: string) {
    setCatalog((cs) => cs.map((c) => (c.id === id ? editCatalogRow(c, key, text, unit) : c)))
    clearInvalid(`${id}.${key}`)
    setRec(null)
  }

  function onAddCatalog() {
    setCatalog((cs) => [...cs, newCatalogRow({ l: 300, w: 200, h: 150 }, unit)])
    setRec(null)
  }

  function onRemoveCatalog(id: string) {
    setCatalog((cs) => cs.filter((c) => c.id !== id))
    setInvalid((s) => new Set([...s].filter((k) => !k.startsWith(`${id}.`))))
    setRec(null)
  }

  /** Smallest catalog box that holds the whole order (explicit quantities required), searched in the worker. */
  async function onRecommend() {
    if (job || runner.current?.busy) return
    const c = validateCatalog(catalog)
    const v = validateRows(rows)
    const bad = new Set<string>()
    if ('invalid' in c) c.invalid.forEach((k) => bad.add(k))
    if ('invalid' in v) v.invalid.forEach((k) => bad.add(k))
    const spec = readSpec(bad)
    if ('types' in v) {
      v.types.filter((t) => t.qty === null).forEach((t) => bad.add(`${t.id}.qty`)) // blank quantity: ask for a number
    }
    setInvalid(bad)
    if ('invalid' in c || 'invalid' in v) {
      showFirstProblem(bad)
      return
    }
    const onlyBlankQty = [...bad].every((k) => k.endsWith('.qty'))
    if (bad.size > 0 && !onlyBlankQty) {
      showFirstProblem(bad) // invalid weights: the highlighted fields explain it
      return
    }
    if (bad.size > 0 || c.boxes.length === 0) {
      // Blank quantities or an empty catalog: answered at once by the same function, without starting a search.
      setRec({ recommendation: recommendBox(c.boxes, v.types, spec), types: v.types, spec })
      return
    }
    runner.current ??= new OptimizerRunner(createOptimizerWorker)
    const version = editVersion.current
    setJob({ kind: 'recommend', progress: null })
    try {
      const recommendation = await runner.current.recommend({ catalog: c.boxes, items: v.types, spec }, (progress) => setJob({ kind: 'recommend', progress }))
      if (editVersion.current !== version) {
        notify('Inputs changed while searching. Run the recommendation again.')
        return
      }
      setRec({ recommendation, types: v.types, spec })
    } catch (e) {
      notify(e instanceof JobCancelledError ? 'Search cancelled' : `Recommendation failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setJob(null)
    }
  }

  /** A new result starts in Auto mode, on the Result screen. */
  function startResult() {
    // The "Sample order loaded" message belongs to the previous screen: do not carry it into the Result.
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
    setProduced(true)
    setMode('auto')
    revealStage.current = true // on phones the 3D view is above the panel: bring it into view once the Result screen is shown
    setScreen('result')
  }

  /** Puts the recommended box into the container fields and shows its layout. */
  function onUseBox() {
    const r = rec?.recommendation
    if (!rec || !r || r.status !== 'found' || !r.box || !r.result) return
    if (soundOnRef.current) unlockAudio() // this click is the gesture that lets the entrance be heard
    const dims = r.box.dims
    setBox(dimsToFields(dims, unit))
    setConfig({ box: dims, types: rec.types, weight: rec.spec, labels: snapshotLabels(rows), pictograms: snapshotPictograms(rows) })
    setOpt(r.result)
    setHist(createHistory<Placement[]>([]))
    setSelectedId(null)
    setStale(false)
    setInvalid((s) => new Set([...s].filter((k) => !k.startsWith('box.'))))
    if (Object.keys(snapshotPictograms(rows)).length > 0) {
      setEntrance((n) => n + 1)
      // Reduced motion has no animation, so nothing waits: the numbers show from the first frame.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setMetricsHidden(true)
    }
    startResult()
  }

  /** "Pack in my own box": validate, optimize in the worker, then replace the automatic layout and clear the manual one. */
  async function onOptimize() {
    if (job || runner.current?.busy) return // never two jobs at once
    const b = validateFields(box)
    const v = validateRows(rows)
    const bad = new Set<string>()
    if ('invalid' in b) b.invalid.forEach((k) => bad.add(`box.${k}`))
    if ('invalid' in v) v.invalid.forEach((k) => bad.add(k))
    const spec = readSpec(bad)
    setInvalid(bad)
    if (bad.size > 0 || 'invalid' in b || 'invalid' in v) {
      showFirstProblem(bad)
      return
    }
    runner.current ??= new OptimizerRunner(createOptimizerWorker)
    const version = editVersion.current
    setJob({ kind: 'optimize', progress: null })
    try {
      const result = await runner.current.run({ box: b.dims, items: v.types, spec }, (progress) => setJob({ kind: 'optimize', progress }))
      if (result.status === 'rejected') {
        notify(result.warnings[0] ?? 'This order is too large to optimize')
        return
      }
      setOpt(result)
      setConfig({ box: b.dims, types: v.types, weight: spec, labels: snapshotLabels(rows), pictograms: snapshotPictograms(rows) })
      setHist(createHistory<Placement[]>([]))
      setSelectedId(null)
      setStale(editVersion.current !== version) // inputs edited while it ran are not part of this result
      startResult()
    } catch (e) {
      notify(e instanceof JobCancelledError ? 'Optimization cancelled' : `Optimization failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setJob(null)
    }
  }

  // ---- Manual arrangement ------------------------------------------------------

  /** Applies the outcome of a manual action: records it, or tells the user why it was refused. */
  function run(c: Change): boolean {
    if (!c.ok) {
      notify(c.reason)
      return false
    }
    if (c.changed) setHist((h) => commit(h, c.placements))
    return true
  }

  function changeMode(m: Mode) {
    setMode(m)
    setSelectedId(null)
  }

  function onNudge(axis: Axis, sign: 1 | -1) {
    if (!selected || step.mm === null) return
    run(moveBy(config.box, hist.present, selected.id, axis, sign * step.mm))
  }

  function onRotate(axis: Axis) {
    if (selected) run(rotate(config.box, hist.present, selected.id, axis))
  }

  function onRemoveSelected() {
    if (selected && run(removeBox(hist.present, selected.id))) setSelectedId(null)
  }

  function onAddBox(typeId: string) {
    const t = config.types.find((x) => x.id === typeId)
    if (!t) return
    const c = addBox(config.box, hist.present, t)
    if (run(c) && c.ok && c.moved) setSelectedId(c.moved.id)
  }

  function canAdd(typeId: string): boolean {
    const t = config.types.find((x) => x.id === typeId)
    if (!t || hist.present.length >= MANUAL_MAX_BOXES) return false
    return t.qty === null || hist.present.filter((p) => p.typeId === typeId).length < t.qty
  }

  function onUndo() {
    setHist(undo)
  }
  function onRedo() {
    setHist(redo)
  }
  function onReset() {
    setHist((h) => commit(h, []))
    setSelectedId(null)
  }
  function onFromAuto() {
    if (autoLayout.placements.length > MANUAL_MAX_BOXES) {
      notify(`Manual mode is limited to ${MANUAL_MAX_BOXES} boxes`)
      return
    }
    setHist((h) => commit(h, autoLayout.placements.map((p) => ({ ...p }))))
    setSelectedId(null)
  }

  const interaction: Interaction = {
    enabled: manual && screen === 'result',
    selectedId: selected?.id ?? null,
    resolve: (id, x, y) => {
      const r = resolveDrop(config.box, hist.present, id, x, y)
      return r && { placement: r.placement, ok: r.check.ok }
    },
    onSelect: setSelectedId,
    onDrop: (id, x, y) => {
      const r = resolveDrop(config.box, hist.present, id, x, y)
      if (!r) return
      if (!r.check.ok) {
        notify(r.check.reason) // the box keeps its previous position
        return
      }
      const old = hist.present.find((p) => p.id === id)
      if (old && (old.x !== r.placement.x || old.y !== r.placement.y || old.z !== r.placement.z)) {
        setHist((h) => commit(h, h.present.map((p) => (p.id === id ? r.placement : p))))
      }
    },
  }

  // Keyboard: undo / redo / delete in manual mode (not while typing in a field).
  const keys = useRef({ onUndo, onRedo, onRemoveSelected })
  useEffect(() => {
    keys.current = { onUndo, onRedo, onRemoveSelected }
  })
  useEffect(() => {
    if (!manual || screen !== 'result') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) keys.current.onRedo()
        else keys.current.onUndo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        keys.current.onRedo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        keys.current.onRemoveSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [manual, screen])

  const selectedType = selected ? config.types.find((t) => t.id === selected.typeId) : undefined

  const flagged = useMemo(() => new Set<StepId>([...invalid].map((k) => stepOfKey(k, rowIds))), [invalid, rowIds])
  const resultReady = produced && !stale

  /** Sound button: the click is the gesture that unlocks audio. Turning it off silences everything at once. */
  function onToggleSound() {
    const next = !soundOnRef.current
    soundOnRef.current = next
    setSoundOn(next)
    if (next) unlockAudio()
    else audio.current?.silence()
  }

  /** Creates the engine on first use and resumes it. Call from a click or tap handler, and only while Sound is on. */
  function unlockAudio() {
    if (!audio.current) {
      const a = new EntranceSound()
      a.onEvent = (name) => {
        const el = soundButton.current
        if (el) {
          el.dataset.log = `${el.dataset.log ?? ''}${el.dataset.log ? ',' : ''}${name}` // test hook: what was scheduled
          el.dataset.pending = String(a.pending)
        }
      }
      audio.current = a
    }
    audio.current.unlock()
    if (soundButton.current) soundButton.current.dataset.audio = audio.current.state
  }

  /** An animation starts: its whole soundtrack is scheduled on the audio clock (only while Sound is on). */
  function onSoundtrack(events: SoundEvent[]) {
    if (soundOnRef.current) audio.current?.schedule(events)
  }

  /** An animation stopped, finished or cut short: whatever is left of its sound stops. */
  function onSoundEnd() {
    audio.current?.silence()
  }
  useEffect(() => () => audio.current?.dispose(), [])
  const waitingForNumbers = metricsHidden && screen === 'result'
  // Safety net: the numbers are never hidden for more than a few seconds, whatever happens to the animation.
  useEffect(() => {
    if (!metricsHidden) return
    const t = window.setTimeout(() => setMetricsHidden(false), 6000)
    return () => window.clearTimeout(t)
  }, [metricsHidden])
  const recFound = rec?.recommendation.status === 'found'
  const onResult = screen === 'result'
  // Live name while the product still exists (renames show at once), otherwise the name it had when the layout was made.
  const labels = useMemo(() => {
    const live = new Map(rows.map((r, i) => [r.id, { name: rowLabel(r, i), color: r.color }]))
    return new Map(config.types.map((t) => [t.id, live.get(t.id) ?? config.labels[t.id] ?? { name: 'Product', color: '#8899aa' }]))
  }, [rows, config])
  const effortNotes = manual ? [] : opt.stats.effort.notes
  const heldBack = manual ? 0 : opt.heldBackByWeight

  // ---- Guided flow ---------------------------------------------------------------

  /** "Your order" → "Choose a box": the products must be valid. Quantities may stay blank (own box); a recommendation asks for them. */
  function onContinueOrder() {
    const v = validateRows(rows)
    if ('invalid' in v) {
      setInvalid((s) => new Set([...[...s].filter((k) => !rowIds.has(k.split('.')[0])), ...v.invalid]))
      return
    }
    setInvalid((s) => new Set([...s].filter((k) => !rowIds.has(k.split('.')[0]))))
    setScreen('box')
  }

  /** The main button of the current screen (also what Enter does in a field). */
  function onPrimary() {
    if (job || runner.current?.busy) return
    if (screen === 'order') onContinueOrder()
    else if (screen === 'box') {
      if (recFound) onUseBox()
      else void onRecommend()
    } else if (screen === 'result') setScreen('report')
    else if (screen === 'report') setScreen('result')
  }

  const back = backTarget(screen)
  const primaryLabel =
    job !== null
      ? job.kind === 'recommend'
        ? 'Searching…'
        : 'Packing…'
      : screen === 'order'
        ? 'Choose a box'
        : screen === 'box'
          ? recFound
            ? 'Use this box'
            : 'Recommend box'
          : screen === 'result'
            ? 'View report'
            : 'Back to result'
  // What the 3D view shows while the user is not on the result: the example layout, or the last result.
  const stageNote = produced ? (stale ? 'Previous result (outdated)' : 'Current result') : 'Example layout'

  return (
    <main className={`app step-${screen}`}>
      <section className="stage" ref={stage}>
        {screen === 'home' && (
          <header className="hero">
            <h1>Izzy Pack 3D</h1>
            <p className="tagline">Find a shipping box for your order and see how to pack it in 3D.</p>
          </header>
        )}
        {screen === 'home' && <FrankensteinHome playOnMount={!frankPlayed} onPlayed={() => setFrankPlayed(true)} onSound={onSoundtrack} onSoundEnd={onSoundEnd} onReplay={() => soundOnRef.current && unlockAudio()} />}
        <PackViewerView ref={viewer} layout={layout} interaction={interaction} halloween={halloween} pictograms={config.pictograms} entrance={screen === 'result' && entrance > 0 ? entrance : null} onEntranceReveal={() => setMetricsHidden(false)} onEntranceSound={onSoundtrack} onEntranceEnd={onSoundEnd} />
        {halloween && <HalloweenDecor />}
        {onResult && (
          <Toolbar
            mode={mode}
            onMode={changeMode}
            canUndo={canUndo(hist)}
            canRedo={canRedo(hist)}
            hasBoxes={hist.present.length > 0}
            onUndo={onUndo}
            onRedo={onRedo}
            onReset={onReset}
            onFromAuto={onFromAuto}
          />
        )}
        {waitingForNumbers ? (
          <div className="chip" data-testid="chip-pending" role="status">
            Fitting the boxes…
          </div>
        ) : screen === 'result' || screen === 'report' ? (
          <div className={layout.unplacedCount > 0 ? 'chip warn' : 'chip'} data-testid="chip">
            <b>{layout.placedCount.toLocaleString('en-US')}</b> placed · {layout.usedPct.toFixed(1)}% used
            {layout.unplacedCount > 0 && <> · {layout.unplacedCount.toLocaleString('en-US')} left out</>}
          </div>
        ) : screen !== 'home' ? (
          <div className={produced && stale ? 'chip warn' : 'chip'} data-testid="stage-note">
            {stageNote}
          </div>
        ) : null}
        {selected && selectedType && (
          <SelectionCard
            placement={selected}
            typeNumber={rows.findIndex((r) => r.id === selected.typeId) + 1}
            typeDims={selectedType.dims}
            unit={unit}
            step={step}
            onStep={(text) => setStep(editField(text, unit))}
            onMove={onNudge}
            onRotate={onRotate}
            onRemove={onRemoveSelected}
            onClose={() => setSelectedId(null)}
          />
        )}
        {job && <JobStatus label={job.kind === 'recommend' ? 'Finding a box' : 'Packing'} progress={job.progress} onCancel={() => runner.current?.cancel()} />}
        {notice && (
          <div className={notice.tone === 'info' ? 'toast info' : 'toast'} role={notice.tone === 'info' ? 'status' : 'alert'}>
            {notice.text}
          </div>
        )}
        <div className="stagebtns" ref={soundButton}>
          <SoundToggle on={soundOn} onToggle={onToggleSound} />
          <button
            type="button"
            className={halloween ? 'hwtoggle on' : 'hwtoggle'}
            aria-pressed={halloween}
            title="Halloween mode: changes only the colors of the 3D view"
            onClick={() => setHalloween((v) => !v)}
          >
            Halloween mode
          </button>
        </div>
        <button
          type="button"
          className="reset"
          aria-label="Reset view"
          title="Reset view"
          onClick={() => viewer.current?.reset()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
        </button>
      </section>
      <aside className={`panel step-${screen}`}>
        {screen !== 'home' && <h1>Izzy Pack 3D</h1>}
        <StepIndicator step={screen} resultReady={resultReady} flagged={flagged} onGo={setScreen} />
        {screen !== 'home' && <UnitsBar unit={unit} weightUnit={wUnit} onUnit={onUnit} onWeightUnit={onWeightUnit} />}
        <form
          className="tabform"
          onSubmit={(e) => {
            e.preventDefault()
            onPrimary()
          }}
        >
          <div className="tabbody">
            <div id="screen-home" className="homepane" hidden={screen !== 'home'}>
              <button type="button" className="primary start" onClick={() => setScreen('order')}>
                Start an order
              </button>
              <button type="button" className="cta-sample" onClick={onTrySample} disabled={job !== null} title="Load three example Halloween products: skull masks, black candles and jack-o’-lanterns">
                Try a sample order
              </button>
              <p className="hint">Add your products, pick a shipping box and see the packing in 3D. Everything stays in your browser.</p>
            </div>
            <div id="screen-order" hidden={screen !== 'order'}>
              <h2 className="steptitle">Your order</h2>
              <ProductsTab
                rows={rows}
                summaries={summaries}
                invalid={invalid}
                unit={unit}
                weightUnit={wUnit}
                manual={false}
                showPlaced={false}
                busy={job !== null}
                canAdd={canAdd}
                onAddBox={onAddBox}
                onEditName={onEditName}
                onEditType={onEditType}
                onEditWeight={onEditWeight}
                onAddType={onAddType}
                onDeleteType={onDeleteType}
                csv={csv}
                onCsvFile={(f) => void onCsvFile(f)}
                onCsvApply={onCsvApply}
                onCsvCancel={() => setCsv(null)}
                onTrySample={onTrySample}
                confirmSample={confirmSample}
                onConfirmSample={loadSample}
                onCancelSample={() => setConfirmSample(false)}
              />
            </div>
            <div id="screen-box" hidden={screen !== 'box'}>
              <h2 className="steptitle">Choose a box</h2>
              <BoxesTab
                box={box}
                invalid={invalid}
                empty={emptyW}
                max={maxW}
                onEditBox={onEditBox}
                onEditWeight={onEditWeight}
                onOwnBox={() => void onOptimize()}
                busy={job !== null}
                catalog={
                  <CatalogPanel
                    rows={catalog}
                    unit={unit}
                    weightUnit={wUnit}
                    invalid={invalid}
                    busy={job !== null}
                    recommendation={rec?.recommendation ?? null}
                    typeNumbers={typeNumbers}
                    onEdit={onEditCatalog}
                    onAdd={onAddCatalog}
                    onRemove={onRemoveCatalog}
                    onRecommend={onRecommend}
                    onUse={onUseBox}
                    hideActions
                  />
                }
              />
            </div>
            <div id="screen-result" hidden={screen !== 'result'} className="resultpane">
              <h2 className="steptitle">Result</h2>
              {waitingForNumbers ? (
                <p className="hint pending" role="status" data-testid="results-pending">
                  Fitting the boxes… the numbers appear when the lid is closed.
                </p>
              ) : (
                <Results
                  layout={layout}
                  unit={unit}
                  stale={stale && !manual}
                  showOrientation={!manual}
                  weight={weight}
                  weightUnit={wUnit}
                  heldBack={heldBack}
                  effortNotes={effortNotes}
                />
              )}
              <p className="hint">{manual ? 'Manual arrangement: these numbers follow the boxes you place.' : 'Automatic arrangement for the chosen box.'}</p>
              {manual && <ManualBoxes rows={rows} summaries={summaries} canAdd={canAdd} onAddBox={onAddBox} />}
            </div>
            <div id="screen-report" hidden={screen !== 'report'}>
              <h2 className="steptitle">Report</h2>
              <ReportTab
                layout={layout}
                items={config.types}
                labels={labels}
                unit={unit}
                weightUnit={wUnit}
                weight={weight}
                manual={manual}
                stale={stale}
                heldBack={heldBack}
                effortNotes={effortNotes}
              />
            </div>
          </div>
          {screen !== 'home' && (
            <div className="tabfoot">
              <p className="error" role="alert">
                {flagged.has(screen === 'report' ? 'result' : screen) ? 'Check the highlighted fields' : ''}
              </p>
              <div className="footrow">
                {back && screen !== 'report' && (
                  <button type="button" className="add back" onClick={() => setScreen(back)} disabled={job !== null}>
                    Back
                  </button>
                )}
                <button type="submit" className="primary" disabled={job !== null} aria-busy={job !== null}>
                  {primaryLabel}
                </button>
              </div>
            </div>
          )}
        </form>
      </aside>
    </main>
  )
}
