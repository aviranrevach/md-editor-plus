/**
 * @jest-environment jsdom
 */
import { renderInlineMarkdown } from '../src/webview/boardInlineRender';

function render(value: string): HTMLElement {
  const host = document.createElement('div');
  renderInlineMarkdown(host, value);
  return host;
}

describe('renderInlineMarkdown — basic marks', () => {
  test('bold with **', () => {
    const h = render('a **bold** b');
    const strong = h.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
    expect(h.textContent).toBe('a bold b');
  });

  test('bold with __', () => {
    expect(render('__x__').querySelector('strong')!.textContent).toBe('x');
  });

  test('italic with *', () => {
    const h = render('a *italic* b');
    expect(h.querySelector('em')!.textContent).toBe('italic');
  });

  test('italic with _', () => {
    expect(render('_y_').querySelector('em')!.textContent).toBe('y');
  });

  test('strikethrough', () => {
    expect(render('~~gone~~').querySelector('s')!.textContent).toBe('gone');
  });

  test('inline code is not re-parsed', () => {
    const h = render('use `**not bold**` here');
    const code = h.querySelector('code')!;
    expect(code.textContent).toBe('**not bold**');
    expect(code.querySelector('strong')).toBeNull();
  });

  test('highlight with ==', () => {
    expect(render('==hi==').querySelector('mark')!.textContent).toBe('hi');
  });
});

describe('renderInlineMarkdown — links & images', () => {
  test('link renders an anchor with href and re-parsed inner', () => {
    const h = render('see [**docs**](https://x.test) now');
    const a = h.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://x.test');
    expect(a.querySelector('strong')!.textContent).toBe('docs');
  });

  test('image renders a thumbnail img', () => {
    const h = render('pic ![alt text](img.png) end');
    const img = h.querySelector('img')!;
    expect(img).not.toBeNull();
    expect(img.alt).toBe('alt text');
    expect(img.className).toContain('bd-inline-thumb');
  });
});

describe('renderInlineMarkdown — inline HTML (color/underline)', () => {
  test('color span keeps a whitelisted color', () => {
    const h = render('<span style="color: rgb(255, 0, 0)">red</span>');
    const span = h.querySelector('span')!;
    expect(span.textContent).toBe('red');
    expect(span.style.color).toBeTruthy();
  });

  test('background-color is allowed', () => {
    const h = render('<span style="background-color: #ff0">hl</span>');
    expect(h.querySelector('span')!.style.backgroundColor).toBeTruthy();
  });

  test('disallowed style props are dropped but text kept', () => {
    const h = render('<span style="position: fixed; color: red">x</span>');
    const span = h.querySelector('span')!;
    expect(span.style.position).toBe('');
    expect(span.style.color).toBeTruthy();
    expect(span.textContent).toBe('x');
  });

  test('underline tag', () => {
    expect(render('<u>under</u>').querySelector('u')!.textContent).toBe('under');
  });

  test('mark tag', () => {
    expect(render('<mark>m</mark>').querySelector('mark')!.textContent).toBe('m');
  });
});

describe('renderInlineMarkdown — inline HTML img & anchor (c9)', () => {
  test('<img> with width renders a thumbnail, not raw markup', () => {
    // What the editor emits for a resized image (imageMarkdown.ts).
    const h = render('pic <img src="shot.png" width="320" /> end');
    const img = h.querySelector('img')!;
    expect(img).not.toBeNull();
    expect(img.className).toContain('bd-inline-thumb');
    expect(h.textContent).not.toContain('<img');
  });

  test('<img> alt is carried over', () => {
    expect(render('<img src="a.png" alt="a shot" />').querySelector('img')!.alt).toBe('a shot');
  });

  test('<img> without a src is left as text rather than a broken image', () => {
    expect(render('<img width="10" />').querySelector('img')).toBeNull();
  });

  test('<img> onerror is never applied', () => {
    const img = render('<img src="a.png" onerror="evil()" />').querySelector('img')!;
    expect(img.getAttribute('onerror')).toBeNull();
  });

  test('<a href> renders a real anchor with re-parsed inner marks', () => {
    const a = render('<a href="https://x.test">go **now**</a>').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://x.test');
    expect(a.querySelector('strong')!.textContent).toBe('now');
  });

  test('javascript: href is dropped but the label still shows', () => {
    const a = render('[click](javascript:alert(1))').querySelector('a')!;
    expect(a.getAttribute('href')).toBeNull();
    expect(a.textContent).toBe('click');
  });

  test('javascript: href is dropped on an HTML anchor too', () => {
    const a = render('<a href="JaVaScRiPt:alert(1)">x</a>').querySelector('a')!;
    expect(a.getAttribute('href')).toBeNull();
  });

  test('relative and anchor hrefs still work', () => {
    expect(render('[a](./docs/x.md)').querySelector('a')!.getAttribute('href')).toBe('./docs/x.md');
    expect(render('[b](#section)').querySelector('a')!.getAttribute('href')).toBe('#section');
    expect(render('[c](mailto:a@b.test)').querySelector('a')!.getAttribute('href')).toBe('mailto:a@b.test');
  });
});

describe('renderInlineMarkdown — safety & robustness', () => {
  test('never uses innerHTML to inject script-like content', () => {
    const h = render('<script>alert(1)</script> hi');
    expect(h.querySelector('script')).toBeNull();
    expect(h.textContent).toContain('hi');
  });

  test('img onerror attribute from document is not honored', () => {
    const h = render('<span style="color:red" onclick="evil()">x</span>');
    const span = h.querySelector('span')!;
    expect(span.getAttribute('onclick')).toBeNull();
  });

  test('unmatched delimiter falls through as literal text', () => {
    const h = render('a ** b');
    expect(h.textContent).toBe('a ** b');
    expect(h.querySelector('strong')).toBeNull();
  });

  test('snake_case is not italicized (intra-word underscore)', () => {
    const h = render('field my_var_name here');
    expect(h.querySelector('em')).toBeNull();
    expect(h.textContent).toBe('field my_var_name here');
  });

  test('underscore italic still works at word boundaries', () => {
    expect(render('a _italic_ b').querySelector('em')!.textContent).toBe('italic');
  });

  test('plain text with no markup', () => {
    const h = render('just plain text');
    expect(h.textContent).toBe('just plain text');
    expect(h.children.length).toBe(0);
  });

  test('empty string renders nothing', () => {
    const h = render('');
    expect(h.textContent).toBe('');
  });

  test('nested marks: bold containing italic', () => {
    const h = render('**bold _and italic_**');
    const strong = h.querySelector('strong')!;
    expect(strong.querySelector('em')!.textContent).toBe('and italic');
  });
});
