import type { BlockDef } from './blockPicker';
import { AI_TRANSFORMS, type AiTransform } from './aiTransforms';

export type ActionId = 'turn-into' | 'duplicate' | 'delete';

export interface ActionItem {
  id: ActionId;
  label: string;
}

// The three actions the dragger menu offers, in display order.
export const BLOCK_ACTIONS: ActionItem[] = [
  { id: 'turn-into', label: 'Turn into' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'delete',    label: 'Delete' },
];

// Flatten BLOCK_DEFS into the set of "turn into" targets:
//  - a def with its own convert() is a target
//  - a def with subItems contributes each sub-item that has convert()
//    (e.g. the five callout types)
// Defs that are insert-only (Toggle, Divider, Boards, Whiteboard, Image) are
// excluded — converting *into* them isn't supported, so offering them would
// silently insert a new block instead.
export function convertibleTargets(defs: BlockDef[]): BlockDef[] {
  const out: BlockDef[] = [];
  for (const def of defs) {
    if (def.subItems?.length) {
      for (const sub of def.subItems) {
        if (sub.convert) out.push(sub);
      }
    } else if (def.convert) {
      out.push(def);
    }
  }
  return out;
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.toLowerCase();
  return fields.some(f => !!f && f.toLowerCase().includes(q));
}

export interface ActionSearchResult {
  actions: ActionItem[]; // matching top-level actions
  targets: BlockDef[];   // matching flattened "turn into" targets
}

// Unified search for the action menu:
//  - empty query  -> all three actions, no flat targets (UI shows the grouped
//                    menu with "Turn into ›")
//  - non-empty    -> actions whose label matches + convert targets whose
//                    label/description/aliases match (so "h1" jumps straight
//                    to Heading 1, "warning" to a Warning callout, etc.)
export function searchBlockActions(query: string, defs: BlockDef[]): ActionSearchResult {
  const q = query.trim();
  if (!q) return { actions: BLOCK_ACTIONS, targets: [] };
  const actions = BLOCK_ACTIONS.filter(a => matches(q, a.label));
  const targets = convertibleTargets(defs).filter(
    t => matches(q, t.label, t.description, ...(t.aliases ?? [])),
  );
  return { actions, targets };
}

// The Turn-into flyout's contents: every deterministic convert target, plus
// the AI transforms that DON'T duplicate one of those targets (offering an AI
// "Table" next to the real Table converter is confusing).
export function turnIntoFlyoutItems(defs: BlockDef[]): { targets: BlockDef[]; aiItems: AiTransform[] } {
  const targets = convertibleTargets(defs);
  const deterministic = new Set(targets.map(t => t.id));
  const aiItems = AI_TRANSFORMS.filter(a => !deterministic.has(a.id));
  return { targets, aiItems };
}
