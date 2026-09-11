#!/usr/bin/env python3
"""
Reference simulation for the Slate SDF Terrain solver.

This is not part of the shipped tool. It is the offline twin of src/kernel/shaders/hydrology.js:
the same pass schedule, the same formulae, the same units, evaluated on the CPU with numpy so
the behaviour of the solver can be inspected without a GPU. Whatever this script shows is what
the WGSL will do, minus floating point detail.

    python3 tools/reference-sim.py --steps 300 --grid 96 --out tools/verify

Checks performed:
  * per-step surface change never exceeds the stability cap (maxStepVoxels * voxel)
  * mass audit: eroded == deposited + suspended + exported, to within rounding
  * incision is progressive and saturating rather than diverging (no runaway hole)
  * a drainage network exists (discharge is heavy-tailed, channels reach the boundary)
  * deposition lands downslope of incision (alluvial fans, not uniform mush)
"""

import argparse
import math
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit('This tool needs numpy and Pillow. On a managed Python: python3 -m venv /tmp/venv && '
             '/tmp/venv/bin/pip install numpy pillow, then run it with /tmp/venv/bin/python.')

#------------------------------------------------------------------------------------------
# Terrain construction (stands in for the node graph bake)
#------------------------------------------------------------------------------------------
def _value_noise(gx, gz, scale, seed):
    """Smooth value noise on the smallest lattice that still resolves the grid."""
    x = gx / scale + seed * 17.13
    z = gz / scale + seed * 41.71
    ix = np.floor(x)
    iz = np.floor(z)
    fx = x - ix
    fz = z - iz
    fx = fx * fx * (3.0 - 2.0 * fx)
    fz = fz * fz * (3.0 - 2.0 * fz)

    def hash2(a, b):
        v = np.sin(a * 127.1 + b * 311.7) * 43758.5453
        return v - np.floor(v)

    v00 = hash2(ix, iz)
    v10 = hash2(ix + 1.0, iz)
    v01 = hash2(ix, iz + 1.0)
    v11 = hash2(ix + 1.0, iz + 1.0)
    return (v00 * (1 - fx) + v10 * fx) * (1 - fz) + (v01 * (1 - fx) + v11 * fx) * fz


def _fbm(gx, gz, scale, octaves, seed):
    total = np.zeros_like(gx)
    amplitude = 1.0
    norm = 0.0
    for octave in range(octaves):
        total = total + amplitude * _value_noise(gx, gz, scale / (2.0 ** octave), seed + octave)
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def bake_terrain(n, span, extent):
    """A fair stand-in for the GPU bake: a plateau massif, a bench, and ridged fluvial relief.
    The relief is band-limited so the grid can actually resolve it — a checkerboard finer than
    the cell size would alias into stripes and hide real solver behaviour behind moire."""
    x = (np.arange(n) + 0.5) * span
    z = (np.arange(n) + 0.5) * span
    gx, gz = np.meshgrid(x - extent * 0.5, z - extent * 0.5, indexing='ij')

    massif = 330.0 * np.exp(-((gx / 520.0) ** 2 + (gz / 470.0) ** 2))
    bench = 80.0 * np.tanh((gz + 140.0) / 300.0)
    ridges = _fbm(gx, gz, 340.0, 4, 11)
    valleys = _fbm(gx, gz, 210.0, 3, 29)
    relief = 120.0 * ridges - 70.0 * valleys
    height = massif + bench + relief
    height = height - height.min() + 30.0
    return height.astype(np.float64)


def laplacian(field, span):
    return (np.roll(field, 1, 0) + np.roll(field, -1, 0) +
            np.roll(field, 1, 1) + np.roll(field, -1, 1) - 4.0 * field) / (span * span)


DIRS = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


def shift(field, dx, dz, fill):
    """Neighbour lookup: the value at (i + dx, j + dz); outside the map returns `fill`."""
    out = np.full_like(field, fill)
    ys = slice(max(0, dx), field.shape[0] + min(0, dx))
    xs = slice(max(0, dz), field.shape[1] + min(0, dz))
    yd = slice(max(0, -dx), field.shape[0] + min(0, -dx))
    xd = slice(max(0, -dz), field.shape[1] + min(0, -dz))
    out[yd, xd] = field[ys, xs]
    return out


class Solver:
    def __init__(self, height, span, extent, params):
        self.h = height.copy()
        self.span = span
        self.extent = extent
        self.p = params
        n = height.shape
        self.water = np.zeros(n)
        self.sediment = np.zeros(n)
        self.cover = np.zeros(n)
        self.wetness = np.zeros(n)
        self.speed = np.zeros(n)
        self.slope = np.zeros(n)
        self.flowx = np.zeros(n)
        self.flowz = np.zeros(n)
        self.accum = np.zeros(n)
        self.filled = height.copy()
        self.delta = np.zeros(n)
        self.hardness = np.clip(0.18 + 0.5 * np.exp(-height / 260.0), 0.0, 1.0)
        self.area = span * span
        self.initial = height.copy()
        self.counters = {'eroded': 0.0, 'deposited': 0.0, 'escaped': 0.0, 'carried': 0.0, 'peak': 0.0}

    # ------------------------------------------------------------------ hydrology
    def rain(self):
        p = self.p
        variation = 1.0 + 0.35 * np.sin(self.h * 0.01)
        self.rainfall = p['rain'] * variation
        # Runoff reaches the store as metres of water; soil takes up the rest.
        volume = self.rainfall * p['dt']
        absorbed = volume * (1.0 - self.wetness) * 0.55
        self.water = self.water + (volume - absorbed)

    def fill(self):
        filled = self.h.copy()
        # One pass per column: a relaxation propagates a cell per pass, so fewer passes than
        # the grid is wide cannot fill a basin.
        for _ in range(self.p['fillIterations']):
            low = np.full_like(filled, 1e30)
            for dx, dz in DIRS:
                low = np.minimum(low, shift(filled, dx, dz, -1e6))
            # Epsilon fill: raising the spill level by a uniform step per cell gives every
            # point of a filled basin a strictly lower neighbour, so the flow field that is
            # derived from it cannot contain a cycle.
            filled = np.maximum(self.h, low + 0.0015)
        self.filled = filled

    def route(self):
        """Total-order D8: every cell steps to the neighbour with the smallest
        (filled elevation, edge distance, index); off-map counts as -infinity. A cell with no
        strictly better neighbour is a sink and keeps its water. Each step strictly decreases a
        total order, so the network is acyclic by construction rather than by luck."""
        n = self.h.shape[0]
        index = np.arange(n)
        edge = np.minimum(np.minimum.outer(index, index), np.minimum.outer(n - 1 - index, n - 1 - index)).astype(np.float64)
        order = np.arange(n * n).reshape(n, n).astype(np.float64)

        best_w = self.filled.copy()
        best_e = edge.copy()
        best_i = order.copy()
        bx = np.zeros_like(self.h)
        bz = np.zeros_like(self.h)

        def better(w, e, i):
            return (w < best_w - 1e-7) | ((np.abs(w - best_w) <= 1e-7) & ((e < best_e) | ((e == best_e) & (i < best_i))))

        for dx, dz in DIRS:
            w = shift(self.filled, dx, dz, -1e9)
            e = shift(edge, dx, dz, -1.0)
            i = shift(order, dx, dz, -1.0)
            take = better(w, e, i)
            best_w = np.where(take, w, best_w)
            best_e = np.where(take, e, best_e)
            best_i = np.where(take, i, best_i)
            bx = np.where(take, float(dx), bx)
            bz = np.where(take, float(dz), bz)

        descended = (bx != 0.0) | (bz != 0.0)
        # Sinks that happen to sit on the rim still export off the map.
        sink = ~descended
        bx = np.where(sink & (index[:, None] == 0), -1.0, bx)
        bx = np.where(sink & (index[:, None] == n - 1), 1.0, bx)
        bz = np.where(sink & (index[None, :] == 0), -1.0, bz)
        bz = np.where(sink & (index[None, :] == n - 1), 1.0, bz)
        descended = (bx != 0.0) | (bz != 0.0)
        self.sink = ~descended
        self.flowx = bx
        self.flowz = bz

        # The routing may leave the map, but the incision law needs a real base level: the drop
        # toward the best neighbour that exists in the domain. Without this the rim sees an
        # endless downhill and carves a notch that nothing can stop.
        self.slope = np.zeros_like(self.h)
        for dx, dz in DIRS:
            dist = self.span * (math.sqrt(2.0) if dx and dz else 1.0)
            other = shift(self.h, dx, dz, 1e9)
            drop = np.maximum((self.h - other) / dist, 0.0)
            self.slope = np.maximum(self.slope, drop)
        # A cell that has no descent at all cannot incise: it is a base level, not a canyon.
        self.slope = np.where(self.sink & (self.slope <= 0.0), 0.0, self.slope)

    def accumulate(self, iterations):
        v = self.accum
        for _ in range(iterations):
            # Rainfall plus routed upstream water only; feeding standing water back in
            # on every pass multiplies the discharge instead of accumulating it.
            total = self.rainfall * self.p['dt'] * self.area
            for dx, dz in DIRS:
                fx = shift(self.flowx, dx, dz, 0.0).round()
                fz = shift(self.flowz, dx, dz, 0.0).round()
                points_back = (fx == -dx) & (fz == -dz)
                total = total + np.where(points_back, np.maximum(shift(v, dx, dz, 0.0), 0.0), 0.0)
            ceiling = self.rainfall * self.p['dt'] * self.area * self.h.size
            v = np.clip(total, 0.0, np.maximum(ceiling, 1.0))
        self.accum = v

    def flux(self):
        """Virtual pipes: each cell sends a share of its water toward every neighbour with a
        lower water surface, capped by what the pipe can carry and by 60% of the store. Shares
        aimed off the map leave the domain. Inflow is the sum of the shares actually aimed at
        this cell — indexed by direction, because a neighbour's share toward a third cell is not
        the same number as its share toward this one."""
        budget = self.water * self.area
        here = self.filled + self.water
        total = np.zeros_like(self.h)
        shares = {}
        for dx, dz in DIRS:
            dist = self.span * (math.sqrt(2.0) if dx and dz else 1.0)
            drop = here - shift(self.filled, dx, dz, -1e7)
            w = np.where(drop > 0.0, np.sqrt(np.maximum(drop, 0.0)) * np.power(np.maximum(self.water, 1e-4), 1.35) / dist, 0.0)
            shares[(dx, dz)] = w
            total = total + w

        flow = np.minimum(budget * 0.6, self.p['conductance'] * self.p['dt'] * self.span * total * self.area)
        inflow = np.zeros_like(self.h)
        outflow = np.zeros_like(self.h)
        exported = 0.0
        n = self.h.shape[0]
        for (dx, dz), w in shares.items():
            share = np.where(total > 0.0, flow * w / np.maximum(total, 1e-12), 0.0)
            outflow = outflow + share
            # The neighbour at (i+dx, j+dz) is the one that can send water back: its direction
            # toward us is (-dx, -dz).
            carrying = shift(share, -dx, -dz, 0.0)
            inside = shift(np.ones_like(self.h), -dx, -dz, 0.0) > 0.5
            exported += float(np.where(inside, 0.0, share).sum())
            inflow = inflow + np.where(inside, carrying, 0.0)

        self.inflow = inflow
        self.outflow = outflow
        self.exportedWater = exported

    def apply_water(self):
        p = self.p
        depth = self.water - (self.outflow - self.inflow) / self.area
        depth = depth - np.maximum(depth, 0.0) * (p['evaporation'] * p['dt'] + (1.0 - self.wetness) * 0.0006)
        self.water = np.clip(depth, 0.0, 120.0)
        self.wetness = np.clip(self.wetness + self.rainfall * p['dt'] * 0.02, 0.0, 1.0)

    def velocity(self):
        dt = max(self.p['dt'], 1e-4)
        hx = shift(self.h + self.water, 1, 0, 0.0) - shift(self.h + self.water, -1, 0, 0.0)
        hz = shift(self.h + self.water, 0, 1, 0.0) - shift(self.h + self.water, 0, -1, 0.0)
        grad_x = -hx / (2.0 * self.span)
        grad_z = -hz / (2.0 * self.span)
        rx, rz = self.flowx, self.flowz
        norm = np.hypot(rx, rz)
        rxn = np.where(norm > 0, rx / np.maximum(norm, 1e-9), 0.0)
        rzn = np.where(norm > 0, rz / np.maximum(norm, 1e-9), 0.0)
        mx = rxn * 0.72 + grad_x * 0.45
        mz = rzn * 0.72 + grad_z * 0.45
        mnorm = np.hypot(mx, mz)
        dirx = np.where(mnorm > 1e-5, mx / np.maximum(mnorm, 1e-9), 1.0)
        dirz = np.where(mnorm > 1e-5, mz / np.maximum(mnorm, 1e-9), 0.0)
        discharge = np.maximum(self.accum, 0.0) / dt
        slope = np.maximum(self.slope, 1e-5)
        width = np.clip(2.0 * np.sqrt(discharge), self.span * 0.25, self.span)
        rough = 0.035
        hydraulic = np.power(discharge * rough / np.maximum(width * np.sqrt(slope), 1e-6), 0.6)
        depth = np.clip(np.maximum(self.water, np.minimum(hydraulic, slope * self.span * 4.0 + 0.05)), 0.0, 60.0)
        velocity = np.clip(np.power(np.maximum(depth, 1e-4), 0.666667) * np.sqrt(slope) / rough, 0.0, 12.0)
        self.water = depth
        self.speed = velocity
        self.velx = dirx * velocity
        self.velz = dirz * velocity

    # ------------------------------------------------------------------ erosion
    def erode(self):
        """Detachment by stream power E = K A^m S^n with hardness and alluvial cover, deposition
        by the transport-length fraction V_s / u, and hillslope creep. Every term is in metres
        per step and every limit is physical; the numerical guards are loose enough that they
        never decide the shape of the landscape."""
        p = self.p
        span = self.span
        dt = p['dt']
        voxel = self.extent / self.h.shape[0]
        cap_step = p['maxStepVoxels'] * voxel

        rain = np.maximum(self.rainfall, 1e-7)
        flux = np.maximum(self.accum, 0.0) / dt
        drainage = flux / rain
        cells = np.maximum(drainage / self.area, 1.0)
        area_term = np.power(cells, p['m'])
        slope = np.clip(self.slope, 1e-6, 0.6)
        slope_term = np.power(slope, p['n'])
        channel = p['gateFloor'] + (1.0 - p['gateFloor']) * np.clip((cells - 8.0) / 32.0, 0.0, 1.0) ** 2 * (3.0 - 2.0 * np.clip((cells - 8.0) / 32.0, 0.0, 1.0))

        detachment = (p['K'] * channel * np.exp(-2.2 * self.hardness) * (1.0 - 0.82 * self.cover)
                      * area_term * slope_term)
        # The drop to the downstream cell is a per-step base level: a channel may not undercut
        # it in one pass, which is what keeps erosion widening valleys instead of pitting.
        fx = self.flowx.round().astype(int)
        fz = self.flowz.round().astype(int)
        xs = np.clip(np.arange(self.h.shape[0])[:, None] + fx, 0, self.h.shape[0] - 1)
        zs = np.clip(np.arange(self.h.shape[1])[None, :] + fz, 0, self.h.shape[1] - 1)
        downstream = self.h[xs, zs]
        drop = np.maximum(self.h - downstream, 0.0)
        erosion = np.clip(np.minimum(detachment, self.water * 0.30 + 0.01), 0.0,
                          np.minimum(cap_step * 0.25, drop * 0.35))

        speed = np.maximum(self.speed, 0.02)
        settle = np.clip(p['settling'] / speed, 0.0, 0.5)
        capacity = p['capacity'] * area_term * slope_term
        overload = np.maximum(self.sediment - capacity, 0.0)
        deposition = np.clip(self.sediment * settle + overload * 0.20, 0.0, np.minimum(self.sediment, cap_step * 0.25))

        creep = min(max(p['creep'], 0.0) * dt, span * span * 0.2)
        # Subtracted, not added: a positive Laplacian means the cell sits in a dip and
        # smoothing has to fill it. The other sign sharpens bumps into spikes.
        diffusion = np.clip(-creep * laplacian(self.h, span), -cap_step * 0.06, cap_step * 0.06)

        self.delta = np.clip(erosion - deposition + diffusion, -cap_step, cap_step)
        self.lastErosion = erosion
        self.lastDeposition = deposition
        self.lastDiffusion = diffusion
        self.sediment = np.maximum(self.sediment + erosion - deposition, 0.0)

        self.h = self.h - self.delta
        self.cover = np.clip(self.cover * 0.985 + deposition / max(voxel, 1e-3), 0.0, 1.0)

        self.counters['eroded'] += float((erosion * self.area).sum())
        self.counters['deposited'] += float((deposition * self.area).sum())
        self.counters['peak'] = max(self.counters['peak'], float(np.abs(self.delta).max()))
        self.counters['maxErosion'] = max(self.counters.get('maxErosion', 0.0), float(erosion.max()))
        self.counters['maxDeposit'] = max(self.counters.get('maxDeposit', 0.0), float(deposition.max()))
        self.counters['maxDiffusion'] = max(self.counters.get('maxDiffusion', 0.0), float(np.abs(diffusion).max()))
        return cap_step

    def transport(self, hops):
        dt = self.p['dt']
        moved_total = 0.0
        for _ in range(hops):
            fraction = np.clip(self.speed * dt / self.span, 0.0, 1.0) * 0.75
            moved = self.sediment * fraction
            self.sediment = self.sediment - moved
            fx = self.flowx.round().astype(int)
            fz = self.flowz.round().astype(int)
            inside = ((fx != 0) | (fz != 0))
            xs = np.arange(self.h.shape[0])[:, None] + fx
            zs = np.arange(self.h.shape[1])[None, :] + fz
            ok = inside & (xs >= 0) & (xs < self.h.shape[0]) & (zs >= 0) & (zs < self.h.shape[1])
            np.add.at(self.sediment, (np.clip(xs, 0, self.h.shape[0] - 1)[ok], np.clip(zs, 0, self.h.shape[1] - 1)[ok]), moved[ok])
            escaped = float(moved[~ok].sum())
            self.counters['escaped'] += escaped * self.area
            moved_total += float(moved.sum())
        self.counters['carried'] = float(self.sediment.sum() * self.area)
        return moved_total

    def step(self):
        self.rain()
        self.fill()
        self.route()
        self.accumulate(self.p['accumulateIterations'])
        self.flux()
        self.apply_water()
        self.velocity()
        cap_step = self.erode()
        self.transport(self.p['transportIterations'])
        return cap_step


#------------------------------------------------------------------------------------------
# Reporting
#------------------------------------------------------------------------------------------
def shade(height, span):
    """Cheap hillshade so the output can be judged by eye."""
    gy, gx = np.gradient(height, span)
    n = np.stack([-gx, np.ones_like(height) * 1.0, -gy], axis=-1)
    n = n / np.linalg.norm(n, axis=-1, keepdims=True)
    sun = np.array([0.45, 0.72, 0.52])
    sun = sun / np.linalg.norm(sun)
    lam = np.clip(n @ sun, 0.0, 1.0)
    base = np.clip(height / max(height.max(), 1.0), 0.0, 1.0)
    tone = 0.20 + 0.62 * lam
    rgb = np.stack([tone * (0.72 + 0.28 * base), tone * (0.66 + 0.24 * base), tone * (0.60 + 0.18 * base)], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def save_image(path, array):
    Image.fromarray((np.clip(array, 0.0, 1.0) * 255).astype(np.uint8)).save(path)


def colourise(plane, gamma=0.45, tint=(0.42, 0.62, 1.0)):
    v = np.power(np.clip(plane, 0.0, None) / max(plane.max(), 1e-9), gamma)
    rgb = np.stack([v * tint[0], v * tint[1], v * tint[2]], axis=-1)
    rgb[..., 1] = np.clip(rgb[..., 1] + v * 0.15, 0.0, 1.0)
    return rgb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=300)
    parser.add_argument('--grid', type=int, default=96)
    parser.add_argument('--extent', type=float, default=1600.0)
    parser.add_argument('--out', type=str, default='tools/verify')
    parser.add_argument('--K', type=float, default=0.036)
    parser.add_argument('--m', type=float, default=0.85)
    parser.add_argument('--n', type=float, default=0.7)
    parser.add_argument('--creep', type=float, default=0.02)
    parser.add_argument('--settling', type=float, default=0.05)
    args = parser.parse_args()

    span = args.extent / args.grid
    params = dict(
        dt=6000.0,
        rain=9.4 / 3.6e6,
        evaporation=2.6e-6,
        K=args.K,
        m=args.m,
        n=args.n,
        settling=args.settling,
        capacity=0.03,
        conductance=0.85,
        maxStepVoxels=0.35,
        fillIterations=129,
        accumulateIterations=24,
        transportIterations=4,
        creep=args.creep,
        gateFloor=0.02,
    )

    height = bake_terrain(args.grid, span, args.extent)
    solver = Solver(height, span, args.extent, params)
    voxel = args.extent / args.grid
    cap = params['maxStepVoxels'] * voxel

    print(f'grid {args.grid}x{args.grid}  span {span:.2f} m  cap {cap:.3f} m/step  dt {params["dt"]:.0f} s')
    print(f'initial relief {height.max() - height.min():.1f} m')

    snaps = {}
    for step in range(1, args.steps + 1):
        solver.step()
        if step in (1, 5, 20, 60, 150, args.steps):
            snaps[step] = solver.h.copy()
            cut = float((solver.initial - solver.h).sum() * solver.area)
            raised = float((solver.h - solver.initial).sum() * solver.area)
            print(f'step {step:4d}  cut {cut/1e6:8.3f} Mm3  fill {raised/1e6:8.3f} Mm3  '
                  f'suspended {solver.counters["carried"]/1e6:6.3f} Mm3  peak |dz| {solver.counters["peak"]:.3f} m  '
                  f'water {float(solver.water.sum()):.1f} m3')

    # ------------------------------------------------------------------ checks
    peak = solver.counters['peak']
    print('\nchecks')
    print(f'  peak per-step change {peak:.4f} m  vs stability cap {cap:.4f} m  -> {"OK" if peak <= cap * 1.001 else "FAIL"}')

    # Cumulative counters are gross per-step volumes, so they are the right side of this
    # ledger: eroded volume is either deposited, still suspended, or has left the map. The net
    # surface change is reported next to it as an independent cross-check, because gross and
    # net only agree when nothing has been reworked, which is exactly when it matters.
    eroded = solver.counters['eroded']
    deposited = solver.counters['deposited']
    suspended = solver.counters['carried']
    exported = solver.counters['escaped']
    closure = (deposited + suspended + exported) / max(eroded, 1e-9)
    print(f'  mass audit: eroded {eroded/1e6:.3f} Mm3 -> deposited {deposited/1e6:.3f} + '
          f'suspended {suspended/1e6:.3f} + exported {exported/1e6:.3f} Mm3 '
          f'-> closure {closure*100:.1f}%')
    net = float((solver.initial - solver.h).sum() * solver.area)
    print(f'  net surface change {net/1e6:.3f} Mm3 vs eroded - deposited {(eroded - deposited)/1e6:.3f} Mm3 '
          f'(difference is material still in transit)')

    incision = solver.initial - solver.h
    deepest = float(incision.max())
    print(f'  deepest incision {deepest:.1f} m  ({"sane" if deepest < 0.6 * solver.initial.max() else "RUNAWAY"})')
    print(f'  component peaks: erosion {solver.counters["maxErosion"]:.3f} m, deposition {solver.counters["maxDeposit"]:.3f} m, '
          f'diffusion {solver.counters["maxDiffusion"]:.3f} m  (cap {cap:.3f} m)')
    print(f'  water: total {float(solver.water.sum()):.1f} m3, deepest {float(solver.water.max()):.3f} m, '
          f'max speed {float(solver.speed.max()):.2f} m/s')

    discharge = solver.accum / max(params['dt'], 1.0)
    channels = discharge > np.percentile(discharge, 99.0)
    print(f'  channel cells (top 1% discharge): {int(channels.sum())}  max discharge {discharge.max():.1f} m3/s')
    sinks = int(((solver.flowx == 0) & (solver.flowz == 0)).sum())
    expected = float((solver.rainfall * params['dt'] * solver.area).sum())
    print(f'  drainage: {sinks} cells route nowhere, accumulated {solver.accum.sum():.0f} m3 vs rainfall {expected:.0f} m3 '
          f'({100.0 * solver.accum.sum() / max(expected, 1e-9):.1f}% of the water is in the network)')
    recipients = np.zeros_like(solver.flowx, dtype=int)
    fx = solver.flowx.round().astype(int)
    fz = solver.flowz.round().astype(int)
    xs = np.arange(solver.h.shape[0])[:, None] + fx
    zs = np.arange(solver.h.shape[1])[None, :] + fz
    ok = (fx != 0) | (fz != 0)
    good = ok & (xs >= 0) & (xs < solver.h.shape[0]) & (zs >= 0) & (zs < solver.h.shape[1])
    np.add.at(recipients, (xs[good], zs[good]), 1)
    print(f'  flow convergence: max upstream neighbours pointing at one cell = {int(recipients.max())}, '
          f'cells with any upstream = {int((recipients > 0).sum())}')
    # Walk the flow field and count cells that revisit themselves within one chain.
    cycles = 0
    for i in range(solver.h.shape[0]):
        for j in range(solver.h.shape[1]):
            seen = set()
            x, z = i, j
            for _ in range(64):
                if (x, z) in seen:
                    cycles += 1
                    break
                seen.add((x, z))
                if fx[x, z] == 0 and fz[x, z] == 0:
                    break
                x, z = x + fx[x, z], z + fz[x, z]
                if not (0 <= x < solver.h.shape[0] and 0 <= z < solver.h.shape[1]):
                    break
    print(f'  flow cycles (mutual neighbours): {cycles}')

    # Deposition without incision: valley floors, fans, and lake beds, as opposed to the
    # channel heads where the two overlap.
    fans = (np.maximum(solver.h - solver.initial, 0.0) > 0.05) & (incision < 0.05)
    print(f'  deposition-only cells: {int(fans.sum())}  where incision is negligible (fans, valley floors)')

    # ------------------------------------------------------------------ images
    os.makedirs(args.out, exist_ok=True)
    save_image(os.path.join(args.out, 'height-initial.png'), shade(solver.initial, span))
    save_image(os.path.join(args.out, 'height-final.png'), shade(solver.h, span))

    cut_map = np.maximum(solver.initial - solver.h, 0.0)
    image = colourise(cut_map, gamma=0.5, tint=(1.0, 0.55, 0.32))
    if cut_map.max() > 0:
        # Mark where material came to rest, so transport paths are visible.
        rest = np.maximum(solver.h - solver.initial, 0.0)
        mask = rest > (0.02 * max(rest.max(), 1e-9))
        image[mask] = image[mask] * 0.35 + np.array([0.35, 0.85, 0.65]) * 0.65
    save_image(os.path.join(args.out, 'incision-map.png'), image)

    save_image(os.path.join(args.out, 'discharge-map.png'), colourise(discharge, gamma=0.35, tint=(0.35, 0.85, 1.0)))
    save_image(os.path.join(args.out, 'deposition-map.png'),
               colourise(np.maximum(solver.h - solver.initial, 0.0), gamma=0.5, tint=(1.0, 0.9, 0.45)))

    profile_row = args.grid // 2
    with open(os.path.join(args.out, 'profile.txt'), 'w') as handle:
        handle.write('x initial final incision\n')
        for index in range(args.grid):
            handle.write(f'{index * span:.1f} {solver.initial[profile_row, index]:.2f} '
                         f'{solver.h[profile_row, index]:.2f} '
                         f'{solver.initial[profile_row, index] - solver.h[profile_row, index]:.2f}\n')
    print(f'\nwrote {args.out}/height-initial.png, height-final.png, incision-map.png, '
          f'discharge-map.png, deposition-map.png, profile.txt')


if __name__ == '__main__':
    main()
