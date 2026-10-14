#!/usr/bin/env python3
"""Convert Frontier Project-Drive's ControlVehicleStructure.inl -> assets/control-vehicle.json.
Source: https://github.com/SultanAladin/Frontier- (Projects/Project-Drive -> EngineContent/GeometryArchives/ControlVehicleStructure.inl)
Authored bounds X[-3.11,3.11] Y[-1.25,1.25] Z[-0.11,1.35] metres, +X fwd / +Y left / +Z up.
Usage: python3 tools/convert-control-vehicle.py /path/to/ControlVehicleStructure.inl
"""
import re, json, sys
src = open(sys.argv[1]).read()
def arr(name, pat):
    m = re.search(name + r'\[\][^=]*=\s*\{(.*?)\};', src, re.S)
    return re.findall(pat, m.group(1))
pos = [round(float(x.rstrip('f')), 5) for x in arr('kPositions', r'-?[\d.]+f')]
tri = [int(x) for x in arr('kTriangles', r'\d+')]
fam = [int(x) for x in arr('kTriangleFamily', r'\d+')]
assert len(pos) == 4476 and len(tri) == 8772 and len(fam) == 2924
json.dump({"positions": pos, "triangles": tri, "families": fam}, open('assets/control-vehicle.json', 'w'))
print('wrote assets/control-vehicle.json', len(pos)//3, 'verts', len(fam), 'tris')
