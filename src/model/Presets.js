/* ============================================================================
   Presets — the road taxonomy.

   A road is described by a CROSS-SECTION: an ordered list of bands running
   left -> right across the carriageway. Geometry, markings, drainage and props
   are all derived from that one list, so adding a new road type (a Dutch
   woonerf, a Tokyo roji, an Autobahn) is a data change, not a code change.

   Band fields
     k   kind        see KINDS
     w   width  (m)
     s   surface key see SURFACES
     h   height (m) above the road datum — 0 is the crown of the carriageway
     dir +1 with-stationing, -1 against, 0 bidirectional / no direction
     riser  how a height change to the *previous* band is resolved
            'curb'  vertical concrete kerb face (default)
            'slope' blended ramp (driveways, woonerf, flush paving)
            'wall'  vertical retaining wall (trenches, viaducts)
            'none'  no transition geometry (bands sit flush / don't connect)
     sec  per-band street furniture
   ========================================================================== */

/* ------------------------------------------------------------ surfaces ---- */

export const SURFACES = {
  asphalt:        { label: 'Asphalt',            base: '#3a3d42', rough: 0.86, bump: 1.0,  tile: 4.0,  kind: 'asphalt' },
  asphalt_fine:   { label: 'Fine asphalt',       base: '#464a50', rough: 0.74, bump: 0.55, tile: 3.0,  kind: 'asphalt' },
  asphalt_coarse: { label: 'Coarse asphalt',     base: '#33363b', rough: 0.93, bump: 1.5,  tile: 5.0,  kind: 'asphalt' },
  asphalt_red:    { label: 'Red asphalt',        base: '#7a4436', rough: 0.82, bump: 1.0,  tile: 4.0,  kind: 'asphalt' },
  asphalt_green:  { label: 'Green asphalt',      base: '#3f5c46', rough: 0.82, bump: 1.0,  tile: 4.0,  kind: 'asphalt' },
  asphalt_blue:   { label: 'Blue asphalt',       base: '#3b4a63', rough: 0.82, bump: 1.0,  tile: 4.0,  kind: 'asphalt' },
  concrete:       { label: 'Concrete slabs',     base: '#8d8f8c', rough: 0.80, bump: 0.6,  tile: 2.0,  kind: 'slab', slab: [1.0, 1.0] },
  concrete_brushed:{ label: 'Brushed concrete',  base: '#9a9c99', rough: 0.70, bump: 0.3,  tile: 3.0,  kind: 'concrete' },
  kerb:           { label: 'Kerb / concrete',    base: '#a3a5a1', rough: 0.66, bump: 0.25, tile: 1.5,  kind: 'concrete' },
  paver:          { label: 'Concrete pavers',    base: '#9c8f7c', rough: 0.84, bump: 0.9,  tile: 1.6,  kind: 'paver', paver: [0.2, 0.1] },
  sett:           { label: 'Granite setts',      base: '#7d7a75', rough: 0.86, bump: 1.4,  tile: 1.2,  kind: 'paver', paver: [0.11, 0.22] },
  cobble:         { label: 'Cobblestone',        base: '#6f6b66', rough: 0.90, bump: 2.0,  tile: 1.4,  kind: 'cobble' },
  brick:          { label: 'Brick paving',       base: '#8e5641', rough: 0.85, bump: 0.9,  tile: 1.4,  kind: 'paver', paver: [0.21, 0.065] },
  tile:           { label: 'Stone tile',         base: '#b0ada6', rough: 0.55, bump: 0.2,  tile: 2.0,  kind: 'slab', slab: [0.6, 0.6] },
  gravel:         { label: 'Gravel',             base: '#7d766a', rough: 0.97, bump: 2.4,  tile: 2.0,  kind: 'gravel' },
  dirt:           { label: 'Compacted dirt',     base: '#6a5c48', rough: 0.98, bump: 1.8,  tile: 3.0,  kind: 'gravel' },
  grass:          { label: 'Grass',              base: '#4c6640', rough: 0.95, bump: 1.2,  tile: 1.5,  kind: 'grass' },
  planting:       { label: 'Planting bed',       base: '#3d5433', rough: 0.96, bump: 2.0,  tile: 1.2,  kind: 'grass' },
  ballast:        { label: 'Rail ballast',       base: '#6b6963', rough: 0.97, bump: 2.6,  tile: 1.2,  kind: 'gravel' },
  sleeper:        { label: 'Sleeper / timber',   base: '#4a3c2c', rough: 0.90, bump: 0.7,  tile: 1.0,  kind: 'wood' },
  steel:          { label: 'Steel / rail',       base: '#9aa1a8', rough: 0.30, bump: 0.1,  tile: 1.0,  kind: 'metal', metal: 0.9 },
  galv:           { label: 'Galvanised steel',   base: '#8f979e', rough: 0.42, bump: 0.15, tile: 1.0,  kind: 'metal', metal: 0.8 },
  rubber:         { label: 'Rubber crossing',    base: '#4b4e53', rough: 0.90, bump: 0.5,  tile: 2.0,  kind: 'gravel' },
  paint_w:        { label: 'Paint — white',      base: '#e8e8e4', rough: 0.55, bump: 0.1,  tile: 1.0,  kind: 'paint' },
  paint_y:        { label: 'Paint — yellow',     base: '#d7b02c', rough: 0.55, bump: 0.1,  tile: 1.0,  kind: 'paint' },
  paint_r:        { label: 'Paint — red',        base: '#b5432f', rough: 0.55, bump: 0.1,  tile: 1.0,  kind: 'paint' },
  paint_g:        { label: 'Paint — green',      base: '#3f7a4a', rough: 0.55, bump: 0.1,  tile: 1.0,  kind: 'paint' },
  paint_b:        { label: 'Paint — blue',       base: '#2f6da8', rough: 0.55, bump: 0.1,  tile: 1.0,  kind: 'paint' },
  chequer:        { label: 'Hazard chequer',     base: '#d8d5cd', rough: 0.6,  bump: 0.1,  tile: 1.0,  kind: 'chequer' },
};

export const SURFACE_KEYS = Object.keys(SURFACES);

/* --------------------------------------------------------------- kinds ---- */

export const KINDS = {
  driving:  { label: 'Driving lane',  short: 'DRV', color: '#59636f', traffic: true,  surface: 'asphalt',        w: 3.25 },
  bus:      { label: 'Bus lane',      short: 'BUS', color: '#c0563a', traffic: true,  surface: 'asphalt_red',    w: 3.5  },
  cycle:    { label: 'Cycle lane',    short: 'CYC', color: '#2f7d55', traffic: true,  surface: 'asphalt_green',  w: 1.8  },
  parking:  { label: 'Parking bay',   short: 'PRK', color: '#4b5563', traffic: false, surface: 'paver',          w: 2.3  },
  shoulder: { label: 'Hard shoulder', short: 'SHL', color: '#6d7278', traffic: false, surface: 'asphalt',        w: 3.0  },
  median:   { label: 'Median',        short: 'MED', color: '#3f4a3a', traffic: false, surface: 'planting',       w: 2.0  },
  sidewalk: { label: 'Sidewalk',      short: 'PED', color: '#8b9099', traffic: false, surface: 'concrete',       w: 2.0, h: 0.15 },
  verge:    { label: 'Verge',         short: 'VRG', color: '#4e6b41', traffic: false, surface: 'grass',          w: 1.5, h: 0.05 },
  path:     { label: 'Pathway',       short: 'PTH', color: '#8a7b62', traffic: false, surface: 'asphalt_fine',   w: 2.0, h: 0.12 },
  plaza:    { label: 'Shared surface',short: 'PLZ', color: '#94897a', traffic: false, surface: 'sett',           w: 6.0, h: 0.0 },
  rail:     { label: 'Rail track',    short: 'RAL', color: '#b78cff', traffic: false, surface: 'ballast',        w: 3.4, h: -0.15 },
  tram:     { label: 'Tram track',    short: 'TRM', color: '#9d7bd8', traffic: false, surface: 'sett',           w: 3.2, h: 0.0 },
  platform: { label: 'Platform',      short: 'PLT', color: '#9aa0a6', traffic: false, surface: 'concrete',       w: 3.0, h: 0.35 },
  barrier:  { label: 'Barrier',       short: 'BAR', color: '#9aa3ad', traffic: false, surface: 'galv',           w: 0.5, h: 0.75 },
  wall:     { label: 'Retaining wall',short: 'WAL', color: '#7f8288', traffic: false, surface: 'concrete_brushed', w: 0.6, h: 1.2 },
  water:    { label: 'Channel',       short: 'WTR', color: '#2c4f63', traffic: false, surface: 'tile',           w: 2.0, h: -0.6 },
  none:     { label: 'Empty',         short: '—',   color: '#3a3f47', traffic: false, surface: 'asphalt',        w: 1.0 },
};

export const KIND_KEYS = Object.keys(KINDS);
/** Kinds that carry motor traffic — they form the carriageway for camber. */
export const TRAFFIC_KINDS = new Set(['driving', 'bus', 'cycle', 'parking', 'tram', 'shoulder', 'plaza']);

/* ------------------------------------------------------ marking styles ---- */

export const MARKING_STYLES = {
  eu:  { label: 'EU / UNECE',  edge: 0.12, lane: 0.12, dash: 3.0, gap: 4.5,  centre: 0.12, stopBar: 0.4,  zebra: { w: 0.5, gap: 0.55 } },
  uk:  { label: 'UK / TSRGD',  edge: 0.10, lane: 0.10, dash: 3.0, gap: 6.0,  centre: 0.10, stopBar: 0.45, zebra: { w: 0.55, gap: 0.6 } },
  us:  { label: 'US / MUTCD',  edge: 0.10, lane: 0.10, dash: 3.05, gap: 9.15, centre: 0.10, stopBar: 0.61, zebra: { w: 0.41, gap: 0.41 } },
  jp:  { label: 'JP',          edge: 0.15, lane: 0.15, dash: 4.0, gap: 6.0,  centre: 0.15, stopBar: 0.45, zebra: { w: 0.45, gap: 0.45 } },
};

/* ------------------------------------------------------------- helpers ---- */

const B = (k, w, extra = {}) => ({ k, w: w ?? KINDS[k].w, s: KINDS[k].surface, h: KINDS[k].h ?? 0, dir: 0, ...extra });
const sw = (w, s = 'concrete', h = 0.15, extra = {}) => B('sidewalk', w, { s, h, ...extra });
const drv = (w, dir = 0, extra = {}) => B('driving', w, { dir, ...extra });

/* -------------------------------------------------------------- presets --- */
/* Ordering is left -> right, which is also the order they appear in the
   cross-section editor. Symmetric sections read nicer.                      */

export const PRESETS = [
  /* ------------------------------------------------------------ URBAN --- */
  {
    id: 'local_street', name: 'Local Street', group: 'Urban', tag: 'str',
    desc: '2 lane · parking both sides',
    bands: [sw(1.8), B('parking', 2.2), drv(3.0, 1), drv(3.0, -1), B('parking', 2.2), sw(1.8)],
    features: { bollards: false, lighting: { on: true, spacing: 26, side: 'right', h: 7 }, gullies: true, trees: { on: false, spacing: 14 } },
  },
  {
    id: 'one_way', name: 'One-Way Street', group: 'Urban', tag: 'str',
    desc: '1 lane · angled parking',
    bands: [sw(2.0), B('parking', 2.4), drv(3.4, 1), B('parking', 2.4), sw(2.0)],
    features: { lighting: { on: true, spacing: 24, side: 'both', h: 7 }, gullies: true },
  },
  {
    id: 'mews', name: 'Mews / Alley', group: 'Urban', tag: 'str',
    desc: 'shared surface · flush setts',
    bands: [sw(0.9, 'sett', 0.06, { riser: 'slope' }), B('plaza', 5.0, { s: 'sett', riser: 'slope' }), sw(0.9, 'sett', 0.06, { riser: 'slope' })],
    features: { lighting: { on: true, spacing: 16, side: 'both', h: 4.2, wall: true }, gullies: true },
  },
  {
    id: 'woonerf', name: 'Woonerf', group: 'Urban', tag: 'str',
    desc: 'home zone ·play street',
    bands: [sw(1.6, 'paver', 0.06, { riser: 'slope' }), B('plaza', 7.5, { s: 'paver', riser: 'slope' }), sw(1.6, 'paver', 0.06, { riser: 'slope' })],
    features: { lighting: { on: true, spacing: 20, side: 'both', h: 5 }, bollards: { on: true, spacing: 9, offset: 0.4 }, trees: { on: true, spacing: 12 } },
  },
  {
    id: 'complete_street', name: 'Complete Street', group: 'Urban', tag: 'str',
    desc: 'cycle · 2 lane · parking · transit',
    bands: [sw(2.6), B('cycle', 1.9, { s: 'asphalt_red', dir: -1 }), B('parking', 2.3), drv(3.1, 1), drv(3.1, -1), B('parking', 2.3), B('cycle', 1.9, { s: 'asphalt_red', dir: 1 }), sw(2.6)],
    features: { lighting: { on: true, spacing: 28, side: 'both', h: 7 }, gullies: true, busStops: true, trees: { on: true, spacing: 15 } },
  },
  {
    id: 'heritage', name: 'Heritage Street', group: 'Urban', tag: 'str',
    desc: 'cobblestone · no markings',
    bands: [sw(1.6, 'sett', 0.14), B('driving', 6.4, { s: 'cobble', dir: 0 }), sw(1.6, 'sett', 0.14)],
    features: { lighting: { on: true, spacing: 18, side: 'both', h: 4.5, heritage: true }, markings: false, gullies: false },
  },

  /* -------------------------------------------------------- ARTERIAL --- */
  {
    id: 'avenue', name: 'Urban Avenue', group: 'Arterial', tag: 'str',
    desc: '4 lane · planted median',
    bands: [sw(3.2), B('cycle', 1.8, { dir: -1 }), drv(3.3, 1), drv(3.3, 1), B('median', 2.4, { s: 'planting', h: 0.2 }), drv(3.3, -1), drv(3.3, -1), B('cycle', 1.8, { dir: 1 }), sw(3.2)],
    features: { lighting: { on: true, spacing: 32, side: 'both', h: 9 }, gullies: true, busStops: true, trees: { on: true, spacing: 10 }, signals: true },
  },
  {
    id: 'arterial', name: 'Arterial Road', group: 'Arterial', tag: 'str',
    desc: '6 lane · bus + cycle',
    bands: [sw(3.5), B('cycle', 2.0, { dir: -1 }), B('parking', 2.4), drv(3.4, 1), B('bus', 3.5, { dir: 1 }), B('median', 3.0, { s: 'concrete', h: 0.18 }), B('bus', 3.5, { dir: -1 }), drv(3.4, -1), B('parking', 2.4), B('cycle', 2.0, { dir: 1 }), sw(3.5)],
    features: { lighting: { on: true, spacing: 34, side: 'both', h: 10 }, gullies: true, busStops: true, signals: true, trees: { on: true, spacing: 14 } },
  },
  {
    id: 'boulevard', name: 'Boulevard', group: 'Arterial', tag: 'str',
    desc: 'tram median · 4 lane',
    bands: [sw(4.0), B('cycle', 2.0, { dir: -1 }), drv(3.4, 1), drv(3.4, 1), B('tram', 3.3, { s: 'sett' }), B('median', 1.0, { s: 'planting', h: 0.15 }), B('tram', 3.3, { s: 'sett' }), drv(3.4, -1), drv(3.4, -1), B('cycle', 2.0, { dir: 1 }), sw(4.0)],
    features: { lighting: { on: true, spacing: 30, side: 'both', h: 9 }, gullies: true, trees: { on: true, spacing: 9 }, catenary: true, signals: true },
  },
  {
    id: 'rambla', name: 'Rambla', group: 'Arterial', tag: 'str',
    desc: 'central promenade · service roads',
    bands: [sw(3.0), drv(3.2, -1), B('parking', 2.3), sw(2.0), B('plaza', 9.0, { s: 'paver', h: 0.12 }), sw(2.0), B('parking', 2.3), drv(3.2, 1), sw(3.0)],
    features: { lighting: { on: true, spacing: 22, side: 'both', h: 7 }, trees: { on: true, spacing: 7 }, bollards: { on: true, spacing: 8, offset: 0.3 } },
  },
  {
    id: 'dual_carriageway', name: 'Dual Carriageway', group: 'Arterial', tag: 'str',
    desc: '3+3 · central reserve · at grade',
    bands: [sw(2.5), B('verge', 1.5), B('cycle', 2.0, { dir: -1 }), drv(3.5, 1), drv(3.5, 1), drv(3.5, 1), B('median', 4.0, { s: 'planting', h: 0.25 }), drv(3.5, -1), drv(3.5, -1), drv(3.5, -1), B('cycle', 2.0, { dir: 1 }), B('verge', 1.5), sw(2.5)],
    features: { lighting: { on: true, spacing: 38, side: 'right', h: 11 }, barrier: { on: true, side: 'median' }, gullies: true, signals: true },
  },

  /* --------------------------------------------------------- HIGHWAY --- */
  {
    id: 'expressway', name: 'Expressway', group: 'Highway', tag: 'str',
    desc: '2+2 · hard shoulder · barrier',
    bands: [B('verge', 3.0), drv(3.65, 1), drv(3.65, 1), B('shoulder', 2.5), B('median', 4.5, { s: 'concrete', h: 0.3 }), B('shoulder', 2.5), drv(3.65, -1), drv(3.65, -1), B('verge', 3.0)],
    features: { lighting: { on: false }, barrier: { on: true, side: 'both' }, gullies: false, rumbles: true },
  },
  {
    id: 'motorway', name: 'Motorway', group: 'Highway', tag: 'str',
    desc: '4+4 · full hard shoulder · 120 km/h',
    bands: [B('verge', 4.0, { h: -0.3 }), B('shoulder', 3.3), drv(3.75, 1), drv(3.75, 1), drv(3.75, 1), drv(3.75, 1), B('median', 6.0, { s: 'planting', h: 0.4, riser: 'slope' }), drv(3.75, -1), drv(3.75, -1), drv(3.75, -1), drv(3.75, -1), B('shoulder', 3.3), B('verge', 4.0, { h: -0.3 })],
    features: { barrier: { on: true, side: 'both' }, lighting: { on: false }, rumbles: true, gantries: true },
  },
  {
    id: 'autobahn', name: 'Autobahn', group: 'Highway', tag: 'str',
    desc: '3+3 · concrete · no speed limit',
    bands: [B('verge', 3.5, { h: -0.25 }), B('shoulder', 3.0, { s: 'concrete' }), drv(3.75, 1, { s: 'concrete' }), drv(3.75, 1, { s: 'concrete' }), drv(3.75, 1, { s: 'concrete' }), B('median', 4.0, { s: 'planting', h: 0.35 }), drv(3.75, -1, { s: 'concrete' }), drv(3.75, -1, { s: 'concrete' }), drv(3.75, -1, { s: 'concrete' }), B('shoulder', 3.0, { s: 'concrete' }), B('verge', 3.5, { h: -0.25 })],
    features: { barrier: { on: true, side: 'both' }, gantries: true, rumbles: true },
  },
  {
    id: 'ramp', name: 'Slip Road / Ramp', group: 'Highway', tag: 'str',
    desc: 'single lane · 60 km/h',
    bands: [B('verge', 2.0, { h: -0.2 }), B('shoulder', 2.0), drv(5.0, 1), B('shoulder', 2.5), B('verge', 2.0, { h: -0.2 })],
    features: { barrier: { on: true, side: 'left' }, rumbles: true },
  },
  {
    id: 'ring_road', name: 'Ring Road', group: 'Highway', tag: 'str',
    desc: '3+3 urban motorway · barriers',
    bands: [sw(2.0), B('wall', 0.5, { h: 1.0 }), B('shoulder', 2.5), drv(3.5, 1), drv(3.5, 1), drv(3.5, 1), B('median', 3.0, { s: 'concrete', h: 0.4 }), drv(3.5, -1), drv(3.5, -1), drv(3.5, -1), B('shoulder', 2.5), B('wall', 0.5, { h: 1.0 }), sw(2.0)],
    features: { barrier: { on: true, side: 'both' }, lighting: { on: true, spacing: 32, side: 'right', h: 12 } },
  },

  /* ---------------------------------------------------------- TRANSIT --- */
  {
    id: 'busway', name: 'BRT / Busway', group: 'Transit', tag: 'rail',
    desc: 'segregated bus corridor',
    bands: [sw(2.5), B('verge', 1.0), B('bus', 3.6, { dir: 1, s: 'concrete' }), B('bus', 3.6, { dir: -1, s: 'concrete' }), B('verge', 1.0), sw(2.5)],
    features: { lighting: { on: true, spacing: 30, side: 'both', h: 8 }, busStops: true, rumbles: false },
  },
  {
    id: 'cycle_street', name: 'Cycle Street', group: 'Transit', tag: 'path',
    desc: 'fietsstraat · bikes priority',
    bands: [sw(1.8, 'paver', 0.1), B('cycle', 4.2, { s: 'asphalt_red', dir: 0 }), sw(1.8, 'paver', 0.1)],
    features: { lighting: { on: true, spacing: 20, side: 'both', h: 6 }, bollards: { on: true, spacing: 12, offset: 0.5 } },
  },
  {
    id: 'cycle_track', name: 'Separated Cycle Track', group: 'Transit', tag: 'path',
    desc: '2-way · kerb separated',
    bands: [sw(2.0), B('verge', 1.2), B('cycle', 1.6, { dir: 1, s: 'asphalt_red' }), B('cycle', 1.6, { dir: -1, s: 'asphalt_red' }), B('verge', 1.2), sw(2.0)],
    features: { lighting: { on: true, spacing: 22, side: 'right', h: 6 }, bollards: { on: true, spacing: 14, offset: 0.35 } },
  },
  {
    id: 'tram_street', name: 'Tram Street', group: 'Transit', tag: 'rail',
    desc: 'grooved rail in asphalt',
    bands: [sw(2.8), B('parking', 2.2), drv(3.2, 1), B('tram', 3.2, { s: 'asphalt' }), drv(3.2, -1), B('parking', 2.2), sw(2.8)],
    features: { lighting: { on: true, spacing: 28, side: 'both', h: 8 }, catenary: true, busStops: true },
  },
  {
    id: 'heavy_rail', name: 'Heavy Rail', group: 'Transit', tag: 'rail',
    desc: 'ballasted mainline · 1435 mm',
    bands: [B('verge', 2.5, { h: -0.4 }), B('rail', 3.6, { h: -0.25, gauge: 1.435, rails: 2 }), B('verge', 2.5, { h: -0.4 })],
    features: { catenary: true, railOnly: true, crossings: true },
  },
  {
    id: 'light_rail', name: 'Light Rail / Metro at grade', group: 'Transit', tag: 'rail',
    desc: 'slab track · 2 tracks',
    bands: [B('verge', 2.0, { h: -0.3 }), B('rail', 3.4, { h: -0.12, gauge: 1.435, rails: 2, slab: true }), B('rail', 3.4, { h: -0.12, gauge: 1.435, rails: 2, slab: true }), B('verge', 2.0, { h: -0.3 })],
    features: { catenary: true, railOnly: true, crossings: true },
  },
  {
    id: 'metro_trench', name: 'Subway — Cut & Cover', group: 'Transit', tag: 'rail',
    desc: 'below grade · retaining walls',
    bands: [B('verge', 3.0, { h: 0.4 }), B('wall', 0.7, { h: 6.5 }), B('rail', 3.6, { h: -6.0, gauge: 1.435, rails: 2 }), B('rail', 3.6, { h: -6.0, gauge: 1.435, rails: 2 }), B('wall', 0.7, { h: 6.5 }), B('verge', 3.0, { h: 0.4 })],
    features: { railOnly: true, tunnels: true, platforms: true, catenary: true },
  },
  {
    id: 'metro_viaduct', name: 'Subway — Elevated', group: 'Transit', tag: 'rail',
    desc: 'viaduct · 8 m deck',
    bands: [B('none', 0.5), B('wall', 0.45, { h: 1.1, s: 'concrete_brushed' }), B('rail', 3.6, { h: 0.0, gauge: 1.435, rails: 2 }), B('rail', 3.6, { h: 0.0, gauge: 1.435, rails: 2 }), B('wall', 0.45, { h: 1.1, s: 'concrete_brushed' }), B('none', 0.5)],
    features: { railOnly: true, elevated: true, catenary: true, platforms: true },
  },

  /* -------------------------------------------------------- PEDESTRIAN -- */
  {
    id: 'footpath', name: 'Footpath', group: 'Pedestrian', tag: 'path',
    desc: '2 m · bituminous',
    bands: [B('verge', 0.4, { h: 0.05, riser: 'slope' }), B('path', 2.0, { s: 'asphalt_fine', h: 0.12 }), B('verge', 0.4, { h: 0.05, riser: 'slope' })],
    features: { lighting: { on: true, spacing: 20, side: 'right', h: 4.5 } },
  },
  {
    id: 'shared_use', name: 'Shared-Use Path', group: 'Pedestrian', tag: 'path',
    desc: '3 m · pedestrians + cycles',
    bands: [B('verge', 0.6, { h: 0.05, riser: 'slope' }), B('path', 3.0, { s: 'asphalt_fine', h: 0.1 }), B('verge', 0.6, { h: 0.05, riser: 'slope' })],
    features: { lighting: { on: true, spacing: 22, side: 'right', h: 5 }, bollards: { on: true, spacing: 20, offset: 0.2 } },
  },
  {
    id: 'ped_street', name: 'Pedestrian Street', group: 'Pedestrian', tag: 'path',
    desc: 'full width paving · bollarded',
    bands: [B('plaza', 12.0, { s: 'sett', h: 0.0 })],
    features: { bollards: { on: true, spacing: 6, offset: 0.5 }, lighting: { on: true, spacing: 20, side: 'both', h: 5, heritage: true }, trees: { on: true, spacing: 8 } },
  },
  {
    id: 'promenade', name: 'Promenade', group: 'Pedestrian', tag: 'path',
    desc: 'waterfront · timber + stone',
    bands: [B('wall', 0.6, { h: 0.5, s: 'paver' }), B('plaza', 6.0, { s: 'tile', h: 0.15 }), B('path', 3.0, { s: 'sleeper', h: 0.15, riser: 'slope' }), B('verge', 2.0, { h: 0.1, riser: 'slope' })],
    features: { lighting: { on: true, spacing: 18, side: 'left', h: 5 }, bollards: { on: true, spacing: 8, offset: 0.4 } },
  },

  /* ------------------------------------------------------------ RURAL --- */
  {
    id: 'rural_road', name: 'Rural Road', group: 'Rural', tag: 'str',
    desc: '2 lane · grass verges',
    bands: [B('verge', 2.0, { h: -0.15, riser: 'slope' }), drv(3.4, 1), drv(3.4, -1), B('verge', 2.0, { h: -0.15, riser: 'slope' })],
    features: { lighting: { on: false }, rumbles: true },
  },
  {
    id: 'country_lane', name: 'Country Lane', group: 'Rural', tag: 'str',
    desc: 'single track · passing places',
    bands: [B('verge', 1.2, { h: -0.12, riser: 'slope' }), drv(4.2, 0), B('verge', 1.2, { h: -0.12, riser: 'slope' })],
    features: { lighting: { on: false }, markings: false, hedges: true },
  },
  {
    id: 'rural_highway', name: 'Rural Highway', group: 'Rural', tag: 'str',
    desc: '2+1 · wide shoulders',
    bands: [B('verge', 3.0, { h: -0.3, riser: 'slope' }), B('shoulder', 2.0), drv(3.5, 1), drv(3.5, -1), drv(3.5, 1), B('shoulder', 2.0), B('verge', 3.0, { h: -0.3, riser: 'slope' })],
    features: { rumbles: true, barrier: { on: true, side: 'left' } },
  },
  {
    id: 'unpaved', name: 'Unpaved Track', group: 'Rural', tag: 'str',
    desc: 'gravel · crowned, no kerb',
    bands: [B('verge', 1.5, { h: -0.2, riser: 'slope' }), drv(5.0, 0, { s: 'gravel' }), B('verge', 1.5, { h: -0.2, riser: 'slope' })],
    features: { markings: false, rumbles: false },
  },

  /* ---------------------------------------------------------- SPECIAL --- */
  {
    id: 'bridge_deck', name: 'Bridge Deck', group: 'Special', tag: 'str',
    desc: '2+2 on structure · parapet',
    bands: [B('wall', 0.45, { h: 1.3, s: 'concrete_brushed' }), B('shoulder', 1.0), drv(3.5, 1), drv(3.5, 1), B('median', 1.6, { s: 'concrete', h: 0.2 }), drv(3.5, -1), drv(3.5, -1), B('shoulder', 1.0), B('wall', 0.45, { h: 1.3, s: 'concrete_brushed' })],
    features: { bridge: true, piers: { spacing: 32 }, expansionJoints: true, lighting: { on: true, spacing: 30, side: 'both', h: 8 } },
  },
  {
    id: 'tunnel_bore', name: 'Road Tunnel', group: 'Special', tag: 'str',
    desc: '2 lane bore · portals',
    bands: [B('wall', 1.0, { h: 6.0, s: 'tile' }), B('shoulder', 1.0), drv(3.6, 1), drv(3.6, -1), B('shoulder', 1.0), B('wall', 1.0, { h: 6.0, s: 'tile' })],
    features: { tunnel: true, lighting: { on: true, spacing: 8, side: 'both', h: 5.5, tunnel: true } },
  },
  {
    id: 'level_crossing', name: 'Level Crossing', group: 'Special', tag: 'rail',
    desc: 'road over rail · barriers',
    bands: [sw(2.0), drv(3.4, 1), drv(3.4, -1), sw(2.0)],
    features: { levelCrossing: true, markings: true },
  },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export const GROUPS = ['Urban', 'Arterial', 'Highway', 'Transit', 'Pedestrian', 'Rural', 'Special'];

/** Deep clone a preset's bands so edits never mutate the library. */
export function cloneBands(preset) {
  return preset.bands.map((b) => ({ ...b }));
}

export function profileWidth(bands) {
  return bands.reduce((s, b) => s + (b.w || 0), 0);
}
