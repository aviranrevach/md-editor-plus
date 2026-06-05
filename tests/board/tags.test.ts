import {
  addTagOption, renameTagOption, deleteTagOption, toggleTagOnCard, getStatusOptions,
  parseBoardSource, serializeBoard,
} from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';

function board(): Board {
  return {
    id: 'b1', name: '',
    columns: [{ name: 'Todo', color: 'blue' }],
    fields: [
      { name: 'Title', type: 'text', visibleOnCard: true },
      { name: 'Status', type: 'status', visibleOnCard: true },
      { name: 'Tags', type: 'tags', visibleOnCard: true,
        options: [{ name: 'backend', color: 'blue' }, { name: 'urgent', color: 'red' }] },
    ],
    cards: [
      { id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' },
      { id:'c2', values:{ id:'c2', Title:'B', Status:'Todo', Tags:'backend' }, body:'' },
    ],
    orphanBodies: [], views: [], activeView: 'kanban',
  };
}

describe('tag-list model helpers', () => {
  it('addTagOption appends with an auto-color default and dedupes', () => {
    const b = addTagOption(board(), 'Tags', 'deploy');
    const opts = getStatusOptions(b, 'Tags');
    expect(opts.map(o => o.name)).toEqual(['backend', 'urgent', 'deploy']);
    expect(opts[2].color).toBeTruthy();
    expect(getStatusOptions(addTagOption(b, 'Tags', 'deploy'), 'Tags')).toHaveLength(3);
  });

  it('renameTagOption renames the option and remaps it inside every card list', () => {
    const b = renameTagOption(board(), 'Tags', 'backend', 'infra');
    expect(getStatusOptions(b, 'Tags').map(o => o.name)).toEqual(['infra', 'urgent']);
    expect(b.cards[0].values.Tags).toBe('infra, urgent');
    expect(b.cards[1].values.Tags).toBe('infra');
  });

  it('deleteTagOption removes the option and strips it from card lists', () => {
    const b = deleteTagOption(board(), 'Tags', 'backend');
    expect(getStatusOptions(b, 'Tags').map(o => o.name)).toEqual(['urgent']);
    expect(b.cards[0].values.Tags).toBe('urgent');
    expect(b.cards[1].values.Tags).toBe('');
  });

  it('toggleTagOnCard adds then removes a tag for one card, preserving others', () => {
    let b = toggleTagOnCard(board(), 'Tags', 'c2', 'urgent');
    expect(b.cards[1].values.Tags).toBe('backend, urgent');
    expect(b.cards[0].values.Tags).toBe('backend, urgent');
    b = toggleTagOnCard(b, 'Tags', 'c2', 'urgent');
    expect(b.cards[1].values.Tags).toBe('backend');
  });
});

describe('tag options serialize + derive-on-load', () => {
  it('round-trips stored tag options (names + colors), including a space in a name', () => {
    const src = [
      `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status,Tag Set=tags" field-options="Tag Set=backend:teal|urgent:red" -->`,
      ``,
      `| Title | Status | Tag Set |`,
      `|---|---|---|`,
      `| A | Todo | backend, urgent |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const a = parseBoardSource(src);
    const f = a.fields.find(x => x.name === 'Tag Set')!;
    expect(f.options).toEqual([{ name: 'backend', color: 'teal' }, { name: 'urgent', color: 'red' }]);
    expect(parseBoardSource(serializeBoard(a))).toEqual(a);
  });

  it('derives a tag set from existing tag values when none is stored, auto-colored', () => {
    const src = [
      `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status,Tags=tags" -->`,
      ``,
      `| Title | Status | Tags |`,
      `|---|---|---|`,
      `| A | Todo | backend, urgent |`,
      `| B | Todo | backend |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const a = parseBoardSource(src);
    const f = a.fields.find(x => x.name === 'Tags')!;
    expect(f.options!.map(o => o.name)).toEqual(['backend', 'urgent']); // first-seen order
    expect(f.options!.every(o => typeof o.color === 'string')).toBe(true);
    expect(parseBoardSource(serializeBoard(a))).toEqual(a);
  });
});
