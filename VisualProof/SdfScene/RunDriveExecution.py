"""Execute the actual Drive DLL and full vehicle scene through production SDF Vulkan kernels."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import time
from PIL import Image

Root = Path(__file__).resolve().parents[2]
Pose = sys.argv[1]
assert Pose in ('Rest', 'Loaded')
Destination = Root / 'VisualProof/SdfScene/Drive' / Pose
Scratch = Root / '_AgentScratch/build/DriveExecution' / Pose
Programs = Scratch / 'Shaders'
Programs.mkdir(parents=True, exist_ok=True)
Destination.mkdir(parents=True, exist_ok=True)
Report = {'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=Root, text=True).strip(),
          'pose': Pose, 'run': os.environ.get('GITHUB_RUN_ID'), 'exitCode': None,
          'method': 'Actual Project Drive DLL and complete opening glTF. CPU BVH supplies primary visibility only; production Vulkan SDF shaders perform lighting on lavapipe.',
          'limitations': ['Not an interactive Frontier window or hardware performance measurement.',
                         'Diffuse-only material override retains authored base colours; car-paint specular and transparent glazing are not represented.',
                         'Production SDF secondary traversal remains hybrid with its existing exact near-surface triangle refinement.',
                         'Rest and loaded are separate captures, not a continuous GPU deformation sequence.'],
          'settings': {'size': [512, 320], 'cardResolution': 2, 'volumeResolution': 32,
                       'clipCell': 0.15, 'warmupFrames': 8, 'simulationFrames': 120 if Pose == 'Loaded' else 0,
                       'simulationHz': 240, 'sunRadiance': 1.8, 'skyAmbient': 0.005, 'reflections': 0}}
Started = time.monotonic()
try:
    Drivers = sorted(Path('/usr/share/vulkan/icd.d').glob('*lvp*.json'))
    if not Drivers:
        raise RuntimeError('Software Vulkan ICD is required')
    os.environ['VK_ICD_FILENAMES'] = str(Drivers[0])
    os.environ.setdefault('GALLIVM_PERF', 'nopt')
    with (Destination / 'Execution.log').open('w') as Log:
        def Execute(Command):
            Log.write('$ ' + ' '.join(map(str, Command)).replace(str(Root), '<repository>') + '\n')
            Log.flush()
            subprocess.run(list(map(str, Command)), cwd=Root, stdout=Log, stderr=subprocess.STDOUT,
                           check=True, timeout=2700)
        Execute([sys.executable, Root / 'VisualProof/TyreDeformation/ExecuteTyres.py', '--capture-drive-only'])
        Engine = Root / 'Frontier'
        for Name in ('DistanceFieldConstruct', 'DistanceFieldCapture', 'DistanceFieldCaptureFixed',
                     'DistanceFieldRadiance', 'DistanceFieldGather', 'DistanceFieldGatherFixed',
                     'DistanceFieldGIResolve', 'DistanceFieldGIResolveFixed'):
            Execute(['glslc', '--target-env=vulkan1.2', '-fshader-stage=compute',
                     '-I' + str(Engine / 'Engine/Shaders'), '-I' + str(Engine / 'Engine'),
                     Engine / 'Engine/Shaders' / (Name + '.slang'), '-o', Programs / (Name + '.spv')])
            Execute(['spirv-val', '--target-env', 'vulkan1.2', Programs / (Name + '.spv')])
        Execute(['g++', '-std=c++20', '-O2', '-Wall', '-Wextra', '-Wno-missing-field-initializers',
                 '-I' + str(Engine), Root / 'VisualProof/SdfScene/SceneExecution.cpp',
                 Engine / 'Engine/DeviceExchange/DistanceFieldGIStage.cpp',
                 Engine / 'Engine/GeometricRaster/DistanceFieldStructure.cpp', '-lvulkan', '-o', Scratch / 'SceneExecution'])
        Exchange = Root / '_AgentScratch/build/TyreDeformation/Images' / ('Drive' + Pose + '.bin')
        Report['geometrySha256'] = hashlib.sha256(Exchange.read_bytes()).hexdigest()
        Execute([Scratch / 'SceneExecution', Programs, Scratch, 'Drive', Exchange])
        Report['exitCode'] = 0
except Exception as Error:
    Report['exitCode'] = 1
    Report['refusal'] = str(Error)
finally:
    for Capture in Scratch.glob('*.ppm'):
        with Image.open(Capture) as Pixels:
            Pixels.save(Destination / (Capture.stem + '.png'))
    Report['seconds'] = time.monotonic() - Started
    Report['shaders'] = {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Programs.glob('*.spv')}
    Report['images'] = {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Destination.glob('*.png')}
    (Destination / 'Provenance.json').write_text(json.dumps(Report, indent=2) + '\n')
    print(json.dumps(Report, indent=2))
sys.exit(Report['exitCode'])
