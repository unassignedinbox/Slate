import * as THREE from 'three';
import { COLORS } from '../config.js';

// One shared, flat-shaded material per surface type. Sharing them is what lets
// the batcher collapse thousands of props into a handful of draw calls.
const make = (name, color, opts = {}) => {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  m.name = name;
  return m;
};

export const MAT = {
  concrete: make('concrete', COLORS.concrete),
  concreteDark: make('concreteDark', COLORS.concreteDark),
  steel: make('steel', COLORS.steel),
  steelDark: make('steelDark', COLORS.steelDark),
  gunmetal: make('gunmetal', 0x2c3136),
  olive: make('olive', COLORS.olive),
  oliveDark: make('oliveDark', COLORS.oliveDark),
  sandbag: make('sandbag', COLORS.sandbag),
  sandbagAlt: make('sandbagAlt', COLORS.sandbagAlt),
  wood: make('wood', COLORS.wood),
  woodDark: make('woodDark', COLORS.woodDark),
  rust: make('rust', COLORS.rust),
  dirt: make('dirt', COLORS.dirt),
  mud: make('mud', COLORS.mud),
  black: make('black', 0x191b1d),
  charred: make('charred', 0x35312c),
  red: make('red', 0x8c2f22),
  white: make('white', 0xd7d3c6),
  glass: new THREE.MeshPhongMaterial({ color: 0x24333c, flatShading: true, shininess: 90, specular: 0x9fd2e6 }),
  chrome: new THREE.MeshPhongMaterial({ color: 0xb9c0c6, flatShading: true, shininess: 120, specular: 0xffffff }),
  tyre: make('tyre', 0x22242a),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
  lampRed: new THREE.MeshBasicMaterial({ color: 0xff5533 }),
};

export const carPaint = (color) => {
  const m = new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0.28, roughness: 0.46 });
  m.name = 'carPaint';
  return m;
};
