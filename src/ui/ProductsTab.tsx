import { useEffect, useRef } from 'react'
import { MAX_TYPES, type TypeRow } from '../core/boxTypes'
import { CSV_MAX_UNITS, TEMPLATE_FILENAME, productsTemplate, type CsvResult } from '../core/csv'
import type { TypeSummary } from '../core/layout'
import type { Dims } from '../core/pack'
import { formatDim, type Unit } from '../core/units'
import { formatWeight, type WeightUnit } from '../core/weight'

export interface CsvState {
  fileName: string
  result: CsvResult
}

interface Props {
  rows: TypeRow[]
  summaries: ReadonlyMap<string, TypeSummary>
  invalid: ReadonlySet<string>
  unit: Unit
  weightUnit: WeightUnit
  manual: boolean
  busy: boolean
  canAdd: (typeId: string) => boolean
  onAddBox: (typeId: string) => void
  onEditName: (id: string, text: string) => void
  onEditType: (id: string, field: keyof Dims | 'qty', text: string) => void
  onEditWeight: (id: string, text: string) => void
  onAddType: () => void
  onDeleteType: (id: string) => void
  csv: CsvState | null
  onCsvFile: (file: File) => void
  /** "Try a sample order": loads three example products (asks first when the current order was edited). */
  onTrySample: () => void
  confirmSample: boolean
  onConfirmSample: () => void
  onCancelSample: () => void
  onCsvApply: () => void
  onCsvCancel: () => void
}

const KEYS: { key: keyof Dims; name: string; head: string }[] = [
  { key: 'l', name: 'length', head: 'L' },
  { key: 'w', name: 'width', head: 'W' },
  { key: 'h', name: 'height', head: 'H' },
]

function placedText(s: TypeSummary | undefined): string {
  if (!s) return '–'
  return s.requested === null ? String(s.placed) : `${s.placed}/${s.requested}`
}

function downloadTemplate(unit: Unit, weightUnit: WeightUnit): void {
  const url = URL.createObjectURL(new Blob([productsTemplate(unit, weightUnit)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = TEMPLATE_FILENAME
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The product list (name, size, quantity, weight), with CSV import. Everything is stored in mm and grams. */
export function ProductsTab(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const confirmBox = useRef<HTMLDivElement>(null)
  // When the question opens, bring it into view (on phones it appears below the fold, above the sticky Optimize bar).
  useEffect(() => {
    if (p.confirmSample) confirmBox.current?.scrollIntoView?.({ block: 'nearest' })
  }, [p.confirmSample])
  const { unit, weightUnit } = p
  return (
    <div className="productstab">
      <p className="hint">
        Size in <b>{unit}</b>, weight per unit in <b>{weightUnit}</b>. A blank quantity means “as many as fit”.
      </p>
      <div className="pheads" aria-hidden="true">
        <span>L</span>
        <span>W</span>
        <span>H</span>
        <span>Qty</span>
        <span>Weight</span>
      </div>
      {p.rows.map((r, i) => {
        const n = i + 1
        const s = p.summaries.get(r.id)
        const short = s !== undefined && s.requested !== null && s.placed < s.requested
        return (
          <div className="pcard" key={r.id}>
            <div className="phead">
              <span className="swatch" style={{ background: r.color }} title={`Type ${n}`} />
              <input
                type="text"
                className="pname"
                autoComplete="off"
                maxLength={60}
                placeholder={`Type ${n}`}
                aria-label={`Type ${n} name`}
                value={r.name}
                onChange={(e) => p.onEditName(r.id, e.target.value)}
              />
              <span className={short ? 'placed short' : 'placed'} aria-label={`Type ${n} placed`}>
                {placedText(s)}
              </span>
              {p.manual && (
                <button type="button" className="add1" aria-label={`Add type ${n} box`} title="Add one to the container" disabled={!p.canAdd(r.id)} onClick={() => p.onAddBox(r.id)}>
                  +
                </button>
              )}
              <button type="button" className="del" aria-label={`Delete type ${n}`} title="Delete product" disabled={p.rows.length <= 1} onClick={() => p.onDeleteType(r.id)}>
                ×
              </button>
            </div>
            <div className="pfields">
              {KEYS.map(({ key, name }) => {
                const bad = p.invalid.has(`${r.id}.${key}`)
                return (
                  <input
                    key={key}
                    className={bad ? 'bad' : undefined}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Type ${n} ${name}`}
                    aria-invalid={bad}
                    value={r.dims[key].text}
                    onChange={(e) => p.onEditType(r.id, key, e.target.value)}
                  />
                )
              })}
              <input
                className={p.invalid.has(`${r.id}.qty`) ? 'bad' : undefined}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="max"
                aria-label={`Type ${n} quantity`}
                aria-invalid={p.invalid.has(`${r.id}.qty`)}
                value={r.qty}
                onChange={(e) => p.onEditType(r.id, 'qty', e.target.value)}
              />
              <input
                className={p.invalid.has(`${r.id}.wt`) ? 'bad' : undefined}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="–"
                aria-label={`Type ${n} weight`}
                aria-invalid={p.invalid.has(`${r.id}.wt`)}
                value={r.weight.text}
                onChange={(e) => p.onEditWeight(r.id, e.target.value)}
              />
            </div>
          </div>
        )
      })}

      <div className="pactions">
        <button type="button" className="add" onClick={p.onAddType} disabled={p.rows.length >= MAX_TYPES} title="Add a product">
          + Type
        </button>
        <button type="button" className="add" onClick={() => fileInput.current?.click()} disabled={p.busy} title="Import products from a CSV file on this computer">
          Import CSV
        </button>
        <button type="button" className="add" onClick={() => downloadTemplate(unit, weightUnit)} title="Download an example CSV in the selected units">
          Template
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          aria-label="CSV file with products"
          data-testid="csv-file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // choosing the same file again must work
            if (f) p.onCsvFile(f)
          }}
        />
      </div>
      <div className="psample">
        <button type="button" className="add sample" onClick={p.onTrySample} disabled={p.busy} title="Load three example Halloween products: skull masks, black candles and jack-o’-lanterns">
          Try a sample order
        </button>
      </div>
      {p.confirmSample && (
        <div ref={confirmBox} className="csvbox samplebox" role="group" aria-label="Replace your products with the sample order?" data-testid="sample-confirm">
          <b>Replace your products with the sample order?</b>
          <p>You changed the current products. Loading the sample replaces them, and your edits are lost. Results and boxes stay as they are until you press Optimize or Recommend box.</p>
          <div className="pactions">
            <button type="button" className="add" onClick={p.onConfirmSample}>
              Replace with sample
            </button>
            <button type="button" className="add" onClick={p.onCancelSample} autoFocus>
              Keep my products
            </button>
          </div>
        </div>
      )}
      <p className="hint csvhint">
        CSV columns: <code>name, length_{unit}, width_{unit}, height_{unit}, quantity, weight_{weightUnit}</code> (weight is optional). Up to {MAX_TYPES} products and{' '}
        {CSV_MAX_UNITS.toLocaleString('en-US')} units. The file is read on this computer only.
      </p>

      {p.csv && <CsvPanel csv={p.csv} unit={unit} weightUnit={weightUnit} onApply={p.onCsvApply} onCancel={p.onCsvCancel} />}
    </div>
  )
}

function CsvPanel({ csv, unit, weightUnit, onApply, onCancel }: { csv: CsvState; unit: Unit; weightUnit: WeightUnit; onApply: () => void; onCancel: () => void }) {
  const r = csv.result
  if (!r.ok) {
    return (
      <div className="csvbox csverr" role="alert" data-testid="csv-errors">
        <b>
          Nothing was imported: {r.errors.length}
          {r.truncated ? '+' : ''} {r.errors.length === 1 && !r.truncated ? 'problem' : 'problems'} in “{csv.fileName}”
        </b>
        <p>Your current products were not changed. Fix the file and import it again.</p>
        <ul>
          {r.errors.map((e, i) => (
            <li key={i}>
              <span className="where">{e.row === null ? 'File' : `Row ${e.row}`}</span>
              {e.column && <code>{e.column}</code>} {e.message}
            </li>
          ))}
        </ul>
        {r.truncated && <p>More problems exist; fix these first.</p>}
        <button type="button" className="add" onClick={onCancel}>
          Close
        </button>
      </div>
    )
  }
  return (
    <div className="csvbox csvok" role="status" data-testid="csv-preview">
      <b>
        “{csv.fileName}”: {r.products.length} {r.products.length === 1 ? 'product' : 'products'}, {r.totalUnits.toLocaleString('en-US')} units
      </b>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Size ({unit})</th>
            <th>Qty</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {r.products.map((x) => (
            <tr key={x.row}>
              <td>{x.name}</td>
              <td>
                {formatDim(x.dims.l, unit)} × {formatDim(x.dims.w, unit)} × {formatDim(x.dims.h, unit)}
              </td>
              <td>{x.qty.toLocaleString('en-US')}</td>
              <td>{x.weightG === null ? '–' : formatWeight(x.weightG, weightUnit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.warnings.map((w) => (
        <p key={w} className="muted">
          {w}
        </p>
      ))}
      <p className="muted">Importing replaces the products above. Results stay as they are until you press Optimize.</p>
      <div className="pactions">
        <button type="button" className="add" onClick={onApply}>
          Replace products
        </button>
        <button type="button" className="add" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

