/**
 * @jest-environment jsdom
 */
import { flattenMarkdownLines, flattenMarkdownToInline } from '../src/webview/boardBodyPreview';
import { renderInlineMarkdown } from '../src/webview/boardInlineRender';

// c9: pasting into a card's description looked right in the side panel but showed
// raw markup in the board's table view. The panel is a full BLOCK editor; the
// board previews render inline markdown only, so every block construct was
// printed as literal syntax. These pin the block layer being flattened away
// while inline marks survive for renderInlineMarkdown to paint.

describe('flattenMarkdownToInline — block constructs', () => {
  test('fenced code block becomes inline code, no ``` delimiters', () => {
    const out = flattenMarkdownToInline('```js\nconst a = 1;\nconst b = 2;\n```');
    expect(out).toBe('`const a = 1; const b = 2;`');
    expect(out).not.toContain('```');
  });

  test('tilde fence is handled too', () => {
    expect(flattenMarkdownToInline('~~~\nplain\n~~~')).toBe('`plain`');
  });

  test('unterminated fence still shows its content', () => {
    expect(flattenMarkdownToInline('```\ndangling')).toBe('`dangling`');
  });

  test('text around a fence is kept in order', () => {
    expect(flattenMarkdownToInline('before\n```\ncode\n```\nafter')).toBe('before • `code` • after');
  });

  test('headings lose their #s', () => {
    expect(flattenMarkdownToInline('# Title\n## Sub')).toBe('Title • Sub');
  });

  test('closed ATX heading drops trailing #s', () => {
    expect(flattenMarkdownToInline('## Middle ##')).toBe('Middle');
  });

  test('bullet lists lose their markers', () => {
    expect(flattenMarkdownToInline('- one\n* two\n+ three')).toBe('one • two • three');
  });

  test('ordered lists lose their numbers', () => {
    expect(flattenMarkdownToInline('1. first\n2) second')).toBe('first • second');
  });

  test('task items lose bullet and checkbox', () => {
    expect(flattenMarkdownToInline('- [ ] todo\n- [x] done')).toBe('todo • done');
  });

  test('blockquotes lose their >', () => {
    expect(flattenMarkdownToInline('> quoted\n>> nested')).toBe('quoted • nested');
  });

  test('thematic breaks are dropped entirely', () => {
    expect(flattenMarkdownToInline('a\n---\nb')).toBe('a • b');
    expect(flattenMarkdownToInline('***')).toBe('');
  });

  test('table renders cells, drops pipes and the separator row', () => {
    const md = '| Name | Qty |\n| --- | --- |\n| Bolt | 4 |';
    expect(flattenMarkdownToInline(md)).toBe('Name • Qty • Bolt • 4');
  });

  test('aligned table separator is dropped', () => {
    expect(flattenMarkdownToInline('| a |\n|:---:|\n| b |')).toBe('a • b');
  });

  test('blank lines collapse rather than leaving empty segments', () => {
    expect(flattenMarkdownToInline('one\n\n\ntwo')).toBe('one • two');
  });
});

describe('flattenMarkdownToInline — pasted block HTML', () => {
  test('block tags are unwrapped, text kept', () => {
    expect(flattenMarkdownToInline('<p>para</p><div>divvy</div>')).toBe('para • divvy');
  });

  test('<br> becomes a line break', () => {
    expect(flattenMarkdownToInline('top<br>bottom')).toBe('top • bottom');
  });

  test('list HTML is unwrapped', () => {
    expect(flattenMarkdownToInline('<ul><li>a</li><li>b</li></ul>')).toBe('a • b');
  });

  test('heading HTML with attributes is unwrapped', () => {
    expect(flattenMarkdownToInline('<h2 class="x">Head</h2>')).toBe('Head');
  });

  test('HTML comments are dropped, including board markers', () => {
    expect(flattenMarkdownToInline('<!-- board:body id="c1" -->keep')).toBe('keep');
  });

  test('multi-line comment cannot leak a stray -->', () => {
    const out = flattenMarkdownToInline('<!--\nhidden\n-->visible');
    expect(out).toBe('visible');
    expect(out).not.toContain('-->');
  });
});

describe('flattenMarkdownToInline — inline marks survive', () => {
  test('bold/italic/code markers are left for the inline renderer', () => {
    expect(flattenMarkdownToInline('# **bold** and *it* and `c`')).toBe('**bold** and *it* and `c`');
  });

  test('a markdown image in a list survives intact', () => {
    expect(flattenMarkdownToInline('- ![alt](img.png)')).toBe('![alt](img.png)');
  });

  test('an inline span keeps its markup', () => {
    const md = '> <span style="color: red">hi</span>';
    expect(flattenMarkdownToInline(md)).toBe('<span style="color: red">hi</span>');
  });

  test('emphasis at line start is not eaten as a bullet', () => {
    // `*bold*` must survive — only `* ` (marker + space) is a bullet.
    expect(flattenMarkdownToInline('*emph* text')).toBe('*emph* text');
  });
});

describe('flattenMarkdownToInline — edges', () => {
  test('empty and whitespace bodies produce nothing', () => {
    expect(flattenMarkdownToInline('')).toBe('');
    expect(flattenMarkdownToInline('   \n\n  ')).toBe('');
  });

  test('maxLength truncates', () => {
    expect(flattenMarkdownToInline('abcdefghij', 4)).toBe('abcd');
  });

  test('plain prose is untouched', () => {
    expect(flattenMarkdownToInline('just a sentence.')).toBe('just a sentence.');
  });
});

// The real fix is the PAIR: flatten the block layer, then render the inline
// layer. These assert the end-to-end result a user sees in a Description cell —
// no angle brackets, no backtick fences, no markdown syntax left as text.
describe('flatten + renderInlineMarkdown — nothing renders as raw markup (c9)', () => {
  function preview(body: string): HTMLElement {
    const td = document.createElement('td');
    renderInlineMarkdown(td, flattenMarkdownToInline(body, 200));
    return td;
  }

  test('a rich HTML paste shows clean text with real bold', () => {
    const td = preview('<div><p>Steps:</p><ul><li>Open the <b>board</b></li><li>Paste</li></ul></div>');
    expect(td.textContent).toBe('Steps: • Open the board • Paste');
    expect(td.querySelector('b')).not.toBeNull();
    expect(td.textContent).not.toContain('<');
  });

  test('a pasted code block shows the code, not the fence', () => {
    const td = preview('The call:\n\n```ts\nconst a = 1;\n```\n\nbreaks.');
    expect(td.querySelector('code')!.textContent).toBe('const a = 1;');
    expect(td.textContent).not.toContain('```');
  });

  test('a resized image renders as a thumbnail, not a tag', () => {
    const td = preview('See <img src="shot.png" width="420" /> here.');
    expect(td.querySelector('img')).not.toBeNull();
    expect(td.textContent).not.toContain('<img');
    expect(td.textContent).not.toContain('width=');
  });

  test('a heading + task list reads as plain text', () => {
    const td = preview('## Plan\n\n- [x] reproduce\n- [ ] fix');
    expect(td.textContent).toBe('Plan • reproduce • fix');
  });

  test('a markdown table reads as its cell values', () => {
    const td = preview('| Size | File |\n| --- | --- |\n| 9.2G | ~/Desktop |');
    expect(td.textContent).toBe('Size • File • 9.2G • ~/Desktop');
    expect(td.textContent).not.toContain('|');
  });

  test('a blockquote + image body keeps the text and shows the image', () => {
    const td = preview('a diff idea.\n\n> note here\n\n![shot](x/y.png)');
    expect(td.textContent).toBe('a diff idea. • note here • ');
    expect(td.querySelector('img')).not.toBeNull();
  });

  test('script tags in a pasted body never become elements', () => {
    const td = preview('<div><script>alert(1)</script>safe</div>');
    expect(td.querySelector('script')).toBeNull();
    expect(td.textContent).toContain('safe');
  });
});

describe('flattenMarkdownLines — maxLines (kanban preview)', () => {
  test('returns only the first content line', () => {
    expect(flattenMarkdownLines('# Heading\nbody text', { maxLines: 1 })).toEqual(['Heading']);
  });

  test('skips leading blank / structure-only lines', () => {
    expect(flattenMarkdownLines('\n---\n\n- real', { maxLines: 1 })).toEqual(['real']);
  });

  test('no options returns every content line', () => {
    expect(flattenMarkdownLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  test('empty body returns an empty list', () => {
    expect(flattenMarkdownLines('')).toEqual([]);
  });
});
