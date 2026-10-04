//============================================================================================================================================
//                                                             WORKSPACEPANEL.JS
//============================================================================================================================================
// 📦 Static polygon cliff authoring workspace, clay viewport, stage inspection and triangle OBJ exchange.

import * as THREE from 'three';
import {OrbitControls} from '../Ocean/lib/addons/OrbitControls.js';
import {CliffDefaults, CliffProfiles, ReadSpecification} from './CliffSpecification.js';

const Element=Id=>document.getElementById(Id);
const StageDescriptions=[
    ['Cliff mass','Buttresses, bays & crown','A continuous profiled landform. Concave bays and projecting buttresses establish the silhouette before any fractures.'],
    ['Bedding cuts','Dipping sedimentary beds','A coherent family of inclined bedding planes. Authored bed-thickness sequences, with real open seams.'],
    ['Bounded joints','Finite-depth rock blocks','Staggered joint planes split the exposed strata, then terminate before the rear of the cliff.'],
    ['Edge spalls','Local fracture cavities','Localized, asymmetric bites with four or six fracture facets. The original edge survives on both sides—not a full-edge bevel.'],
    ['Surface fissures','Shallow polygon incisions','Finite, kinked V-grooves cut into individual rock faces. Closed bottoms, bounded depth; no SDF erosion.']
];
const State={Specification:{...CliffDefaults},Result:null,Stage:4,Revision:0,ReadyRevision:0,Worker:null,Dirty:false,
    Mode:'Clay',Wire:false,Selected:null,Isolated:false,Exploded:false,Milliseconds:0,Error:null};
const Scene=new THREE.Scene();
Scene.background=new THREE.Color('#282e38');
const Camera=new THREE.PerspectiveCamera(38,1,.05,500);
const Renderer=new THREE.WebGLRenderer({canvas:Element('SceneCanvas'),antialias:true,preserveDrawingBuffer:true});
Renderer.setPixelRatio(Math.min(devicePixelRatio,2));
Renderer.shadowMap.enabled=true;
Renderer.shadowMap.type=THREE.PCFSoftShadowMap;
Renderer.shadowMap.autoUpdate=false;
Renderer.toneMapping=THREE.ACESFilmicToneMapping;
Renderer.toneMappingExposure=1;
const Controls=new OrbitControls(Camera,Renderer.domElement);
Controls.enableDamping=true;
Controls.dampingFactor=.12;
Controls.minDistance=.5;
Controls.maxDistance=150;
Controls.maxPolarAngle=Math.PI*.49;
const Hemisphere=new THREE.HemisphereLight('#d7e5fc','#484952',1.25);
Scene.add(Hemisphere);
const Sun=new THREE.DirectionalLight('#fff4e5',3.2);
Sun.position.set(-26,37,24);
Sun.castShadow=true;
Sun.shadow.mapSize.set(2048,2048);
Object.assign(Sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:.5,far:150});
Sun.shadow.normalBias=.025;
Sun.shadow.bias=-.00004;
Sun.shadow.radius=2;
Scene.add(Sun,Sun.target);
const Fill=new THREE.DirectionalLight('#b5c9ea',.65);
Fill.position.set(22,16,-16);
Scene.add(Fill);
const Ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#333b48',roughness:1}));
Ground.rotation.x=-Math.PI/2;
Ground.position.y=-.12;
Ground.receiveShadow=true;
Scene.add(Ground);
const Grid=new THREE.GridHelper(100,20,'#424c5c','#384250');
Grid.position.y=-.105;
Grid.material.transparent=true;
Grid.material.opacity=.25;
Scene.add(Grid);
const BodyGroup=new THREE.Group();
Scene.add(BodyGroup);
const ClayMaterial=new THREE.MeshStandardMaterial({color:'#a9abad',roughness:1,metalness:0,flatShading:true,
    polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
const CutMaterial=ClayMaterial.clone();
CutMaterial.color.set('#ffffff');
CutMaterial.vertexColors=true;
const WireMaterial=new THREE.LineBasicMaterial({color:'#111820',transparent:true,opacity:.35});
const SelectionMaterial=new THREE.LineBasicMaterial({color:'#efb063',transparent:true,opacity:.9,depthTest:true});
const CutColours={Cliff:'#929aa5',Crown:'#929aa5',Base:'#929aa5',End:'#929aa5',Back:'#929aa5',Bedding:'#8ca49d',
    Joint:'#8ca49d',Termination:'#8ca49d',Spall:'#e0a570',Crack:'#d07969'};
let SelectionOutline=null;
let ResizePending=true;
let RenderRequested=true;
const ResizeObserverHandle=new ResizeObserver(()=>{ResizePending=true;});
ResizeObserverHandle.observe(Element('Viewport'));

function SetStatus(Message, Warning=false)
{
    Element('Status').textContent=Message;
    Element('StatusDot').style.background=Warning?'#c59a61':'#88a483';
}

function SetPressed(Id, Value)
{
    RenderRequested=true;
    Element(Id).classList.toggle('Active',Value);
    Element(Id).setAttribute('aria-pressed',String(Value));
}

function DisposeBodies()
{
    ClearSelection();
    BodyGroup.children.forEach(Body=>Body.traverse(Object=>{if(Object.geometry) Object.geometry.dispose();}));
    BodyGroup.clear();
}

function BuildRenderBody(Mesh, Index)
{
    const Positions=new Float32Array(Mesh.Triangles.length*9);
    const Colours=new Float32Array(Positions.length);
    Mesh.Triangles.forEach((Triangle,TriangleIndex)=>
    {
        const Colour=new THREE.Color(CutColours[Mesh.Tags[TriangleIndex]]||'#929aa5');
        Triangle.forEach((Vertex,Corner)=>
        {
            Positions.set(Mesh.Vertices[Vertex],TriangleIndex*9+Corner*3);
            Colours.set([Colour.r,Colour.g,Colour.b],TriangleIndex*9+Corner*3);
        });
    });
    const Geometry=new THREE.BufferGeometry();
    Geometry.setAttribute('position',new THREE.BufferAttribute(Positions,3));
    Geometry.setAttribute('color',new THREE.BufferAttribute(Colours,3));
    Geometry.computeVertexNormals();
    Geometry.computeBoundingBox();
    Geometry.computeBoundingSphere();
    const Body=new THREE.Mesh(Geometry,State.Mode==='Scars'?CutMaterial:ClayMaterial);
    Body.name=Mesh.Name;
    Body.userData={Index,Mesh,Centre:Geometry.boundingBox.getCenter(new THREE.Vector3())};
    Body.castShadow=true;
    Body.receiveShadow=true;
    const Wire=new THREE.LineSegments(new THREE.WireframeGeometry(Geometry),WireMaterial);
    Wire.name='Triangle edges';
    Wire.visible=State.Wire;
    Body.add(Wire);
    return Body;
}

function ViewStage(StageNumber)
{
    RenderRequested=true;
    Renderer.shadowMap.needsUpdate=true;
    State.Stage=Math.max(1,Math.min(5,StageNumber));
    const [Title,,Description]=StageDescriptions[State.Stage-1];
    Element('StageTitle').textContent=Title;
    Element('StageDescription').textContent=Description;
    Element('StageNumber').textContent=`0${State.Stage} / 05`;
    Element('PreviousStage').disabled=State.Stage===1;
    Element('NextStage').disabled=State.Stage===5;
    document.querySelectorAll('.StageButton').forEach(Button=>
    {
        const Selected=Number(Button.dataset.stage)===State.Stage;
        Button.classList.toggle('Active',Selected);
        Button.setAttribute('aria-pressed',String(Selected));
    });
    if (!State.Result) return;
    const Name=State.Selected?.name;
    const Isolated=State.Isolated;
    DisposeBodies();
    const Stage=State.Result.Stages[State.Stage-1];
    Stage.Meshes.forEach((Mesh,Index)=>BodyGroup.add(BuildRenderBody(Mesh,Index)));
    if (Name)
    {
        const Match=BodyGroup.children.find(Body=>Body.name===Name);
        if (Match) SelectBody(Match,false);
        State.Isolated=Isolated && !!Match;
    }
    ApplyVisibility();
    UpdateMetrics();
}

function UpdateMetrics()
{
    const Stage=State.Result?.Stages[State.Stage-1];
    if (!Stage) return;
    const Metrics=Stage.Metrics;
    const Format=Value=>Value.toLocaleString('en');
    Element('Metrics').innerHTML=`<span>Closed mesh objects</span><b>${Metrics.Bodies}</b>
        <span>Vertices / triangles</span><b>${Format(Metrics.Vertices)} / ${Format(Metrics.Triangles)}</b>
        <span>Open / nonmanifold edges</span><b class="Pass">${Metrics.OpenEdges} / ${Metrics.NonmanifoldEdges}</b>
        <span>Nonmanifold vertices / duplicates</span><b class="Pass">${Metrics.NonmanifoldVertices} / ${Metrics.DuplicateTriangles}</b>
        <span>Degenerate / flipped winding</span><b class="Pass">${Metrics.ZeroArea} / ${Metrics.WindingErrors}</b>
        <span>Local spalls / fissures</span><b>${Metrics.Spalls} / ${Metrics.Cracks}</b>
        <span>Rejected spalls / fissures</span><b>${Metrics.RejectedSpalls} / ${Metrics.RejectedCracks}</b>
        <span>Triangles below 5°</span><b class="${Metrics.ThinTriangles?'Warn':'Pass'}">${Metrics.ThinTriangles}</b>
        <span>Minimum triangle angle</span><b>${Metrics.MinimumAngle.toFixed(2)}°</b>
        <span>Whole pipeline</span><b>${(State.Milliseconds/1000).toFixed(2)} s</b>`;
    Element('QualityNote').textContent=Metrics.ThinTriangles ?
        'Narrow triangles remain at some clipped intersections; counted above, not hidden. Topology checks do not prove absence of all surface intersections.' :
        'Indexed export topology checked per body. No n-gons. Display wireframe includes every triangulation edge.';
    Element('BodyCount').textContent=`${Metrics.Bodies} closed mesh objects`;
    Element('TriangleCount').textContent=`${Format(Metrics.Triangles)} triangles`;
    if (!State.Dirty) SetStatus(`Stage ${State.Stage} · ${Metrics.ThinTriangles ? `${Metrics.ThinTriangles} narrow-triangle warnings` : 'Topology checked'} · seed ${State.Result.Specification.Seed}`,!!Metrics.ThinTriangles);
}

function ClearSelection()
{
    RenderRequested=true;
    if (SelectionOutline)
    {
        SelectionOutline.removeFromParent();
        SelectionOutline.geometry.dispose();
        SelectionOutline=null;
    }
    State.Selected=null;
    State.Isolated=false;
    Element('SelectionName').textContent='Cliff formation';
    Element('SelectionDetail').textContent='Double-click a rock to inspect it.';
    Element('Isolate').disabled=true;
    Element('Isolate').textContent='Isolate rock';
}

function SelectBody(Body, Focus=true)
{
    ClearSelection();
    State.Selected=Body;
    SelectionOutline=new THREE.LineSegments(new THREE.EdgesGeometry(Body.geometry,12),SelectionMaterial);
    Body.add(SelectionOutline);
    Element('SelectionName').textContent=Body.name;
    Element('SelectionDetail').textContent=`${Body.userData.Mesh.Triangles.length.toLocaleString()} triangles · ${Body.userData.Mesh.Spalls.length} spalls · ${Body.userData.Mesh.Cracks.length} fissures`;
    Element('Isolate').disabled=false;
    if (Focus) FrameView(Body);
}

function ApplyVisibility()
{
    RenderRequested=true;
    Renderer.shadowMap.needsUpdate=true;
    BodyGroup.children.forEach(Body=>
    {
        Body.visible=!State.Isolated || Body===State.Selected;
        const Centre=Body.userData.Centre;
        Body.position.set(State.Exploded?Centre.x*.15:0,State.Exploded?Centre.y*.14:0,State.Exploded?Centre.z*.13:0);
    });
    Element('Isolate').textContent=State.Isolated?'Restore cliff':'Isolate rock';
}

function FrameView(Body=null, Direction=null)
{
    RenderRequested=true;
    if (!BodyGroup.children.length) return;
    const View=Element('Viewport').getBoundingClientRect();
    Camera.aspect=View.width/Math.max(1,View.height);
    const Box=new THREE.Box3().setFromObject(Body||BodyGroup);
    const Middle=Box.getCenter(new THREE.Vector3());
    const Size=Box.getSize(new THREE.Vector3());
    const Radius=Size.length()*.5;
    const Angle=Math.min(Camera.fov*Math.PI/360,Math.atan(Math.tan(Camera.fov*Math.PI/360)*Camera.aspect));
    const Distance=Radius/Math.sin(Angle)*(Body?1.10:.93);
    const Offset=(Direction||new THREE.Vector3(.47,.25,.88)).clone().normalize();
    Controls.target.copy(Middle);
    Camera.position.copy(Middle).addScaledVector(Offset,Distance);
    Camera.near=Math.max(.02,Distance/2000);
    Camera.updateProjectionMatrix();
    Controls.update();
}

function MarkDirty()
{
    State.Dirty=true;
    Element('ExportObj').disabled=true;
    SetStatus('Parameters changed · rebuild required',true);
}

function Generate()
{
    State.Worker?.terminate();
    const Revision=++State.Revision;
    State.Error=null;
    MarkDirty();
    State.Result=null;
    DisposeBodies();
    Renderer.shadowMap.needsUpdate=true;
    Element('BodyCount').textContent='Building strata…';
    Element('Metrics').textContent='Building a new mesh; previous result discarded.';
    Element('Failure').hidden=true;
    Element('Loading').hidden=false;
    Element('LoadingTitle').textContent='Constructing cliff';
    Element('LoadingDetail').textContent='Stitching geological profiles…';
    Element('Regenerate').textContent='Restart rebuild';
    SetStatus('Building new geometry · no cached OBJ fallback');
    try
    {
        State.Specification=ReadSpecification(State.Specification);
        for (const [Name,Value] of Object.entries(State.Specification))
        {
            const Input=Element(Name);
            if (Input)
            {
                Input.value=Value;
                UpdateRange(Input);
            }
        }
        const GenerationWorker=new Worker(new URL('./GenerationQueue.js',import.meta.url),{type:'module'});
        State.Worker=GenerationWorker;
        GenerationWorker.onmessage=Event=>
        {
            const Message=Event.data;
            if (Message.Revision!==State.Revision) return;
            if (Message.Progress)
            {
                Element('LoadingDetail').textContent=`${Message.Progress} / 5 · ${StageDescriptions[Message.Progress-1][0]}`;
                return;
            }
            if (Message.Error)
            {
                FailGeneration(Message.Error);
                return;
            }
            State.Result=Message.Result;
            State.Milliseconds=Message.Milliseconds;
            State.ReadyRevision=Revision;
            State.Dirty=false;
            Element('Loading').hidden=true;
            Element('Regenerate').textContent='Rebuild geometry';
            Element('ExportObj').disabled=false;
            ViewStage(State.Stage);
            FrameView();
            GenerationWorker.terminate();
            State.Worker=null;
        };
        GenerationWorker.onerror=Event=>
        {
            if (State.Revision===Revision) FailGeneration(Event.message||'Geometry worker failed to load.');
        };
        GenerationWorker.postMessage({Revision,Specification:State.Specification});
    }
    catch (Error)
    {
        FailGeneration(Error.message);
    }
}

function FailGeneration(Message)
{
    State.Worker?.terminate();
    State.Worker=null;
    State.Result=null;
    State.Error=Message;
    State.Dirty=true;
    DisposeBodies();
    Renderer.shadowMap.needsUpdate=true;
    Element('ExportObj').disabled=true;
    Element('BodyCount').textContent='No generated mesh';
    Element('Metrics').textContent='No mesh available. Generation or rendering failed.';
    Element('Loading').hidden=true;
    Element('Failure').hidden=false;
    Element('Failure').textContent=`Generation failed: ${Message} No previous or prebaked geometry has been substituted. Change the recipe and rebuild.`;
    Element('Regenerate').textContent='Retry rebuild';
    SetStatus('Generation failed · export disabled',true);
}

function Download(Name, Content, Type)
{
    const Url=URL.createObjectURL(new Blob([Content],{type:Type}));
    const Link=document.createElement('a');
    Link.href=Url;
    Link.download=Name;
    Link.click();
    setTimeout(()=>URL.revokeObjectURL(Url),1000);
}

function ObjText()
{
    if (!State.Result || State.Dirty) throw new Error('Rebuild the current recipe before exporting.');
    const Stage=State.Result.Stages[State.Stage-1];
    const Lines=[`# Frontier polygon cliff | stage ${State.Stage} | seed ${State.Result.Specification.Seed}`,
        '# metres; triangles only; untransformed source geometry; no textures, displacement or SDF','s off'];
    let Offset=1;
    for (const Mesh of Stage.Meshes)
    {
        Lines.push(`o ${Mesh.Name.replace(/[^a-zA-Z0-9]+/g,'_')}`);
        Mesh.Vertices.forEach(Point=>Lines.push(`v ${Point.map(Value=>Value.toFixed(8)).join(' ')}`));
        Mesh.Triangles.forEach(Triangle=>Lines.push(`f ${Triangle.map(Index=>Index+Offset).join(' ')}`));
        Offset+=Mesh.Vertices.length;
    }
    return Lines.join('\n')+'\n';
}

const Groups=[
    ['Cliff mass',true,[['Profile','Landform'],['Seed','Feature seed'],['Width','Width',18,48,.5,'m'],['Height','Height',10,26,.5,'m'],
        ['Depth','Depth',8,18,.5,'m'],['Relief','Buttress / bay relief',.35,1.3,.05,'×'],['Retreat','Crown retreat',.25,.65,.01,'×']]],
    ['Bedding cuts',false,[['Beds','Bed count',4,10,1,''],['Dip','Bedding dip',-8,8,.5,'°'],['Aperture','Joint aperture',.035,.18,.005,'m']]],
    ['Bounded joints',false,[['JointSpacing','Joint spacing',3,7,.2,'m'],['Penetration','Joint penetration',.55,.9,.01,'×'],['FaceRecess','Face recess scale',0,1.5,.05,'m']]],
    ['Edge spalls',true,[['SpallSize','Spall scale',.25,1.3,.05,'m'],['SpallDensity','Edge occupancy',0,1,.05,'×']]],
    ['Surface fissures',false,[['CrackLength','Maximum length',.5,2.2,.1,'m'],['CrackWidth','Mouth width',.07,.22,.01,'m'],
        ['CrackDepth','Maximum depth',.06,.3,.01,'m'],['CrackDensity','Face occupancy',0,1,.05,'×']]],
    ['Triangulation',false,[['TriangleSpan','Target edge span',.8,2.2,.1,'m']]]
];
function BuildControls()
{
    Element('ParameterControls').innerHTML=Groups.map(([Title,Open,Fields])=>`<details ${Open?'open':''}><summary>${Title}</summary><div class="ControlGroup">${Fields.map(([Name,Label,Minimum,Maximum,Step,Unit])=>
    {
        if (Name==='Profile') return `<div class="Property"><label class="FieldLabel" for="Profile">${Label}</label><select id="Profile">${Object.entries(CliffProfiles).map(([Key,Profile])=>`<option value="${Key}">${Profile.Label}</option>`).join('')}</select></div>`;
        if (Name==='Seed') return `<div class="Property"><label class="FieldLabel" for="Seed">${Label}<span class="Subtle">catalogue selection</span></label><div class="SeedRow"><input type="number" id="Seed" min="0" max="999999" step="1"><button id="NewSeed">New seed</button></div></div>`;
        return `<div class="Property"><label class="FieldLabel" for="${Name}">${Label}<output id="${Name}Value"></output></label><input type="range" id="${Name}" min="${Minimum}" max="${Maximum}" step="${Step}" data-unit="${Unit}"></div>`;
    }).join('')}</div></details>`).join('');
    for (const [, ,Fields] of Groups)
    {
        for (const [Name] of Fields)
        {
            const Input=Element(Name);
            Input.value=State.Specification[Name];
            UpdateRange(Input);
            Input.addEventListener('input',()=>
            {
                State.Specification[Name]=Name==='Profile'?Input.value:Number(Input.value);
                UpdateRange(Input);
                MarkDirty();
            });
            Input.addEventListener('change',()=>
            {
                State.Specification[Name]=Name==='Profile'?Input.value:Number(Input.value);
                Generate();
            });
        }
    }
    Element('NewSeed').onclick=()=>
    {
        State.Specification.Seed=crypto.getRandomValues(new Uint32Array(1))[0]%1000000;
        Element('Seed').value=State.Specification.Seed;
        Generate();
    };
}

function UpdateRange(Input)
{
    if (Input.type!=='range') return;
    Input.style.setProperty('--Fill',`${(Number(Input.value)-Number(Input.min))/(Number(Input.max)-Number(Input.min))*100}%`);
    const Output=Element(`${Input.id}Value`);
    if (Output) Output.textContent=`${Number(Input.value).toFixed(Number(Input.step)<.01?3:Number(Input.step)<1?2:0)} ${Input.dataset.unit||''}`;
}

StageDescriptions.forEach(([Title,Subtitle],Index)=>
{
    const Button=document.createElement('button');
    Button.className='StageButton';
    Button.dataset.stage=Index+1;
    Button.innerHTML=`<span class="Number">0${Index+1}</span><span><strong>${Title}</strong><small>${Subtitle}</small></span>`;
    Button.onclick=()=>ViewStage(Index+1);
    Element('StageList').appendChild(Button);
});
BuildControls();
ViewStage(State.Stage);
Element('Regenerate').onclick=Generate;
Element('PreviousStage').onclick=()=>ViewStage(State.Stage-1);
Element('NextStage').onclick=()=>ViewStage(State.Stage+1);
Element('Frame').onclick=()=>FrameView();
Element('Front').onclick=()=>FrameView(null,new THREE.Vector3(0,.04,1));
Element('Rear').onclick=()=>FrameView(null,new THREE.Vector3(0,.18,-1));
Element('SelectCliff').onclick=()=>{ClearSelection();ApplyVisibility();};
Element('SelectCliff').ondblclick=()=>FrameView();
Element('ShowAll').onclick=()=>{ClearSelection();ApplyVisibility();FrameView();};
Element('Isolate').onclick=()=>{State.Isolated=!State.Isolated;ApplyVisibility();};
Element('Clay').onclick=()=>
{
    State.Mode='Clay';
    BodyGroup.children.forEach(Body=>{Body.material=ClayMaterial;});
    SetPressed('Clay',true);
    SetPressed('Scars',false);
};
Element('Scars').onclick=()=>
{
    State.Mode='Scars';
    BodyGroup.children.forEach(Body=>{Body.material=CutMaterial;});
    SetPressed('Clay',false);
    SetPressed('Scars',true);
};
Element('Wire').onclick=()=>
{
    State.Wire=!State.Wire;
    BodyGroup.children.forEach(Body=>{Body.children.find(Child=>Child.name==='Triangle edges').visible=State.Wire;});
    SetPressed('Wire',State.Wire);
};
Element('Explode').onchange=Event=>{State.Exploded=Event.target.checked;ApplyVisibility();};
Element('Ground').onchange=Event=>{Ground.visible=Grid.visible=Event.target.checked;RenderRequested=true;};
Element('Shadows').onchange=Event=>{Sun.castShadow=Event.target.checked;Renderer.shadowMap.needsUpdate=true;RenderRequested=true;};
Element('LightAngle').oninput=Event=>
{
    RenderRequested=true;
    Renderer.shadowMap.needsUpdate=true;
    const Angle=Number(Event.target.value)*Math.PI/180;
    Sun.position.set(Math.sin(Angle)*40,37,Math.cos(Angle)*40);
    Element('LightValue').textContent=`${Event.target.value}°`;
};
Element('ExportObj').onclick=()=>Download(`Cliff_${State.Specification.Profile}_${State.Specification.Seed}_Stage${State.Stage}.obj`,ObjText(),'text/plain');
Element('ExportRecipe').onclick=()=>Download(`Cliff_${State.Specification.Seed}.json`,JSON.stringify({Format:'Frontier.PolygonCliff',Version:1,Specification:State.Specification},null,2),'application/json');
Element('ImportRecipe').onclick=()=>Element('RecipeFile').click();
Element('RecipeFile').onchange=async Event=>
{
    try
    {
        const Recipe=JSON.parse(await Event.target.files[0].text());
        if (Recipe.Format!=='Frontier.PolygonCliff' || Recipe.Version!==1) throw new Error('Unsupported cliff recipe');
        State.Specification=ReadSpecification(Recipe.Specification);
        BuildControls();
        Generate();
    }
    catch(Error)
    {
        SetStatus(`Recipe not loaded: ${Error.message}`,true);
    }
    Event.target.value='';
};
Renderer.domElement.addEventListener('dblclick',Event=>
{
    if (!State.Result || State.Dirty) return;
    const Rect=Renderer.domElement.getBoundingClientRect();
    const Ray=new THREE.Raycaster();
    Ray.setFromCamera(new THREE.Vector2((Event.clientX-Rect.left)/Rect.width*2-1,1-(Event.clientY-Rect.top)/Rect.height*2),Camera);
    const Hit=Ray.intersectObjects(BodyGroup.children.filter(Body=>Body.visible),false)[0];
    if (Hit) SelectBody(Hit.object);
});
window.addEventListener('keydown',Event=>
{
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (Event.key.toLowerCase()==='f') FrameView(State.Selected);
    if (Event.key==='Escape') {ClearSelection();ApplyVisibility();}
});
Renderer.domElement.addEventListener('webglcontextlost',Event=>
{
    Event.preventDefault();
    FailGeneration('WebGL context lost. Reload the page to restore the viewport.');
    Element('Regenerate').disabled=true;
});
function Animate()
{
    requestAnimationFrame(Animate);
    if (ResizePending)
    {
        ResizePending=false;
        RenderRequested=true;
        const Rect=Element('Viewport').getBoundingClientRect();
        Camera.aspect=Rect.width/Rect.height;
        Camera.updateProjectionMatrix();
        Renderer.setSize(Rect.width,Rect.height,false);
    }
    const Moved=Controls.update();
    if (Moved || RenderRequested)
    {
        RenderRequested=false;
        Renderer.render(Scene,Camera);
        const Along=new THREE.Vector3(1,0,0).applyQuaternion(Camera.quaternion).multiplyScalar(5);
        const A=Controls.target.clone().project(Camera);
        const B=Controls.target.clone().add(Along).project(Camera);
        const PixelsPerMetre=Math.abs(B.x-A.x)*Renderer.domElement.clientWidth*.1;
        const ScaleLength=[.01,.02,.05,.1,.2,.5,1,2,5,10,20].filter(Length=>Length*PixelsPerMetre<=150).at(-1)||.01;
        document.querySelector('.ScaleBadge span').style.width=`${ScaleLength*PixelsPerMetre}px`;
        document.querySelector('.ScaleBadge b').textContent=`${ScaleLength} m`;
    }
}
window.CliffApp={State,Scene,Camera,Controls,Renderer,BodyGroup,Generate,ViewStage,FrameView,SelectBody,ObjText,
    SetSpecification:Specification=>{State.Specification=ReadSpecification({...State.Specification,...Specification});BuildControls();Generate();},
    FocusSpall:()=>
    {
        const Candidates=BodyGroup.children.flatMap(Body=>Body.userData.Mesh.Spalls.map(Spall=>({Body,Spall})));
        Candidates.sort((A,B)=>new THREE.Vector3(...A.Spall.Centre).distanceTo(new THREE.Vector3(0,8,0))-new THREE.Vector3(...B.Spall.Centre).distanceTo(new THREE.Vector3(0,8,0)));
        const Selected=Candidates.find(Candidate=>Candidate.Spall.Size>.45)||Candidates[0];
        if (!Selected) return false;
        SelectBody(Selected.Body,false);
        const Centre=new THREE.Vector3(...Selected.Spall.Centre);
        Controls.target.copy(Centre);
        Camera.position.copy(Centre).add(new THREE.Vector3(2,1.3,4.8));
        Controls.update();
        return Selected.Body.name;
    }};
Animate();
Generate();
