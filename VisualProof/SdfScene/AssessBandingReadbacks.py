"""Compare raw production readbacks with dense quadrature; never alter captured pixels."""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

Root = Path(__file__).resolve().parent
Before = Root / 'Captures'
After = Root / 'BandingAfter'
Cases = ('Reference', 'Orbit', 'High')

def Pixels(Directory, Case, Name='Scene-GI'):
    return np.asarray(Image.open(Directory / Case / (Name+'.png')).convert('RGB'), dtype=np.float64)

def Metrics(Difference):
    return {'rms': float(np.sqrt(np.mean(Difference**2))),
            'maximum': float(np.max(np.abs(Difference)))}

Reports = {}
Programs = None
Source = None
for Case in (*Cases, 'Oracle'):
    Directory = After / Case
    Provenance = json.loads((Directory/'Provenance.json').read_text())
    assert Provenance['exitCode'] == 0, 'Failed execution: '+Case
    if Source is None: Source = Provenance['source']
    assert Source == Provenance['source'], 'Dense and shipping captures must share a source revision'
    for Name, Digest in Provenance['images'].items():
        assert hashlib.sha256((Directory/Name).read_bytes()).hexdigest() == Digest
    if Case != 'Oracle':
        Baseline = json.loads((Before/Case/'Provenance.json').read_text())
        assert Baseline['exitCode'] == 0
        for Name, Digest in Baseline['images'].items():
            assert hashlib.sha256((Before/Case/Name).read_bytes()).hexdigest() == Digest
        if Programs is None: Programs = Provenance['shaders']
        assert Programs == Provenance['shaders'], 'View captures must use identical shipping shaders'
        Reports[Case] = {'source': Provenance['source'],
                         'giOffChange': Metrics(Pixels(After,Case,'Scene-GI-off')-Pixels(Before,Case,'Scene-GI-off')),
                         'giToggle': Metrics(Pixels(After,Case)-Pixels(After,Case,'Scene-GI-off'))}

Dense = Pixels(After,'Oracle')
Old = Pixels(Before,'Reference')
New = Pixels(After,'Reference')
# Predeclared physical foreground rectangle: no objects occur before Y=-1 in this fixture.
# Project only this geometric mask, never compute an independent lighting reference.
Height, Width = Dense.shape[:2]
Eye = np.array([7.,-10.,7.]); Target = np.array([0.,.5,1.])
Forward = Target-Eye; Forward /= np.linalg.norm(Forward)
Right = np.cross(Forward,[0.,0.,1.]); Right /= np.linalg.norm(Right)
Up = np.cross(Right,Forward)
Column, Row = np.meshgrid(np.arange(Width)+.5, np.arange(Height)+.5)
Aperture = np.tan(np.deg2rad(25.))
Directions = Forward + ((2*Column/Width-1)*Aperture*Width/Height)[...,None]*Right + ((1-2*Row/Height)*Aperture)[...,None]*Up
with np.errstate(divide='ignore', invalid='ignore'):
    Floor = Eye + Directions * (-Eye[2]/Directions[...,2])[...,None]
FloorMask = (Directions[...,2]<0)&(np.abs(Floor[...,0])<4.8)&(Floor[...,1]>-3.8)&(Floor[...,1]<-1.05)
LitMask = np.max(np.abs(Dense-Pixels(After,'Reference','Scene-GI-off')),axis=2)>=2
Comparison = {}
for Name, Mask in [('wholeImage',np.ones((Height,Width),dtype=bool)),('giAffectedPixels',LitMask),('foregroundFloor',FloorMask)]:
    Comparison[Name] = {'pixels':int(Mask.sum()), 'before':Metrics((Old-Dense)[Mask]), 'after':Metrics((New-Dense)[Mask])}
Restored = Metrics(Pixels(After,'Reference','Restored')-New)
# Improvement gates are separate from the retained, still-failing C026 scale gates.
Gate = all(Result['giOffChange']['maximum']==0 for Result in Reports.values())
Gate &= Restored['maximum']==0
Gate &= all(Comparison[Name]['after']['rms'] < Comparison[Name]['before']['rms']*.5 for Name in Comparison)
Report = {'method':'Raw 8-bit display RGB versus 512+512 unfiltered production-shader quadrature; same cache, scene and exposure.',
          'limitations':'Not independent transport ground truth. Matte scene only. No continuous-camera stability or GPU timing proof.',
          'sampleCountsPerTechnique':{'before':32,'after':32,'denseReference':512},
          'gates':{'giOffMaximumChange':0,'restorationMaximumChange':0,'rmsRatioUpperBound':.5},
          'views':Reports,'referenceComparison':Comparison,'restoredImage':Restored,'improvementPass':bool(Gate)}
(Root/'BandingAssessment.json').write_text(json.dumps(Report,indent=2)+'\n')

FontPath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def Font(Size):
    return ImageFont.truetype(FontPath,Size) if Path(FontPath).exists() else ImageFont.load_default(size=Size)
Panels=[]
for Case, Label in [('Reference','Original camera'),('Orbit','Orbit camera'),('High','High camera')]:
    Panels.extend([(Before,Case,'Scene-GI','BEFORE / '+Label),(After,Case,'Scene-GI','AFTER / '+Label)])
Panels.extend([(After,'Oracle','Scene-GI','REFERENCE / 512+512, no reconstruction'),
               (After,'Reference','Scene-GI-off','GI OFF / bit-identical before and after')])
Canvas=Image.new('RGB',(840,4*304+144),'#101318'); Drawing=ImageDraw.Draw(Canvas)
Drawing.text((24,18),'DIFFUSE GI / BANDING REPAIR',font=Font(24),fill='#f1f5fa')
Drawing.text((24,53),'Same scene, lights and exposure. Production SPIR-V on CPU Vulkan.',font=Font(15),fill='#b5c2d2')
Drawing.text((24,77),'Raw readbacks: no post-capture denoising, resizing, retouching or exposure changes.',font=Font(13),fill='#b5c2d2')
for Index,(Directory,Case,Name,Label) in enumerate(Panels):
    Left=24+(Index%2)*408; Top=110+(Index//2)*304
    Drawing.text((Left,Top),Label,font=Font(14),fill='#e5ebf2')
    Canvas.paste(Image.open(Directory/Case/(Name+'.png')).convert('RGB'),(Left,Top+25))
Drawing.text((24,4*304+116),'Primary visibility supplied by CPU triangles; every lighting calculation uses production shaders.',font=Font(13),fill='#b5c2d2')
Canvas.save(Root/'BandingComparison.png')
print(json.dumps(Report,indent=2))
if '--enforce' in sys.argv and not Gate:
    raise SystemExit('FAIL banding improvement, untouched-direct-lighting or restoration gate')
