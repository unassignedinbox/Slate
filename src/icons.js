// Lucide icon nodes -> SVG strings / DOM elements.
import { icons } from 'lucide';

function attrsToString(attrs = {}) {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');
}

function nodeToMarkup(node) {
  if (!node) return '';
  const [tag, attrs = {}, children = []] = node;
  const inner = children.map(nodeToMarkup).join('');
  return `<${tag} ${attrsToString(attrs)}>${inner}</${tag}>`;
}

/** SVG markup for a lucide icon name, e.g. svgIcon('camera', 18). */
export function svgIcon(name, size = 16, extraClass = '') {
  const icon = icons[name];
  if (!icon) return `<svg width="${size}" height="${size}"></svg>`;
  const [tag, attrs, children] = icon;
  const merged = { ...attrs, width: size, height: size, class: extraClass || undefined };
  return nodeToMarkup([tag, merged, children]);
}

/** DOM element for a lucide icon name. */
export function iconEl(name, size = 16, className = '') {
  const wrap = document.createElement('span');
  wrap.className = `icon-wrap ${className}`.trim();
  wrap.style.display = 'inline-flex';
  wrap.innerHTML = svgIcon(name, size);
  return wrap;
}
