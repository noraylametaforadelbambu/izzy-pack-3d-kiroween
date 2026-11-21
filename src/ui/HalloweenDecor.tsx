/**
 * Static Halloween decoration for the corners of the 3D view: a carved pumpkin with a lit face and two small bats.
 * Pure CSS shapes (no images, no fonts, no animation). It is decorative only: hidden from assistive technology and
 * transparent to the pointer, so it never takes clicks, drags or focus from the viewer or the controls.
 */
export function HalloweenDecor() {
  return (
    <div className="hwdecor" aria-hidden="true" data-testid="halloween-decor">
      <div className="hw-pumpkin">
        <i className="stem" />
        <i className="lobe l1" />
        <i className="lobe l3" />
        <i className="lobe l2" />
        <div className="face">
          <i className="eye a" />
          <i className="eye b" />
          <i className="nose" />
          <i className="mouth" />
        </div>
      </div>
      <span className="hw-bat b1">
        <i />
      </span>
      <span className="hw-bat b2">
        <i />
      </span>
    </div>
  )
}
