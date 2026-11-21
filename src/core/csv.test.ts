import { describe, expect, it } from 'vitest'
import { MAX_TYPES, rowLabel, rowsFromProducts, validateRows } from './boxTypes'
import {
  CSV_MAX_BYTES,
  CSV_MAX_NAME,
  CSV_MAX_UNITS,
  TEMPLATE_FILENAME,
  parseProductsCsv,
  productsTemplate,
  type CsvIssue,
  type CsvResult,
} from './csv'
import { problems } from './layoutProblems'
import { UNITS } from './units'
import { WEIGHT_UNITS } from './weight'
import { optimizeWeighted } from './weighted'

const HEAD = 'name,length_mm,width_mm,height_mm,quantity,weight_g'
const ok = (r: CsvResult) => {
  if (!r.ok) throw new Error(`expected a valid file, got: ${JSON.stringify(r.errors)}`)
  return r
}
const bad = (r: CsvResult): CsvIssue[] => {
  expect(r.ok).toBe(false)
  return r.ok ? [] : r.errors
}
const msg = (i: CsvIssue): string => `${i.row}:${i.column}:${i.message}`

describe('template', () => {
  it('imports cleanly in every unit combination and means the same products', () => {
    for (const u of UNITS) {
      for (const w of WEIGHT_UNITS) {
        const r = ok(parseProductsCsv(productsTemplate(u, w)))
        expect(r.products).toHaveLength(2)
        expect(r.warnings).toEqual([])
        const [a, b] = r.products
        expect(a.name).toBe('Product A')
        expect(a.dims.l).toBeCloseTo(220, 1)
        expect(a.dims.w).toBeCloseTo(150, 1)
        expect(a.dims.h).toBeCloseTo(90, 1)
        expect(a.qty).toBe(10)
        expect(a.weightG).toBeCloseTo(450, w === 'g' ? 6 : 0)
        expect(b.weightG).toBeNull() // the blank cell is allowed
        expect(r.totalUnits).toBe(30)
      }
    }
  })
  it('names the unit in every measure header and has a fixed file name', () => {
    expect(productsTemplate('cm', 'lb').split('\r\n')[0]).toBe('name,length_cm,width_cm,height_cm,quantity,weight_lb')
    expect(productsTemplate('mm', 'g').split('\r\n')[0]).toBe(HEAD)
    expect(TEMPLATE_FILENAME).toMatch(/\.csv$/)
  })
})

describe('valid files', () => {
  it('reads a simple file and converts to mm and grams', () => {
    const r = ok(parseProductsCsv(`${HEAD}\nBox A,220,150,90,10,450\nBox B,100,100,100,5,\n`))
    expect(r.products).toEqual([
      { row: 2, name: 'Box A', dims: { l: 220, w: 150, h: 90 }, qty: 10, weightG: 450 },
      { row: 3, name: 'Box B', dims: { l: 100, w: 100, h: 100 }, qty: 5, weightG: null },
    ])
  })
  it('converts cm, in, kg and lb exactly', () => {
    const r = ok(parseProductsCsv('name,length_cm,width_in,height_mm,quantity,weight_lb\nX,22,1,50,3,2\n'))
    expect(r.products[0].dims).toEqual({ l: 220, w: 25.4, h: 50 })
    expect(r.products[0].weightG).toBeCloseTo(907.18474, 9)
    expect(ok(parseProductsCsv('name,length_mm,width_mm,height_mm,quantity,weight_kg\nX,1,1,1,1,0.25\n')).products[0].weightG).toBe(250)
  })
  it('does not need the weight column, and accepts any column order and header style', () => {
    const r = ok(parseProductsCsv('Quantity,HEIGHT (mm),Product,Width [mm],Length mm\n7,30,Thing,20,10\n'))
    expect(r.products[0]).toMatchObject({ name: 'Thing', qty: 7, dims: { l: 10, w: 20, h: 30 }, weightG: null })
  })
  it('accepts weight zero', () => {
    expect(ok(parseProductsCsv(`${HEAD}\nA,1,1,1,1,0\n`)).products[0].weightG).toBe(0)
  })
  it('handles a BOM, Windows line endings, blank lines and a missing final newline', () => {
    const r = ok(parseProductsCsv(`\ufeff${HEAD}\r\n\r\nA,1,2,3,4,5\r\n\r\nB,1,2,3,4,5`))
    expect(r.products.map((p) => p.name)).toEqual(['A', 'B'])
    expect(r.products.map((p) => p.row)).toEqual([3, 5]) // the lines of the file
  })
  it('reads quoted names with commas, quotes and line breaks', () => {
    const r = ok(parseProductsCsv(`${HEAD}\n"Bottle, 1 L",1,2,3,4,5\n"The ""big"" one",1,2,3,4,5\n"two\nlines",1,2,3,4,5\n`))
    expect(r.products.map((p) => p.name)).toEqual(['Bottle, 1 L', 'The "big" one', 'two\nlines'])
  })
  it('reads semicolon and tab files, with comma decimals', () => {
    const semi = ok(parseProductsCsv('name;length_cm;width_cm;height_cm;quantity;weight_kg\nA;12,5;10;8,25;3;0,5\n'))
    expect(semi.products[0]).toMatchObject({ dims: { l: 125, w: 100, h: 82.5 }, qty: 3, weightG: 500 })
    const tab = ok(parseProductsCsv('name\tlength_mm\twidth_mm\theight_mm\tquantity\nA\t1.5\t2\t3\t4\n'))
    expect(tab.products[0].dims).toEqual({ l: 1.5, w: 2, h: 3 })
  })
  it('ignores unknown columns with a warning', () => {
    const r = ok(parseProductsCsv(`${HEAD},color\nA,1,2,3,4,5,red\n`))
    expect(r.warnings).toEqual(['Column "color" is not used and was ignored'])
  })
  it('accepts the largest sizes the model supports', () => {
    const rows = Array.from({ length: MAX_TYPES }, (_, i) => `P${i},100000,1,1,100,`)
    const r = ok(parseProductsCsv(`${HEAD}\n${rows.join('\n')}\n`))
    expect(r.products).toHaveLength(MAX_TYPES)
    expect(r.totalUnits).toBe(800)
  })
})

describe('errors are listed by row and nothing is accepted', () => {
  it('reports each bad cell with its line and column', () => {
    const e = bad(parseProductsCsv(`${HEAD}\nA,10,abc,5,2,\nB,0,5,5,2,\nC,5,5,-3,2,\nD,5,5,5,0,\nE,5,5,5,1.5,\nF,5,5,5,,\nG,5,5,5,2,x\n`))
    expect(e.map(msg)).toEqual([
      '2:width_mm:is not a plain number (digits and one decimal separator only)',
      '3:length_mm:must be above 0',
      '4:height_mm:is not a plain number (digits and one decimal separator only)',
      '5:quantity:must be between 1 and 100,000',
      '6:quantity:must be a whole number such as 12',
      '7:quantity:is empty (a whole number is required)',
      '8:weight_g:is not a plain number (digits and one decimal separator only)',
    ])
  })
  it('lists several problems of the same row', () => {
    const e = bad(parseProductsCsv(`${HEAD}\n,0,0,0,0,-1\n`))
    expect(e.filter((x) => x.row === 2).map((x) => x.column)).toEqual(['name', 'length_mm', 'width_mm', 'height_mm', 'quantity', 'weight_g'])
  })
  it('never returns partial products', () => {
    const r = parseProductsCsv(`${HEAD}\nA,1,1,1,1,\nB,1,1,1,x,\nC,1,1,1,1,\n`)
    expect(r.ok).toBe(false)
    expect('products' in r).toBe(false)
  })
  it('rejects names that are empty or too long', () => {
    const e = bad(parseProductsCsv(`${HEAD}\n   ,1,1,1,1,\n${'n'.repeat(CSV_MAX_NAME + 1)},1,1,1,1,\n`))
    expect(e.map((x) => x.column)).toEqual(['name', 'name'])
  })
  it('rejects absurd sizes', () => {
    expect(msg(bad(parseProductsCsv(`${HEAD}\nA,100001,1,1,1,\n`))[0])).toBe('2:length_mm:is larger than 100 m')
    expect(bad(parseProductsCsv('name,length_cm,width_mm,height_mm,quantity\nA,10001,1,1,1\n'))[0].column).toBe('length_cm')
  })
  it('does not guess "1,500": a comma decimal in a comma file is an error', () => {
    const e = bad(parseProductsCsv(`${HEAD}\nA,"1,500",1,1,1,\n`))
    expect(e[0].message).toMatch(/write it with a dot/)
    expect(bad(parseProductsCsv('name;length_mm;width_mm;height_mm;quantity\nA;1,2,3;1;1;1\n'))[0].message).toMatch(/not a plain number/)
  })
  it('rejects scientific notation, signs and thousands separators', () => {
    for (const v of ['1e3', '+5', '1 000', '5mm', 'Infinity', 'NaN']) expect(parseProductsCsv(`${HEAD}\nA,${v},1,1,1,\n`).ok).toBe(false)
  })
  it('flags rows with more cells than the header', () => {
    const e = bad(parseProductsCsv(`${HEAD}\nA,1,1,1,1,,extra\n`))
    expect(e[0].message).toMatch(/cells/)
  })
  it('keeps the line numbers of the file when cells contain line breaks and blank lines come first', () => {
    const e = bad(parseProductsCsv(`${HEAD}\n\n"two\nlines",1,1,1,1,\nB,1,1,x,1,\n`))
    expect(e.map((x) => x.row)).toEqual([5])
  })
})

describe('header and file problems', () => {
  it('names each missing required column', () => {
    const e = bad(parseProductsCsv('name,length_mm,width_mm\nA,1,1\n'))
    expect(e.map((x) => x.message)).toEqual(['Missing column: height_mm, height_cm or height_in', 'Missing column: quantity'])
    expect(e.every((x) => x.row === 1)).toBe(true)
  })
  it('requires the unit in the header', () => {
    const e = bad(parseProductsCsv('name,length,width_mm,height_mm,quantity,weight\nA,1,1,1,1,1\n'))
    expect(e.map((x) => x.message)).toEqual([expect.stringContaining('say the unit, for example length_mm'), expect.stringContaining('say the unit, for example weight_g')])
  })
  it('rejects unknown units and repeated columns', () => {
    expect(parseProductsCsv('name,length_ft,width_mm,height_mm,quantity\nA,1,1,1,1\n').ok).toBe(false)
    expect(bad(parseProductsCsv('name,length_mm,length_cm,width_mm,height_mm,quantity\nA,1,1,1,1,1\n')).some((x) => /twice/.test(x.message))).toBe(true)
  })
  it('rejects empty files, a header without products, unclosed quotes and binary files', () => {
    expect(bad(parseProductsCsv(''))[0].message).toBe('The file is empty')
    expect(bad(parseProductsCsv('  \n \r\n'))[0].message).toBe('The file is empty')
    expect(bad(parseProductsCsv(`${HEAD}\n`))[0].message).toBe('The file has a header but no products')
    expect(bad(parseProductsCsv(`${HEAD}\n"open,1,1,1,1,\n`))[0].message).toMatch(/never closed/)
    expect(bad(parseProductsCsv(`${HEAD}\nA,1,1,1,1,\u0000\n`))[0].message).toMatch(/does not look like a text/)
  })
  it('respects the size limit of the file', () => {
    expect(bad(parseProductsCsv('x'.repeat(CSV_MAX_BYTES + 1)))[0].message).toMatch(/too large/)
  })
})

describe('model limits', () => {
  it(`allows at most ${MAX_TYPES} products and points at the first extra row`, () => {
    const rows = Array.from({ length: MAX_TYPES + 1 }, (_, i) => `P${i},1,1,1,1,`)
    const e = bad(parseProductsCsv(`${HEAD}\n${rows.join('\n')}\n`))
    expect(e).toHaveLength(1)
    expect(e[0].row).toBe(MAX_TYPES + 2)
    expect(e[0].message).toMatch(new RegExp(`at most ${MAX_TYPES}`))
  })
  it('limits the total units to what the optimizer accepts', () => {
    const rows = `A,1,1,1,${CSV_MAX_UNITS},\nB,1,1,1,1,\n`
    expect(bad(parseProductsCsv(`${HEAD}\n${rows}`))[0].message).toMatch(/limit is 100,000/)
    expect(ok(parseProductsCsv(`${HEAD}\nA,1,1,1,${CSV_MAX_UNITS},\n`)).totalUnits).toBe(CSV_MAX_UNITS)
  })
  it('limits the number of problems that are listed', () => {
    const rows = Array.from({ length: MAX_TYPES }, () => 'A,x,x,x,x,x').join('\n')
    const r = parseProductsCsv(`${HEAD}\n${rows}\n`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.length).toBeLessThanOrEqual(30)
      expect(r.truncated).toBe(true)
    }
  })
})

describe('imported products become order rows', () => {
  const csv = 'name,length_cm,width_cm,height_cm,quantity,weight_kg\nShirt box,22,15,9,12,0.4\nBook,30,20,5,8,\n'
  it('shows the sizes and weights in the selected units', () => {
    const r = ok(parseProductsCsv(csv))
    const rows = rowsFromProducts(r.products, 'in', 'lb')
    expect(rows.map((x) => x.name)).toEqual(['Shirt box', 'Book'])
    expect([rows[0].dims.l.text, rows[0].dims.w.text, rows[0].dims.h.text]).toEqual(['8.661', '5.906', '3.543'])
    expect(rows[0].qty).toBe('12')
    expect(rows[0].weight.text).toBe('0.882')
    expect(rows[1].weight.g).toBeNull()
    expect(new Set(rows.map((x) => x.id)).size).toBe(2)
    expect(new Set(rows.map((x) => x.color)).size).toBe(2)
  })
  it('keeps the physical values whatever unit they are shown in', () => {
    const r = ok(parseProductsCsv(csv))
    const asMm = validateRows(rowsFromProducts(r.products, 'mm', 'g'))
    const asIn = validateRows(rowsFromProducts(r.products, 'in', 'lb'))
    expect('types' in asMm && 'types' in asIn).toBe(true)
    if ('types' in asMm && 'types' in asIn) {
      expect(asMm.types[0].dims).toEqual({ l: 220, w: 150, h: 90 })
      expect(asIn.types[0].dims.l).toBeCloseTo(220, 9)
      expect(asMm.types[0].weightKg).toBeCloseTo(0.4, 9)
      expect(asMm.types.map((t) => t.qty)).toEqual([12, 8])
    }
  })
  it('labels rows by name, falling back to "Type n"', () => {
    expect(rowLabel({ name: 'Shirt box' }, 0)).toBe('Shirt box')
    expect(rowLabel({ name: '  ' }, 2)).toBe('Type 3')
  })
  it('imported products can be optimized straight away', () => {
    const r = ok(parseProductsCsv(csv))
    const v = validateRows(rowsFromProducts(r.products, 'mm', 'g'))
    if (!('types' in v)) throw new Error('rows should be valid')
    const box = { l: 600, w: 400, h: 400 }
    const res = optimizeWeighted(box, v.types, { emptyG: 300, maxG: 20_000 })
    expect(res.status).toBe('complete')
    expect(res.layout.placedCount).toBe(20)
    expect(problems(box, res.layout.placements)).toEqual([])
    expect(res.weight.productG).toBeCloseTo(12 * 400, 6)
  })
})
