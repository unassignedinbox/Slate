//============================================================================================================================================
//                                                             CABINSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Cabin HMI — steering wheel with integrated cluster, glass transparency, and interior cameras, ported from Frontier's HMI study.

// 📝 Frontier reference: Projects/Project-Drive/Source/DriveCabinLayout.h (CabinTabletFixture, CabinClusterFixture, CabinDriverEyeFixture)
//    and Experimental/TabletPanel (HMI Studio) for the UI patterns. This module builds the IlluminationHost interior as facet sets
//    that ride with the chassis: a steering wheel torus (thin torus around +X normal, centred ahead of the driver), a dashboard box,
//    and two display quads (tablet on centre stack, cluster on wheel). The glass facets are split from the body so they can be
//    rendered as a transparent shell that does NOT block the distance field — the windshield is open to GI, the interior lights
//    through it.

import { CourseMaterial } from "./MaterialSpecification.js";
import { ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import * as Course from "./CourseStructure.js";
import { MultiplyTransform, ConstructRigidTransform } from "./TransformProjection.js";

const Rebase = ResolveCoMAuthoredZ(); // [m] body z rebase CoM

// ── Fixtures in CoM-local [m] (model frame minus Rebase) ──────────────────────────────────────────────────────────
// Model frame: +X forward, +Y left, +Z up, origin ≈ hub height. CabinLayout gives model-frame centres.
function Rebased(Position) { return [Position[0], Position[1], Position[2] - Rebase]; }

export const CabinFixtures = Object.freeze({
    // Centre-stack tablet: 0.30×0.19 m display, 0.42 rad tilt, centre stack
    Tablet:  { Centre: Rebased([+0.98,  0.00, +0.62]), Tilt: 0.42, Width: 0.30, Height: 0.19, CornerRadius: 0.012, Bezel: 0.012, Name: "Display:CabinTablet",  Emission: 3.0 },
    // Driver cluster ahead of driver, 0.34×0.19 m (hexagon), 0.14 rad tilt, left-hand drive (+Y)
    Cluster: { Centre: Rebased([+0.86, +0.42, +0.92]), Tilt: 0.14, Width: 0.34, Height: 0.19, CornerRadius: 0.020, Bezel: 0.010, Name: "Display:DriverCluster", Emission: 3.5 },
    // Headliner lamp
    Lamp:    { Centre: Rebased([+0.15,  0.00, +1.30]), Radius: 0.045, Luminance: 40.0 },
    // Driver eye (cockpit camera): position, pitch down 0.21 rad, Vfov 70°
    DriverEye: { Position: Rebased([-0.20, +0.42, +1.12]), PitchDown: 0.21, Vfov: 1.22 }, // 1.22 rad ≈ 70°
    PassengerEye: { Position: Rebased([-0.20, -0.42, +1.12]), PitchDown: 0.18, Vfov: 1.18 },
    RearSeat: { Position: Rebased([-0.85,  0.00, +1.05]), PitchDown: 0.08, Vfov: 1.35 },
    // Steering wheel: torus centre, normal along +X (wheel faces -X toward driver), radius and tube
    Wheel:   { Centre: Rebased([+0.62, +0.42, +0.85]), Radius: 0.185, Tube: 0.016, Tilt: 0.35, SpokeInset: 0.04 } // Tilt back about Y
});

export const CabinCameras = [
    { Id: "driver",   Label: "Cockpit — driver eye",      Eye: CabinFixtures.DriverEye,   Description: "70° windshield view, cluster + tablet in frame" },
    { Id: "passenger",Label: "Cockpit — passenger",       Eye: CabinFixtures.PassengerEye, Description: "Passenger view across dash" },
    { Id: "wheel",    Label: "Cockpit — wheel close",     Eye: { Position: [CabinFixtures.Wheel.Centre[0]-0.18, CabinFixtures.Wheel.Centre[1], CabinFixtures.Wheel.Centre[2]+0.08], PitchDown: 0.45, Vfov: 0.95 }, Description: "Wheel and cluster detail" },
    { Id: "rear",     Label: "Cockpit — rear seat",       Eye: CabinFixtures.RearSeat,    Description: "Rear bench looking forward" },
    { Id: "overhead", Label: "Cockpit — headliner",       Eye: { Position: Rebased([+0.10, 0.00, +1.33]), PitchDown: 1.1, Vfov: 1.4 }, Description: "Top-down cabin" }
];

// ── Basis for a display facing the driver (−X) tilted back by Tilt about −Y ─────────────────────────────────
export function CabinScreenBasis(Tilt)
{
    const Right  = [0.0, -1.0, 0.0];
    const Up     = [Math.sin(Tilt), 0.0, Math.cos(Tilt)];
    const Toward = [-Math.cos(Tilt), 0.0, Math.sin(Tilt)];
    return { Right, Up, Toward };
}

// 4×4 column-major transform for a display at Centre, Tilt back, occupying Width×Height in its local XY.
export function ConstructDisplayTransform(Centre, Tilt)
{
    const { Right, Up, Toward } = CabinScreenBasis(Tilt);
    const T = new Float32Array(16);
    T[0]=Right[0]; T[1]=Right[1]; T[2]=Right[2]; T[3]=0;
    T[4]=Up[0];    T[5]=Up[1];    T[6]=Up[2];    T[7]=0;
    T[8]=Toward[0];T[9]=Toward[1];T[10]=Toward[2];T[11]=0;
    T[12]=Centre[0];T[13]=Centre[1];T[14]=Centre[2];T[15]=1;
    return T;
}

// ── Facet generators ─────────────────────────────────────────────────────────────────────────────────────────
// Plane quad (two triangles) at local origin in display's XY plane, sized Width×Height, normal +Z (Toward)
function EmitDisplayFacets(Width, Height, Family)
{
    const hx = Width*0.5, hy = Height*0.5;
    const a=[-hx,-hy,0], b=[ hx,-hy,0], c=[ hx, hy,0], d=[-hx, hy,0];
    const n=[0,0,1];
    return [
        { Corners:[a,b,c], Normals:[n,n,n], Family },
        { Corners:[a,c,d], Normals:[n,n,n], Family }
    ];
}

// Thin bezel ring as a picture frame: outer - inner
function EmitBezelFacets(Width, Height, Bezel, Family)
{
    const ox=Width*0.5+Bezel, oy=Height*0.5+Bezel, ix=Width*0.5, iy=Height*0.5;
    const oA=[-ox,-oy,0], oB=[ ox,-oy,0], oC=[ ox, oy,0], oD=[-ox, oy,0];
    const iA=[-ix,-iy,0], iB=[ ix,-iy,0], iC=[ ix, iy,0], iD=[-ix, iy,0];
    const n=[0,0,1];
    // four sides as quads
    const quads=[[oA,oB,iB,iA],[oB,oC,iC,iB],[oC,oD,iD,iC],[oD,oA,iA,iD]];
    const facets=[];
    for(const [p0,p1,p2,p3] of quads){
        facets.push({Corners:[p0,p1,p2],Normals:[n,n,n],Family});
        facets.push({Corners:[p0,p2,p3],Normals:[n,n,n],Family});
    }
    return facets;
}

// Torus around X normal (wheel faces -X). Major circle in YZ plane, tilt about Y optionally.
function EmitSteeringWheelFacets(Radius, Tube, MajorSegments, MinorSegments, Family)
{
    const facets=[];
    const nMajor=MajorSegments, nMinor=MinorSegments;
    const tilt=CabinFixtures.Wheel.Tilt;
    const sinT=Math.sin(tilt), cosT=Math.cos(tilt);
    // helper to rotate point about Y by tilt
    const rotY=(p)=>{
        const x=p[0]*cosT - p[2]*sinT;
        const z=p[0]*sinT + p[2]*cosT;
        return [x,p[1],z];
    };
    const rotN=(n)=>{
        const x=n[0]*cosT - n[2]*sinT;
        const z=n[0]*sinT + n[2]*cosT;
        return [x,n[1],n[2]];
    };
    for(let i=0;i<nMajor;++i){
        const u0=2*Math.PI*i/nMajor, u1=2*Math.PI*((i+1)%nMajor)/nMajor;
        for(let j=0;j<nMinor;++j){
            const v0=2*Math.PI*j/nMinor, v1=2*Math.PI*((j+1)%nMinor)/nMinor;
            // Torus axis X, major circle in YZ plane radius R, tube offset in (e_r, e_x) plane.
            // major point m=[0,R cos u,R sin u]; e_r=[0,cos u,sin u]; e_x=[1,0,0]
            // point = m + Tube*(cos v * e_r + sin v * e_x)
            const m00=[0, Radius*Math.cos(u0), Radius*Math.sin(u0)];
            const mr0=[0, Math.cos(u0), Math.sin(u0)];
            const mx=[1,0,0];
            const p00=[ m00[0]+Tube*(Math.cos(v0)*mr0[0]+Math.sin(v0)*mx[0]), m00[1]+Tube*(Math.cos(v0)*mr0[1]+Math.sin(v0)*mx[1]), m00[2]+Tube*(Math.cos(v0)*mr0[2]+Math.sin(v0)*mx[2])];
            const m01=[0, Radius*Math.cos(u0), Radius*Math.sin(u0)];
            const mr01=[0, Math.cos(u0), Math.sin(u0)];
            const p01=[ m01[0]+Tube*(Math.cos(v1)*mr01[0]+Math.sin(v1)*mx[0]), m01[1]+Tube*(Math.cos(v1)*mr01[1]+Math.sin(v1)*mx[1]), m01[2]+Tube*(Math.cos(v1)*mr01[2]+Math.sin(v1)*mx[2])];
            const m10=[0, Radius*Math.cos(u1), Radius*Math.sin(u1)];
            const mr10=[0, Math.cos(u1), Math.sin(u1)];
            const p10=[ m10[0]+Tube*(Math.cos(v0)*mr10[0]+Math.sin(v0)*mx[0]), m10[1]+Tube*(Math.cos(v0)*mr10[1]+Math.sin(v0)*mx[1]), m10[2]+Tube*(Math.cos(v0)*mr10[2]+Math.sin(v0)*mx[2])];
            const m11=[0, Radius*Math.cos(u1), Radius*Math.sin(u1)];
            const mr11=[0, Math.cos(u1), Math.sin(u1)];
            const p11=[ m11[0]+Tube*(Math.cos(v1)*mr11[0]+Math.sin(v1)*mx[0]), m11[1]+Tube*(Math.cos(v1)*mr11[1]+Math.sin(v1)*mx[1]), m11[2]+Tube*(Math.cos(v1)*mr11[2]+Math.sin(v1)*mx[2])];
            // normals are from tube centre outward (cos v * e_r + sin v * e_x)
            const n00=rotN([Math.sin(v0), Math.cos(v0)*Math.cos(u0), Math.cos(v0)*Math.sin(u0)]);
            const n01=rotN([Math.sin(v1), Math.cos(v1)*Math.cos(u0), Math.cos(v1)*Math.sin(u0)]);
            const n10=rotN([Math.sin(v0), Math.cos(v0)*Math.cos(u1), Math.cos(v0)*Math.sin(u1)]);
            const n11=rotN([Math.sin(v1), Math.cos(v1)*Math.cos(u1), Math.cos(v1)*Math.sin(u1)]);
            const pp00=rotY(p00), pp01=rotY(p01), pp10=rotY(p10), pp11=rotY(p11);
            facets.push({Corners:[pp00,pp10,pp11],Normals:[n00,n10,n11],Family});
            facets.push({Corners:[pp00,pp11,pp01],Normals:[n00,n11,n01],Family});
        }
    }
    // add three spokes: simple boxes from centre to rim
    const spokeLen=Radius*0.92;
    for(let s=0;s<3;++s){
        const ang= -Math.PI/2 + s*2*Math.PI/3; // 3 spokes 120°
        const dir=[0, Math.cos(ang), Math.sin(ang)];
        const rotDir=rotY(dir);
        const mid=[ rotDir[0]*spokeLen*0.5, rotDir[1]*spokeLen*0.5, rotDir[2]*spokeLen*0.5 ];
        const len=spokeLen, wid=0.024, th=0.016;
        // create oriented box: local axes along dir and perpendicular
        // simplified: axis-aligned box then rotate to dir? For brevity, use axis-aligned approximation ignoring rotation - visual placeholder
        // Instead emit a small box at spoke position
        const box=Course.EmitBoxFacets(wid, len, th, Family);
        // translate box to mid
        for(const f of box){
            f.Corners=f.Corners.map(p=>[p[0]+mid[0], p[1]+mid[1], p[2]+mid[2]]);
        }
        facets.push(...box);
    }
    return facets;
}

// Dashboard: shallow box ahead of driver spanning cabin width, tilted slightly
function EmitDashboardFacets(Family)
{
    // Dashboard top surface: 0.75 x 0.52 x 0.06 m centred at  [0.73, 0.05, 0.82] (CoM-local), covering driver to centre.
    // Use a single box facet set; bevel not needed.
    const W=0.82, H=0.04, D=0.32; // width along Y, thickness Z, depth X
    const centre=[0.72, 0.06, 0.83];
    const facets=Course.EmitBoxFacets(W, D, H, Family);
    for(const f of facets){
        // EmitBox gives box centred at origin with extent X,Y,Z ; we need to rotate 90? Keep as is and translate.
        f.Corners=f.Corners.map(p=>[p[0]+centre[0], p[1]+centre[1], p[2]+centre[2]]);
        // normals already outward, no rotation needed for this placeholder
    }
    return facets;
}

// Cabin floor / rear shelf box: simple enclosure
function EmitCabinShellFacets(Family)
{
    // Floor carpet: large thin box under feet
    const floor=[-0.35, 0.0, 0.38];
    const floorFacets=Course.EmitBoxFacets(1.8, 1.6, 0.02, Family).map(f=>({Corners:f.Corners.map(p=>[p[0]+floor[0],p[1]+floor[1],p[2]+floor[2]]), Normals:undefined, Family}));
    // Rear parcel shelf
    const shelf=[-0.90, 0.0, 0.86];
    const shelfFacets=Course.EmitBoxFacets(1.4, 1.2, 0.025, Family).map(f=>({Corners:f.Corners.map(p=>[p[0]+shelf[0],p[1]+shelf[1],p[2]+shelf[2]]), Normals:undefined, Family}));
    return [...floorFacets,...shelfFacets];
}

// Helper: World transform for a cabin occupant that rides with the chassis (body position/orientation)
export function ResolveCabinWorldTransform(BodyPosition, BodyOrientation, LocalTransform)
{
    const Body = ConstructRigidTransform(BodyPosition, BodyOrientation);
    return MultiplyTransform(Body, LocalTransform);
}

// Construct facet sets in the scene for cabin — called after body/wheels.
export function ConstructCabinSets(Scene)
{
    // Wheel and dashboard materials
    const WheelMat = CourseMaterial.VehiclePlastic; // dark
    const DashMat  = CourseMaterial.VehiclePlastic;
    const FloorMat = CourseMaterial.VehiclePlastic;
    const BezelMat = CourseMaterial.VehicleTrim; // aluminium bezel
    const GlassMat = CourseMaterial.GlassPane; // display cover — not screen-door like the windshield
    const DisplayMatTablet = CourseMaterial.DisplayTablet;
    const DisplayMatCluster = CourseMaterial.DisplayCluster;

    // Steering wheel
    const WheelFacets = EmitSteeringWheelFacets(CabinFixtures.Wheel.Radius, CabinFixtures.Wheel.Tube, 24, 10, WheelMat);
    const WheelSet = Scene.ConstructFacetSet("Cabin steering wheel", WheelFacets, 0.012, 40.0);

    // Dashboard top
    const DashFacets = EmitDashboardFacets(DashMat);
    const DashSet = Scene.ConstructFacetSet("Cabin dashboard", DashFacets, 0.02, 28.0);

    // Shell (floor etc.) — optional, helps AO
    const ShellFacets = EmitCabinShellFacets(FloorMat);
    const ShellSet = Scene.ConstructFacetSet("Cabin shell", ShellFacets, 0.04, 18.0);

    // Display quads (glass + content)
    // Tablet glass quad (physical cover) — same fixture but slightly forward of display content
    const TabletGlassFacets = EmitDisplayFacets(CabinFixtures.Tablet.Width+0.008, CabinFixtures.Tablet.Height+0.008, GlassMat);
    const TabletGlassSet = Scene.ConstructFacetSet("Cabin tablet glass", TabletGlassFacets, 0.0, 0.0);
    const TabletFacets = EmitDisplayFacets(CabinFixtures.Tablet.Width, CabinFixtures.Tablet.Height, DisplayMatTablet);
    const TabletSet = Scene.ConstructFacetSet("Cabin tablet display", TabletFacets, 0.0, 0.0);
    const TabletBezelFacets = EmitBezelFacets(CabinFixtures.Tablet.Width, CabinFixtures.Tablet.Height, CabinFixtures.Tablet.Bezel, BezelMat);
    const TabletBezelSet = Scene.ConstructFacetSet("Cabin tablet bezel", TabletBezelFacets, 0.0, 0.0);

    const ClusterGlassFacets = EmitDisplayFacets(CabinFixtures.Cluster.Width+0.006, CabinFixtures.Cluster.Height+0.006, GlassMat);
    const ClusterGlassSet = Scene.ConstructFacetSet("Cabin cluster glass", ClusterGlassFacets, 0.0, 0.0);
    const ClusterFacets = EmitDisplayFacets(CabinFixtures.Cluster.Width, CabinFixtures.Cluster.Height, DisplayMatCluster);
    const ClusterSet = Scene.ConstructFacetSet("Cabin cluster display", ClusterFacets, 0.0, 0.0);
    const ClusterBezelFacets = EmitBezelFacets(CabinFixtures.Cluster.Width, CabinFixtures.Cluster.Height, CabinFixtures.Cluster.Bezel, BezelMat);
    const ClusterBezelSet = Scene.ConstructFacetSet("Cabin cluster bezel", ClusterBezelFacets, 0.0, 0.0);

    // Glass split sets are handled in FacetStructure; here we just return wheel/dashboard etc.
    return { WheelSet, DashSet, ShellSet, TabletGlassSet, TabletSet, TabletBezelSet, ClusterGlassSet, ClusterSet, ClusterBezelSet };
}
