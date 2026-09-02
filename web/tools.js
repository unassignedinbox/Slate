// Tool catalogue (mirrors the real Slate bands) + a small spec describing how
// each drawing tool is placed in the viewport: how many clicks it takes and
// which kind of entity it produces.

export const BANDS = [
  { name:'2DPrimitives', tools:[
    ['Line','line'],['Polyline','polyline'],['Rectangle','rectangle'],['Circle','circle'],
    ['Arc','arc'],['Ellipse','ellipse'],['Point','point'],['Bezier','bezier'],
    ['Hermite','hermite'],['B-Spline','spline'],['Rational Spline','rspline'],
    ['Construction','construction'],['Tangent Arc','tangentarc'],['Polygon','polygon'],['Slot','slot'],
  ]},
  { name:'Operations', tools:[
    ['Fillet','fillet'],['Chamfer','chamfer'],['Trim','trim'],
    ['Extend','extend'],['Offset','offset'],['Cut','cut'],
  ]},
  { name:'Dimensions', tools:[
    ['Linear Dim.','lineardim'],['Angular Dim.','angulardim'],['Radial Dim.','radialdim'],
  ]},
  { name:'Constraints', tools:[
    ['Horizontal','horizontal'],['Vertical','vertical'],['Coincident','coincident'],
    ['Parallel','parallel'],['Perpendicular','perpendicular'],['Tangent','tangent'],
    ['Equal','equal'],['Midpoint','midpoint'],['Symmetry','symmetry'],['Concentric','concentric'],
  ]},
  { name:'Booleans', tools:[
    ['Union','union'],['Cut','boolcut'],['Intersect','intersect'],
  ]},
];

// How a given glyph draws. `clicks`: fixed number of points before it commits.
// `chain`: keeps taking points until Enter/Esc/double-click. `kind`: entity kind.
export const DRAW_SPEC = {
  line:        { kind:'line',        clicks:2 },
  point:       { kind:'point',       clicks:1 },
  rectangle:   { kind:'rectangle',   clicks:2 },
  circle:      { kind:'circle',      clicks:2 },        // centre, then radius
  ellipse:     { kind:'ellipse',     clicks:2 },        // centre, then corner
  arc:         { kind:'arc',         clicks:3 },        // start, end, bulge
  polygon:     { kind:'polygon',     clicks:2, sides:6 },// centre, then radius
  slot:        { kind:'slot',        clicks:2 },        // two ends (radius fixed)
  polyline:    { kind:'polyline',    chain:true },
  bezier:      { kind:'polyline',    chain:true, dashed:false },
  hermite:     { kind:'polyline',    chain:true },
  spline:      { kind:'polyline',    chain:true },
  rspline:     { kind:'polyline',    chain:true },
  tangentarc:  { kind:'arc',         clicks:3 },
  construction:{ kind:'line',        clicks:2, construction:true },
};

export function specFor(glyph) { return DRAW_SPEC[glyph] || null; }
export function isDrawing(glyph) { return !!DRAW_SPEC[glyph]; }
