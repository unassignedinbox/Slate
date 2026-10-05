"""Build and execute native Drive deformation checks and CPU field renders; no browser renderer is involved."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
import zlib

Root = Path(__file__).resolve().parents[2]
Frontier = Root / 'Frontier'
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument('--dependencies', type=Path, default=Frontier / 'ExternalPackages')
Parser.add_argument('--capture-drive-only', action='store_true', help='Export full native scene snapshots without repeating diagnostic tyre renders')
Arguments = Parser.parse_args()
Dependencies = Arguments.dependencies.resolve()
Destination = Root / 'VisualProof/TyreDeformation'
Scratch = Root / '_AgentScratch/build/TyreDeformation'
Scratch.mkdir(parents=True, exist_ok=True)
Images = Scratch / 'Images'
Images.mkdir(exist_ok=True)
Captures = Destination / 'Captures'
Captures.mkdir(exist_ok=True)
os.environ['FRONTIER_PATCH_CACHE'] = str(Scratch / 'PatchCache')
Windows = sys.platform == 'win32'
Compiler = 'cl.exe' if Windows else os.environ.get('CXX', 'g++')
Includes = [Frontier, Frontier / 'Engine']
for Name in ('cgltf', 'stb', 'ufbx', 'vulkan-headers'):
    Folder = Dependencies / Name
    if Name == 'vulkan-headers' and not Folder.exists():
        Folder = Dependencies / 'Vulkan-Headers'
    Includes.append(Folder / 'include' if Name == 'vulkan-headers' else Folder)
Log = []


def Execute(Command, ExpectedCode=0):
    Result = subprocess.run([str(Value) for Value in Command], cwd=Scratch, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace')
    Log.append('$ ' + ' '.join(str(Value) for Value in Command) + '\n' + Result.stdout)
    (Destination / 'Execution.log').write_text('\n'.join(Log).replace(str(Root), '<repository>'), encoding='utf-8')
    print(Result.stdout, end='')
    if Result.returncode != ExpectedCode:
        raise RuntimeError(f"Expected exit {ExpectedCode}, got {Result.returncode}")


def Build(Name, Sources, Shared=False):
    Output = Scratch / (Name + ('.dll' if Shared else '.exe' if Windows else ''))
    if Windows:
        Command = [Compiler, '/nologo', '/O2', '/MD', '/EHsc', '/std:c++20', '/utf-8', '/W3',
                   '/DNOMINMAX', '/DWIN32_LEAN_AND_MEAN', '/D_CRT_SECURE_NO_WARNINGS',
                   *(['/LD'] if Shared else []), *['/I' + str(Value) for Value in Includes],
                   *Sources, '/Fe:' + str(Output)]
    else:
        Command = [Compiler, '-std=c++20', '-O2', '-Wall', '-Wextra', '-pthread',
                   *(['-shared', '-fPIC'] if Shared else []), *['-I' + str(Value) for Value in Includes],
                   *Sources, '-ldl', '-o', Output]
    Execute(Command)
    return Output


def Png(Source, Output):
    Data = Source.read_bytes()
    Magic, Dimensions, Maximum, Pixels = Data.split(b'\n', 3)
    assert Magic == b'P6' and Maximum == b'255'
    Width, Height = map(int, Dimensions.split())
    assert len(Pixels) == Width * Height * 3
    def Chunk(Name, Payload):
        return struct.pack('>I', len(Payload)) + Name + Payload + struct.pack('>I', zlib.crc32(Name + Payload))
    Rows = b''.join(b'\0' + Pixels[Row * Width * 3:(Row + 1) * Width * 3] for Row in range(Height))
    Output.write_bytes(b'\x89PNG\r\n\x1a\n' + Chunk(b'IHDR', struct.pack('>IIBBBBB', Width, Height, 8, 2, 0, 0, 0)) +
                       Chunk(b'IDAT', zlib.compress(Rows, 9)) + Chunk(b'IEND', b''))


ContentManifest = json.loads((Frontier / 'Projects/Project-Drive/Build/DriveContentSources.json').read_text())
ContentSources = [Frontier / Value for Value in ContentManifest['sources']]
ContentHost = Build('DriveContentHost', ContentSources)
Scene = Frontier / 'Projects/Project-Drive/Content/Scenes/DriveCourse.r4.gltf'
Execute([ContentHost, '--ensure', Scene])
Execute([ContentHost, '--verify-only', Scene])
BakePath = Frontier / 'Projects/Project-Drive/Content/DistanceFields/DriveTyre.sdf'
OriginalBake = BakePath.read_bytes()
try:
    Damaged = bytearray(OriginalBake)
    Damaged[-16] ^= 0x40
    BakePath.write_bytes(Damaged)
    Execute([ContentHost, '--verify-only', Scene], ExpectedCode=1)
finally:
    BakePath.write_bytes(OriginalBake)
SimulationManifest = json.loads((Frontier / 'Projects/Project-Drive/Build/DriveSimulationSources.json').read_text())
SimulationSources = [Frontier / Value for Value in SimulationManifest['sources']]
Image = Build('ProjectDrive', SimulationSources, True)
Playback = Build('DriveInterchangeChecks', SimulationSources + [Frontier / 'Projects/Project-Drive/Source/DriveInterchangeChecks.cpp'])
Execute([Playback])
InterchangeSources = [Value for Value in ContentSources if Value.name != 'DriveContentHost.cpp'] + [
    Frontier / 'Engine/ProjectInterchange/CodeInterchange.cpp',
    Frontier / 'Engine/ProjectInterchange/ProjectSpecification.cpp',
    Frontier / 'Engine/GeometricRaster/DistanceFieldStructure.cpp', Destination / 'InterchangeHost.cpp']
Interchange = Build('InterchangeHost', InterchangeSources)
Execute([Interchange, Image, Scene, Images])
if Arguments.capture_drive_only:
    print('PASS native Drive rest/loaded scene export for production Vulkan execution')
    sys.exit(0)
Renderer = Build('TyreHost', [Destination / 'TyreHost.cpp',
                            Frontier / 'Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.cpp',
                            Frontier / 'Engine/GeometricRaster/DistanceFieldSpace.cpp'])
Execute([Renderer, Images])
Live = json.loads((Images / 'ProjectDrive.json').read_text())
Execute([Renderer, Images, Images / 'ProjectDrive.sdf', str(Live['hub'][2])])
for Source in sorted(Images.glob('*.ppm')):
    Png(Source, Captures / (Source.stem + '.png'))
for Name in ('Metrics.json', 'ProjectDrive.json'):
    (Destination / Name).write_bytes((Images / Name).read_bytes())
Provenance = {'platform': sys.platform, 'productionVulkanExecuted': False, 'renderer': 'native C++ CPU field-only reference',
              'sceneSha256': hashlib.sha256(Scene.read_bytes()).hexdigest(), 'files': {}}
Sources = set(ContentSources + SimulationSources + InterchangeSources + [Destination / 'TyreHost.cpp'])
Sources.update(Frontier / Value for Value in (
    'Engine/GeometricRaster/DeformationSpace.h', 'Engine/Host/GeometrySequence.h',
    'Engine/Host/FrontierRuntime.cpp', 'Engine/ProjectInterchange/GeometryInterchange.h',
    'Projects/Project-Drive/Source/TyreSequence.h'))
Sources.update(Captures.glob('*.png'))
Sources.add(Frontier / 'Projects/Project-Drive/Content/DistanceFields/DriveTyre.sdf')
for Source in sorted(Sources):
    Provenance['files'][str(Source.relative_to(Root))] = hashlib.sha256(Source.read_bytes()).hexdigest()
(Destination / 'Provenance.json').write_text(json.dumps(Provenance, indent=2) + '\n')
print('PASS native Drive playback, deformation handoff, field revision, rest bake and twelve CPU diagnostic renders')
