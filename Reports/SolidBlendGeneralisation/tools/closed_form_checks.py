"""Independent closed-form volume checks for the planar cases, so 'accepted' is not the only evidence.

Box a = b = c = 4 (all edges convex, 90 degrees).

Fillet, all 12 edges, radius r: the rounded box is the Minkowski sum of the inner box (a-2r)^3 with a ball of radius r,
so by the Steiner formula  V = pqs + 2r(pq+qs+ps) + pi r^2 (p+q+s) + 4/3 pi r^3  with p = q = s = a - 2r.

Chamfer, all 12 edges, symmetric setback s: each edge removes a triangular prism (area s^2/2, length a - 2s) and each
corner removes a tetrahedron (volume s^3/6), so  V = a^3 - 12 (s^2/2)(a - 2s) - 8 s^3/6.

Single edge, fillet radius r: removal (1 - pi/4) r^2 L.  Single edge, chamfer s: removal s^2 L / 2.  (L = 4)
"""
import json
import math
import sys

from nh import Host

A = 4.0
L = 4.0


def FilletAllExpected(R):
    P = A - 2 * R
    return P ** 3 + 2 * R * 3 * P * P + math.pi * R * R * 3 * P + 4.0 / 3.0 * math.pi * R ** 3


def ChamferAllExpected(S):
    return A ** 3 - 12 * (S * S / 2) * (A - 2 * S) - 8 * S ** 3 / 6


def Volume(H, Name):
    H.Cmd(f'topology {Name} --summary')
    import re
    for Line in H.Text:
        M = re.search(r'χ=(-?\d+)\s+genus (-?\d+)\s+closed (yes|no)\s+manifold (yes|no)\s+oriented (yes|no)\s+volume ([-\d.eE+]+)', Line)
        if M:
            return dict(chi=int(M.group(1)), valid=(M.group(3, 4, 5) == ('yes', 'yes', 'yes') and M.group(2) == '0'),
                        volume=float(M.group(6)))
    return None


def Run(Out):
    H = Host(120)
    Rows = {'all_edges_fillet': [], 'all_edges_chamfer': [], 'single_edge_fillet': [], 'single_edge_chamfer': []}
    for R in (0.1, 0.3, 0.5, 1.0):
        H.Cmd('reset', f'box (0,0,0) ({A},{A},{A}) --name=B')
        Edges = ','.join(str(i) for i in range(12))
        Res = H.Cmd(f'fillet B {R} --edges={Edges}')
        Name = [F['name'] for F in Res['description']['figures'] if F['name'].startswith('B')][-1] if Res['success'] else None
        Got = Volume(H, Name) if Name else None
        Exp = FilletAllExpected(R)
        Rows['all_edges_fillet'].append(dict(radius=R, accepted=Res['success'], expected=Exp,
                                             measured=Got and Got['volume'], valid=Got and Got['valid'],
                                             error=Got and abs(Got['volume'] - Exp)))
    for S in (0.1, 0.3, 0.5, 1.0):
        H.Cmd('reset', f'box (0,0,0) ({A},{A},{A}) --name=B')
        Edges = ','.join(str(i) for i in range(12))
        Res = H.Cmd(f'chamfer B {S} --edges={Edges} --name=B')
        Name = [F['name'] for F in Res['description']['figures'] if F['name'].startswith('B')][-1] if Res['success'] else None
        Got = Volume(H, Name) if Name else None
        Exp = ChamferAllExpected(S)
        Rows['all_edges_chamfer'].append(dict(setback=S, accepted=Res['success'], expected=Exp,
                                              measured=Got and Got['volume'], valid=Got and Got['valid'],
                                              error=Got and abs(Got['volume'] - Exp)))
    for R in (0.1, 0.5, 1.0, 1.5, 1.9, 2.5, 3.5, 3.9):
        H.Cmd('reset', f'box (0,0,0) ({A},{A},{A}) --name=B')
        Res = H.Cmd(f'fillet B {R} --edges=0')
        Name = [F['name'] for F in Res['description']['figures'] if F['name'].startswith('B')][-1] if Res['success'] else None
        Got = Volume(H, Name) if Name else None
        Exp = A ** 3 - (1 - math.pi / 4) * R * R * L
        Rows['single_edge_fillet'].append(dict(radius=R, accepted=Res['success'], expected=Exp,
                                               measured=Got and Got['volume'], valid=Got and Got['valid'],
                                               error=Got and abs(Got['volume'] - Exp)))
    for S in (0.1, 0.5, 1.0, 1.5, 1.9, 2.5, 3.5, 3.9):
        H.Cmd('reset', f'box (0,0,0) ({A},{A},{A}) --name=B')
        Res = H.Cmd(f'chamfer B {S} --edges=0 --name=B')
        Name = [F['name'] for F in Res['description']['figures'] if F['name'].startswith('B')][-1] if Res['success'] else None
        Got = Volume(H, Name) if Name else None
        Exp = A ** 3 - S * S / 2 * L
        Rows['single_edge_chamfer'].append(dict(setback=S, accepted=Res['success'], expected=Exp,
                                                measured=Got and Got['volume'], valid=Got and Got['valid'],
                                                error=Got and abs(Got['volume'] - Exp)))
    H.Close()
    with open(Out, 'w') as F:
        json.dump(Rows, F, indent=2)
    for Section, Items in Rows.items():
        print(Section)
        for I in Items:
            print('  ', {K: (round(V, 6) if isinstance(V, float) else V) for K, V in I.items()})
    print('wrote', Out)


if __name__ == '__main__':
    Run(sys.argv[1] if len(sys.argv) > 1 else 'closed_form_checks.json')
