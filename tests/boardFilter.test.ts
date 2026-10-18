import { applyFilter, EMPTY_VALUE, type FilterState } from '../src/webview/boardFilter';
import type { Board, Card, FieldDef } from '../src/webview/boardModel';

function field(name: string, type: FieldDef['type']): FieldDef {
  return { name, type, visibleOnCard: true };
}
function card(id: string, values: Record<string, string>): Card {
  return { id, values, body: '' };
}
function board(fields: FieldDef[], cards: Card[]): Board {
  return {
    id: 'b1', name: 'B', columns: [], fields, cards,
    orphanBodies: [], views: [], activeView: 'table',
  };
}

const FIELDS = [field('Status', 'status'), field('Impact', 'status'), field('Tags', 'tags')];
const CARDS = [
  card('c1', { Status: 'Todo',  Impact: 'High', Tags: 'ui,bug' }),
  card('c2', { Status: 'Doing', Impact: 'Low',  Tags: 'bug' }),
  card('c3', { Status: 'Todo',  Impact: '',      Tags: '' }),
];
const b = board(FIELDS, CARDS);

const ids = (cs: Card[]) => cs.map((c) => c.id);

describe('applyFilter', () => {
  it('returns all cards in order for an empty filter', () => {
    expect(ids(applyFilter(CARDS, {}, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('filters a status field to one value', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo'] }, b))).toEqual(['c1', 'c3']);
  });

  it('ORs within a single field (two values)', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo', 'Doing'] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('ANDs across two active fields', () => {
    expect(ids(applyFilter(CARDS, { Status: ['Todo'], Impact: ['High'] }, b))).toEqual(['c1']);
  });

  it('matches a tag field if any tag is in the set', () => {
    expect(ids(applyFilter(CARDS, { Tags: ['bug'] }, b))).toEqual(['c1', 'c2']);
  });

  it('matches EMPTY_VALUE for cards with no value (status)', () => {
    expect(ids(applyFilter(CARDS, { Impact: [EMPTY_VALUE] }, b))).toEqual(['c3']);
  });

  it('matches EMPTY_VALUE for cards with no tags', () => {
    expect(ids(applyFilter(CARDS, { Tags: [EMPTY_VALUE] }, b))).toEqual(['c3']);
  });

  it('ORs EMPTY_VALUE with a real value', () => {
    expect(ids(applyFilter(CARDS, { Impact: ['High', EMPTY_VALUE] }, b))).toEqual(['c1', 'c3']);
  });

  it('treats a field with an empty allowed list as inactive', () => {
    expect(ids(applyFilter(CARDS, { Status: [] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('ignores an unknown field name', () => {
    expect(ids(applyFilter(CARDS, { Nope: ['x'] }, b))).toEqual(['c1', 'c2', 'c3']);
  });

  it('preserves input order (visibility only)', () => {
    const reordered = [CARDS[2], CARDS[0], CARDS[1]];
    expect(ids(applyFilter(reordered, { Status: ['Todo', 'Doing'] }, b))).toEqual(['c3', 'c1', 'c2']);
  });
});

import {
  NONE_ON, allFieldValues, onValues, toggleFilterValue, clearFilterField,
} from '../src/webview/boardFilter';

describe('filter on/off helpers', () => {
  const opts = ['Todo', 'Doing', 'Done'];
  const all = [...opts, EMPTY_VALUE];

  it('allFieldValues appends EMPTY_VALUE', () => {
    expect(allFieldValues(opts)).toEqual(['Todo', 'Doing', 'Done', EMPTY_VALUE]);
  });

  it('onValues defaults to all-on when the field has no entry', () => {
    expect([...onValues({}, 'Status', opts)].sort()).toEqual([...all].sort());
  });

  it('onValues reads the stored set and drops NONE_ON', () => {
    expect([...onValues({ Status: ['Todo'] }, 'Status', opts)]).toEqual(['Todo']);
    expect([...onValues({ Status: [NONE_ON] }, 'Status', opts)]).toEqual([]);
  });

  it('toggling one value off an all-on field stores the remaining on-set', () => {
    expect(toggleFilterValue({}, 'Status', opts, 'Done').Status!.sort())
      .toEqual(['Doing', EMPTY_VALUE, 'Todo'].sort());
  });

  it('toggling the last value on clears the field (back to all-on)', () => {
    const partial: FilterState = { Status: ['Todo'] };
    // turn every remaining value on → field becomes inactive (deleted)
    let next = toggleFilterValue(partial, 'Status', opts, 'Doing');
    next = toggleFilterValue(next, 'Status', opts, 'Done');
    next = toggleFilterValue(next, 'Status', opts, EMPTY_VALUE);
    expect(next.Status).toBeUndefined();
  });

  it('toggling the only remaining value off stores [NONE_ON]', () => {
    expect(toggleFilterValue({ Status: ['Todo'] }, 'Status', opts, 'Todo').Status)
      .toEqual([NONE_ON]);
  });

  it('toggleFilterValue does not mutate its input', () => {
    const input: FilterState = { Status: ['Todo'] };
    toggleFilterValue(input, 'Status', opts, 'Doing');
    expect(input).toEqual({ Status: ['Todo'] });
  });

  it('clearFilterField removes only the named field', () => {
    expect(clearFilterField({ Status: ['Todo'], Impact: ['High'] }, 'Status'))
      .toEqual({ Impact: ['High'] });
  });
});
