/** Product pictograms shown on the boxes in the 3D view. Only products that come with one (the sample order) have it. */
export type PictogramKind = 'skull' | 'candle' | 'pumpkin'

export const PICTOGRAM_KINDS: readonly PictogramKind[] = ['skull', 'candle', 'pumpkin']

/** Accessible name of each pictogram (used for the small icon next to a product in "Your order"). */
export const PICTOGRAM_LABELS: Readonly<Record<PictogramKind, string>> = {
  skull: 'Skull',
  candle: 'Black candle',
  pumpkin: 'Jack-o’-lantern',
}
