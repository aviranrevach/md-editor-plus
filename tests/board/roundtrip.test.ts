import { parseBoardSource, serializeBoard } from '../../src/webview/boardModel';

const FIXTURES: { name: string; source: string }[] = [
  {
    name: 'full board with bodies',
    source: [
      `<!-- board:start id="b-a3f2" name="Sprint 12" columns="Todo|Doing|Done" column-colors="blue|amber|emerald" field-types="Title=text,Status=status,Owner=person,Due=date,Tags=tags,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | Owner | Due | Tags | id |`,
      `|---|---|---|---|---|---|`,
      `| Build the kanban block | Doing | @aviran | 2026-06-01 | feature, editor | c1 |`,
      `| Write round-trip tests | Todo |  |  | tests | c2 |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `## Goal`,
      `Add the table + comment parser, render the board view, support drag-drop.`,
      ``,
      `- subtask 1`,
      `- subtask 2`,
      ``,
      `<!-- board:body id="c2" -->`,
      ``,
      `Brief notes for c2.`,
      ``,
      `<!-- board:end -->`,
    ].join('\n'),
  },
  {
    name: 'empty board (no cards)',
    source: [
      `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status" -->`,
      ``,
      `| Title | Status |`,
      `|---|---|`,
      ``,
      `<!-- board:end -->`,
    ].join('\n'),
  },
  {
    name: 'board with table view',
    source: [
      `<!-- board:start id="b1" name="X" columns="Todo|Doing" column-colors="blue|amber" field-types="Title=text,Status=status,id=text" hidden-fields="id" active-view="table" -->`,
      `<!-- board:view name="table" columns="Title,Status" hidden="id" sort="Title,asc" group="Status" widths="Status=100,Title=200" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| A | Todo | c1 |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n'),
  },
];

describe('board source round-trip', () => {
  for (const fix of FIXTURES) {
    it(`parse(serialize(parse(x))) deep-equals parse(x): ${fix.name}`, () => {
      const a = parseBoardSource(fix.source);
      const b = parseBoardSource(serializeBoard(a));
      expect(b).toEqual(a);
    });
  }

  it('bare board:view round-trips stably (current behavior: bare view is preserved by serializer)', () => {
    // A view with only a name and no other attrs is "meaninglessly empty" from
    // pruneView's perspective, but pruneView only runs when an op is called.
    // The serializer emits it as-is; parse re-creates the same object.
    const md1 = [
      `<!-- board:start id="b1" columns="Todo" column-colors="blue" field-types="Title=text,Status=status" -->`,
      `<!-- board:view name="table" -->`,
      ``,
      `| Title | Status |`,
      `|---|---|`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const parsed1 = parseBoardSource(md1);
    expect(parsed1.views).toHaveLength(1);
    expect(parsed1.views[0]).toEqual({ name: 'table' });

    const md2 = serializeBoard(parsed1);
    // Serializer re-emits the bare view block.
    expect(md2).toContain('<!-- board:view name="table" -->');

    const parsed2 = parseBoardSource(md2);
    // parse(serialize(parse(md1))) deep-equals parse(md1)
    expect(parsed2).toEqual(parsed1);
  });

  it('preserves orphan board:body blocks on round-trip', () => {
    const source = [
      `<!-- board:start id="b1" -->`,
      ``,
      `| id | Title | Status |`,
      `|---|---|---|`,
      `| c1 | First | Todo |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `Body for c1`,
      ``,
      `<!-- board:body id="ghost" -->`,
      ``,
      `Body for a deleted card`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');
    const a = parseBoardSource(source);
    const out = serializeBoard(a);
    expect(out).toContain('<!-- board:body id="ghost" -->');
    expect(out).toContain('Body for a deleted card');
  });
});
