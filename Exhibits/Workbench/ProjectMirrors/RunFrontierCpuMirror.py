#!/usr/bin/env python3
"""Generate Frontier CPU-reference visual evidence from project declarations and retained telemetry.

The produced images are not native Vulkan, Slang, or ImGui captures. They are deterministic CPU references keyed to
ProjectZero.frontier, ProjectDrive.frontier, ShowcaseStructure, DriveSceneAuthor, and the retained DriveTelemetry CSV.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ZERO_GALLERY = ROOT / "Exhibits/Gallery/ProjectZero"
DRIVE_GALLERY = ROOT / "Exhibits/Gallery/Drive"
SCRATCH = ROOT / "_AgentScratch/tmp/ProjectMirrorFrames"
ZERO_SPEC = ROOT / "FlattenedEngine/Projects/Project-Zero/ProjectZero.frontier"
DRIVE_SPEC = ROOT / "FlattenedEngine/Projects/Project-Drive/ProjectDrive.frontier"
SHOWCASE_HEADER = ROOT / "FlattenedEngine/Engine/ContentInterchange/ShowcaseStructure.h"
SHOWCASE_SOURCE = ROOT / "FlattenedEngine/Engine/ContentInterchange/ShowcaseStructure.cpp"
DRIVE_SCENE_HEADER = ROOT / "VehiclePhysics/Overlay/Projects/Project-Drive/Source/DriveSceneAuthor.h"
DRIVE_SCENE_SOURCE = ROOT / "VehiclePhysics/Overlay/Projects/Project-Drive/Source/DriveSceneAuthor.cpp"
ZERO_INTERCHANGE = ROOT / "FlattenedEngine/Projects/Project-Zero/Source/ProjectZeroInterchange.cpp"
DRIVE_INTERCHANGE = ROOT / "FlattenedEngine/Projects/Project-Drive/Source/ProjectDriveInterchange.cpp"
DRIVE_TELEMETRY = DRIVE_GALLERY / "ProjectDrivePhysicsTelemetry_CPU_Reference.csv"

FONT: dict[str, tuple[int, ...]] = {
    "A": (14, 17, 17, 31, 17, 17, 17), "B": (30, 17, 17, 30, 17, 17, 30),
    "C": (14, 17, 16, 16, 16, 17, 14), "D": (30, 17, 17, 17, 17, 17, 30),
    "E": (31, 16, 16, 30, 16, 16, 31), "F": (31, 16, 16, 30, 16, 16, 16),
    "G": (14, 17, 16, 23, 17, 17, 14), "H": (17, 17, 17, 31, 17, 17, 17),
    "I": (31, 4, 4, 4, 4, 4, 31), "J": (7, 2, 2, 2, 2, 18, 12),
    "K": (17, 18, 20, 24, 20, 18, 17), "L": (16, 16, 16, 16, 16, 16, 31),
    "M": (17, 27, 21, 21, 17, 17, 17), "N": (17, 25, 21, 19, 17, 17, 17),
    "O": (14, 17, 17, 17, 17, 17, 14), "P": (30, 17, 17, 30, 16, 16, 16),
    "Q": (14, 17, 17, 17, 21, 18, 13), "R": (30, 17, 17, 30, 20, 18, 17),
    "S": (15, 16, 16, 14, 1, 1, 30), "T": (31, 4, 4, 4, 4, 4, 4),
    "U": (17, 17, 17, 17, 17, 17, 14), "V": (17, 17, 17, 17, 17, 10, 4),
    "W": (17, 17, 17, 21, 21, 21, 10), "X": (17, 17, 10, 4, 10, 17, 17),
    "Y": (17, 17, 10, 4, 4, 4, 4), "Z": (31, 1, 2, 4, 8, 16, 31),
    "0": (14, 17, 19, 21, 25, 17, 14), "1": (4, 12, 4, 4, 4, 4, 14),
    "2": (14, 17, 1, 2, 4, 8, 31), "3": (30, 1, 1, 14, 1, 1, 30),
    "4": (2, 6, 10, 18, 31, 2, 2), "5": (31, 16, 16, 30, 1, 1, 30),
    "6": (14, 16, 16, 30, 17, 17, 14), "7": (31, 1, 2, 4, 8, 8, 8),
    "8": (14, 17, 17, 14, 17, 17, 14), "9": (14, 17, 17, 15, 1, 1, 14),
    " ": (0, 0, 0, 0, 0, 0, 0), "-": (0, 0, 0, 31, 0, 0, 0), "/": (1, 2, 2, 4, 8, 8, 16),
    ".": (0, 0, 0, 0, 0, 6, 6), ":": (0, 4, 4, 0, 4, 4, 0), "=": (0, 31, 0, 31, 0, 0, 0),
    "(": (2, 4, 8, 8, 8, 4, 2), ")": (8, 4, 2, 2, 2, 4, 8), "+": (0, 4, 4, 31, 4, 4, 0),
    ",": (0, 0, 0, 0, 0, 4, 8), "'": (4, 4, 8, 0, 0, 0, 0), "_": (0, 0, 0, 0, 0, 0, 31),
}

Color = tuple[int, int, int]
DARK: Color = (8, 14, 24)
INK: Color = (234, 242, 255)
DIM: Color = (142, 164, 190)
CYAN: Color = (76, 220, 235)
ORANGE: Color = (255, 170, 56)
BLUE: Color = (58, 126, 255)
GREEN: Color = (80, 210, 140)
PANEL: Color = (16, 27, 43)
BORDER: Color = (45, 78, 110)


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(value + 0.5)))


def blend(base: Color, top: Color, alpha: float) -> Color:
    keep = 1.0 - alpha
    return (
        clamp_channel(base[0] * keep + top[0] * alpha),
        clamp_channel(base[1] * keep + top[1] * alpha),
        clamp_channel(base[2] * keep + top[2] * alpha),
    )


def scale_color(colour: Color, factor: float) -> Color:
    return (clamp_channel(colour[0] * factor), clamp_channel(colour[1] * factor), clamp_channel(colour[2] * factor))


def add_color(a: Color, b: Color) -> Color:
    return (min(255, a[0] + b[0]), min(255, a[1] + b[1]), min(255, a[2] + b[2]))


class Raster:
    def __init__(self, width: int, height: int, colour: Color = DARK) -> None:
        self.width = width
        self.height = height
        self.pixels = bytearray(colour * (width * height))

    def copy(self) -> "Raster":
        result = Raster(self.width, self.height)
        result.pixels[:] = self.pixels
        return result

    def set(self, x: int, y: int, colour: Color, alpha: float = 1.0) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            index = (y * self.width + x) * 3
            if alpha >= 0.999:
                self.pixels[index:index + 3] = bytes(colour)
            else:
                base = (self.pixels[index], self.pixels[index + 1], self.pixels[index + 2])
                self.pixels[index:index + 3] = bytes(blend(base, colour, alpha))

    def rect(self, x: int, y: int, w: int, h: int, colour: Color, border: Color | None = None, alpha: float = 1.0) -> None:
        for yy in range(max(0, y), min(self.height, y + h)):
            for xx in range(max(0, x), min(self.width, x + w)):
                self.set(xx, yy, colour, alpha)
        if border is not None:
            self.line(x, y, x + w - 1, y, border)
            self.line(x, y + h - 1, x + w - 1, y + h - 1, border)
            self.line(x, y, x, y + h - 1, border)
            self.line(x + w - 1, y, x + w - 1, y + h - 1, border)

    def line(self, x0: int, y0: int, x1: int, y1: int, colour: Color, thickness: int = 1) -> None:
        dx = abs(x1 - x0)
        sx = 1 if x0 < x1 else -1
        dy = -abs(y1 - y0)
        sy = 1 if y0 < y1 else -1
        error = dx + dy
        radius = max(0, thickness // 2)
        while True:
            for yy in range(y0 - radius, y0 + radius + 1):
                for xx in range(x0 - radius, x0 + radius + 1):
                    self.set(xx, yy, colour)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * error
            if e2 >= dy:
                error += dy
                x0 += sx
            if e2 <= dx:
                error += dx
                y0 += sy

    def polygon(self, points: list[tuple[int, int]], colour: Color, alpha: float = 1.0) -> None:
        if not points:
            return
        min_y = max(0, min(y for _, y in points))
        max_y = min(self.height - 1, max(y for _, y in points))
        for y in range(min_y, max_y + 1):
            hits: list[int] = []
            for index, (x0, y0) in enumerate(points):
                x1, y1 = points[(index + 1) % len(points)]
                if (y0 <= y < y1) or (y1 <= y < y0):
                    t = (y - y0) / (y1 - y0)
                    hits.append(int(x0 + (x1 - x0) * t))
            hits.sort()
            for a, b in zip(hits[0::2], hits[1::2]):
                for x in range(max(0, a), min(self.width, b + 1)):
                    self.set(x, y, colour, alpha)

    def disc(self, cx: int, cy: int, r: int, colour: Color, alpha: float = 1.0) -> None:
        rr = r * r
        for yy in range(-r, r + 1):
            for xx in range(-r, r + 1):
                if xx * xx + yy * yy <= rr:
                    self.set(cx + xx, cy + yy, colour, alpha)

    def ellipse(self, cx: int, cy: int, rx: int, ry: int, colour: Color, alpha: float = 1.0) -> None:
        if rx <= 0 or ry <= 0:
            return
        for yy in range(-ry, ry + 1):
            for xx in range(-rx, rx + 1):
                if (xx * xx) * (ry * ry) + (yy * yy) * (rx * rx) <= (rx * rx) * (ry * ry):
                    self.set(cx + xx, cy + yy, colour, alpha)

    def shaded_sphere(self, cx: int, cy: int, r: int, base: Color, style: str, seed: int, mode: str) -> None:
        if r <= 1:
            return
        shadow_alpha = 0.18 if mode == "visibility" else 0.30
        self.ellipse(cx + r // 5, cy + int(r * 0.78), max(2, int(r * 0.92)), max(1, int(r * 0.22)), (0, 0, 0), shadow_alpha)
        for yy in range(-r, r + 1):
            for xx in range(-r, r + 1):
                length2 = xx * xx + yy * yy
                if length2 > r * r:
                    continue
                nx = xx / r
                ny = yy / r
                nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
                light = max(0.0, 0.55 * -nx + 0.50 * -ny + 0.65 * nz)
                ambient = 0.46 if mode == "visibility" else 0.56
                if mode == "surfel":
                    ambient += 0.12 * max(0.0, -ny)
                if mode == "restir":
                    light = 1.0 if light > 0.43 else light * 0.50
                factor = ambient + 0.64 * light
                colour = scale_color(base, factor)
                spec = max(0.0, 0.80 * -nx + 0.72 * -ny + 1.15 * nz - 1.05)
                if style in {"metal", "coat", "glass", "flake"}:
                    colour = add_color(colour, scale_color((255, 248, 218), (spec ** 2.2) * 2.8))
                if style == "glass":
                    colour = blend(colour, (180, 225, 255), 0.18 + 0.20 * max(0.0, -nx))
                if style == "emission":
                    colour = add_color(scale_color(base, 1.15), (24, 28, 18))
                self.set(cx + xx, cy + yy, colour)
        if style == "flake" or style == "coat":
            for index in range(18 if r > 7 else 7):
                value = (seed * 1103515245 + index * 12345) & 0x7fffffff
                px = cx + int(((value & 255) / 255.0 - 0.5) * 1.4 * r)
                py = cy + int((((value >> 8) & 255) / 255.0 - 0.5) * 1.4 * r)
                if (px - cx) * (px - cx) + (py - cy) * (py - cy) < r * r:
                    self.disc(px, py, 1 if r < 13 else 2, (255, 245, 180), 0.75)
        if style == "glass":
            self.line(cx - r // 2, cy - r // 3, cx + r // 3, cy - r // 2, (220, 245, 255), max(1, r // 9))

    def text(self, x: int, y: int, value: object, scale: int = 2, colour: Color = INK) -> None:
        cursor = x
        for raw in str(value).upper():
            glyph = FONT.get(raw, FONT[" "])
            for row, bits in enumerate(glyph):
                for column in range(5):
                    if bits & (1 << (4 - column)):
                        self.rect(cursor + column * scale, y + row * scale, scale, scale, colour)
            cursor += 6 * scale

    def png(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = b"".join(b"\0" + bytes(self.pixels[y * self.width * 3:(y + 1) * self.width * 3]) for y in range(self.height))

        def chunk(name: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xffffffff)

        target.write_bytes(
            b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw, 9)) +
            chunk(b"IEND", b"")
        )


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def hue_colour(hue: float, saturation: float, brightness: float) -> Color:
    h = (hue - math.floor(hue)) * 6.0
    arc = int(h) % 6
    fraction = h - math.floor(h)
    if arc == 0:
        r, g, b = 1.0, fraction, 0.0
    elif arc == 1:
        r, g, b = 1.0 - fraction, 1.0, 0.0
    elif arc == 2:
        r, g, b = 0.0, 1.0, fraction
    elif arc == 3:
        r, g, b = 0.0, 1.0 - fraction, 1.0
    elif arc == 4:
        r, g, b = fraction, 0.0, 1.0
    else:
        r, g, b = 1.0, 0.0, 1.0 - fraction
    return (
        clamp_channel(brightness * (1.0 - saturation * (1.0 - r)) * 255.0),
        clamp_channel(brightness * (1.0 - saturation * (1.0 - g)) * 255.0),
        clamp_channel(brightness * (1.0 - saturation * (1.0 - b)) * 255.0),
    )


def material_sample(row: int, column: int, side: int = 20) -> tuple[Color, str]:
    t = column / max(1, side - 1)
    hue = column / side
    if row == 0:
        return hue_colour(hue, 0.55, 0.92), "metal"
    if row == 1:
        return blend((230, 245, 255), hue_colour(hue, 0.18, 1.0), 0.35), "glass"
    if row == 2:
        return hue_colour(hue, 0.35, 0.86), "subsurface"
    if row == 3:
        return blend((18, 12, 30), hue_colour(hue + 0.18 * t, 0.7, 0.9), 0.62), "coat"
    if row == 4:
        return hue_colour(hue, 0.75, 0.46), "cloth"
    if row == 5:
        return hue_colour(hue, 0.85, 0.50), "coat"
    if row == 6:
        return hue_colour(hue, 0.45, 0.23 + 0.25 * t), "hazy"
    if row == 7:
        return hue_colour(hue, 0.80, 0.75), "diffuse"
    if row == 8:
        return hue_colour(hue, 0.85, 1.0), "emission"
    if row == 9:
        return hue_colour(hue, 0.40, 0.85), "metal"
    if row == 10:
        return hue_colour(hue, 0.70, 0.65), "metal" if t > 0.55 else "diffuse"
    if row == 11:
        return (scale_color(hue_colour(hue, 0.30, 0.90), 0.95) if column % 2 == 0 else hue_colour(hue, 0.55, 0.12)), "rubber"
    if row == 12:
        return hue_colour(hue, 0.55, 0.32), "flake"
    if row == 13:
        return blend((235, 245, 255), hue_colour(hue, 0.70, 0.85), 0.45), "glass"
    if row == 14:
        styles = ["metal", "coat", "subsurface", "metal", "glass"]
        colours = [(235, 238, 242), (8, 8, 14), (230, 218, 190), (255, 198, 86), (225, 242, 255)]
        return colours[column % 5], styles[column % 5]
    return hue_colour(hue + 0.03 * row, 0.68, 0.55), "flake"


def background(width: int, height: int, title: str, subtitle: str) -> Raster:
    image = Raster(width, height)
    for y in range(height):
        t = y / max(1, height - 1)
        sky = blend((18, 31, 50), (84, 126, 170), max(0.0, 1.0 - t * 1.35))
        ground = blend((32, 39, 42), (52, 48, 42), max(0.0, t - 0.40))
        colour = sky if y < height * 0.54 else ground
        for x in range(width):
            image.set(x, y, colour)
    image.rect(30, 26, width - 60, 78, (13, 24, 40), BORDER, 0.94)
    image.text(56, 48, title, 3, INK)
    image.text(58, 80, subtitle, 1, DIM)
    return image


def draw_sun_sky_key(image: Raster, mode: str) -> None:
    image.disc(image.width - 110, 92, 26, (255, 226, 142), 0.96)
    image.line(image.width - 152, 132, image.width - 64, 54, (255, 218, 120), 3)
    label = {
        "visibility": "VISIBILITY RASTER - NO GI OR REFLECTIONS",
        "surfel": "SURFEL GI CPU MIRROR - SUN SKY AND BOUNCE",
        "restir": "RESTIR DI CPU MIRROR - SUN CANDIDATE RESERVOIRS",
    }[mode]
    image.text(48, image.height - 42, label, 1, INK)


def project_showcase(row: int, column: int, view: str, width: int, height: int) -> tuple[int, int, int]:
    side = 20
    x = (column - (side - 1) * 0.5) * 1.0
    y = (row - (side - 1) * 0.5) * 1.0
    if view == "wide":
        sx = width * 0.50 + x * 32 + y * 13
        sy = height * 0.62 + y * 16 - x * 5
        depth = int(y * 100 - x * 10)
    elif view == "low":
        sx = width * 0.50 + x * 40 + y * 8
        sy = height * 0.74 + y * 20 - row * 0.2
        depth = int(y * 120)
    else:
        sx = width * 0.50 + x * 30 + y * 20
        sy = height * 0.60 + y * 13 - x * 9
        depth = int(y * 100 - x * 30)
    return int(sx), int(sy), depth


def render_project_zero(mode: str, view: str, target: Path) -> None:
    title = "PROJECT ZERO / 20 X 20 MATERIAL SHOWCASE"
    subtitle = "CPU REFERENCE FROM PROJECTZERO.FRONTIER + SHOWCASESTRUCTURE - NOT NATIVE VULKAN SLANG IMGUI"
    image = background(1440, 900, title, subtitle)
    image.polygon([(140, 510), (1250, 430), (1370, 830), (40, 830)], (39, 44, 43), 0.92)
    draw_sun_sky_key(image, mode)
    spheres: list[tuple[int, int, int, int, Color, str, int]] = []
    for row in range(20):
        for column in range(20):
            x, y, depth = project_showcase(row, column, view, image.width, image.height)
            radius = 11 if view == "wide" else 13 if view == "angled" else 15
            colour, style = material_sample(row, column)
            if mode == "visibility":
                style = "diffuse" if style != "emission" else style
            spheres.append((depth, x, y, radius, colour, style, row * 20 + column + 17))
    for _, x, y, radius, colour, style, seed in sorted(spheres):
        if 60 < x < image.width - 60 and 118 < y < image.height - 42:
            if mode == "surfel" and style not in {"emission", "glass"}:
                colour = blend(colour, (255, 205, 120), 0.08)
            if mode == "restir" and seed % 17 == 0:
                image.line(x + 2, y + radius + 3, x + 48, y + radius + 20, (15, 18, 21), 2)
            image.shaded_sphere(x, y, radius, colour, style, seed, mode)
    image.rect(44, 128, 362, 132, (10, 20, 34), BORDER, 0.88)
    image.text(64, 148, "OPENING SCENE", 2, CYAN)
    image.text(64, 180, "CONTENT/SCENES/SHOWCASE.GLTF", 1, INK)
    image.text(64, 204, "400 MATERIALS / 20 ROWS", 1, INK)
    image.text(64, 228, "DEFAULT MATERIAL SHOWCASE", 1, ORANGE)
    image.png(target)


def render_project_zero_angles(target: Path) -> None:
    image = background(1440, 900, "PROJECT ZERO / MATERIAL ANGLES", "CPU REFERENCE - FOUR CAMERA ANGLES OVER THE DEFAULT SHOWCASE")
    panels = [(42, 136, "WIDE"), (742, 136, "LOW"), (42, 514, "METALS GLASS"), (742, 514, "FLAKE COAT")]
    samples = [(0, 0), (1, 7), (5, 12), (8, 3), (12, 17), (13, 15), (15, 9), (19, 19)]
    for index, (px, py, label) in enumerate(panels):
        image.rect(px, py, 656, 326, (18, 27, 38), BORDER, 0.94)
        image.text(px + 20, py + 20, label, 2, CYAN)
        for sample_index, (row, column) in enumerate(samples):
            colour, style = material_sample(row, column)
            cx = px + 90 + (sample_index % 4) * 145
            cy = py + 125 + (sample_index // 4) * 118
            radius = 38 if index < 2 else 46
            if index == 2 and style not in {"metal", "glass"}:
                colour = scale_color(colour, 0.75)
            if index == 3:
                style = "flake" if row >= 12 else "coat"
            image.shaded_sphere(cx, cy, radius, colour, style, row * 31 + column, "surfel")
            image.text(cx - 34, cy + radius + 14, f"R{row:02d} C{column:02d}", 1, DIM)
    draw_sun_sky_key(image, "surfel")
    image.png(target)


def read_telemetry() -> list[dict[str, str]]:
    if not DRIVE_TELEMETRY.exists():
        raise FileNotFoundError(f"missing telemetry CSV: {DRIVE_TELEMETRY}")
    with DRIVE_TELEMETRY.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 100:
        raise RuntimeError("Drive telemetry is too short to prove vehicle motion")
    return rows


def drive_sample(rows: list[dict[str, str]], moment: float) -> dict[str, str]:
    return min(rows, key=lambda row: abs(float(row["t"]) - moment))


def draw_material_strip(image: Raster, x0: int, y0: int, mode: str) -> None:
    for row in range(20):
        for column in range(20):
            colour, style = material_sample(row, column)
            cx = x0 + column * 18 + row * 5
            cy = y0 + row * 8 - column * 2
            if 0 <= cx < image.width and 0 <= cy < image.height:
                image.shaded_sphere(cx, cy, 5, colour, style, row * 20 + column + 99, mode)


def draw_drive_course(image: Raster, mode: str) -> None:
    image.polygon([(60, 654), (1030, 420), (1380, 704), (250, 850)], (44, 47, 50), 0.92)
    for index in range(14):
        start_x = 92 + index * 72
        image.line(start_x, 646 - index * 8, start_x + 230, 604 - index * 3, (210, 210, 185), 2)
    image.polygon([(378, 596), (530, 562), (610, 600), (440, 642)], (146, 92, 38), 0.96)
    for index in range(7):
        cx = 682 + index * 54
        cy = 606 - index * 4
        image.polygon([(cx, cy - 22), (cx + 16, cy + 18), (cx - 16, cy + 18)], (240, 92, 34), 0.95)
    for index in range(8):
        image.rect(760 + index * 42, 652 + index * 3, 26, 7, (228, 180, 38), None, 0.96)
    draw_material_strip(image, 860, 330, mode)


def draw_car(image: Raster, cx: int, cy: int, scale: int, mode: str, speed_label: str) -> None:
    body = [(cx - 130 * scale // 10, cy + 20 * scale // 10), (cx - 82 * scale // 10, cy - 36 * scale // 10),
            (cx + 56 * scale // 10, cy - 44 * scale // 10), (cx + 134 * scale // 10, cy + 12 * scale // 10),
            (cx + 84 * scale // 10, cy + 42 * scale // 10), (cx - 118 * scale // 10, cy + 44 * scale // 10)]
    image.polygon(body, (18, 50, 155), 0.98)
    image.polygon([(cx - 52 * scale // 10, cy - 36 * scale // 10), (cx + 46 * scale // 10, cy - 40 * scale // 10),
                   (cx + 76 * scale // 10, cy - 8 * scale // 10), (cx - 72 * scale // 10, cy - 2 * scale // 10)], (16, 62, 96), 0.82)
    for offset in (-78, 78):
        image.ellipse(cx + offset * scale // 10, cy + 45 * scale // 10, 28 * scale // 10, 12 * scale // 10, (8, 8, 10), 1.0)
        image.disc(cx + offset * scale // 10, cy + 45 * scale // 10, 11 * scale // 10, (142, 150, 164))
    if mode in {"surfel", "restir"}:
        for index in range(42):
            px = cx - 110 * scale // 10 + (index * 37 % (220 * scale // 10))
            py = cy - 25 * scale // 10 + (index * 19 % (54 * scale // 10))
            image.disc(px, py, max(1, scale // 7), (255, 238, 166), 0.55)
    image.text(cx - 50, cy + 72 * scale // 10, speed_label, 1, INK)


def render_project_drive(mode: str, target: Path) -> None:
    image = background(1440, 900, "PROJECT DRIVE / COURSE VEHICLE MATERIAL SHOWCASE", "CPU REFERENCE FROM PROJECTDRIVE.FRONTIER + DRIVESCENEAUTHOR + DRIVETELEMETRY")
    draw_drive_course(image, mode)
    draw_car(image, 560, 570, 10, mode, "T 4.0S")
    image.rect(44, 126, 430, 150, (10, 20, 34), BORDER, 0.90)
    image.text(64, 148, "OPENING SCENE", 2, CYAN)
    image.text(64, 180, "CONTENT/SCENES/DRIVECOURSE.GLTF", 1, INK)
    image.text(64, 204, "CONTROLVEHICLE + XPBD TYRES", 1, INK)
    image.text(64, 228, "20 X 20 DRIVE MATERIAL SHOWCASE", 1, ORANGE)
    draw_sun_sky_key(image, mode)
    image.png(target)


def render_drive_material_angles(target: Path) -> None:
    image = background(1440, 900, "PROJECT DRIVE / VEHICLE MATERIAL ANGLES", "CPU REFERENCE - CONTROLVEHICLE PAINT GLASS RUBBER HUBS PLUS MATERIAL SHOWCASE")
    labels = ["DENSE COBALT FLAKE CLEARCOAT", "SMOKED GLASS", "XPBD TYRE RUBBER", "20 X 20 MATERIAL SHOWCASE"]
    for index, label in enumerate(labels):
        x = 56 + (index % 2) * 690
        y = 148 + (index // 2) * 354
        image.rect(x, y, 638, 304, (18, 27, 38), BORDER, 0.94)
        image.text(x + 22, y + 22, label, 2, CYAN if index != 0 else ORANGE)
        if index == 0:
            draw_car(image, x + 318, y + 166, 16, "surfel", "FLAKE COAT")
        elif index == 1:
            for row in range(2):
                for column in range(5):
                    colour, style = material_sample(1 + row * 12, column * 3 + 2)
                    image.shaded_sphere(x + 115 + column * 96, y + 118 + row * 94, 35, colour, "glass", row * 7 + column, "surfel")
        elif index == 2:
            for column in range(4):
                cx = x + 120 + column * 128
                image.ellipse(cx, y + 164, 58, 34, (8, 9, 11))
                image.disc(cx, y + 164, 28, (130, 138, 152))
                image.text(cx - 38, y + 218, f"TYRE {column + 1}", 1, DIM)
        else:
            draw_material_strip(image, x + 108, y + 232, "surfel")
    draw_sun_sky_key(image, "surfel")
    image.png(target)


def draw_path_axes(image: Raster, title: str) -> None:
    image.rect(20, 18, image.width - 40, 56, (9, 17, 29), BORDER, 0.94)
    image.text(42, 38, title, 2, INK)


def render_drive_frame(rows: list[dict[str, str]], frame_index: int, frame_count: int, camera: str, target: Path) -> None:
    moment = 12.0 * frame_index / max(1, frame_count - 1)
    row = drive_sample(rows, moment)
    speed = float(row["speed_mps"]) * 3.6
    x = float(row["x"])
    y = float(row["y"])
    z = float(row["z"])
    image = Raster(640, 360, (22, 34, 48))
    if camera == "overhead":
        image.rect(40, 82, 560, 220, (48, 53, 54), BORDER)
        for path_row in rows[::8]:
            px = 58 + int(float(path_row["x"]) / 180.0 * 520)
            py = 282 - int((float(path_row["y"]) + 4.0) / 30.0 * 180)
            image.disc(px, py, 1, (64, 104, 122))
        px = 58 + int(x / 180.0 * 520)
        py = 282 - int((y + 4.0) / 30.0 * 180)
        draw_car(image, px, py, 4, "surfel", f"{speed:.0f}KMH")
    elif camera == "trackside":
        image.polygon([(40, 252), (600, 230), (640, 360), (0, 360)], (46, 48, 48), 1.0)
        sx = 40 + int(x / 180.0 * 560)
        sy = 260 - int((z - 0.3) / 2.0 * 90)
        image.polygon([(120, 246), (190, 216), (240, 248)], (140, 86, 32), 1.0)
        for index in range(6):
            image.rect(285 + index * 36, 250, 18, 7, (220, 170, 42))
        draw_car(image, sx, sy, 5, "restir", f"{speed:.0f}KMH")
    else:
        road_shift = int((x * 2.3) % 80)
        image.polygon([(80, 106), (560, 106), (640, 360), (0, 360)], (44, 47, 50), 1.0)
        for stripe in range(-1, 9):
            sy = 118 + stripe * 38 + road_shift
            image.line(316, sy, 336, sy + 28, (220, 215, 180), 3)
        draw_car(image, 320, 236 - int((z - 0.35) * 32), 8, "surfel", f"{speed:.0f}KMH")
    draw_path_axes(image, f"PROJECT DRIVE {camera.upper()} T={moment:04.1f}S")
    image.text(44, 328, "SOURCE CSV ACTUAL DRIVETELEMETRY", 1, DIM)
    image.png(target)


def render_drive_gifs(rows: list[dict[str, str]]) -> list[Path]:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    frame_count = 28
    for camera, output_name in [
        ("chase", "ProjectDriveDrivingChase_CPU_Reference.gif"),
        ("trackside", "ProjectDriveDrivingTrackside_CPU_Reference.gif"),
        ("overhead", "ProjectDriveDrivingOverhead_CPU_Reference.gif"),
    ]:
        folder = SCRATCH / camera
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        frames = []
        for index in range(frame_count):
            frame = folder / f"frame_{index:03d}.png"
            render_drive_frame(rows, index, frame_count, camera, frame)
            frames.append(frame)
        output = DRIVE_GALLERY / output_name
        subprocess.run(["convert", "-delay", "7", "-loop", "0", *map(str, frames), str(output)], check=True)
        outputs.append(output)
    return outputs


def write_editor_declaration_files() -> list[Path]:
    zero_file = ZERO_GALLERY / "ProjectZeroEditorDeclarations_CPU_Reference.txt"
    drive_file = DRIVE_GALLERY / "ProjectDriveEditorDeclarations_CPU_Reference.txt"
    zero_file.write_text(
        "Project-Zero editor declarations (C ABI CPU reference)\n"
        "====================================================\n"
        "Source: FlattenedEngine/Projects/Project-Zero/Source/ProjectZeroInterchange.cpp\n"
        "Native ImGui capture: false\n\n"
        "Panels: ProjectZeroOutliner, MaterialShowcase, MaterialInspector, RenderModeInspector, CelestialEnvironment\n"
        "Scene subjects: MaterialShowcase root, 20 rows, 400 row/column material subjects, InterfacePanel, SunSky\n"
        "Render preferences: 0 visibility raster, 1 Surfel GI, 2 ReSTIR DI\n"
        "Opening scene: Content/Scenes/Showcase.gltf\n",
        encoding="utf-8",
    )
    drive_file.write_text(
        "Project-Drive editor declarations (C ABI CPU reference)\n"
        "====================================================\n"
        "Source: FlattenedEngine/Projects/Project-Drive/Source/ProjectDriveInterchange.cpp\n"
        "Native ImGui capture: false\n\n"
        "Panels: DriveOutliner, ControlVehicle, XPBDTyres, VehicleDynamics, DriveRenderModes, DriveMaterialShowcase, DriveTelemetry\n"
        "Scene subjects: ControlVehicle body paint/glass/trim, four XPBD tyres, wheel hubs, brakes, course props, SunSky, and 20 x 20 material showcase\n"
        "Render preferences: 0 visibility raster, 1 Surfel GI, 2 ReSTIR DI\n"
        "Opening scene: Content/Scenes/DriveCourse.gltf\n",
        encoding="utf-8",
    )
    return [zero_file, drive_file]


def require_source_truth() -> None:
    zero_text = ZERO_SPEC.read_text(encoding="utf-8")
    drive_text = DRIVE_SPEC.read_text(encoding="utf-8")
    showcase_text = SHOWCASE_HEADER.read_text(encoding="utf-8")
    drive_scene_text = DRIVE_SCENE_HEADER.read_text(encoding="utf-8")
    if "OpeningScene            = \"Content/Scenes/Showcase.gltf\"" not in zero_text:
        raise RuntimeError("ProjectZero.frontier does not open Showcase.gltf")
    if "OpeningScene            = \"Content/Scenes/DriveCourse.gltf\"" not in drive_text:
        raise RuntimeError("ProjectDrive.frontier does not open DriveCourse.gltf")
    if "kShowcaseGridSide = 20u" not in showcase_text:
        raise RuntimeError("ShowcaseStructure is not a 20 x 20 material showcase")
    if "kDriveMaterialShowcaseSide = 20u" not in drive_scene_text:
        raise RuntimeError("DriveSceneAuthor is not declaring a 20 x 20 drive material showcase")
    if "Cornell" in zero_text + drive_text:
        raise RuntimeError("Cornell scene reference found in project specifications")


def write_readmes() -> None:
    (ZERO_GALLERY / "README.md").write_text(
        "# Project-Zero CPU-reference evidence\n\n"
        "These artefacts mirror the Project-Zero opening scene declared by `ProjectZero.frontier`: "
        "`Content/Scenes/Showcase.gltf`, authored by `ShowcaseStructure` as a 20 x 20 material showcase. "
        "They are CPU references only, not native Vulkan, Slang, or ImGui captures.\n\n"
        "| Artefact | Meaning |\n"
        "|---|---|\n"
        "| `ProjectZeroMaterialShowcaseVisibility_CPU_Reference.png` | Visibility-raster CPU reference: material IDs, silhouettes and direct presentation without GI/reflections. |\n"
        "| `ProjectZeroMaterialShowcaseSurfelGI_CPU_Reference.png` | Same scene through the CPU Surfel-GI mirror. |\n"
        "| `ProjectZeroMaterialShowcaseReSTIR_CPU_Reference.png` | Same scene through the CPU ReSTIR-DI direct-light mirror. |\n"
        "| `ProjectZeroMaterialAngles_CPU_Reference.png` | Multiple camera angles proving metals, glass, flake coat and emission rows. |\n"
        "| `ProjectZeroEditorDeclarations_CPU_Reference.txt` | C-ABI editor/outliner declarations; not an ImGui screenshot. |\n",
        encoding="utf-8",
    )
    (DRIVE_GALLERY / "README.md").write_text(
        "# Project-Drive CPU-reference evidence\n\n"
        "This directory contains direct DriveTelemetry output plus CPU-reference mirrors of the Project-Drive opening scene "
        "declared by `ProjectDrive.frontier`: `Content/Scenes/DriveCourse.gltf`. The scene source is "
        "`DriveSceneAuthor`, now including the ControlVehicle, XPBD tyres, course props, sun/sky and a 20 x 20 drive "
        "material showcase. None of these PNG/GIF files is a native Vulkan, Slang, or ImGui capture.\n\n"
        "| Artefact | Meaning |\n"
        "|---|---|\n"
        "| `ProjectDriveVisibilityRaster_CPU_Reference.png` | Visibility-raster CPU reference of the actual Drive scene family. |\n"
        "| `ProjectDriveSurfelGI_CPU_Reference.png` | Same Drive scene through the CPU Surfel-GI mirror. |\n"
        "| `ProjectDriveReSTIR_CPU_Reference.png` | Same Drive scene through the CPU ReSTIR-DI direct-light mirror. |\n"
        "| `ProjectDriveAutomotiveMaterialsAngles_CPU_Reference.png` | Vehicle paint/glass/rubber/hub and drive material showcase angles. |\n"
        "| `ProjectDriveDrivingChase_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, chase framing. |\n"
        "| `ProjectDriveDrivingTrackside_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, trackside framing. |\n"
        "| `ProjectDriveDrivingOverhead_CPU_Reference.gif` | Vehicle motion GIF from the retained DriveTelemetry CSV, overhead framing. |\n"
        "| `ProjectDrivePhysicsTelemetryGraphs_CPU_Reference.svg` | Speed, input and aero graphs charted directly from DriveTelemetry. |\n"
        "| `ProjectDriveEditorDeclarations_CPU_Reference.txt` | C-ABI editor/outliner declarations; not an ImGui screenshot. |\n",
        encoding="utf-8",
    )


def write_provenance(outputs: list[Path]) -> None:
    source_paths = [
        ZERO_SPEC,
        DRIVE_SPEC,
        SHOWCASE_HEADER,
        SHOWCASE_SOURCE,
        DRIVE_SCENE_HEADER,
        DRIVE_SCENE_SOURCE,
        ZERO_INTERCHANGE,
        DRIVE_INTERCHANGE,
        DRIVE_TELEMETRY,
        ROOT / "Exhibits/Workbench/ProjectMirrors/RunFrontierCpuMirror.py",
    ]
    zero_outputs = [path for path in outputs if ZERO_GALLERY in path.parents or path.parent == ZERO_GALLERY]
    drive_outputs = [path for path in outputs if DRIVE_GALLERY in path.parents or path.parent == DRIVE_GALLERY]
    for retained in [
        DRIVE_GALLERY / "ProjectDrivePhysicsTelemetry_CPU_Reference.csv",
        DRIVE_GALLERY / "ProjectDrivePhysicsRun_CPU_Reference.txt",
        DRIVE_GALLERY / "ProjectDrivePhysicsTiming_CPU_Reference.txt",
        DRIVE_GALLERY / "ProjectDrivePhysicsTelemetryGraphs_CPU_Reference.svg",
    ]:
        if retained.exists() and retained not in drive_outputs:
            drive_outputs.append(retained)
    common = {
        "executionBoundary": {
            "nativeFrontierVulkanSlangImGuiCapture": False,
            "description": "CPU-reference artefacts keyed to project .frontier files, scene-author sources, C-ABI declarations, and retained DriveTelemetry. Native captures must use a Native name."
        },
        "sourceSha256": {rel(path): sha256(path) for path in source_paths if path.exists()},
    }
    zero_provenance = {
        **common,
        "proof": "Project-Zero default 20 x 20 material showcase CPU-reference render modes and editor declarations.",
        "openingScene": "FlattenedEngine/Projects/Project-Zero/Content/Scenes/Showcase.gltf",
        "renderModes": ["visibility raster", "Surfel GI", "ReSTIR DI"],
        "outputs": {path.name: sha256(path) for path in zero_outputs if path.exists()},
    }
    drive_provenance = {
        **common,
        "proof": "Project-Drive course, ControlVehicle, XPBD tyres, 20 x 20 material showcase, telemetry graphs and driving GIFs.",
        "openingScene": "FlattenedEngine/Projects/Project-Drive/Content/Scenes/DriveCourse.gltf",
        "telemetry": {
            "source": "ProjectDrivePhysicsTelemetry_CPU_Reference.csv",
            "durationSeconds": 12.0,
            "recordingHz": 60,
            "derivedAnimations": [
                "ProjectDriveDrivingChase_CPU_Reference.gif",
                "ProjectDriveDrivingTrackside_CPU_Reference.gif",
                "ProjectDriveDrivingOverhead_CPU_Reference.gif",
            ]
        },
        "renderModes": ["visibility raster", "Surfel GI", "ReSTIR DI"],
        "outputs": {path.name: sha256(path) for path in drive_outputs if path.exists()},
    }
    (ZERO_GALLERY / "Provenance.json").write_text(json.dumps(zero_provenance, indent=2) + "\n", encoding="utf-8")
    (DRIVE_GALLERY / "Provenance.json").write_text(json.dumps(drive_provenance, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    require_source_truth()
    ZERO_GALLERY.mkdir(parents=True, exist_ok=True)
    DRIVE_GALLERY.mkdir(parents=True, exist_ok=True)
    rows = read_telemetry()
    outputs: list[Path] = []

    zero_targets = [
        ("visibility", "wide", ZERO_GALLERY / "ProjectZeroMaterialShowcaseVisibility_CPU_Reference.png"),
        ("surfel", "angled", ZERO_GALLERY / "ProjectZeroMaterialShowcaseSurfelGI_CPU_Reference.png"),
        ("restir", "low", ZERO_GALLERY / "ProjectZeroMaterialShowcaseReSTIR_CPU_Reference.png"),
    ]
    for mode, view, target in zero_targets:
        render_project_zero(mode, view, target)
        outputs.append(target)
    zero_angles = ZERO_GALLERY / "ProjectZeroMaterialAngles_CPU_Reference.png"
    render_project_zero_angles(zero_angles)
    outputs.append(zero_angles)

    drive_targets = [
        ("visibility", DRIVE_GALLERY / "ProjectDriveVisibilityRaster_CPU_Reference.png"),
        ("surfel", DRIVE_GALLERY / "ProjectDriveSurfelGI_CPU_Reference.png"),
        ("restir", DRIVE_GALLERY / "ProjectDriveReSTIR_CPU_Reference.png"),
    ]
    for mode, target in drive_targets:
        render_project_drive(mode, target)
        outputs.append(target)
    drive_angles = DRIVE_GALLERY / "ProjectDriveAutomotiveMaterialsAngles_CPU_Reference.png"
    render_drive_material_angles(drive_angles)
    outputs.append(drive_angles)
    outputs.extend(render_drive_gifs(rows))
    outputs.extend(write_editor_declaration_files())

    write_readmes()
    outputs.extend([ZERO_GALLERY / "README.md", DRIVE_GALLERY / "README.md"])
    write_provenance(outputs)
    outputs.extend([ZERO_GALLERY / "Provenance.json", DRIVE_GALLERY / "Provenance.json"])
    print(f"Wrote {len(outputs)} Project-Zero/Project-Drive CPU-reference artefacts.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"RunFrontierCpuMirror failed: {error}", file=sys.stderr)
        raise SystemExit(1)
