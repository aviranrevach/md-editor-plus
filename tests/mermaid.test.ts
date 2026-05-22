import { mermaidBlockToMarkdown, isMermaidFence, preprocessMermaidBlocks } from '../src/webview/extensions/mermaidBlock';

describe('mermaid fence detection', () => {
  it('detects a simple mermaid fence', () => {
    expect(isMermaidFence('```mermaid')).toBe(true);
  });

  it('detects with trailing whitespace', () => {
    expect(isMermaidFence('```mermaid   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMermaidFence('```Mermaid')).toBe(true);
    expect(isMermaidFence('```MERMAID')).toBe(true);
  });

  it('rejects non-mermaid code fences', () => {
    expect(isMermaidFence('```javascript')).toBe(false);
    expect(isMermaidFence('```')).toBe(false);
    expect(isMermaidFence('```python')).toBe(false);
  });

  it('rejects regular text containing mermaid', () => {
    expect(isMermaidFence('mermaid diagram')).toBe(false);
    expect(isMermaidFence('some ```mermaid inline')).toBe(false);
  });
});

describe('mermaid markdown serialization', () => {
  it('serializes code back to a mermaid fenced block', () => {
    const code = 'graph TD\n    A --> B';
    expect(mermaidBlockToMarkdown(code)).toBe(
      '```mermaid\ngraph TD\n    A --> B\n```\n'
    );
  });

  it('handles empty code', () => {
    expect(mermaidBlockToMarkdown('')).toBe('```mermaid\n\n```\n');
  });

  it('preserves multiline content', () => {
    const code = 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi';
    const result = mermaidBlockToMarkdown(code);
    expect(result).toBe(
      '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n```\n'
    );
  });
});

describe('mermaid preprocessing', () => {
  it('converts a mermaid fence to a data-mermaid-block div', () => {
    const input = '```mermaid\ngraph TD\n    A --> B\n```';
    const result = preprocessMermaidBlocks(input);
    expect(result).toContain('data-mermaid-block');
    expect(result).toContain('data-code=');
    expect(result).toContain('graph TD');
    expect(result).toContain('A --&gt; B');
  });

  it('leaves non-mermaid code fences untouched', () => {
    const input = '```javascript\nconst x = 1;\n```';
    const result = preprocessMermaidBlocks(input);
    expect(result).toBe(input);
  });

  it('handles multiple mermaid blocks', () => {
    const input = [
      '# Title',
      '',
      '```mermaid',
      'graph TD',
      '    A --> B',
      '```',
      '',
      'Some text',
      '',
      '```mermaid',
      'sequenceDiagram',
      '    Alice->>Bob: Hi',
      '```',
    ].join('\n');
    const result = preprocessMermaidBlocks(input);
    const matches = result.match(/data-mermaid-block/g);
    expect(matches).toHaveLength(2);
    // Non-mermaid content should be preserved
    expect(result).toContain('# Title');
    expect(result).toContain('Some text');
  });

  it('handles mermaid block mixed with regular code', () => {
    const input = [
      '```python',
      'print("hello")',
      '```',
      '',
      '```mermaid',
      'pie title Pets',
      '    "Dogs" : 386',
      '    "Cats" : 85',
      '```',
    ].join('\n');
    const result = preprocessMermaidBlocks(input);
    // Python block should be preserved as-is
    expect(result).toContain('```python');
    expect(result).toContain('print("hello")');
    // Mermaid block should be converted
    expect(result).toContain('data-mermaid-block');
    expect(result).toContain('pie title Pets');
  });

  it('escapes special HTML characters in code attribute', () => {
    const input = '```mermaid\ngraph TD\n    A["<script>"] --> B\n```';
    const result = preprocessMermaidBlocks(input);
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('handles unclosed mermaid fence gracefully', () => {
    const input = '```mermaid\ngraph TD\n    A --> B';
    const result = preprocessMermaidBlocks(input);
    // Should still process (treat EOF as end of block)
    expect(result).toContain('data-mermaid-block');
  });

  it('encodes newlines so markdown-it does not break attribute', () => {
    const input = '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hi\n```';
    const result = preprocessMermaidBlocks(input);
    // Newlines must be encoded as &#10; to prevent markdown-it from
    // splitting the HTML block at blank/indented lines
    expect(result).not.toContain('\n    Alice');
    expect(result).toContain('&#10;');
    // The div must be a single-line HTML block
    const divLine = result.split('\n').find(l => l.includes('data-mermaid-block'));
    expect(divLine).toContain('sequenceDiagram');
    expect(divLine).toContain('Alice-&gt;&gt;Bob');
  });

  it('preserves sequence diagram with blank lines between sections', () => {
    const input = [
      '```mermaid',
      'sequenceDiagram',
      '    participant C as Consultant',
      '    participant A as Agent',
      '',
      '    C->>A: Hello<br>world',
      '    A-->>C: Done',
      '```',
    ].join('\n');
    const result = preprocessMermaidBlocks(input);
    expect(result).toContain('data-mermaid-block');
    // The blank line inside the code must become &#10;&#10; not a literal blank line
    expect(result).toContain('&#10;&#10;');
    // Entire div on one line
    const lines = result.split('\n').filter(l => l.includes('data-mermaid-block'));
    expect(lines).toHaveLength(1);
  });
});
