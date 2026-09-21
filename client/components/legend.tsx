/** What the boxes drawn over the screenshot mean. */
export function Legend() {
  return (
    <ul className="legend">
      <li className="legend__flea">Flea market</li>
      <li className="legend__trader">Trader</li>
      <li className="legend__unrecognised">Not recognised</li>
      <li className="legend__unsure">Dashed: check the match</li>
    </ul>
  );
}
