const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  trace: '<path d="M5 5v14"/><path d="m9 9 4 3-4 3z" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2.4 6"/><path d="M4 4v6h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.4 2.4 0 1 1 3.9 1.9c-1 .8-1.5 1.3-1.5 2.6"/><path d="M12 17h.01"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  blocks: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  terminal: '<path d="M4 5h16v14H4z"/><path d="m8 10 3 2-3 2M13 14h3"/>',
  warning: '<path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M6 3v18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.4 6"/><path d="M20 4v7h-7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowUp: '<path d="M12 20V4M5 11l7-7 7 7"/>',
  arrowDown: '<path d="M12 4v16M5 13l7 7 7-7"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 16): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span;
}
