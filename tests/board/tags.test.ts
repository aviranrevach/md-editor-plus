/**
 * @jest-environment jsdom
 */

import {
  addTagOption, renameTagOption, deleteTagOption, toggleTagOnCard, getStatusOptions,
  parseBoardSource, serializeBoard, sanitizeTagName,
} from '../../src/webview/boardModel';
import type { Board } from '../../src/webview/boardModel';
import { mountTable } from '../../src/webview/boardTableRender';
import type { BoardRendererCtx } from '../../src/webview/boardBlock';
import { openFieldActionMenu } from '../../src/webview/boardProperties';
import { openStatusOptionsEditor } from '../../src/webview/boardStatusOptions';

function ctxFor(b: Board) {
  const root = document.createElement('div'); document.body.appendChild(root);
  const ref = { current: b };
  const ctx: BoardRendererCtx = {
    root,
    getBoard: () => ref.current,
    mutate: (n: Board) => { ref.current = n; },
    openSidePanel: (_id: string) => {},
    requestDelete: () => {},
    readonly: false,
  };
  return { ctx, ref };
}

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

describe('tag chip color', () => {
  it('renders each tag chip with its option color class', () => {
    const b: Board = {
      id: 'b1', name: '', columns: [{ name: 'Todo', color: 'blue' }],
      fields: [
        { name: 'Title', type: 'text', visibleOnCard: true },
        { name: 'Status', type: 'status', visibleOnCard: true },
        { name: 'Tags', type: 'tags', visibleOnCard: true,
          options: [{ name: 'backend', color: 'teal' }, { name: 'urgent', color: 'red' }] },
      ],
      cards: [{ id: 'c1', values: { id: 'c1', Title: 'A', Status: 'Todo', Tags: 'backend, urgent' }, body: '' }],
      orphanBodies: [], views: [], activeView: 'table',
    };
    const { ctx } = ctxFor(b);
    mountTable(ctx);
    const cell = ctx.root.querySelector('td[data-field="Tags"]')!;
    const chips = Array.from(cell.querySelectorAll('.bd-tag'));
    expect(chips.map(c => c.className)).toEqual([
      expect.stringContaining('color-teal'),
      expect.stringContaining('color-red'),
    ]);
  });
});

describe('tags picker', () => {
  const mk = (): Board => ({
    id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
    fields:[
      { name:'Title', type:'text', visibleOnCard:true },
      { name:'Status', type:'status', visibleOnCard:true },
      { name:'Tags', type:'tags', visibleOnCard:true,
        options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
    ],
    cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend' }, body:'' }],
    orphanBodies:[], views:[], activeView:'table',
  });

  it('clicking a tags cell opens a checklist; toggling adds/removes the tag', () => {
    const { ctx, ref } = ctxFor(mk());
    mountTable(ctx);
    (ctx.root.querySelector('td[data-field="Tags"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const pop = document.querySelector('.bd-tags-pop')!;
    const rows = Array.from(pop.querySelectorAll('.bd-tags-opt')) as HTMLElement[];
    expect(rows.length).toBe(2);
    const urgent = rows.find(r => /urgent/.test(r.textContent || ''))!;
    urgent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ref.current.cards[0].values.Tags).toBe('backend, urgent');
  });

  it('typing a new tag and creating it adds an auto-colored option and toggles it on', () => {
    const { ctx, ref } = ctxFor(mk());
    mountTable(ctx);
    (ctx.root.querySelector('td[data-field="Tags"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = document.querySelector('.bd-tags-pop input') as HTMLInputElement;
    input.value = 'deploy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const create = document.querySelector('.bd-tags-create') as HTMLElement;
    create.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const f = ref.current.fields.find(x => x.name === 'Tags')!;
    expect(f.options!.map(o => o.name)).toContain('deploy');
    expect(ref.current.cards[0].values.Tags).toBe('backend, deploy');
  });
});

describe('Edit options works for tags', () => {
  const mk = (): Board => ({
    id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
    fields:[
      { name:'Title', type:'text', visibleOnCard:true },
      { name:'Status', type:'status', visibleOnCard:true },
      { name:'Tags', type:'tags', visibleOnCard:true,
        options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
    ],
    cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' }],
    orphanBodies:[], views:[], activeView:'kanban',
  });

  it('shows "Edit options" for a tags field in the field action menu', () => {
    const b = mk();
    const a = document.createElement('button'); document.body.appendChild(a);
    openFieldActionMenu(a, b, b.fields[2], () => {});
    const labels = Array.from(document.querySelectorAll('.board-field-action-label')).map(n => n.textContent);
    expect(labels).toContain('Edit options');
  });

  it('renaming a tag via the editor migrates card values (comma-list aware)', () => {
    let latest: Board = mk();
    const a = document.createElement('button'); document.body.appendChild(a);
    openStatusOptionsEditor(a, () => latest, 'Tags', (n: Board) => { latest = n; });
    // buildOptionsEditor sets host.className = 'bd-opt-editor' (overwrites 'bd-opt-popover')
    const nameInput = document.querySelector('.bd-opt-editor .bd-opt-name') as HTMLInputElement;
    nameInput.focus(); nameInput.value = 'infra'; nameInput.dispatchEvent(new Event('blur'));
    expect(latest.fields.find(f => f.name === 'Tags')!.options!.map(o => o.name)).toEqual(['infra', 'urgent']);
    expect(latest.cards[0].values.Tags).toBe('infra, urgent');
  });
});

describe('tag name safety + rename merge', () => {
  const mk = (): Board => ({
    id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
    fields:[
      { name:'Title', type:'text', visibleOnCard:true },
      { name:'Status', type:'status', visibleOnCard:true },
      { name:'Tags', type:'tags', visibleOnCard:true,
        options:[{name:'backend',color:'teal'},{name:'urgent',color:'red'}] },
    ],
    cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'backend, urgent' }, body:'' }],
    orphanBodies:[], views:[], activeView:'kanban',
  });

  it('sanitizeTagName strips | ; , and trims', () => {
    expect(sanitizeTagName('  a|b;c,d ')).toBe('abcd');
    expect(sanitizeTagName(' ; , | ')).toBe('');
  });

  it('addTagOption strips unsafe chars and stays round-trippable', () => {
    const b = addTagOption(mk(), 'Tags', 'code|review;x');
    expect(getStatusOptions(b, 'Tags').map((o: any) => o.name)).toContain('codereviewx');
  });

  it('renameTagOption merges into an existing option instead of duplicating', () => {
    const b = renameTagOption(mk(), 'Tags', 'urgent', 'backend'); // backend already exists
    expect(getStatusOptions(b, 'Tags').map((o: any) => o.name)).toEqual(['backend']); // no dup
    expect(b.cards[0].values.Tags).toBe('backend'); // 'backend, urgent' -> both map to backend -> deduped
  });
});

describe('tags picker sanitizes created tag', () => {
  it('creating a tag with unsafe chars stores + toggles the sanitized name', () => {
    const board: Board = {
      id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
      fields:[
        { name:'Title', type:'text', visibleOnCard:true },
        { name:'Status', type:'status', visibleOnCard:true },
        { name:'Tags', type:'tags', visibleOnCard:true, options:[] },
      ],
      cards:[{ id:'c1', values:{ id:'c1', Title:'A', Status:'Todo', Tags:'' }, body:'' }],
      orphanBodies:[], views:[], activeView:'table',
    };
    const { ctx, ref } = ctxFor(board);
    mountTable(ctx);
    (ctx.root.querySelector('td[data-field="Tags"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles:true }));
    const input = document.querySelector('.bd-tags-pop input') as HTMLInputElement;
    input.value = 'a|b;c'; input.dispatchEvent(new Event('input', { bubbles:true }));
    (document.querySelector('.bd-tags-create') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles:true }));
    const f = ref.current.fields.find((x: any) => x.name === 'Tags')!;
    expect(f.options!.map((o: any) => o.name)).toEqual(['abc']);
    expect(ref.current.cards[0].values.Tags).toBe('abc'); // sanitized name toggled on, not raw
  });
});

describe('options editor popover keeps its styling class', () => {
  it('the .bd-opt-popover element retains its class after render (not overwritten)', () => {
    const { openStatusOptionsEditor } = require('../../src/webview/boardStatusOptions');
    let latest: Board = {
      id:'b1', name:'', columns:[{name:'Todo',color:'blue'}],
      fields:[
        { name:'Title', type:'text', visibleOnCard:true },
        { name:'Status', type:'status', visibleOnCard:true },
        { name:'Tags', type:'tags', visibleOnCard:true, options:[{name:'backend',color:'teal'}] },
      ],
      cards:[], orphanBodies:[], views:[], activeView:'kanban',
    };
    const a = document.createElement('button'); document.body.appendChild(a);
    openStatusOptionsEditor(a, () => latest, 'Tags', (n: Board) => { latest = n; });
    const pop = document.querySelector('.bd-opt-popover');
    expect(pop).not.toBeNull();                              // popover class survives
    expect(pop!.classList.contains('bd-opt-editor')).toBe(true); // editor class also present
  });
});
