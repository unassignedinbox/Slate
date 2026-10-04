//============================================================================================================================================
//                                                            FRACTURESEQUENCE.JS
//============================================================================================================================================
// 📦 Profiled cliff mass, bedding, finite joints, local spalls and shallow polygon fissures.

import {CollapseSlivers, FlipCaps, SnapCaps} from './TriangleSolver.js';
import {CliffProfiles, SectionPlans, RecessPlans, BeddingPlans, JointPlans, SpallPlans, CrackPlans, SelectCatalogue, ReadSpecification} from './CliffSpecification.js';
import {Add, Subtract, Scale, Dot, Cross, Length, Normalize, Lerp, Centre, PointKey, EdgeKey, Face, Frame,
    ClipCells, JoinCells, TriangulateFace, TriangulateBody, InsideMesh, MeshMetrics, PointInLoop, LoopClearance} from './PolyhedronSolver.js';

function ConstructMass(Specification)
{
    const {Width,Height,Depth,Relief,Retreat,Profile}=Specification;
    const {Stations,Sections,SectionKinds}=CliffProfiles[Profile];
    const MinimumProjection=Math.min(...Stations.flatMap(([, ,Projection])=>SectionPlans.flatMap(Plan=>Plan.map(Setback=>Projection*Relief+Setback*Retreat/.48))));
    const DepthScale=Math.min(1,.88/Math.max(.01,-MinimumProjection));
    const Rows=Stations.map(([X,Crown,Projection],Station)=>Sections.map(([Y],Level)=>
        [(X-.5)*Width,Y*Crown*Height,(Projection*Relief + SectionPlans[SectionKinds[Station]][Level]*Retreat/.48)*Depth*DepthScale]));
    const Cells=[];
    for (let Column=0;Column<Rows.length-1;++Column)
    {
        for (let Level=0;Level<Sections.length-1;++Level)
        {
            const CornerIndices=[[Column,Level],[Column+1,Level],[Column+1,Level+1],[Column,Level+1]];
            for (const Triangle of [[0,1,2],[0,2,3]])
            {
                const Indices=Triangle.map(Index=>CornerIndices[Index]);
                const Front=Indices.map(([Column,Level])=>Rows[Column][Level]);
                const Back=Front.map(([X,Y])=>[X,Y,-Depth]);
                const Middle=Centre([...Front,...Back]);
                const Faces=[Face(Front,'Cliff',[0,0,1]),Face(Back,'Back',[0,0,-1])];
                for (let Index=0;Index<3;++Index)
                {
                    const Next=(Index+1)%3;
                    const [A,B]=[Indices[Index],Indices[Next]];
                    const Tag=A[1]===B[1] && A[1]===0 ? 'Base' :
                        A[1]===B[1] && A[1]===Sections.length-1 ? 'Crown' :
                        A[0]===B[0] && (A[0]===0 || A[0]===Stations.length-1) ? 'End' : 'Construction';
                    const Loop=[Front[Index],Back[Index],Back[Next],Front[Next]];
                    Faces.push(Face(Loop,Tag,Subtract(Centre(Loop),Middle)));
                }
                Cells.push(Faces);
            }
        }
    }
    return Cells;
}

function SeparateCutFromCorners(Cells, Direction, Desired, Clearance, MaximumShift=.6)
{
    const Coordinates=[...new Set(Cells.flatMap(Cell=>Cell.flatMap(Polygon=>Polygon.Loop.map(Point=>Dot(Point,Direction)))))];
    const Candidates=[Desired,...Coordinates.flatMap(Value=>[Value-Clearance-1e-5,Value+Clearance+1e-5])];
    Candidates.sort((A,B)=>Math.abs(A-Desired)-Math.abs(B-Desired));
    return Candidates.find(Value=>Math.abs(Value-Desired)<MaximumShift && Coordinates.every(Corner=>Math.abs(Value-Corner)>=Clearance)) ?? Desired;
}

function SliceBeds(Cells, Specification, Select)
{
    const {Height,Beds,Dip,Aperture}=Specification;
    const Plan=BeddingPlans[Select(BeddingPlans.length)];
    const Weights=Array.from({length:Beds},(_,Index)=>Plan[Index%Plan.length]);
    const Total=Weights.reduce((A,B)=>A+B);
    const Direction=Normalize([-Math.tan(Dip*Math.PI/180),1,.035]);
    const Levels=[-Infinity];
    let Sum=0;
    for (let Index=0;Index<Beds-1;++Index)
    {
        Sum+=Weights[Index];
        Levels.push(SeparateCutFromCorners(Cells,Direction,Sum/Total*Height*.99,.19+Aperture*.5,Math.min(.6,.25*Height/Beds)));
    }
    Levels.push(Infinity);
    return Weights.map((Weight,Index)=>
    {
        let Pieces=Cells;
        if (Number.isFinite(Levels[Index])) Pieces=ClipCells(Pieces,Scale(Direction,-1),-Levels[Index]-Aperture*.5,'Bedding');
        if (Number.isFinite(Levels[Index+1])) Pieces=ClipCells(Pieces,Direction,Levels[Index+1]-Aperture*.5,'Bedding');
        return {Name:`Bed ${String(Index+1).padStart(2,'0')}`,Cells:Pieces,Layer:Index};
    }).filter(Bed=>Bed.Cells.length);
}

function SplitJoints(Beds, Specification, Select)
{
    const {Depth,Width,JointSpacing,Penetration,Aperture}=Specification;
    const Family=JointPlans[Select(JointPlans.length)];
    const Result=[];
    for (const Bed of Beds)
    {
        // 📝 Front joints stop at this depth. Rear strata are not sliced by the joint family.
        const Terminal=-Depth*Penetration;
        const Rear=ClipCells(Bed.Cells,[0,0,1],Terminal-Aperture*.5,'Termination');
        const Front=ClipCells(Bed.Cells,[0,0,-1],-Terminal-Aperture*.5,'Termination');
        if (Rear.length) Result.push({Name:`${Bed.Name} · rear`,Cells:Rear,Layer:Bed.Layer,Rear:true});
        const Direction=Normalize([1,Family.Lean,Family.Obliquity]);
        const Positions=[-Infinity];
        const Stagger=Family.Stagger[Bed.Layer%Family.Stagger.length]*JointSpacing;
        for (let X=-Width*.5+JointSpacing+Stagger;X<Width*.5;X+=JointSpacing) Positions.push(SeparateCutFromCorners(Front,Direction,X,.16+Aperture*.5));
        Positions.push(Infinity);
        for (let Index=0;Index<Positions.length-1;++Index)
        {
            let Pieces=Front;
            if (Number.isFinite(Positions[Index])) Pieces=ClipCells(Pieces,Scale(Direction,-1),-Positions[Index]-Aperture*.5,'Joint');
            if (Number.isFinite(Positions[Index+1])) Pieces=ClipCells(Pieces,Direction,Positions[Index+1]-Aperture*.5,'Joint');
            if (Pieces.length && Specification.FaceRecess>0)
            {
                const Plan=RecessPlans[Select(RecessPlans.length)];
                const Outward=Normalize(Plan.Normal);
                const Support=Math.max(...Pieces.flatMap(Cell=>Cell.flatMap(Face=>Face.Loop.map(Point=>Dot(Point,Outward)))));
                const Depth=Specification.FaceRecess*Plan.Depth*[.35,1,.25,.8,.15,.65,.3][Bed.Layer%7];
                Pieces=ClipCells(Pieces,Outward,Support-Depth,'Cliff');
            }
            if (Pieces.length) Result.push({Name:`${Bed.Name} · block ${String(Index+1).padStart(2,'0')}`,Cells:Pieces,Layer:Bed.Layer});
        }
    }
    return Result;
}

function EdgeIncidence(Body)
{
    const Edges=new Map();
    Body.Faces.forEach((Polygon,FaceIndex)=>Polygon.Loop.forEach((A,Index)=>
    {
        const B=Polygon.Loop[(Index+1)%Polygon.Loop.length];
        const Key=EdgeKey(A,B);
        if (!Edges.has(Key)) Edges.set(Key,[]);
        Edges.get(Key).push({A,B,FaceIndex,Index});
    }));
    return [...Edges.values()].filter(Edges=>Edges.length===2);
}

function InteriorTriangle(Polygon, Points)
{
    const Basis=Frame(Polygon);
    const Loop=Polygon.Loop.map(Basis.Project);
    // 📝 Sample the complete proposed triangular patch, not just its deepest corner.
    for (let First=1;First<8;++First)
    {
        for (let Second=1;Second<8-First;++Second)
        {
            const Point=Add(Scale(Points[0],First/8),Add(Scale(Points[1],Second/8),Scale(Points[2],1-(First+Second)/8)));
            if (!PointInLoop(Basis.Project(Point),Loop)) return false;
        }
    }
    return true;
}

function CarveSpalls(Body, Specification, Select)
{
    if (Body.Rear || !Specification.SpallDensity) return Body;
    const Source=TriangulateBody(Body,Infinity);
    const Busy=new Set();
    const Original=Body.Faces.slice();
    const Edges=EdgeIncidence(Body).sort((First,Second)=>Length(Subtract(Second[0].A,Second[0].B))-Length(Subtract(First[0].A,First[0].B)));
    for (const Pair of Edges)
    {
        const [First,Second]=Pair;
        const FirstFace=Original[First.FaceIndex], SecondFace=Original[Second.FaceIndex];
        if (Busy.has(First.FaceIndex) || Busy.has(Second.FaceIndex)) continue;
        if (![FirstFace.Tag,SecondFace.Tag].some(Tag=>Tag==='Cliff' || Tag==='Crown')) continue;
        const Cosine=Dot(FirstFace.Normal,SecondFace.Normal);
        if (Cosine>.90 || Cosine<-.7) continue;
        if (Dot(FirstFace.Normal,Subtract(Centre(SecondFace.Loop),First.A))>1e-6) continue;
        const EdgeLength=Length(Subtract(First.B,First.A));
        if (EdgeLength<.7 || Select(100)>=Specification.SpallDensity*100) continue;
        const Plan=SpallPlans[Select(SpallPlans.length)];
        const Tangent=Normalize(Subtract(First.B,First.A));
        const IntoFirst=Normalize(Cross(FirstFace.Normal,Tangent));
        const IntoSecond=Normalize(Cross(SecondFace.Normal,Scale(Tangent,-1)));
        const Middle=Lerp(First.A,First.B,Plan.Position);
        let Size=Math.min(Specification.SpallSize,EdgeLength*.30,
            EdgeLength*Math.min(Plan.Position-.10,.90-Plan.Position)/Plan.Length);
        for (let Attempt=0;Attempt<5;++Attempt,Size*=.7)
        {
            if (Size<.12) break;
            const Start=Add(Middle,Scale(Tangent,-Size*Plan.Length));
            const End=Add(Middle,Scale(Tangent,Size*Plan.Length));
            const FirstLip=Add(Middle,Add(Scale(IntoFirst,Size*Plan.FirstDepth),Scale(Tangent,Size*Plan.Shear)));
            const SecondLip=Add(Middle,Add(Scale(IntoSecond,Size*Plan.SecondDepth),Scale(Tangent,-Size*Plan.Shear)));
            const FirstPath=Plan.Shape==='Flake' ? [Add(FirstLip,Add(Scale(Tangent,-Size*.35),Scale(IntoFirst,Size*.12))),
                Add(FirstLip,Add(Scale(Tangent,Size*.50),Scale(IntoFirst,-Size*.05)))] : [FirstLip];
            const SecondPath=Plan.Shape==='Flake' ? [Add(SecondLip,Add(Scale(Tangent,-Size*.28),Scale(IntoSecond,Size*.08))),
                Add(SecondLip,Add(Scale(Tangent,Size*.40),Scale(IntoSecond,-Size*.09)))] : [SecondLip];
            const LipInside=(Polygon,Lip)=>
            {
                const Basis=Frame(Polygon), Loop=Polygon.Loop.map(Basis.Project), Point=Basis.Project(Lip);
                return PointInLoop(Point,Loop) && LoopClearance(Point,Loop)>Math.min(.025,Size*.15);
            };
            if (!FirstPath.every(Point=>LipInside(FirstFace,Point) && InteriorTriangle(FirstFace,[Start,End,Point])) ||
                !SecondPath.every(Point=>LipInside(SecondFace,Point) && InteriorTriangle(SecondFace,[End,Start,Point]))) continue;
            const Root=Subtract(Centre([Start,End,...FirstPath,...SecondPath]),Scale(Normalize(Add(FirstFace.Normal,SecondFace.Normal)),Size*Plan.Root));
            const Rim=[Start,...SecondPath,End,...FirstPath.slice().reverse()];
            if (!InsideMesh(Root,Source) || Rim.some(Point=>!InsideMesh(Lerp(Point,Root,.5),Source))) continue;
            const Replace=(Record,Path,Reverse)=>
            {
                const Polygon=Body.Faces[Record.FaceIndex];
                const Loop=Polygon.Loop.slice();
                Loop.splice(Record.Index+1,0,...(Reverse ? [End,...Path.slice().reverse(),Start] : [Start,...Path,End]));
                Body.Faces[Record.FaceIndex]={...Polygon,Loop};
            };
            Replace(First,FirstPath,false);
            Replace(Second,SecondPath,true);
            // 📝 Bounded fracture facets replace a local edge patch; both original edge ends survive.
            const Feature=Body.Spalls.length;
            Rim.forEach((Point,Index)=>Body.Faces.push({...Face([Point,Rim[(Index+1)%Rim.length],Root],'Spall'),Feature}));
            Body.Spalls.push({Centre:Middle,Root,Rim,Size,Shape:Plan.Shape,Feature,AffectedFaces:[First.FaceIndex,Second.FaceIndex],
                OriginalFaces:[FirstFace,SecondFace],OriginalEdge:[First.A,First.B]});
            Busy.add(First.FaceIndex);
            Busy.add(Second.FaceIndex);
            break;
        }
    }
    return Body;
}

function CarveCracks(Body, Specification, Select)
{
    if (Body.Rear || !Specification.CrackDensity || Select(100)>=Specification.CrackDensity*100) return Body;
    const Source=TriangulateBody(Body,Infinity);
    const Faces=Body.Faces.filter(Polygon=>Polygon.Tag==='Cliff' && Polygon.Normal[2]>.2);
    Faces.sort((A,B)=>
    {
        const Area=Polygon=>Length(Polygon.Loop.slice(1,-1).reduce((Sum,Point,Index)=>
            Add(Sum,Cross(Subtract(Point,Polygon.Loop[0]),Subtract(Polygon.Loop[Index+2],Polygon.Loop[0]))),[0,0,0]));
        return Area(B)-Area(A);
    });
    const Plan=CrackPlans[Select(CrackPlans.length)];
    for (const Polygon of Faces.slice(0,3))
    {
        const Basis=Frame(Polygon);
        const Loop=Polygon.Loop.map(Basis.Project);
        const Patch=TriangulateFace(Polygon);
        const Candidates=Patch.Triangles.map(Triangle=>Centre(Triangle.map(Index=>Patch.Vertices[Index])));
        Candidates.push(Centre(Polygon.Loop));
        Candidates.sort((A,B)=>LoopClearance(Basis.Project(B),Loop)-LoopClearance(Basis.Project(A),Loop));
        const Direction=Normalize(Subtract([Plan.Tilt,1,0],Scale(Polygon.Normal,Dot([Plan.Tilt,1,0],Polygon.Normal))));
        const Across=Normalize(Cross(Polygon.Normal,Direction));
        for (let Attempt=0;Attempt<4;++Attempt)
        {
            const Size=Specification.CrackLength*Math.pow(.8,Attempt);
            const Width=Specification.CrackWidth;
            const Middle=Add(Candidates[0],Scale(Across,Plan.Offset*Size));
            const Path=Plan.Path.map(([Along,Side])=>Add(Middle,Add(Scale(Direction,Along*Size),Scale(Across,Side*Size))));
            // 📝 The V-groove is shallow and finite. It does not split the block or use a signed-distance field.
            const Root=Path.map((Point,Index)=>Subtract(Point,Scale(Polygon.Normal,Specification.CrackDepth*[.5,1,.8,.45][Index])));
            const Left=Path.map((Point,Index)=>Add(Point,Scale(Across,Width*.5*[.35,1,1,.3][Index])));
            const Right=Path.map((Point,Index)=>Subtract(Point,Scale(Across,Width*.5*[.35,1,1,.3][Index])));
            let Rim=[...Left,...Right.slice().reverse()];
            let RootIndices=[0,1,2,3,3,2,1,0];
            if (!Rim.every(Point=>PointInLoop(Basis.Project(Point),Loop) && LoopClearance(Basis.Project(Point),Loop)>Width*1.6)) continue;
            if (!Root.every(Point=>InsideMesh(Point,Source))) continue;
            if (PolygonArea(Rim.map(Basis.Project))<0)
            {
                Rim.reverse();
                RootIndices.reverse();
            }
            Polygon.Holes.push(Rim.slice().reverse());
            Rim.forEach((A,Index)=>
            {
                const Next=(Index+1)%Rim.length;
                const B=Rim[Next], First=Root[RootIndices[Index]], Second=Root[RootIndices[Next]];
                if (RootIndices[Index]===RootIndices[Next]) Body.Faces.push(Face([A,B,First],'Crack'));
                else
                {
                    Body.Faces.push(Face([A,B,Second],'Crack'));
                    Body.Faces.push(Face([A,Second,First],'Crack'));
                }
            });
            Body.Cracks.push({Centre:Middle,Root,Rim,Depth:Specification.CrackDepth,Length:Size});
            return Body;
        }
    }
    return Body;
}

function PolygonArea(Points)
{
    return Points.reduce((Sum,A,Index)=>
    {
        const B=Points[(Index+1)%Points.length];
        return Sum+A[0]*B[1]-B[0]*A[1];
    },0)*.5;
}

function EmitStage(Bodies, Number, Specification, Previous)
{
    const Compile=Body=>SnapCaps(FlipCaps(CollapseSlivers(FlipCaps(TriangulateBody(Body,Number===1 ? Specification.TriangleSpan*3 : Specification.TriangleSpan),.12),.12),.12),.12);
    const Meshes=Bodies.map(Body=>
    {
        let Mesh=Compile(Body);
        const PreviousCount=Previous?.Records.find(Record=>Record.Name===Body.Name)?.ThinTriangles||0;
        // 📝 Damage is transactional: reject a local feature if it worsens the narrow-triangle budget.
        if (Number===4)
        {
            while (MeshMetrics(Mesh).ThinTriangles>PreviousCount && Body.Spalls.length)
            {
                const Narrow=Mesh.Triangles.find(Triangle=>
                {
                    const Points=Triangle.map(Index=>Mesh.Vertices[Index]);
                    return Points.some((Point,Index)=>
                    {
                        const A=Normalize(Subtract(Points[(Index+1)%3],Point));
                        const B=Normalize(Subtract(Points[(Index+2)%3],Point));
                        return Dot(A,B)>Math.cos(5*Math.PI/180);
                    });
                });
                const Position=Centre(Narrow.map(Index=>Mesh.Vertices[Index]));
                const Ordered=Body.Spalls.slice().sort((A,B)=>Length(Subtract(A.Centre,Position))-Length(Subtract(B.Centre,Position)));
                const Rejected=Ordered[0];
                Rejected.AffectedFaces.forEach((FaceIndex,Index)=>{Body.Faces[FaceIndex]=Rejected.OriginalFaces[Index];});
                Body.Faces=Body.Faces.filter(Polygon=>!(Polygon.Tag==='Spall' && Polygon.Feature===Rejected.Feature));
                Body.Spalls=Body.Spalls.filter(Spall=>Spall!==Rejected);
                Body.RejectedSpalls=(Body.RejectedSpalls||0)+1;
                Mesh=Compile(Body);
            }
        }
        if (Number===5 && MeshMetrics(Mesh).ThinTriangles>PreviousCount && Body.Cracks.length)
        {
            Body.Faces=Body.Faces.filter(Polygon=>Polygon.Tag!=='Crack').map(Polygon=>({...Polygon,Holes:[]}));
            Body.RejectedCracks=Body.Cracks.length;
            Body.Cracks=[];
            Mesh=Compile(Body);
        }
        Mesh.Spalls=Mesh.Spalls.map(({OriginalFaces,...Record})=>Record);
        Mesh.RejectedSpalls=Body.RejectedSpalls||0;
        Mesh.RejectedCracks=Body.RejectedCracks||0;
        return Mesh;
    });
    const Records=Meshes.map(Mesh=>({...MeshMetrics(Mesh),Name:Mesh.Name}));
    const Sum=Key=>Records.reduce((Total,Record)=>Total+Record[Key],0);
    const Metrics={Stage:Number,Bodies:Meshes.length,Vertices:Sum('Vertices'),Triangles:Sum('Triangles'),
        OpenEdges:Sum('OpenEdges'),NonmanifoldEdges:Sum('NonmanifoldEdges'),WindingErrors:Sum('WindingErrors'),
        ZeroArea:Sum('ZeroArea'),NonmanifoldVertices:Sum('NonmanifoldVertices'),DuplicateTriangles:Sum('DuplicateTriangles'),ThinTriangles:Sum('ThinTriangles'),MinimumAngle:Math.min(...Records.map(Record=>Record.MinimumAngle)),
        RejectedSpalls:Meshes.reduce((Total,Mesh)=>Total+Mesh.RejectedSpalls,0),RejectedCracks:Meshes.reduce((Total,Mesh)=>Total+Mesh.RejectedCracks,0),
        Volume:Sum('Volume'),Spalls:Meshes.reduce((Total,Mesh)=>Total+Mesh.Spalls.length,0),Cracks:Meshes.reduce((Total,Mesh)=>Total+Mesh.Cracks.length,0)};
    return {Number,Meshes,Metrics,Records};
}

export function GenerateCliff(Input, Progress=()=>{})
{
    const Specification=ReadSpecification(Input);
    const Select=SelectCatalogue(Specification.Seed);
    const Stages=[];
    const Mass=ConstructMass(Specification);
    const Emit=(Bodies,Number)=>
    {
        Progress(Number);
        const Stage=EmitStage(Bodies,Number,Specification,Stages.at(-1));
        Stages.push(Stage);
        return Stage;
    };
    Emit([JoinCells(Mass,'Cliff mass')],1);
    const Beds=SliceBeds(Mass,Specification,Select);
    Emit(Beds.map(Bed=>JoinCells(Bed.Cells,Bed.Name)),2);
    const Blocks=SplitJoints(Beds,Specification,Select);
    let Bodies=Blocks.map(Block=>({...JoinCells(Block.Cells,Block.Name),Rear:Block.Rear}));
    Emit(Bodies,3);
    Bodies=Bodies.map(Body=>CarveSpalls(structuredClone(Body),Specification,Select));
    Emit(Bodies,4);
    Bodies=Bodies.map(Body=>CarveCracks(structuredClone(Body),Specification,Select));
    Emit(Bodies,5);
    return {Specification,Stages};
}
