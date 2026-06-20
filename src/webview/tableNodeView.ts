// c46 — regular markdown tables rendered through a NodeView so a rail can hug
// the table's left edge (reachable row grip) without changing the content
// model. contentDOM is the real <tbody>, so markdown round-trip is unchanged.
import Table from '@tiptap/extension-table';
import { mergeAttributes } from '@tiptap/core';

export const TableWithRail = Table.extend({
  addNodeView() {
    return ({ HTMLAttributes }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mp-table';

      const rail = document.createElement('div');
      rail.className = 'mp-table-rail';
      rail.contentEditable = 'false';
      rail.setAttribute('aria-hidden', 'true');

      const table = document.createElement('table');
      const attrs = mergeAttributes(HTMLAttributes);
      for (const [k, v] of Object.entries(attrs)) {
        if (v != null) table.setAttribute(k, String(v));
      }
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);

      wrapper.appendChild(rail);
      wrapper.appendChild(table);

      return {
        dom: wrapper,
        contentDOM: tbody,
        ignoreMutation(mutation) {
          const t = mutation.target as Node;
          // Keep rail chrome mutations out of ProseMirror.
          return t === rail || rail.contains(t);
        },
      };
    };
  },
});

export default TableWithRail;
