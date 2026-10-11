// Scene build orchestration: graph -> one welded surface mesh + instanced furniture + sim data.

import { MeshBuilder, quadWireIndices } from '../core/mesh.js';
import { solveNetwork, buildJunctionMesh } from './junction.js';
import { buildRoadRibbon, prepareEdge } from './roadmesh.js';

/**
 * Build the merged road surface (carriageways + junction plates + kerbs + footways).
 * One MeshBuilder => one vertex buffer => intersections are genuinely merged geometry.
 */
export function buildSurface(net, ctx = {}) {
  const t0 = now();
  net.rebuildAllCurves();
  for (const e of net.edges.values()) prepareEdge(net, e);
  solveNetwork(net);

  const mb = new MeshBuilder('road-surface');
  const junctions = new Map();
  const ribbons = new Map();

  // junction plates first: their mouth rows define the welded seam the ribbons snap onto
  for (const node of net.nodes.values()) {
    if (node.edges.length === 0) continue;
    const info = buildJunctionMesh(mb, net, node, ctx);
    if (info) junctions.set(node.id, info);
  }
  for (const edge of net.edges.values()) {
    ribbons.set(edge.id, buildRoadRibbon(mb, net, edge, ctx));
  }

  const mesh = mb.finish();
  mesh.wire = quadWireIndices(mesh.quads);
  mesh.buildMs = now() - t0;
  return { mesh, junctions, ribbons, builder: mb };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
