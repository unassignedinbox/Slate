"""Compare fixed physical probes independently of camera projection; retain raw pixels in labelled sheets."""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

Root = Path(__file__).resolve().parent
Captures = Root / 'Captures'
Cases = ['Reference','Orbit','High','Far','Small','Large','Offset','Extreme']
X, Y = np.meshgrid(-2.8+(np.arange(32)+.5)/32*5.6, -2+(np.arange(32)+.5)/32*4.8)
VisibleFloor = ((X+.5)**2+(Y-.2)**2 > .7**2)
VisibleFloor &= ~((X>=.6)&(X<=1.4)&(Y>=.4)&(Y<=1.2))
VisibleFloor &= ~((X>=-2.6)&(X<=-1.7)&(Y>=-.8)&(Y<=1.9))
def Pixels(Case, Name): return np.asarray(Image.open(Captures/Case/(Name+'.png')).convert('RGB'),dtype=np.float64)
Reference = Pixels('Reference','Floor-probes')
Report = {'method':'RGB errors on identical, exposed floor points; occluded object footprints excluded. Display units 0..255.',
          'thresholdRms':1.0, 'thresholdMaximum':5.0, 'probeCount':int(VisibleFloor.sum()), 'cases':{}}
Programs = None
for Case in Cases:
    Pathname = Captures/Case
    Provenance = json.loads((Pathname/'Provenance.json').read_text())
    if Provenance['exitCode']!=0: raise SystemExit('Execution did not pass: '+Case)
    for Name, Digest in Provenance['images'].items():
        assert hashlib.sha256((Pathname/Name).read_bytes()).hexdigest()==Digest
    if Programs is None: Programs=Provenance['shaders']
    assert Programs==Provenance['shaders'], 'Different shaders cannot form an invariance comparison'
    Error = (Pixels(Case,'Floor-probes')-Reference)[VisibleFloor]
    Rms, Maximum = float(np.sqrt(np.mean(Error**2))),float(np.max(np.abs(Error)))
    Difference = Pixels(Case,'Scene-GI')-Pixels(Case,'Scene-GI-off')
    Report['cases'][Case]={'rms':Rms, 'maximum':Maximum, 'withinTolerance':Rms<=1 and Maximum<=5,
                           'giToggleRms':float(np.sqrt(np.mean(Difference**2))), 'source':Provenance['source']}
ReturnError=Pixels('Reference','Restored')-Pixels('Reference','Scene-GI')
Report['restoredImageRms']=float(np.sqrt(np.mean(ReturnError**2)))
Report['restoredImageMaximum']=float(np.max(np.abs(ReturnError)))
Report['failingCases']=[Case for Case,Result in Report['cases'].items() if not Result['withinTolerance']]
Report['overallInvariancePass']=not Report['failingCases']
(Root/'Assessment.json').write_text(json.dumps(Report,indent=2)+'\n')
FontPath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def Font(Size): return ImageFont.truetype(FontPath,Size)
def Sheet(File, Panels, Columns, Title, Subtitle):
    Rows=(len(Panels)+Columns-1)//Columns
    Canvas=Image.new('RGB',(Columns*408+24,Rows*320+132),'#101318'); Draw=ImageDraw.Draw(Canvas)
    Draw.text((24,20),Title,font=Font(23),fill='#f1f5fa');Draw.text((24,58),Subtitle,font=Font(14),fill='#aab6c7')
    for Index,(Case,Name,Label,Note) in enumerate(Panels):
        X=24+(Index%Columns)*408; Y=100+(Index//Columns)*320
        Draw.text((X,Y),Label,font=Font(17),fill='#e4e9ef')
        Canvas.paste(Image.open(Captures/Case/(Name+'.png')).convert('RGB'),(X,Y+28))
        Draw.text((X,Y+290),Note,font=Font(13),fill='#aab6c7')
    Draw.text((24,Rows*320+110),'Actual 384 x 256 readbacks; no denoising, retouching or exposure changes. Reflections off.',font=Font(13),fill='#aab6c7')
    Canvas.save(Root/File)
Sheet('LightingAndMotion.png',[
 ('Reference','Scene-GI-off','GI OFF / same sun and exposure','Direct lighting + fixed sky fill'),
 ('Reference','Scene-GI','SDF GI ON','Production surface-card transport; matte scene'),
 ('Reference','Moved-first-frame','MOVED / first frame','Same running stage; instance moved 1.5 m'),
 ('Reference','Moved-settled','MOVED / settled','32 production cache updates after motion')],2,
 'SDF GI / INDEPENDENT CUSTOM SCENE','Actual production SPIR-V executed on CPU Vulkan; CPU triangles supply primary visibility.')
Descriptions={'Reference':'Base scene / front camera','Orbit':'Left orbit / same scene','High':'High camera / same scene','Far':'Camera 20x farther / narrower FOV',
              'Small':'Scene scale 0.01x','Large':'Scene scale 100x','Offset':'Offset (+10k, -25k, +1k) m','Extreme':'Offset (+1M, -1M, +1M) m'}
Panels=[]
for Case in Cases:
    Result=Report['cases'][Case]
    Panels.append((Case,'Scene-GI',Descriptions[Case],f"Floor RGB RMS {Result['rms']:.3f}; max {Result['maximum']:.0f}"))
Sheet('ScaleDistanceAndViews.png',Panels,2,'SDF GI / SCALE, DISTANCE AND CAMERA',
      'Same shaders, materials, light, cell size and card resolution. Finite stress cases, not an any-distance guarantee.')
print(json.dumps(Report,indent=2))

if '--enforce' in sys.argv and not Report['overallInvariancePass']:
    raise SystemExit('FAIL invariance gates: '+', '.join(Report['failingCases']))
