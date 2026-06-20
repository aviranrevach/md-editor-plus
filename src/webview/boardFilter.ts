// Pure, session-only board filter. No DOM, no vscode — unit-testable.
//
// A FilterState maps a field name to the list of values allowed for that field.
// A card is shown iff it passes EVERY active field (AND across fields); it
// passes a field if its value is in that field's allowed set (OR within a
// field). Tag fields match if ANY of the card's tags is allowed. EMPTY_VALUE
// matches a card that has no value for the field. Filtering never reorders or
// mutates cards.

import type { Board, Card } from './boardModel';

// Sentinel for "no value" — distinct from any real status/tag name (a status
// literally named "__EMPTY__" colliding is treated as negligible).
export const EMPTY_VALUE = '__EMPTY__';

export type FilterState = Record<string, string[]>;

function splitTags(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function applyFilter(cards: Card[], filter: FilterState, board: Board): Card[] {
  const active = Object.entries(filter).filter(([, vals]) => Array.isArray(vals) && vals.length > 0);
  if (active.length === 0) return cards;

  const typeByName = new Map(board.fields.map((f) => [f.name, f.type]));

  return cards.filter((card) =>
    active.every(([fieldName, allowed]) => {
      const type = typeByName.get(fieldName);
      if (type === undefined) return true; // unknown field → ignored
      if (type === 'tags') {
        const tags = splitTags(card.values[fieldName] ?? '');
        if (tags.length === 0) return allowed.includes(EMPTY_VALUE);
        return tags.some((t) => allowed.includes(t));
      }
      const val = (card.values[fieldName] ?? '').trim();
      if (val === '') return allowed.includes(EMPTY_VALUE);
      return allowed.includes(val);
    }),
  );
}

// Sentinel stored when EVERY value of a field is toggled off: a value no card
// has, so applyFilter hides every card. Distinct from EMPTY_VALUE.
export const NONE_ON = '__none__';

// All selectable values for a field = its option names + the (Empty) sentinel.
export function allFieldValues(optionNames: string[]): string[] {
  return [...optionNames, EMPTY_VALUE];
}

// The values currently ON for a field. No entry → all on (default). Otherwise
// the stored set, minus the NONE_ON sentinel.
export function onValues(
  filter: FilterState, fieldName: string, optionNames: string[],
): Set<string> {
  const raw = filter[fieldName];
  return raw === undefined
    ? new Set(allFieldValues(optionNames))
    : new Set(raw.filter((v) => v !== NONE_ON));
}

// Pure toggle of one value. Returns a new FilterState (never mutates input):
// all on → field deleted (show everything); all off → [NONE_ON] (hide all);
// otherwise the on-set is stored.
export function toggleFilterValue(
  filter: FilterState, fieldName: string, optionNames: string[], value: string,
): FilterState {
  const next: FilterState = { ...filter };
  const on = onValues(filter, fieldName, optionNames);
  if (on.has(value)) on.delete(value);
  else on.add(value);
  const all = allFieldValues(optionNames);
  if (on.size === all.length) delete next[fieldName];
  else if (on.size === 0) next[fieldName] = [NONE_ON];
  else next[fieldName] = [...on];
  return next;
}

// Pure: reset a single field (back to all-on). Never mutates input.
export function clearFilterField(filter: FilterState, fieldName: string): FilterState {
  const next: FilterState = { ...filter };
  delete next[fieldName];
  return next;
}
