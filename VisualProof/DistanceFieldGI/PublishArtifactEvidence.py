"""Retain paired production-shader CPU readbacks, including failures without mislabelling them as passes."""
from pathlib import Path
import hashlib
import json
import os
import shutil

Root = Path(__file__).resolve().parents[2]
Source = Root / '_AgentScratch/build/sdf-execution'
for Phase in ('ArtifactBaseline', 'ArtifactAfter'):
    Destination = Root / 'VisualProof/DistanceFieldGI' / Phase
    Destination.mkdir(parents=True, exist_ok=True)
    Captures = list((Source / 'Images' / Phase).glob('*.png'))
    if not Captures: continue
    for Previous in Destination.iterdir():
        if Previous.suffix in ('.log', '.png', '.json'): Previous.unlink()
    for File in Captures:
        shutil.copy2(File, Destination / File.name)
    Log = Source / (Phase+'.log')
    if Log.exists(): shutil.copy2(Log, Destination / 'Execution.log')
    Regression = Source / 'Regression.log'
    if Phase == 'ArtifactAfter' and Regression.exists(): shutil.copy2(Regression, Destination / 'Regression.log')
    Programs = Source / ('BaselineShaders' if Phase == 'ArtifactBaseline' else 'Shaders')
    Report = {'harnessSource': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
              'shaderSource': 'a42147b1148ffa13f08d4d11f42b665a8afb1a0d' if Phase == 'ArtifactBaseline' else os.environ['GITHUB_SHA'],
              'reference': 'matte-reference.png is independent CPU area quadrature, not a Vulkan readback.',
              'execution': 'Production SPIR-V on CPU Vulkan. Receiver-plane lighting maps, not perspective camera renders.',
              'shaders': {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Programs.glob('*.spv')},
              'images': {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Destination.glob('*.png')}}
    (Destination / 'Provenance.json').write_text(json.dumps(Report, indent=2)+'\n')
