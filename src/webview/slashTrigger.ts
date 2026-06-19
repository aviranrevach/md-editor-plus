/**
 * Decide whether a plain "/" keystroke should open the block picker.
 * True only on a completely empty text block with a collapsed selection,
 * so "/" typed mid-text (e.g. "and/or", paths, dates) is never hijacked.
 */
export function slashShouldOpenPicker(blockText: string, selectionEmpty: boolean): boolean {
  return blockText === '' && selectionEmpty;
}
