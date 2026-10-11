// RoadDocument — pure data model for the editor scene.
// Serializable to JSON; geometry is rebuilt from this by the viewport.

import { uid } from './util.js';

export class RoadDocument {
  constructor() {
    this.version = 1;
    this.sceneName = 'Untitled City';
    this.settings = {
      gridSnap: 5,
      viewMode: 'lit', // lit | classes | wire | subway
      showGrid: true,
      sunAzimuth: 150,
      sunElevation: 42,
    };
    this.segments = []; // road segments
    this.props = [];    // street furniture
    this.rails = [];    // rail lines (with optional level crossings)
    this.subways = [];  // subway lines (tunnels, stations, entrances)
    this.env = { river: null, parks: [] };
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit(kind = 'structure') {
    for (const fn of this._listeners) fn(kind, this);
  }

  addSegment(segment) {
    segment.id ||= uid('rd');
    segment.overrides ||= {};
    this.segments.push(segment);
    this.emit('structure');
    return segment;
  }

  addProp(prop) {
    prop.id ||= uid('pr');
    this.props.push(prop);
    this.emit('structure');
    return prop;
  }

  addRail(rail) {
    rail.id ||= uid('rl');
    this.rails.push(rail);
    this.emit('structure');
    return rail;
  }

  addSubway(subway) {
    subway.id ||= uid('sw');
    this.subways.push(subway);
    this.emit('structure');
    return subway;
  }

  remove(id) {
    const before =
      this.segments.length + this.props.length + this.rails.length + this.subways.length;
    this.segments = this.segments.filter((s) => s.id !== id);
    this.props = this.props.filter((p) => p.id !== id);
    this.rails = this.rails.filter((r) => r.id !== id);
    this.subways = this.subways.filter((s) => s.id !== id);
    const after =
      this.segments.length + this.props.length + this.rails.length + this.subways.length;
    if (after !== before) this.emit('structure');
    return after !== before;
  }

  find(id) {
    return (
      this.segments.find((s) => s.id === id) ||
      this.props.find((p) => p.id === id) ||
      this.rails.find((r) => r.id === id) ||
      this.subways.find((s) => s.id === id) ||
      null
    );
  }

  clear() {
    this.segments = [];
    this.props = [];
    this.rails = [];
    this.subways = [];
    this.junctions = [];
    this.env = { river: null, parks: [] };
    this.emit('structure');
  }

  stats() {
    const laneKm = this.segments.reduce((acc, s) => {
      const len = polylineLength(s.points) / 1000;
      return acc + len;
    }, 0);
    return {
      segments: this.segments.length,
      props: this.props.length,
      rails: this.rails.length,
      subways: this.subways.length,
      laneKm,
    };
  }

  serialize() {
    return JSON.stringify({
      version: this.version,
      sceneName: this.sceneName,
      settings: this.settings,
      segments: this.segments,
      props: this.props,
      rails: this.rails,
      subways: this.subways,
      junctions: this.junctions || [],
      env: this.env,
    });
  }

  static deserialize(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const doc = new RoadDocument();
    doc.version = data.version || 1;
    doc.sceneName = data.sceneName || 'Untitled City';
    Object.assign(doc.settings, data.settings || {});
    doc.segments = data.segments || [];
    doc.props = data.props || [];
    doc.rails = data.rails || [];
    doc.subways = data.subways || [];
    doc.junctions = data.junctions || [];
    doc.env = data.env || { river: null, parks: [] };
    return doc;
  }
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    len += Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
  }
  return len;
}

/** Aggregate the prop list per kind for the outliner collections. */
export function propCollections(doc) {
  const map = new Map();
  for (const p of doc.props) {
    if (!map.has(p.kind)) map.set(p.kind, []);
    map.get(p.kind).push(p);
  }
  return map;
}
