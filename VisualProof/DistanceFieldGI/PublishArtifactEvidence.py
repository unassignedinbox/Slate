"""Retain actual CPU Vulkan readbacks; source revision and shader hashes travel with the pixels."""
from pathlib import Path
import hashlib
import json
import os
import shutil

Root = Path(__file__).resolve().parents[2]
Source = Root / '_AgentScratch/build/sdf-execution'
Phase = os.environ['EVIDENCE_PHASE']
if Phase not in ('ArtifactBaseline', 'ArtifactAfter'):
    raise SystemExit('Unknown evidence destination')
Destination = Root / 'VisualProof/DistanceFieldGI' / Phase
Destination.mkdir(parents=True, exist_ok=True)
for Pattern in ('shadow*.png', 'matte*.png'):
    for File in (Source / 'Images').glob(Pattern):
        shutil.copy2(File, Destination / File.name)
for Name in ('Artifacts.log', 'Execution.log'):
    if (Source / Name).exists():
        shutil.copy2(Source / Name, Destination / Name)
Report = {'source': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
          'execution': 'Production SPIR-V on CPU Vulkan, not a rewritten CPU shading approximation. Receiver-plane maps, not perspective camera renders.',
          'shaders': {File.name: hashlib.sha256(File.read_bytes()).hexdigest()
                      for File in (Source / 'Shaders').glob('*.spv')},
          'images': {File.name: hashlib.sha256(File.read_bytes()).hexdigest()
                     for File in Destination.glob('*.png')}}
(Destination / 'Provenance.json').write_text(json.dumps(Report, indent=2)+'\n')
