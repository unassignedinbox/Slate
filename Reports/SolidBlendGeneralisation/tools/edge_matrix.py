"""Probe: which edges of which solids does the SolidArc native kernel accept for fillet / chamfer, and is the result valid?

Each trial rebuilds the body from scratch (reset + recipe), applies ONE console operation to ONE edge index, then reads
the topology summary of the result. A trial counts as valid only when the native summary reports closed, manifold,
oriented, genus 0 and chi = 2 and the volume moved in the expected direction. Results are written per body so a hang
in one body does not lose the others.
"""
import json
import os
import re
import sys
import time

from nh import CommandTimeout, Host

RADIUS = 0.3          # [m] fillet radius for every trial (4-unit parts)
SETBACK = 0.3         # [m] chamfer setback for every trial
LIMIT = float(os.environ.get('PROBE_LIMIT', '60'))   # [s] per-command watchdog

BODIES = {
    'box': ['box (0,0,0) (4,4,4) --name=B'],
    'cylinder': ['cylinder (0,0,0) 2 4 --name=B'],
    'cone_frustum': ['cone (0,0,0) 2 1 4 --name=B'],
    'sphere': ['sphere (0,0,0) 2 --name=B'],
    'torus': ['torus (0,0,0) 2 0.5 --name=B'],
    'box_minus_cyl_hole': ['box (-2,-2,-2) (2,2,2) --name=A', 'cylinder (0,0,-3) 0.8 6 --name=T',
                           'boolean subtract A -- T --name=B'],
    'box_plus_cyl_boss': ['box (-2,-2,-2) (2,2,2) --name=A', 'cylinder (0,0,1) 1 2 --name=T',
                          'boolean union A -- T --name=B'],
    'L_union_boxes': ['box (0,0,0) (4,4,4) --name=A', 'box (2,2,0) (6,6,4) --name=T', 'boolean union A -- T --name=B'],
    'sphere_minus_box_corner': ['sphere (0,0,0) 1.5 --name=A', 'box (0,0,0) (3,3,3) --name=T',
                                'boolean subtract A -- T --name=B'],
    'box_minus_sphere_pocket': ['box (0,0,0) (4,4,4) --name=A', 'sphere (2,2,4) 1.5 --name=T',
                                'boolean subtract A -- T --name=B'],
    # Equal-radius perpendicular bores are a degenerate Boolean (refused); the unequal-radius variant is the usable case.
    'cylinder_cross_bore_equal_radii': ['cylinder (0,0,-3) 1 6 --name=A', 'cylinder (-3,0,0) 1 6 --axis=(1,0,0) --name=T',
                                        'boolean subtract A -- T --name=B'],
    'cylinder_cross_bore_r07': ['cylinder (0,0,-3) 1 6 --name=A', 'cylinder (-3,0,0) 0.7 6 --axis=(1,0,0) --name=T',
                                'boolean subtract A -- T --name=B'],
    'box_intersect_cylinder': ['box (-2,-2,-2) (2,2,2) --name=A', 'cylinder (0,0,-3) 2.5 6 --name=T',
                               'boolean intersect A -- T --name=B'],
    'tilted_cylinder': ['cylinder (0,0,0) 1.5 4 --axis=(1,1,1) --name=B'],
}

SUMMARY = re.compile(r'χ=(-?\d+)\s+genus (-?\d+)\s+closed (yes|no)\s+manifold (yes|no)\s+oriented (yes|no)\s+volume ([-\d.eE+]+)')


def ResultName(Response, Base):
    """Name of the solid produced by the last transactional operation (ops rename the body, e.g. B -> B.Filleted)."""
    Names = [F['name'] for F in Response['description']['figures'] if F['name'].startswith(Base)]
    return Names[-1] if Names else None


def Measure(H, Name):
    H.Cmd(f'topology {Name} --summary')
    for Line in H.Text:
        M = SUMMARY.search(Line)
        if M:
            return dict(chi=int(M.group(1)), genus=int(M.group(2)), closed=M.group(3) == 'yes',
                        manifold=M.group(4) == 'yes', oriented=M.group(5) == 'yes', volume=float(M.group(6)))
    return None


def Refusal(H):
    """The native error line: console lines marked with the cross mark. 'dim auto' housekeeping lines are ignored."""
    Lines = [L.strip().lstrip('✗').strip() for L in H.Text if '✗' in L]
    return Lines[-1:] if Lines else ['no error line reported']


def Trial(H, Recipe, Operation, Edge, Value):
    H.Cmd('reset', *Recipe)
    before = Measure(H, 'B')
    if Operation == 'fillet':
        R = H.Cmd(f'fillet B {Value} --edges={Edge}')
    else:
        R = H.Cmd(f'chamfer B {Value} --edges={Edge} --name=B')
    if not R['success']:
        return dict(status='refused', refusal=Refusal(H))
    name = ResultName(R, 'B')
    after = Measure(H, name) if name else None
    if after is None:
        return dict(status='unreadable')
    # Relative test: a blend cannot change the Euler characteristic or genus of its source (a through-hole is genus 1 and
    # legitimately stays so; a chamfer that creates a tunnel on a genus-0 body is wrong).
    valid = (after['closed'] and after['manifold'] and after['oriented']
             and after['chi'] == before['chi'] and after['genus'] == before['genus'])
    return dict(status='accepted' if valid else 'accepted-but-invalid', source_chi=before['chi'],
                source_genus=before['genus'], chi=after['chi'], genus=after['genus'],
                volume_before=before['volume'], volume_after=after['volume'],
                volume_delta=after['volume'] - before['volume'])


def Edges(H, Recipe):
    """Build the source body. Returns (edge count, refusal text); the count is 0 when the recipe does not produce 'B'."""
    R = H.Cmd('reset', *Recipe)
    for F in H.Cmd('list')['description']['figures']:
        if F['name'] == 'B':
            return F['edges'], ''
    return 0, ' / '.join(Refusal(H))


def Run(Out):
    Only = [B for B in os.environ.get('PROBE_ONLY', '').split(',') if B]
    Selected = {K: V for K, V in BODIES.items() if not Only or K in Only}
    results = {'radius': RADIUS, 'setback': SETBACK, 'watchdog_seconds': LIMIT,
               'occt_worker': os.environ.get('SOLIDARC_OCCT_BLEND_HOST', 'not set'), 'bodies': {}}
    H = Host(LIMIT)
    for Body, Recipe in Selected.items():
        Start = time.time()
        try:
            Count, Why = Edges(H, Recipe)
        except CommandTimeout as Error:
            H = Host(LIMIT)
            results['bodies'][Body] = dict(edges=None, rows=[], note=f'setup timed out: {Error}')
            print(Body, 'setup timed out', flush=True)
            continue
        if Count == 0:
            results['bodies'][Body] = dict(edges=0, rows=[], note=f'source not built: {Why}')
            print(Body, 'source not built:', Why, flush=True)
            continue
        Rows = []
        for Edge in range(Count):
            Row = dict(edge=Edge)
            for Op, Value in (('fillet', RADIUS), ('chamfer', SETBACK)):
                try:
                    Row[Op] = Trial(H, Recipe, Op, Edge, Value)
                except CommandTimeout as Error:
                    Row[Op] = dict(status='timeout', detail=str(Error))
                    H = Host(LIMIT)
            Rows.append(Row)
        results['bodies'][Body] = dict(edges=Count, rows=Rows, seconds=round(time.time() - Start, 2),
                                       source_chi=next((X.get('source_chi') for R in Rows for X in R.values()
                                                        if isinstance(X, dict) and 'source_chi' in X), None),
                                       source_genus=next((X.get('source_genus') for R in Rows for X in R.values()
                                                          if isinstance(X, dict) and 'source_genus' in X), None))
        with open(Out, 'w') as F:
            json.dump(results, F, indent=2, ensure_ascii=False)
        Timeouts = sum(1 for R in Rows for Op in ('fillet', 'chamfer') if R.get(Op, {}).get('status') == 'timeout')
        print(f'{Body}: edges={Count} timeouts={Timeouts} seconds={round(time.time() - Start, 1)}', flush=True)
    H.Close()
    print('wrote', Out, flush=True)


if __name__ == '__main__':
    Run(sys.argv[1] if len(sys.argv) > 1 else 'edge_matrix.json')
