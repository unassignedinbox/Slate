"""Tiny glTF 2.0 / GLB writer (meshes on a node hierarchy + TRS animations)."""
import json
import struct


class GLTF:
    def __init__(self):
        self.nodes = []
        self.meshes = []
        self.materials = []
        self.animations = []
        self.bin = bytearray()
        self.bufferViews = []
        self.accessors = []
        self.scene_roots = []

    # ------------------------------------------------------------ buffers
    def _pad(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def _view(self, data, target=None):
        self._pad()
        off = len(self.bin)
        self.bin += data
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            bv["target"] = target
        self.bufferViews.append(bv)
        return len(self.bufferViews) - 1

    def acc_f(self, values, kind, target=None):
        """values: list of tuples (or floats for SCALAR)"""
        comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[kind]
        flat = []
        for v in values:
            if comps == 1:
                flat.append(v)
            else:
                flat.extend(v)
        data = struct.pack("<%df" % len(flat), *flat)
        bv = self._view(data, target)
        mins = [min(flat[i::comps]) for i in range(comps)]
        maxs = [max(flat[i::comps]) for i in range(comps)]
        self.accessors.append({"bufferView": bv, "componentType": 5126,
                               "count": len(values), "type": kind,
                               "min": mins, "max": maxs})
        return len(self.accessors) - 1

    def acc_idx(self, indices):
        big = max(indices) > 65535
        fmt = "<%dI" if big else "<%dH"
        data = struct.pack(fmt % len(indices), *indices)
        bv = self._view(data, 34963)
        self.accessors.append({"bufferView": bv,
                               "componentType": 5125 if big else 5123,
                               "count": len(indices), "type": "SCALAR"})
        return len(self.accessors) - 1

    # ------------------------------------------------------------- assets
    def add_material(self, name, base, metallic=0.2, rough=0.4, emissive=None):
        m = {"name": name,
             "pbrMetallicRoughness": {"baseColorFactor": list(base),
                                      "metallicFactor": metallic,
                                      "roughnessFactor": rough},
             "doubleSided": False}
        if emissive:
            m["emissiveFactor"] = list(emissive)
        self.materials.append(m)
        return len(self.materials) - 1

    def add_mesh(self, name, prims):
        """prims: list of geom.Mesh (already normal-computed)"""
        gl_prims = []
        for p in prims:
            attrs = {"POSITION": self.acc_f(p.v, "VEC3", 34962),
                     "NORMAL": self.acc_f(p.n, "VEC3", 34962),
                     "TEXCOORD_0": self.acc_f(p.uv, "VEC2", 34962)}
            gl_prims.append({"attributes": attrs,
                             "indices": self.acc_idx(p.idx),
                             "material": p.material})
        self.meshes.append({"name": name, "primitives": gl_prims})
        return len(self.meshes) - 1

    def add_node(self, name, t=(0, 0, 0), r=(0, 0, 0, 1), s=None,
                 mesh=None, parent=None):
        n = {"name": name, "translation": list(t), "rotation": list(r)}
        if s:
            n["scale"] = list(s)
        if mesh is not None:
            n["mesh"] = mesh
        self.nodes.append(n)
        i = len(self.nodes) - 1
        if parent is None:
            self.scene_roots.append(i)
        else:
            self.nodes[parent].setdefault("children", []).append(i)
        return i

    # --------------------------------------------------------- animations
    def add_animation(self, name, tracks):
        """tracks: list of (node, path, times[], values[])"""
        samplers, channels = [], []
        for node, path, times, values in tracks:
            kind = {"rotation": "VEC4", "translation": "VEC3",
                    "scale": "VEC3"}[path]
            ti = self.acc_f(times, "SCALAR")
            vi = self.acc_f(values, kind)
            samplers.append({"input": ti, "output": vi,
                             "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1,
                             "target": {"node": node, "path": path}})
        self.animations.append({"name": name, "samplers": samplers,
                                "channels": channels})

    # -------------------------------------------------------------- write
    def _json(self):
        return {
            "asset": {"version": "2.0",
                      "generator": "Slate procedural arthropod builder"},
            "scene": 0,
            "scenes": [{"nodes": self.scene_roots}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "animations": self.animations,
            "buffers": [{"byteLength": len(self.bin)}],
            "bufferViews": self.bufferViews,
            "accessors": self.accessors,
        }

    def save_glb(self, path):
        self._pad()
        j = self._json()
        js = json.dumps(j, separators=(",", ":")).encode("utf-8")
        while len(js) % 4:
            js += b" "
        b = bytes(self.bin)
        total = 12 + 8 + len(js) + 8 + len(b)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(b), 0x004E4942)); f.write(b)
        return total
