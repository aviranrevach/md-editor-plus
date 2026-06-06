/**
 * @jest-environment jsdom
 *
 * End-to-end regression test for the board markdown round-trip:
 *
 *   raw markdown
 *     → preprocessMarkdownBoards
 *     → markdown-it (same config tiptap-markdown uses)
 *     → DOMParser (real browser HTML parsing via jsdom)
 *     → <div data-board source="..."> in the DOM
 *     → parseBoardSource on the recovered source
 *     → Board with all cards present
 *
 * Catches the bug where multi-line content in the source attribute caused
 * markdown-it to terminate the HTML block at a blank line, breaking the div
 * and silently losing all card data on file reopen.
 */

import markdownit from 'markdown-it';
import { preprocessMarkdownBoards } from '../../src/webview/extensions/board';
import { parseBoardSource } from '../../src/webview/boardModel';

// Match tiptap-markdown's MarkdownParser config.
const md = markdownit({ html: true, linkify: false, breaks: false });

function runPipeline(rawMarkdown: string): { sourceFromDom: string | null; html: string } {
  const preprocessed = preprocessMarkdownBoards(rawMarkdown);
  const html = md.render(preprocessed);
  const dom = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    'text/html',
  );
  const div = dom.querySelector('div[data-board]');
  return { sourceFromDom: div?.getAttribute('source') ?? null, html };
}

describe('board markdown pipeline (preprocess → markdown-it → DOM)', () => {
  it('preserves cards through the full pipeline (simple 3-row board)', () => {
    const raw = [
      `<!-- board:start id="b1" name="Sprint" columns="Todo|Doing|Done" column-colors="gray|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| Draft notes | Todo | c1 |`,
      `| Polish edit | Doing | c2 |`,
      `| Ship 0.5.2 | Done | c3 |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const { sourceFromDom } = runPipeline(raw);
    expect(sourceFromDom).not.toBeNull();
    const board = parseBoardSource(sourceFromDom!);
    expect(board.cards).toHaveLength(3);
    expect(board.cards.map((c) => c.values.Status)).toEqual(['Todo', 'Doing', 'Done']);
    expect(board.cards.map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
  });

  it('preserves cards in a many-row board with multi-word column names', () => {
    const raw = [
      `<!-- board:start id="b2" name="Roadmap" columns="Backlog|Up Next|In Progress|Shipped" column-colors="gray|blue|amber|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| First | Backlog | r1 |`,
      `| Second | Up Next | r2 |`,
      `| Third | In Progress | r3 |`,
      `| Fourth | Shipped | r4 |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const { sourceFromDom } = runPipeline(raw);
    expect(sourceFromDom).not.toBeNull();
    const board = parseBoardSource(sourceFromDom!);
    expect(board.cards).toHaveLength(4);
    expect(board.cards.map((c) => c.values.Status)).toEqual([
      'Backlog', 'Up Next', 'In Progress', 'Shipped',
    ]);
  });

  it('preserves two boards in the same file', () => {
    const raw = [
      `<!-- board:start id="a" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| One | Todo | a1 |`,
      ``,
      `<!-- board:end -->`,
      ``,
      `Some prose between boards.`,
      ``,
      `<!-- board:start id="b" columns="Planning|Released" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| Two | Planning | b1 |`,
      `| Three | Released | b2 |`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const preprocessed = preprocessMarkdownBoards(raw);
    const html = md.render(preprocessed);
    const dom = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      'text/html',
    );
    const divs = dom.querySelectorAll('div[data-board]');
    expect(divs).toHaveLength(2);

    const a = parseBoardSource(divs[0].getAttribute('source')!);
    const b = parseBoardSource(divs[1].getAttribute('source')!);
    expect(a.cards).toHaveLength(1);
    expect(b.cards).toHaveLength(2);
  });

  it('preserves board:body blocks alongside the table', () => {
    const raw = [
      `<!-- board:start id="b1" columns="Todo|Done" column-colors="blue|emerald" field-types="Title=text,Status=status,id=text" hidden-fields="id" -->`,
      ``,
      `| Title | Status | id |`,
      `|---|---|---|`,
      `| With body | Todo | c1 |`,
      ``,
      `<!-- board:body id="c1" -->`,
      ``,
      `## Body heading`,
      `Some details here.`,
      ``,
      `<!-- board:end -->`,
    ].join('\n');

    const { sourceFromDom } = runPipeline(raw);
    expect(sourceFromDom).not.toBeNull();
    const board = parseBoardSource(sourceFromDom!);
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0].body).toContain('Body heading');
    expect(board.cards[0].body).toContain('Some details here');
  });
});
