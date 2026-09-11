"""Erosion-tuning harness.

The CPU twin in reference-sim.py reproduces the GPU solver pass for pass, so a parameter sweep
here is a sweep of the real model rather than of a caricature of it. What makes a landscape
model trustworthy is not that it cuts somewhere, but that it cuts where the water goes: these
scores measure exactly that, so tuning stops being a matter of taste.

  network    Pearson correlation between log drainage area and cumulative detachment.
             A real drainage network gives 0.6 or better; uncorrelated honeycomb gives ~0.
  focus      Share of all detachment that happens in the top 5% of cells by discharge.
             Channelised erosion concentrates; uniform erosion does not.
  relief     Deepest incision as a fraction of initial relief. Under 0.35 the landscape has
             not been sculpted yet; over 1.5 the run is dissolving rather than eroding.
  volume     Suspended / (suspended + deposited) sediment, which should stay small: a river
             that never drops its load cannot build valley floors or fans.

Usage:  python3 tools/tune-erosion.py [--steps N] [--grid M] [--quick]
"""

import argparse
import importlib.util
import itertools
import os
import sys
import time

try:
    import numpy as np
except ImportError:
    sys.exit('This tool needs numpy. On a managed Python: python3 -m venv /tmp/venv && '
             '/tmp/venv/bin/pip install numpy, then run it with /tmp/venv/bin/python.')

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location('reference_sim', os.path.join(HERE, 'reference-sim.py'))
reference = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reference)


def run_once(params, grid, extent, steps):
    """Run one configuration and return the solver plus the accumulated detachment field."""
    span = extent / grid
    height = reference.bake_terrain(grid, span, extent)
    solver = reference.Solver(height, span, extent, params)

    detachment = np.zeros_like(height)
    aggradation = np.zeros_like(height)
    for _ in range(steps):
        solver.step()
        detachment += solver.lastErosion
        aggradation += solver.lastDeposition

    return solver, detachment, aggradation


def score(solver, detachment, aggradation, steps):
    """Valley-ness metrics. Every one of them is something a geomorphologist would recognise."""
    discharge = np.maximum(solver.accum, 0.0)
    drain = np.maximum(discharge, 1.0)
    wet = detachment > 1e-4

    if wet.sum() > 16 and np.std(np.log10(drain[wet])) > 0:
        network = float(np.corrcoef(np.log10(drain[wet]), detachment[wet])[0, 1])
    else:
        network = 0.0

    flat = discharge.ravel()
    order = np.argsort(flat)[::-1]
    top = order[:max(1, int(flat.size * 0.05))]
    total = float(detachment.sum())
    focus = float(detachment.ravel()[top].sum() / max(total, 1e-9))

    relief = float((solver.initial - solver.h).max() / max(solver.initial.max() - solver.initial.min(), 1e-9))
    suspended = float(solver.sediment.sum() * solver.area)
    deposited = float(aggradation.sum() * solver.area)
    volume = suspended / max(suspended + deposited, 1e-9)

    incision = np.maximum(solver.initial - solver.h, 0.0)
    mean_cut = float(incision.mean())
    peak_cut = float(incision.max())

    return dict(network=network, focus=focus, relief=relief, volume=volume,
                mean_cut=mean_cut, peak_cut=peak_cut)


def merge(base, overrides):
    params = dict(base)
    params.update(overrides)
    return params


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=120)
    parser.add_argument('--grid', type=int, default=64)
    parser.add_argument('--extent', type=float, default=1600.0)
    parser.add_argument('--quick', action='store_true')
    args = parser.parse_args()

    base = dict(
        dt=6000.0, rain=9.4 / 3.6e6, evaporation=2.6e-6,
        K=0.00042, m=0.52, n=1.08, settling=0.12, capacity=0.03,
        conductance=0.85, maxStepVoxels=0.35, fillIterations=129,
        accumulateIterations=24, transportIterations=4, creep=0.02, gateFloor=0.02,
    )

    if args.quick:
        sweep = [dict(K=k, m=m) for k, m in itertools.product([0.004, 0.036], [0.68, 0.85])]
    else:
        sweep = [dict(m=m, n=n, gateFloor=f)
                 for m, n, f in itertools.product([0.85, 1.0, 1.15], [1.08, 0.7, 0.5], [0.02])]

    print(f'{"m":>9} {"n":>9} {"gateFloor":>9} | {"network":>8} {"focus":>7} {"relief":>7} '
          f'{"volume":>7} {"meanCut":>8} {"peakCut":>8} | {"s":>5}')
    rows = []
    for overrides in sweep:
        params = merge(base, overrides)
        started = time.time()
        solver, detachment, aggradation = run_once(params, args.grid, args.extent, args.steps)
        elapsed = time.time() - started
        metrics = score(solver, detachment, aggradation, args.steps)
        rows.append((overrides, metrics))
        print(f'{params["m"]:9.3f} {params["n"]:9.3f} {params["gateFloor"]:9.3f} | '
              f'{metrics["network"]:8.3f} {metrics["focus"]:7.3f} {metrics["relief"]:7.3f} '
              f'{metrics["volume"]:7.4f} {metrics["mean_cut"]:8.4f} {metrics["peak_cut"]:8.2f} | {elapsed:5.1f}')

    print('\nranking by network correlation (higher is a more channelised landscape)')
    for overrides, metrics in sorted(rows, key=lambda row: -row[1]['network'])[:5]:
        print(f'  {overrides}  ->  network {metrics["network"]:.3f}, focus {metrics["focus"]:.3f}, '
              f'relief {metrics["relief"]:.3f}, volume {metrics["volume"]:.4f}')


if __name__ == '__main__':
    main()
