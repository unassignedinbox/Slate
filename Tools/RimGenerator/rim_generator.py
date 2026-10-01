bl_info = {
    "name": "Slate One-Piece Y Rim Generator",
    "author": "Slate",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > Rim Generator",
    "description": "Procedural AAA-ready one-piece Y-spoke rim generator. No tyre is created.",
    "category": "Add Mesh",
}

import math
import os
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, IntProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup


COLLECTION_NAME = "RIM_GENERATOR"
ASSEMBLY_NAME = "Rim_OnePiece_Y_Assembly"
PROFILE_NAME = "RimBlank_CrossSection"


# -----------------------------------------------------------------------------
# Small geometry and material primitives
# -----------------------------------------------------------------------------


class GeometryBuffer:
    """Transient indexed geometry for one mesh datablock."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.material_indices = []

    def vertex(self, point):
        self.vertices.append(tuple(float(component) for component in point))
        return len(self.vertices) - 1

    def face(self, indices, material_index=0):
        self.faces.append(tuple(indices))
        self.material_indices.append(material_index)


def _set_shader_input(shader, names, value):
    for name in names:
        socket = shader.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def _make_material(name, color, metallic, roughness, coat=0.0):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)

    material.use_nodes = True
    material.diffuse_color = (*color, 1.0)
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    if shader is not None:
        _set_shader_input(shader, ("Base Color",), (*color, 1.0))
        _set_shader_input(shader, ("Metallic",), metallic)
        _set_shader_input(shader, ("Roughness",), roughness)
        _set_shader_input(shader, ("Coat Weight", "Clearcoat"), coat)
        _set_shader_input(shader, ("Coat Roughness", "Clearcoat Roughness"), 0.16)
    return material


def _materials(settings):
    finish_presets = {
        "BRUSHED_SILVER": ((0.44, 0.48, 0.52), 0.92, 0.21),
        "GUNMETAL": ((0.105, 0.12, 0.14), 0.93, 0.22),
        "SATIN_BLACK": ((0.018, 0.022, 0.028), 0.88, 0.25),
        "FORGED_BRONZE": ((0.29, 0.115, 0.045), 0.90, 0.23),
        "CERAMIC_WHITE": ((0.72, 0.76, 0.79), 0.32, 0.19),
    }
    color, metallic, roughness = finish_presets[settings.finish]
    finish = _make_material("Rim_Finish_" + settings.finish, color, metallic, roughness, 0.24)
    barrel = _make_material("Rim_Inner_Barrel", (0.018, 0.022, 0.027), 0.72, 0.30, 0.08)
    machined = _make_material("Rim_Machined_Edge", (0.62, 0.68, 0.73), 0.96, 0.16, 0.36)
    titanium = _make_material("Rim_Titanium_Lugs", (0.31, 0.35, 0.39), 0.95, 0.20, 0.30)
    cap = _make_material("Rim_Center_Cap", color, metallic, max(0.16, roughness - 0.03), 0.32)
    return finish, barrel, machined, titanium, cap


def _new_mesh_object(name, buffer, collection, materials):
    mesh = bpy.data.meshes.new(name + "_Topology")
    mesh.from_pydata(buffer.vertices, [], buffer.faces)
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    mesh.update()

    for index, polygon in enumerate(mesh.polygons):
        polygon.use_smooth = True
        if index < len(buffer.material_indices):
            polygon.material_index = buffer.material_indices[index]

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def _add_bevel(obj, width, segments=3):
    if width <= 0.0:
        return
    modifier = obj.modifiers.new("AAA Edge Softening", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(28.0)
    if hasattr(modifier, "harden_normals"):
        modifier.harden_normals = True


def _append_lathe(buffer, profile, radial_segments, material_index):
    """Revolve a closed (axial, radial) blank-rim profile around the X axis."""
    rows = []
    for axial, radius in profile:
        row = []
        for segment in range(radial_segments):
            angle = (2.0 * math.pi * segment) / radial_segments
            row.append(buffer.vertex((axial, radius * math.cos(angle), radius * math.sin(angle))))
        rows.append(row)

    profile_count = len(rows)
    for profile_index in range(profile_count):
        next_profile = (profile_index + 1) % profile_count
        for segment in range(radial_segments):
            next_segment = (segment + 1) % radial_segments
            buffer.face(
                (
                    rows[profile_index][segment],
                    rows[next_profile][segment],
                    rows[next_profile][next_segment],
                    rows[profile_index][next_segment],
                ),
                material_index,
            )


def _append_annulus(buffer, axial_back, axial_front, inner_radius, outer_radius, radial_segments, material_index):
    """Add a solid annular hub section, also aligned to the X axle."""
    back_inner = []
    back_outer = []
    front_inner = []
    front_outer = []
    for segment in range(radial_segments):
        angle = (2.0 * math.pi * segment) / radial_segments
        direction = (math.cos(angle), math.sin(angle))
        back_inner.append(buffer.vertex((axial_back, inner_radius * direction[0], inner_radius * direction[1])))
        back_outer.append(buffer.vertex((axial_back, outer_radius * direction[0], outer_radius * direction[1])))
        front_inner.append(buffer.vertex((axial_front, inner_radius * direction[0], inner_radius * direction[1])))
        front_outer.append(buffer.vertex((axial_front, outer_radius * direction[0], outer_radius * direction[1])))

    for segment in range(radial_segments):
        nxt = (segment + 1) % radial_segments
        buffer.face((back_outer[segment], front_outer[segment], front_outer[nxt], back_outer[nxt]), material_index)
        buffer.face((back_inner[nxt], front_inner[nxt], front_inner[segment], back_inner[segment]), material_index)
        buffer.face((front_outer[segment], front_inner[segment], front_inner[nxt], front_outer[nxt]), material_index)
        buffer.face((back_outer[nxt], back_inner[nxt], back_inner[segment], back_outer[segment]), material_index)


def _append_cylinder_x(buffer, axial_back, axial_front, center_yz, radius, radial_segments, material_index):
    back = []
    front = []
    for segment in range(radial_segments):
        angle = (2.0 * math.pi * segment) / radial_segments
        y = center_yz[0] + radius * math.cos(angle)
        z = center_yz[1] + radius * math.sin(angle)
        back.append(buffer.vertex((axial_back, y, z)))
        front.append(buffer.vertex((axial_front, y, z)))

    for segment in range(radial_segments):
        nxt = (segment + 1) % radial_segments
        buffer.face((back[segment], back[nxt], front[nxt], front[segment]), material_index)
    buffer.face(tuple(reversed(back)), material_index)
    buffer.face(tuple(front), material_index)


def _append_ring_stack_x(buffer, rings, center_yz, radial_segments, material_index):
    """Add a chamfered solid nut from [(axial, radius), ...]."""
    rows = []
    for axial, radius in rings:
        row = []
        for segment in range(radial_segments):
            angle = (2.0 * math.pi * segment) / radial_segments
            y = center_yz[0] + radius * math.cos(angle)
            z = center_yz[1] + radius * math.sin(angle)
            row.append(buffer.vertex((axial, y, z)))
        rows.append(row)

    for ring_index in range(len(rows) - 1):
        for segment in range(radial_segments):
            nxt = (segment + 1) % radial_segments
            buffer.face((rows[ring_index][segment], rows[ring_index + 1][segment], rows[ring_index + 1][nxt], rows[ring_index][nxt]), material_index)
    buffer.face(tuple(reversed(rows[0])), material_index)
    buffer.face(tuple(rows[-1]), material_index)


def _profile_points(settings):
    """Default lathe profile. X is wheel width and radius is the second coordinate."""
    width = settings.width_in * 0.0254
    diameter = settings.diameter_in * 0.0254
    half_width = width * 0.5
    outer_radius = diameter * 0.5
    inner_radius = max(0.012, outer_radius - settings.barrel_wall)

    # This is intentionally a closed, editable section rather than a torus.
    # It gives the lip, bead seat, barrel and rear return enough control points.
    return [
        (-half_width + 0.025, inner_radius),
        (half_width - 0.105, inner_radius),
        (half_width - 0.075, outer_radius - 0.045),
        (half_width - 0.045, outer_radius - 0.015),
        (half_width + 0.005, outer_radius + 0.015),
        (half_width + 0.030, outer_radius + 0.005),
        (half_width + 0.030, outer_radius - 0.020),
        (half_width, outer_radius - 0.050),
        (-half_width + 0.100, outer_radius - 0.050),
        (-half_width + 0.050, outer_radius - 0.030),
    ]


def _profile_from_curve(curve_object):
    if curve_object is None or curve_object.type != "CURVE" or not curve_object.data.splines:
        return None
    spline = curve_object.data.splines[0]
    if spline.type != "POLY" or len(spline.points) < 4:
        return None
    points = [(point.co.x, point.co.y) for point in spline.points]
    if any(radius <= 0.0 for _, radius in points):
        return None
    return points


def _make_profile_curve(profile, collection):
    curve_data = bpy.data.curves.new(PROFILE_NAME, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 1
    curve_data.bevel_depth = 0.0022
    curve_data.bevel_resolution = 2
    curve_data.resolution_u = 1
    spline = curve_data.splines.new("POLY")
    spline.points.add(len(profile) - 1)
    for point, (axial, radius) in zip(spline.points, profile):
        point.co = (axial, radius, 0.0, 1.0)
    spline.use_cyclic_u = True

    curve_object = bpy.data.objects.new(PROFILE_NAME, curve_data)
    collection.objects.link(curve_object)
    curve_object.hide_render = True
    curve_object.display_type = "WIRE"
    curve_object["purpose"] = "Editable lathed blank-rim cross section"
    curve_object["coordinates"] = "X = axial width [m], Y = radius [m]"
    return curve_object


def _cross_2d(first, second):
    return first.x * second.y - first.y * second.x


def _point_inside_2d(polygon, point):
    inside = False
    for index, first in enumerate(polygon):
        second = polygon[(index + 1) % len(polygon)]
        if (first.y > point.y) != (second.y > point.y):
            x_at_y = (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x
            if point.x < x_at_y:
                inside = not inside
    return inside


def _segment_parameter(first, second, other_first, other_second):
    direction = second - first
    other_direction = other_second - other_first
    denominator = _cross_2d(direction, other_direction)
    if abs(denominator) < 1.0e-9:
        return None
    offset = other_first - first
    parameter = _cross_2d(offset, other_direction) / denominator
    other_parameter = _cross_2d(offset, direction) / denominator
    if -1.0e-8 <= parameter <= 1.0 + 1.0e-8 and -1.0e-8 <= other_parameter <= 1.0 + 1.0e-8:
        return max(0.0, min(1.0, parameter))
    return None


def _polygon_key(point):
    return (round(point.x, 8), round(point.y, 8))


def _rectangle_2d(start, end, width):
    direction = (end - start).normalized()
    normal = Vector((-direction.y, direction.x))
    half_width = width * 0.5
    return [
        start - normal * half_width,
        end - normal * half_width,
        end + normal * half_width,
        start + normal * half_width,
    ]


def _disc_polygon(center, radius, sides=12):
    return [
        center + Vector((math.cos(2.0 * math.pi * index / sides), math.sin(2.0 * math.pi * index / sides))) * radius
        for index in range(sides)
    ]


def _union_polygons(polygons):
    """Extract the outside loop of a small union of convex 2D polygons.

    The Y is made from three overlapping strips and a round junction. Splitting
    their edge arrangement before tracing the outside loop avoids the common
    self-intersecting hand-written Y outline at the branch junction.
    """
    candidate_edges = []
    for polygon_index, polygon in enumerate(polygons):
        for edge_index, first in enumerate(polygon):
            second = polygon[(edge_index + 1) % len(polygon)]
            split_parameters = [0.0, 1.0]
            for other in polygons:
                for other_index, other_first in enumerate(other):
                    other_second = other[(other_index + 1) % len(other)]
                    parameter = _segment_parameter(first, second, other_first, other_second)
                    if parameter is not None:
                        split_parameters.append(parameter)
            split_parameters = sorted(set(round(parameter, 12) for parameter in split_parameters))
            for start_parameter, end_parameter in zip(split_parameters, split_parameters[1:]):
                start = first + (second - first) * start_parameter
                end = first + (second - first) * end_parameter
                midpoint = (start + end) * 0.5
                hidden = any(
                    other_index != polygon_index and _point_inside_2d(other, midpoint)
                    for other_index, other in enumerate(polygons)
                )
                if not hidden and (end - start).length > 1.0e-7:
                    candidate_edges.append((start, end))

    edges = []
    seen = set()
    for first, second in candidate_edges:
        edge_key = (_polygon_key(first), _polygon_key(second))
        if edge_key not in seen:
            seen.add(edge_key)
            edges.append((first, second))

    outgoing = {}
    for edge_index, (first, _) in enumerate(edges):
        outgoing.setdefault(_polygon_key(first), []).append(edge_index)

    loops = []
    used = set()
    for first_index in range(len(edges)):
        if first_index in used:
            continue
        edge_index = first_index
        loop = []
        start_key = _polygon_key(edges[edge_index][0])
        for _ in range(len(edges) + 1):
            if edge_index in used:
                break
            used.add(edge_index)
            first, second = edges[edge_index]
            if not loop:
                loop.append(first)
            loop.append(second)
            if _polygon_key(second) == start_key:
                break
            choices = [candidate for candidate in outgoing.get(_polygon_key(second), []) if candidate not in used]
            if not choices:
                break
            if len(choices) == 1:
                edge_index = choices[0]
                continue
            incoming = second - first
            edge_index = min(
                choices,
                key=lambda candidate: abs(
                    math.atan2(
                        _cross_2d(incoming, edges[candidate][1] - edges[candidate][0]),
                        incoming.dot(edges[candidate][1] - edges[candidate][0]),
                    )
                ),
            )
        if len(loop) >= 4 and _polygon_key(loop[0]) == _polygon_key(loop[-1]):
            loop.pop()
            loops.append(loop)

    if not loops:
        raise ValueError("The Y spoke strips did not produce a closed silhouette")
    return max(loops, key=lambda loop: abs(sum(_cross_2d(loop[index], loop[(index + 1) % len(loop)]) for index in range(len(loop)))))


def _y_polygon(settings, outer_radius, hub_radius, style):
    """Return one continuous, non-self-intersecting 2D Y silhouette."""
    style_spread = {"Y_SINGLE": 31.0, "Y_COMPACT": 24.0, "Y_AGGRESSIVE": 38.0}[style]
    style_start = {"Y_SINGLE": 0.43, "Y_COMPACT": 0.50, "Y_AGGRESSIVE": 0.37}[style]
    spread = math.radians(style_spread)
    branch_start = hub_radius + (outer_radius - hub_radius) * style_start
    tip_radius = outer_radius - settings.lip_clearance
    branch_length = max(0.03, (tip_radius - branch_start) / max(0.25, math.cos(spread)))
    root_width = settings.spoke_width * {"Y_SINGLE": 1.0, "Y_COMPACT": 0.84, "Y_AGGRESSIVE": 1.10}[style]
    branch_width = root_width * (0.82 if style == "Y_AGGRESSIVE" else 0.90)

    p0 = Vector((hub_radius - 0.012, 0.0))
    junction = Vector((branch_start, 0.0))
    left_direction = Vector((math.cos(spread), math.sin(spread)))
    right_direction = Vector((math.cos(spread), -math.sin(spread)))
    left_tip = junction + left_direction * branch_length
    right_tip = junction + right_direction * branch_length
    junction_radius = max(root_width, branch_width) * 0.78

    strips = [
        _rectangle_2d(p0, junction, root_width),
        _rectangle_2d(junction - left_direction * 0.012, left_tip, branch_width),
        _rectangle_2d(junction - right_direction * 0.012, right_tip, branch_width),
        _disc_polygon(junction, junction_radius),
    ]
    return _union_polygons(strips)


def _append_y_prism(buffer, polygon, center_angle, axial_back, axial_front, material_index):
    """Extrude a 2D Y silhouette along X and tessellate its concave caps."""
    radial = Vector((math.cos(center_angle), math.sin(center_angle)))
    tangent = Vector((-math.sin(center_angle), math.cos(center_angle)))

    def point_at(axial, point):
        yz = radial * point.x + tangent * point.y
        return buffer.vertex((axial, yz.x, yz.y))

    front = [point_at(axial_front, point) for point in polygon]
    back = [point_at(axial_back, point) for point in polygon]
    count = len(polygon)

    cap_points = [Vector((point.x, point.y)) for point in polygon]
    triangles = tessellate_polygon([cap_points])
    for triangle in triangles:
        indices = [cap_points.index(vertex) for vertex in triangle]
        buffer.face((front[indices[0]], front[indices[1]], front[indices[2]]), material_index)
        buffer.face((back[indices[2]], back[indices[1]], back[indices[0]]), material_index)

    for index in range(count):
        nxt = (index + 1) % count
        buffer.face((front[index], back[index], back[nxt], front[nxt]), material_index)


def _new_collection(name, parent=None):
    collection = bpy.data.collections.new(name)
    if parent is None:
        bpy.context.scene.collection.children.link(collection)
    else:
        parent.children.link(collection)
    return collection


def _remove_collection_recursive(collection):
    for child in list(collection.children):
        _remove_collection_recursive(child)
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def _remove_generated_collection():
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is not None:
        _remove_collection_recursive(collection)


def _find_previous_profile():
    curve_object = bpy.data.objects.get(PROFILE_NAME)
    return _profile_from_curve(curve_object)


def _set_parent(objects, root):
    for obj in objects:
        if obj is not None and obj != root:
            obj.parent = root


def _root_metadata(root, settings, profile_source):
    root["asset_role"] = "AAA game wheel rim only"
    root["tire_included"] = False
    root["topology"] = "single main mesh object; each Y is one continuous closed prism"
    root["spoke_rule"] = "Y silhouette, never a V plus separate bar"
    root["profile_source"] = profile_source
    root["coordinate_convention"] = "wheel axle +X; world +Z remains up"
    root["units"] = "meters"
    root["finish"] = settings.finish
    root["spoke_style"] = settings.spoke_style
    root["spoke_count"] = settings.spoke_count
    root["bead_diameter_in"] = settings.diameter_in
    root["wheel_width_in"] = settings.width_in


def _build_scene(settings, profile, profile_source):
    _remove_generated_collection()
    root_collection = _new_collection(COLLECTION_NAME)
    assembly_collection = _new_collection("Rim_Assembly", root_collection)
    hardware_collection = _new_collection("Rim_Hardware", root_collection)
    controls_collection = _new_collection("Rim_Controls", root_collection)

    finish, barrel, machined, titanium, cap_material = _materials(settings)
    profile_object = _make_profile_curve(profile, controls_collection)

    # Main rim: blank, hub ring and all Y spokes intentionally share one mesh datablock.
    main_buffer = GeometryBuffer()
    outer_radius = settings.diameter_in * 0.0254 * 0.5
    hub_radius = settings.hub_radius
    width = settings.width_in * 0.0254
    half_width = width * 0.5
    face_offset = half_width + settings.dish
    style = settings.spoke_style

    _append_lathe(main_buffer, profile, settings.blank_radial_segments, 0)
    _append_annulus(main_buffer, -half_width * 0.35, face_offset + 0.015, settings.center_bore, hub_radius, 64, 0)

    polygon = _y_polygon(settings, outer_radius - 0.010, hub_radius, style)
    for spoke_index in range(settings.spoke_count):
        center_angle = (2.0 * math.pi * spoke_index) / settings.spoke_count + settings.spoke_phase
        _append_y_prism(
            main_buffer,
            polygon,
            center_angle,
            face_offset - settings.spoke_depth,
            face_offset,
            0 if not settings.contrast_spokes else 2,
        )

    main_materials = [finish, barrel, machined]
    assembly = _new_mesh_object(ASSEMBLY_NAME, main_buffer, assembly_collection, main_materials)
    assembly["topology"] = "one main mesh datablock"
    assembly["spoke_topology"] = "continuous Y prisms"
    assembly["no_tyre"] = True
    assembly["material_slots"] = "finish / inner barrel / machined edge"
    _add_bevel(assembly, settings.edge_bevel, 3)

    # The inside of the barrel is shaded separately without introducing a tyre.
    # A narrow dark annulus also gives the open wheel believable depth in-game.
    barrel_buffer = GeometryBuffer()
    barrel_inner = max(0.010, outer_radius - settings.barrel_wall - 0.004)
    barrel_outer = max(barrel_inner + 0.004, outer_radius - settings.barrel_wall + 0.010)
    _append_annulus(
        barrel_buffer,
        -half_width + 0.015,
        -half_width + 0.035,
        barrel_inner,
        barrel_outer,
        96,
        0,
    )
    barrel_object = _new_mesh_object("Rim_Inner_Barrel_Shading", barrel_buffer, assembly_collection, [barrel])
    barrel_object["purpose"] = "dark inner barrel shading; not a tyre"
    _add_bevel(barrel_object, settings.edge_bevel * 0.5, 2)

    # Lug hardware: shaft, washer and chamfered hex nut for every lug position.
    hardware_buffer = GeometryBuffer()
    lug_front = face_offset + 0.020
    for lug_index in range(settings.lug_count):
        angle = (2.0 * math.pi * lug_index) / settings.lug_count + settings.lug_phase
        center = (settings.lug_circle * math.cos(angle), settings.lug_circle * math.sin(angle))
        _append_cylinder_x(hardware_buffer, lug_front - 0.115, lug_front + 0.018, center, 0.009, 20, 0)
        _append_cylinder_x(hardware_buffer, lug_front + 0.010, lug_front + 0.026, center, settings.lug_radius * 1.20, 24, 0)
        _append_ring_stack_x(
            hardware_buffer,
            [
                (lug_front + 0.022, settings.lug_radius * 0.78),
                (lug_front + 0.029, settings.lug_radius),
                (lug_front + 0.064, settings.lug_radius),
                (lug_front + 0.071, settings.lug_radius * 0.78),
            ],
            center,
            6,
            0,
        )
    hardware = _new_mesh_object("Rim_Lug_Nuts_And_Bolts", hardware_buffer, hardware_collection, [titanium])
    hardware["hardware"] = "bolt shaft + washer + chamfered hex nut"
    _add_bevel(hardware, 0.0015, 2)

    cap_buffer = GeometryBuffer()
    _append_cylinder_x(
        cap_buffer,
        lug_front - 0.006,
        lug_front + 0.032,
        (0.0, 0.0),
        settings.center_cap_radius,
        64,
        0,
    )
    cap_object = _new_mesh_object("Rim_Center_Cap", cap_buffer, hardware_collection, [cap_material])
    cap_object["purpose"] = "removable center cap"
    _add_bevel(cap_object, 0.002, 3)

    root = bpy.data.objects.new("Rim_Generator_Root", None)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = outer_radius * 1.15
    root_collection.objects.link(root)
    _root_metadata(root, settings, profile_source)
    _set_parent([assembly, barrel_object, hardware, cap_object, profile_object], root)

    # Keep a clean selection for an artist opening the generated asset.
    bpy.ops.object.select_all(action="DESELECT")
    assembly.select_set(True)
    bpy.context.view_layer.objects.active = assembly
    return root


# -----------------------------------------------------------------------------
# Blender properties, operators and panel
# -----------------------------------------------------------------------------


class RimGeneratorProperties(PropertyGroup):
    diameter_in: FloatProperty(
        name="Bead diameter",
        description="Nominal wheel diameter in inches",
        default=18.0,
        min=12.0,
        max=30.0,
    )
    width_in: FloatProperty(
        name="Wheel width",
        description="Nominal rim width in inches",
        default=9.5,
        min=5.0,
        max=16.0,
    )
    barrel_wall: FloatProperty(
        name="Barrel wall [m]",
        description="Radial thickness between the bead seat and the inner barrel",
        default=0.050,
        min=0.020,
        max=0.120,
        subtype="DISTANCE",
    )
    hub_radius: FloatProperty(
        name="Hub radius [m]",
        default=0.084,
        min=0.045,
        max=0.160,
        subtype="DISTANCE",
    )
    center_bore: FloatProperty(
        name="Center bore [m]",
        default=0.036,
        min=0.020,
        max=0.100,
        subtype="DISTANCE",
    )
    center_cap_radius: FloatProperty(
        name="Center cap radius [m]",
        default=0.052,
        min=0.025,
        max=0.100,
        subtype="DISTANCE",
    )
    dish: FloatProperty(
        name="Face dish [m]",
        description="Positive values pull spokes toward the camera-facing side",
        default=0.030,
        min=-0.060,
        max=0.120,
        subtype="DISTANCE",
    )
    spoke_style: EnumProperty(
        name="Rim type",
        items=[
            ("Y_SINGLE", "Single Y", "Balanced one-piece Y spoke; default AAA road/performance layout"),
            ("Y_COMPACT", "Compact Y", "Tighter branch spread with more open negative space"),
            ("Y_AGGRESSIVE", "Aggressive Y", "Wider branches and deeper visual mass for a motorsport profile"),
        ],
        default="Y_SINGLE",
    )
    spoke_count: IntProperty(
        name="Y spokes",
        description="Number of continuous Y spoke silhouettes around the hub",
        default=5,
        min=3,
        max=12,
    )
    spoke_width: FloatProperty(
        name="Spoke width [m]",
        default=0.030,
        min=0.012,
        max=0.080,
        subtype="DISTANCE",
    )
    spoke_depth: FloatProperty(
        name="Spoke depth [m]",
        default=0.040,
        min=0.012,
        max=0.100,
        subtype="DISTANCE",
    )
    spoke_phase: FloatProperty(
        name="Spoke phase [deg]",
        default=0.0,
        min=math.radians(-36.0),
        max=math.radians(36.0),
        subtype="ANGLE",
    )
    lip_clearance: FloatProperty(
        name="Lip clearance [m]",
        default=0.022,
        min=0.006,
        max=0.080,
        subtype="DISTANCE",
    )
    lug_count: IntProperty(
        name="Lug count",
        default=5,
        min=3,
        max=8,
    )
    lug_circle: FloatProperty(
        name="Lug circle radius [m]",
        default=0.066,
        min=0.040,
        max=0.120,
        subtype="DISTANCE",
    )
    lug_radius: FloatProperty(
        name="Nut radius [m]",
        default=0.018,
        min=0.008,
        max=0.032,
        subtype="DISTANCE",
    )
    lug_phase: FloatProperty(
        name="Lug phase [deg]",
        default=0.0,
        min=math.radians(-36.0),
        max=math.radians(36.0),
        subtype="ANGLE",
    )
    edge_bevel: FloatProperty(
        name="Edge bevel [m]",
        default=0.0018,
        min=0.0,
        max=0.008,
        subtype="DISTANCE",
    )
    blank_radial_segments: IntProperty(
        name="Blank radial segments",
        description="128 is the recommended AAA export setting; lower it for blockout",
        default=128,
        min=32,
        max=256,
    )
    finish: EnumProperty(
        name="Finish",
        items=[
            ("BRUSHED_SILVER", "Brushed silver", "Forged aluminum with a machined highlight"),
            ("GUNMETAL", "Gunmetal", "Dark metallic performance finish"),
            ("SATIN_BLACK", "Satin black", "Low-key black powder coat"),
            ("FORGED_BRONZE", "Forged bronze", "Warm bronze metallic"),
            ("CERAMIC_WHITE", "Ceramic white", "Light painted finish"),
        ],
        default="BRUSHED_SILVER",
    )
    contrast_spokes: BoolProperty(
        name="Machined spoke contrast",
        description="Assign the machined-edge material to the Y faces",
        default=False,
    )
    use_profile_curve: BoolProperty(
        name="Use edited cross-section curve",
        description="Read RimBlank_CrossSection on Generate instead of rebuilding the default profile",
        default=False,
    )
    export_path: StringProperty(
        name="GLB export path",
        description="Absolute or relative path for the selected assembly export",
        default="//rim_one_piece_y.glb",
        subtype="FILE_PATH",
    )


class RIMGEN_OT_generate(Operator):
    bl_idname = "rim_generator.generate"
    bl_label = "Generate One-Piece Y Rim"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.rim_generator
        profile = _find_previous_profile() if settings.use_profile_curve else None
        if profile is None:
            profile = _profile_points(settings)
            profile_source = "default parameterized profile"
        else:
            profile_source = "RimBlank_CrossSection curve"
        try:
            _build_scene(settings, profile, profile_source)
        except Exception as error:
            self.report({"ERROR"}, "Rim generation failed: " + str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Generated one-piece Y rim; no tyre was created")
        return {"FINISHED"}


class RIMGEN_OT_reset_profile(Operator):
    bl_idname = "rim_generator.reset_profile"
    bl_label = "Reset Cross-Section"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.rim_generator
        settings.use_profile_curve = False
        profile = _profile_points(settings)
        _build_scene(settings, profile, "default parameterized profile")
        settings.use_profile_curve = False
        self.report({"INFO"}, "Cross-section reset; enable Use edited cross-section curve after editing the curve")
        return {"FINISHED"}


class RIMGEN_OT_export(Operator):
    bl_idname = "rim_generator.export_glb"
    bl_label = "Export GLB"
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = context.scene.rim_generator
        path = bpy.path.abspath(settings.export_path)
        if not path.lower().endswith(".glb"):
            path += ".glb"
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        try:
            bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False)
        except Exception as error:
            self.report({"ERROR"}, "GLB export failed: " + str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Exported rim GLB to " + path)
        return {"FINISHED"}


class RIMGEN_PT_panel(Panel):
    bl_label = "One-Piece Y Rim"
    bl_idname = "RIMGEN_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Rim Generator"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.rim_generator

        header = layout.box()
        header.label(text="AAA asset / rim only", icon="MOD_ARRAY")
        header.label(text="One continuous Y silhouette per spoke")
        header.label(text="No tyre or tyre materials are created")

        geometry = layout.box()
        geometry.label(text="Blank + fitment", icon="MESH_CIRCLE")
        geometry.prop(settings, "diameter_in")
        geometry.prop(settings, "width_in")
        geometry.prop(settings, "barrel_wall")
        geometry.prop(settings, "hub_radius")
        geometry.prop(settings, "center_bore")
        geometry.prop(settings, "center_cap_radius")
        geometry.prop(settings, "dish")

        spokes = layout.box()
        spokes.label(text="Continuous Y spoke topology", icon="MESH_DATA")
        spokes.prop(settings, "spoke_style")
        spokes.prop(settings, "spoke_count")
        spokes.prop(settings, "spoke_width")
        spokes.prop(settings, "spoke_depth")
        spokes.prop(settings, "spoke_phase")
        spokes.prop(settings, "lip_clearance")

        hardware = layout.box()
        hardware.label(text="Lug hardware", icon="DRIVER_ROTATIONAL_DIFFERENCE")
        hardware.prop(settings, "lug_count")
        hardware.prop(settings, "lug_circle")
        hardware.prop(settings, "lug_radius")
        hardware.prop(settings, "lug_phase")

        surface = layout.box()
        surface.label(text="Surface + export", icon="MATERIAL")
        surface.prop(settings, "finish")
        surface.prop(settings, "contrast_spokes")
        surface.prop(settings, "edge_bevel")
        surface.prop(settings, "blank_radial_segments")
        surface.prop(settings, "export_path")

        profile = layout.box()
        profile.label(text="Editable blank cross-section", icon="CURVE_DATA")
        profile.prop(settings, "use_profile_curve")
        profile.label(text="Edit RimBlank_CrossSection in Edit Mode")
        profile.operator("rim_generator.reset_profile", icon="FILE_REFRESH")

        row = layout.row(align=True)
        row.scale_y = 1.5
        row.operator("rim_generator.generate", icon="MOD_BUILD")
        row = layout.row()
        row.operator("rim_generator.export_glb", icon="EXPORT")


def _register_classes():
    for cls in (
        RimGeneratorProperties,
        RIMGEN_OT_generate,
        RIMGEN_OT_reset_profile,
        RIMGEN_OT_export,
        RIMGEN_PT_panel,
    ):
        bpy.utils.register_class(cls)


def _unregister_classes():
    for cls in reversed((RIMGEN_PT_panel, RIMGEN_OT_export, RIMGEN_OT_reset_profile, RIMGEN_OT_generate, RimGeneratorProperties)):
        bpy.utils.unregister_class(cls)


def register():
    _register_classes()
    bpy.types.Scene.rim_generator = PointerProperty(type=RimGeneratorProperties)


def unregister():
    if hasattr(bpy.types.Scene, "rim_generator"):
        del bpy.types.Scene.rim_generator
    _unregister_classes()


if __name__ == "__main__":
    register()
