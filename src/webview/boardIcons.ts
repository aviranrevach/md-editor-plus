// src/webview/boardIcons.ts
// Inline SVG strings shared across the board UI. 16x16 viewBox by default;
// caller controls size via the container.
import type { FieldType } from './boardModel';

export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  text:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M3 4h10M3 8h10M3 12h7"/>
    </svg>`,
  status:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>
    </svg>`,
  date:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1"/>
      <path d="M2.5 6.5h11M5.5 2v2M10.5 2v2"/>
    </svg>`,
  person:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="8" cy="6" r="2.5"/>
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
    </svg>`,
  tags:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M3 6h10M3 10h10M6 3v10M10 3v10"/>
    </svg>`,
  image:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1"/>
      <circle cx="6" cy="6.5" r="1"/>
      <path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2"/>
    </svg>`,
};

export const ICON_PLUS =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M8 3v10M3 8h10"/>
  </svg>`;

export const ICON_CLOSE =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M4 4l8 8M12 4l-8 8"/>
  </svg>`;

export const ICON_CHEVRON_DOWN =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M4 6l4 4 4-4"/>
  </svg>`;

export const ICON_CHECK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8l3 3 7-7"/>
  </svg>`;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  status: 'Status',
  date: 'Date',
  person: 'Person',
  tags: 'Tags',
  image: 'Image',
};
