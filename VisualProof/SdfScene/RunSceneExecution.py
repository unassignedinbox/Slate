"""Render a perspective stress scene with the unmodified production SDF SPIR-V on CPU Vulkan."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import time
from PIL import Image

Root = Path(__file__).resolve().parents[2]
Case = sys.argv[1]
assert Case in ('Reference', 'Small', 'Large', 'Offset', 'Extreme', 'Orbit', 'High', 'Far')
Output = Root / '_AgentScratch/build/sdf-scene' / Case
Programs = Output / 'Shaders'
Destination = Root / 'VisualProof/SdfScene/Captures' / Case
Programs.mkdir(parents=True, exist_ok=True)
Destination.mkdir(parents=True, exist_ok=True)
Drivers = sorted(Path('/usr/share/vulkan/icd.d').glob('*lvp*.json'))
if not Drivers: raise SystemExit('CPU Vulkan ICD is required')
os.environ['VK_ICD_FILENAMES'] = str(Drivers[0])
os.environ.setdefault('GALLIVM_PERF', 'nopt')
Engine = Root / 'Frontier'
for Name in ('DistanceFieldConstruct', 'DistanceFieldCapture', 'DistanceFieldCaptureFixed', 'DistanceFieldRadiance', 'DistanceFieldGIResolve', 'DistanceFieldGIResolveFixed'):
    subprocess.run(['glslc', '--target-env=vulkan1.2', '-fshader-stage=compute', '-I'+str(Engine/'Engine/Shaders'),
                    '-I'+str(Engine/'Engine'), str(Engine/'Engine/Shaders'/ (Name+'.slang')), '-o', str(Programs/(Name+'.spv'))], check=True)
    subprocess.run(['spirv-val', '--target-env', 'vulkan1.2', str(Programs/(Name+'.spv'))], check=True)
subprocess.run(['g++', '-std=c++20', '-O2', '-Wall', '-Wextra', '-Wno-missing-field-initializers', '-I'+str(Engine),
                str(Root/'VisualProof/SdfScene/SceneExecution.cpp'), str(Engine/'Engine/DeviceExchange/DistanceFieldGIStage.cpp'),
                str(Engine/'Engine/GeometricRaster/DistanceFieldStructure.cpp'), '-lvulkan', '-o', str(Output/'SceneExecution')], check=True)
Started = time.monotonic()
Code = 124
try:
    with (Destination/'Execution.log').open('w') as Log:
        Result = subprocess.run([str(Output/'SceneExecution'), str(Programs), str(Output), Case], stdout=Log,
                                stderr=subprocess.STDOUT, timeout=3300)
        Code = Result.returncode
finally:
    for Capture in Output.glob('*.ppm'):
        with Image.open(Capture) as Pixels: Pixels.save(Destination/(Capture.stem+'.png'))
    Report = {'source': os.environ.get('GITHUB_SHA', subprocess.check_output(['git','rev-parse','HEAD'],cwd=Root,text=True).strip()),
              'run': os.environ.get('GITHUB_RUN_ID'), 'case': Case, 'exitCode': Code, 'seconds': time.monotonic()-Started,
              'method': 'Production Vulkan SDF stages on CPU ICD. CPU triangle intersections supply primary visibility only; all lighting/material/transport runs in production SPIR-V.',
              'settings': {'size':[384,256], 'cardResolution':4, 'volumeResolution':32, 'clipCell':0.15, 'warmupFrames':32,
                           'shadowConeSlope':0.06, 'sunRadiance':1.8, 'skyAmbient':0.005, 'reflections':0, 'materials':'matte Lambert, no textures; unused specular tables are unit placeholders'},
              'shaders': {P.name:hashlib.sha256(P.read_bytes()).hexdigest() for P in Programs.glob('*.spv')},
              'images': {P.name:hashlib.sha256(P.read_bytes()).hexdigest() for P in Destination.glob('*.png')}}
    (Destination/'Provenance.json').write_text(json.dumps(Report,indent=2)+'\n')
    print((Destination/'Execution.log').read_text(),flush=True)
if Code: raise SystemExit(Code)
