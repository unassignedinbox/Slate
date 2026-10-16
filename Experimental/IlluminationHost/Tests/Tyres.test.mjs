import test from 'node:test';
import { ProjectSparkEmitter, SampleScrapeFan } from '../Source/SparkProjection.js';
import assert from 'node:assert/strict';
import { TyreCarcassSolver, CarcassNodes, CarcassRecordBytes, CarcassSpecification } from '../Source/TyreCarcassSolver.js';
import { EvaluateTyreContact, ResolveTyreVolume, AdvanceWheelHub } from '../Source/PneumaticTyreModel.js';
import { VehicleSolver } from '../Source/VehicleSolver.js';
import { VehicleGeometry as G, ResolveSuspensionPair } from '../Source/VehicleSpecification.js';
import { ConstructThermal, IntegrateThermal } from '../Source/TyreThermalIntegrator.js';
import { CabinLayout, ConstructCabinTransform } from '../Source/CabinLayout.js';
import { TransformPoint, InvertTransform, DotVector } from '../Source/TransformProjection.js';
const HalfWidth = G.TyreWidth / 2;
const Neutral = { Throttle: 0, Brake: 0, Steer: 0, Handbrake: false };
const Contact = (Overrides = {}) => ({ InContact: true, HubDistance: G.TyreRadius - 0.018,
    DownAngle: -Math.PI/2, Pressure: 220000, LateralForce: 0, Shredded: false, ...Overrides });
const MakeCarcass = () => new TyreCarcassSolver(G.TyreRadius,G.TyreRimRadius,HalfWidth);
const Run = (V,Seconds,Command=Neutral,FPS=60) => {for(let I=0;I<Seconds*FPS;I++) V.Advance(Command,1/FPS);};
const Near = (A,B,E=1e-7) => assert.ok(Math.abs(A-B)<E, `${A} != ${B} (tolerance ${E})`);

test('contact law is monotone, pressure supports load, flat remains supported by cords and flange',()=>{
    for(const P of [0,25000,220000,400000]) {
        let Prior = 0;
        for(let D=0;D<0.24;D+=0.001) {
            const C=EvaluateTyreContact(D,P,G.TyreRadius,G.TyreRimRadius,HalfWidth);
            assert.ok(C.Force>=Prior && C.Stiffness>0);
            Prior=C.Force;
        }
    }
    const Force=P=>EvaluateTyreContact(.018,P,G.TyreRadius,G.TyreRimRadius,HalfWidth).Force;
    assert.ok(Force(220000)>Force(25000)*4);
    assert.ok(EvaluateTyreContact(.16,0,G.TyreRadius,G.TyreRimRadius,HalfWidth).Pinched);
    assert.ok(EvaluateTyreContact(.16,0,G.TyreRadius,G.TyreRimRadius,HalfWidth).Force>10000);
    assert.ok(EvaluateTyreContact(.01,0,G.TyreRadius,G.TyreRimRadius,HalfWidth,true).Force>14000);
});

test('finite-volume gas law raises sealed pressure under compression; a leak converges to atmosphere',()=>{
    const T=ConstructThermal();
    const Old=T.GaugePressure;
    T.Volume=ResolveTyreVolume(.12,G.TyreRadius,HalfWidth);
    assert.ok(T.Volume<.045 && T.Volume>.027);
    IntegrateThermal(T,{SlidingPower:0,Airspeed:0,InContact:true},1/60);
    assert.ok(T.GaugePressure>Old);
    T.LeakRate=20;
    for(let I=0;I<120;I++) IntegrateThermal(T,{SlidingPower:0,Airspeed:0,InContact:true},1/60);
    assert.ok(T.GaugePressure<1);
});

test('implicit hub solve stays bounded across inflated/flat/rim impacts and loss of ground',()=>{
    for(const Pressure of [0,220000,400000]) for(const Shredded of [false,true]) {
        const Wheel={Length:.5522,ExtensionVelocity:0};
        const Strut=ResolveSuspensionPair().Front;
        for(let I=0;I<1000;I++) {
            const H=AdvanceWheelHub(Wheel,Strut,{StaticLength:.5522,TouchLength:I<500?.50:Infinity,
                Projection:1,MountNormalVelocity:I===250?-20:0,Pressure,Radius:Shredded?.3566:G.TyreRadius,
                RimRadius:G.TyreRimRadius,HalfWidth,Mass:G.UnsprungMassPerWheel,Shredded},1/480);
            assert.ok(Number.isFinite(H.Length)&&Math.abs(H.Rate)<100);
            assert.ok(H.Length>.3&&H.Length<.8);
            Wheel.Length=H.Length; Wheel.ExtensionVelocity=H.Rate;
        }
        assert.ok(Wheel.Length>.55);
    }
});

test('shell respects road/rim, is symmetric, and has bounded radial/axial state',()=>{
    const S=MakeCarcass(), C=Array.from({length:4},()=>Contact({HubDistance:.40,LateralForce:5000,Pressure:10000}));
    for(let I=0;I<120;I++) S.Advance(C,1/60);
    const W=S.Wheels[0],Pinch=G.TyreRadius-G.TyreRimRadius-CarcassSpecification.PinchClearance;
    for(let I=0;I<CarcassNodes;I++) {
        assert.ok(W.Deflection[I]>=W.Floor[I]-1e-8 && W.Deflection[I]<=Pinch+1e-8);
        assert.ok(Math.abs(W.Axial[I])<=CarcassSpecification.LateralCeiling);
        Near(W.Deflection[I],W.Deflection[(CarcassNodes-I)%CarcassNodes],1e-5);
    }
    assert.ok(W.Peak>.10 && W.LateralShift>.01 && W.PatchNodes>0);
    assert.equal(S.EncodeRecords().byteLength,4*CarcassRecordBytes);
    assert.equal(CarcassRecordBytes,432);
    assert.ok([...new Float32Array(S.EncodeRecords())].every(Number.isFinite));
});

test('shell fixed-step result is frame-rate independent; high spin does not drag the patch',()=>{
    const Reference=MakeCarcass();
    for(let I=0;I<60;I++) Reference.Advance(Array.from({length:4},()=>Contact()),1/60);
    for(const FPS of [24,30,120,144]) {
        const S=MakeCarcass();
        for(let I=0;I<FPS;I++) S.Advance(Array.from({length:4},()=>Contact({DownAngle:-I*17})),1/FPS);
        for(let I=0;I<CarcassNodes;I++) Near(S.Wheels[0].Deflection[I],Reference.Wheels[0].Deflection[I],1e-8);
    }
});

test('airborne carcass rebounds, shredded carcass clears, reset clears all metadata and accumulator',()=>{
    const S=MakeCarcass();
    for(let I=0;I<60;I++) S.Advance(Array.from({length:4},()=>Contact({Pressure:0,HubDistance:.36,LateralForce:5000})),1/60);
    for(let I=0;I<180;I++) S.Advance(Array.from({length:4},()=>Contact({InContact:false})),1/60);
    assert.ok(S.Wheels[0].Peak<1e-5);
    assert.ok(Math.abs(S.Wheels[0].LateralShift)<1e-5);
    S.Advance(Array.from({length:4},()=>Contact({Shredded:true})),1/60);
    assert.equal(S.Wheels[0].Peak,0);
    S.Reset();
    assert.equal(S.Accumulator,0);
    for(const W of S.Wheels) {
        assert.equal(W.Wrinkle,0); assert.equal(W.Pinched,false); assert.equal(W.Peak,0);
        assert.ok(W.Deflection.every(X=>X===0)); assert.ok(W.Axial.every(X=>X===0));
    }
});

test('vehicle rests on all four tyres, one blowout lowers that corner, inflation and respawn repair it',()=>{
    const V=new VehicleSolver();
    Run(V,4);
    assert.equal(V.QueryTelemetry().Contacts,4);
    const Initial=V.Wheels[0].TyreDeflection;
    assert.ok(Initial>.01 && Initial<.03);
    assert.ok(Math.abs(V.LinearVelocity[2])<.001);
    const Rest=V.Position[2];
    V.PunctureTyre(0,true); Run(V,5);
    assert.ok(V.Thermals[0].GaugePressure<100);
    assert.ok(V.Wheels[0].TyreDeflection>Initial*4);
    assert.ok(V.Position[2]<Rest-.015);
    V.InflateTyres(220000,220000); Run(V,4);
    assert.ok(V.Thermals[0].GaugePressure>210000);
    assert.ok(V.Wheels[0].TyreDeflection<Initial*1.3);
    V.Respawn();
    assert.equal(V.Wheels[0].Shredded,false);
    assert.equal(V.Thermals[0].LeakRate,0);
    assert.equal(V.Wheels[0].ExtensionVelocity,0);
});

test('long burnout, puncture and driving do not produce NaN or detach the tyre from its hub',()=>{
    const V=new VehicleSolver(),S=MakeCarcass();
    for(let I=0;I<900;I++) {
        if(I===100) V.PunctureTyre(2,true);
        if(I===500) V.CoolTyres();
        V.Advance({Throttle:I<700?1:0,Brake:0,Steer:Math.sin(I*.01)*.25,Handbrake:false,LineLock:I<550},1/60);
        S.Advance(V.QueryCarcassContacts(),1/60);
        assert.ok([...V.Position,...V.LinearVelocity,...V.AngularVelocity].every(Number.isFinite));
        for(let W=0;W<4;W++) {
            assert.ok(V.Wheels[W].Length>.2&&V.Wheels[W].Length<.9);
            const C=V.QueryCarcassContacts()[W];
            if(C.InContact) Near(C.HubDistance,V.Wheels[W].Radius-V.Wheels[W].TyreDeflection);
        }
    }
});

test('cabin screen basis stays orthonormal and tablet pointer coordinates round-trip',()=>{
    for(const Angle of [-1.56,0,1.56]) {
        const T=ConstructCabinTransform(CabinLayout.Wheel,CabinLayout.WheelTilt,Angle);
        for(const A of [0,4,8]) {
            Near(DotVector(Array.from(T.slice(A,A+3)),Array.from(T.slice(A,A+3))),1,1e-6);
        }
        Near(DotVector(Array.from(T.slice(0,3)),Array.from(T.slice(4,7))),0,1e-6);
        const P=[.1,-.03,.014],Back=TransformPoint(InvertTransform(T),TransformPoint(T,P));
        P.forEach((X,I)=>Near(X,Back[I],1e-6));
    }
});

test('scrape fans stay outside road/walls and spinning-rim sparks follow material slip',()=>{
    for(const N of [[0,0,1],[1,0,0],[0,-1,0],[.6,0,.8]]) {
        const E=ProjectSparkEmitter({Normal:N,Point:[0,0,0],Velocity:[12,-4,-3],Strength:1});
        assert.ok(DotVector(E.Velocity,N)>0);
        Near(DotVector(E.Position,N),.03);
        for(let I=0;I<100;I++) {
            const F=SampleScrapeFan(N,Math.sin(I),Math.cos(I),-Math.sin(I*.3));
            assert.ok(DotVector(F,N)>-1e-8);
        }
    }
    const Spin=ProjectSparkEmitter({Normal:[0,0,1],Point:[0,0,0],Velocity:[-30,0,0],Strength:1});
    assert.ok(Spin.Velocity[0]<0);
    const Hull=ProjectSparkEmitter({Normal:[0,0,1],Point:[0,0,0],Velocity:[20,0,0],Strength:1});
    assert.ok(Hull.Velocity[0]>0&&Hull.Velocity[0]<20);
});
