// Strict SVG subset: no scripting, CSS, external URLs, animation or foreign HTML.
export function sanitizePatternSVG(text) {
  if (text.length > 500000) throw new Error("SVG is limited to 500 KB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("SVG document entities are not allowed.");
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    xml.querySelector("parsererror") ||
    xml.documentElement.localName !== "svg"
  )
    throw new Error("Invalid SVG document.");
  const tags = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "fill-rule",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "transform",
    "id",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "fx",
    "fy",
    "clip-path",
    "preserveAspectRatio",
  ]);
  const nodes = [
    xml.documentElement,
    ...xml.documentElement.querySelectorAll("*"),
  ];
  if (nodes.length > 5000) throw new Error("SVG is limited to 5,000 elements.");
  for (const node of nodes) {
    if (!tags.has(node.localName))
      throw new Error(
        "Unsupported SVG element: " +
          node.localName +
          ". Use paths and basic shapes.",
      );
    for (const a of [...node.attributes]) {
      if (a.name === "xmlns" && a.value === "http://www.w3.org/2000/svg")
        continue;
      if (!attrs.has(a.name))
        throw new Error(
          "Unsupported SVG attribute: " +
            a.name +
            ". Expand styles to presentation attributes first.",
        );
      if (
        /(?:javascript:|https?:|data:|@import|expression\s*\()/i.test(
          a.value,
        ) ||
        (/url\s*\(/i.test(a.value) && !/^url\(#[\w-]+\)$/.test(a.value))
      )
        throw new Error("External SVG references are not allowed.");
    }
  }
  const root = xml.documentElement;
  if (!root.getAttribute("viewBox"))
    root.setAttribute(
      "viewBox",
      `0 0 ${parseFloat(root.getAttribute("width")) || 100} ${parseFloat(root.getAttribute("height")) || 100}`,
    );
  root.setAttribute("width", "100");
  root.setAttribute("height", "100");
  return new XMLSerializer().serializeToString(xml);
}
