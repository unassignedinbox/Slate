#!/usr/bin/env python3
"""Encode a compact median-split bounding hierarchy beside the ShaderBall binary geometry.

The browser SurfelIntegrator traces the same full-resolution ShaderBall used by the native showcase. WebGPU has no
portable hardware ray-query API, so the integration shader traverses this immutable hierarchy in software. Leaves
reference source triangle numbers; render and trace paths therefore share the original positions and indices.

Binary format, little-endian:

    magic        4 bytes  "SBH1"
    node_count   u32
    order_count  u32
    leaf_limit   u32
    nodes        node_count x (minimum.xyz f32, first u32, maximum.xyz f32, count u32)
    order        order_count x source triangle number u32

An internal node has count zero and first names its left child; its right child is first + 1. A leaf has positive
count and first addresses the order sequence.
"""

from __future__ import annotations

import argparse
import pathlib
import struct

GeometryMagic = 0x314D4253
HierarchyMagic = b"SBH1"


def DecodeGeometry(Path: pathlib.Path) -> tuple[list[tuple[float, float, float]], list[int]]:
    Content = Path.read_bytes()
    if len(Content) < 16:
        raise ValueError("geometry file is shorter than its header")
    Magic, VertexCount, IndexCount, _ = struct.unpack_from("<IIIf", Content, 0)
    if Magic != GeometryMagic or IndexCount % 3 != 0:
        raise ValueError("geometry header is not SBM1 triangle content")

    ExpectedBytes = 16 + VertexCount * 32 + IndexCount * 4
    if len(Content) != ExpectedBytes:
        raise ValueError(f"geometry byte count is {len(Content)}, expected {ExpectedBytes}")

    Positions: list[tuple[float, float, float]] = []
    Cursor = 16
    for _VertexNumber in range(VertexCount):
        Positions.append(struct.unpack_from("<3f", Content, Cursor))
        Cursor += 32
    Indices = list(struct.unpack_from(f"<{IndexCount}I", Content, Cursor))
    return Positions, Indices


def EncodeHierarchy(
    Positions: list[tuple[float, float, float]],
    Indices: list[int],
    LeafLimit: int,
) -> tuple[list[tuple[float, float, float, int, float, float, float, int]], list[int]]:
    TriangleCount = len(Indices) // 3
    Bounds: list[tuple[float, float, float, float, float, float]] = []
    Centres: list[tuple[float, float, float]] = []
    for TriangleNumber in range(TriangleCount):
        Alpha = Positions[Indices[TriangleNumber * 3]]
        Beta = Positions[Indices[TriangleNumber * 3 + 1]]
        Gamma = Positions[Indices[TriangleNumber * 3 + 2]]
        Minimum = tuple(min(Alpha[Axis], Beta[Axis], Gamma[Axis]) for Axis in range(3))
        Maximum = tuple(max(Alpha[Axis], Beta[Axis], Gamma[Axis]) for Axis in range(3))
        Bounds.append((*Minimum, *Maximum))
        Centres.append(tuple((Alpha[Axis] + Beta[Axis] + Gamma[Axis]) / 3.0 for Axis in range(3)))

    Nodes: list[tuple[float, float, float, int, float, float, float, int] | None] = [None]
    TriangleOrder: list[int] = []

    def Partition(NodeNumber: int, Triangles: list[int]) -> None:
        Minimum = [min(Bounds[TriangleNumber][Axis] for TriangleNumber in Triangles) for Axis in range(3)]
        Maximum = [max(Bounds[TriangleNumber][Axis + 3] for TriangleNumber in Triangles) for Axis in range(3)]
        if len(Triangles) <= LeafLimit:
            First = len(TriangleOrder)
            TriangleOrder.extend(Triangles)
            Nodes[NodeNumber] = (*Minimum, First, *Maximum, len(Triangles))
            return

        CentreMinimum = [min(Centres[TriangleNumber][Axis] for TriangleNumber in Triangles) for Axis in range(3)]
        CentreMaximum = [max(Centres[TriangleNumber][Axis] for TriangleNumber in Triangles) for Axis in range(3)]
        Span = [CentreMaximum[Axis] - CentreMinimum[Axis] for Axis in range(3)]
        SplitAxis = max(range(3), key=Span.__getitem__)
        Triangles.sort(key=lambda TriangleNumber: Centres[TriangleNumber][SplitAxis])
        Middle = len(Triangles) // 2

        LeftNumber = len(Nodes)
        Nodes.extend((None, None))
        Nodes[NodeNumber] = (*Minimum, LeftNumber, *Maximum, 0)
        Partition(LeftNumber, Triangles[:Middle])
        Partition(LeftNumber + 1, Triangles[Middle:])

    Partition(0, list(range(TriangleCount)))
    return [Node for Node in Nodes if Node is not None], TriangleOrder


def WriteHierarchy(
    Path: pathlib.Path,
    Nodes: list[tuple[float, float, float, int, float, float, float, int]],
    TriangleOrder: list[int],
    LeafLimit: int,
) -> int:
    Path.parent.mkdir(parents=True, exist_ok=True)
    with Path.open("wb") as Stream:
        Stream.write(struct.pack("<4sIII", HierarchyMagic, len(Nodes), len(TriangleOrder), LeafLimit))
        for Node in Nodes:
            Stream.write(struct.pack("<3fI3fI", *Node))
        Stream.write(struct.pack(f"<{len(TriangleOrder)}I", *TriangleOrder))
    return Path.stat().st_size


def Main() -> int:
    Parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    Parser.add_argument("--input", required=True, type=pathlib.Path)
    Parser.add_argument("--output", required=True, type=pathlib.Path)
    Parser.add_argument("--leaf-limit", type=int, default=4)
    Arguments = Parser.parse_args()

    if Arguments.leaf_limit < 1 or Arguments.leaf_limit > 16:
        Parser.error("--leaf-limit must be between 1 and 16")

    Positions, Indices = DecodeGeometry(Arguments.input)
    Nodes, TriangleOrder = EncodeHierarchy(Positions, Indices, Arguments.leaf_limit)
    ByteCount = WriteHierarchy(Arguments.output, Nodes, TriangleOrder, Arguments.leaf_limit)
    print(
        f"encoded {len(Indices) // 3} triangles into {len(Nodes)} nodes "
        f"({ByteCount / 1048576.0:.2f} MiB): {Arguments.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(Main())
