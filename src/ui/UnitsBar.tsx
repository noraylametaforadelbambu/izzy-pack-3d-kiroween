import { UNITS, type Unit } from '../core/units'
import { WEIGHT_UNITS, type WeightUnit } from '../core/weight'

interface Props {
  unit: Unit
  weightUnit: WeightUnit
  onUnit: (u: Unit) => void
  onWeightUnit: (u: WeightUnit) => void
}

/** One length unit and one weight unit for the whole app (products, boxes, results, report). */
export function UnitsBar({ unit, weightUnit, onUnit, onWeightUnit }: Props) {
  return (
    <div className="unitsbar">
      <div className="seg" role="radiogroup" aria-label="Unit">
        {UNITS.map((u) => (
          <button key={u} type="button" role="radio" aria-checked={unit === u} className={unit === u ? 'on' : undefined} onClick={() => onUnit(u)}>
            {u}
          </button>
        ))}
      </div>
      <div className="seg" role="radiogroup" aria-label="Weight unit">
        {WEIGHT_UNITS.map((u) => (
          <button key={u} type="button" role="radio" aria-checked={weightUnit === u} className={weightUnit === u ? 'on' : undefined} onClick={() => onWeightUnit(u)}>
            {u}
          </button>
        ))}
      </div>
    </div>
  )
}
