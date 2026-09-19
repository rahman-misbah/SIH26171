// §5.1's accessible_name resolution order: aria-labelledby, label[for],
// wrapping <label>, alt, title. Only used to check *presence* (Phase A reads
// no text) -- the actual value is re-derived in Phase B (§5.2).

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

export function resolveAccessibleName(el: Element, doc: Document): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(doc.getElementById(id)))
      .filter((t) => t !== '')
      .join(' ');
    if (text !== '') return text;
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim() !== '') return ariaLabel.trim();

  if (el.id !== '') {
    const forLabel = doc.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`);
    const text = textOf(forLabel);
    if (text !== '') return text;
  }

  const wrappingLabel = el.closest('label');
  if (wrappingLabel) {
    const text = textOf(wrappingLabel);
    if (text !== '') return text;
  }

  const alt = el.getAttribute('alt');
  if (alt && alt.trim() !== '') return alt.trim();

  const title = el.getAttribute('title');
  if (title && title.trim() !== '') return title.trim();

  return '';
}
