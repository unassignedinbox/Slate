#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;
in vec2 vUv;
out vec4 oRay;
uniform sampler2D uPosition;
uniform sampler2D uNormalRoughness;
uniform sampler2D uDirectRadiance;
uniform sampler3D uProbeRed;
uniform sampler3D uProbeGreen;
uniform sampler3D uProbeBlue;
uniform sampler3D uProbeVisibility0;
uniform sampler3D uProbeVisibility1;
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uProbeOrigin;
uniform vec3 uProbeSpacing;
uniform ivec3 uProbeDimensions;
uniform float uProbeVisibilityDistance;
uniform float uThickness;
uniform float uMaximumDistance;
uniform int uRaySteps;
uniform int uRayCount;
uniform int uFrame;
uniform bool uScreenTrace;
uniform bool uVolumeProbes;
uniform bool uLeakRejection;
uniform bool uBackface;
const float PI=3.141592653589793;

float Hash(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
vec3 EvaluateCoefficients(vec4 r,vec4 g,vec4 b,vec3 n){vec4 basis=vec4(1.0,n);return max(vec3(dot(r,basis),dot(g,basis),dot(b,basis)),vec3(0.0));}
float ProbeVisibilityWeight(ivec3 cell,vec3 receiver,vec4 v0,vec4 v1){
    float validity=v1.b;if(!uLeakRejection)return validity;
    vec3 probePosition=uProbeOrigin+vec3(cell)*uProbeSpacing;vec3 delta=receiver-probePosition;float distanceToProbe=length(delta);
    if(distanceToProbe<1e-4)return validity;vec3 d=delta/distanceToProbe,a=abs(d);float reach;
    if(a.x>=a.y&&a.x>=a.z)reach=(d.x>=0.0?v0.r:v0.g)*uProbeVisibilityDistance;
    else if(a.y>=a.z)reach=(d.y>=0.0?v0.b:v0.a)*uProbeVisibilityDistance;
    else reach=(d.z>=0.0?v1.r:v1.g)*uProbeVisibilityDistance;
    float excess=max(distanceToProbe-reach-0.35,0.0);return validity*exp(-excess*excess*1.75);
}
vec3 SampleVolumeProbe(vec3 P,vec3 N){
    if(!uVolumeProbes)return vec3(0.0);
    vec3 grid=(P-uProbeOrigin)/uProbeSpacing;ivec3 base=ivec3(floor(grid));vec3 f=fract(grid);
    base=clamp(base,ivec3(0),uProbeDimensions-ivec3(2));vec3 sum=vec3(0.0);float weights=0.0;
    for(int z=0;z<=1;++z)for(int y=0;y<=1;++y)for(int x=0;x<=1;++x){
        ivec3 c=base+ivec3(x,y,z);vec3 tc=(vec3(c)+0.5)/vec3(uProbeDimensions);
        vec4 r=texture(uProbeRed,tc),g=texture(uProbeGreen,tc),b=texture(uProbeBlue,tc);
        vec4 v0=texture(uProbeVisibility0,tc),v1=texture(uProbeVisibility1,tc);
        float w=(x==1?f.x:1.0-f.x)*(y==1?f.y:1.0-f.y)*(z==1?f.z:1.0-f.z);
        w*=ProbeVisibilityWeight(c,P,v0,v1);sum+=EvaluateCoefficients(r,g,b,N)*w;weights+=w;
    }
    return sum/max(weights,1e-5);
}
vec3 CosineDirection(vec3 N,float a,float b){
    float radius=sqrt(a),angle=6.283185307*b;vec3 local=vec3(radius*cos(angle),radius*sin(angle),sqrt(max(1.0-a,0.0)));
    vec3 axis=abs(N.z)<0.999?vec3(0,0,1):vec3(0,1,0);vec3 T=normalize(cross(axis,N));vec3 B=cross(N,T);return normalize(T*local.x+B*local.y+N*local.z);
}
bool TraceScreen(vec3 origin,vec3 direction,out vec2 hitUv){
    float previousT=0.08,t=0.16;
    for(int step=0;step<40;++step){
        if(step>=uRaySteps||t>uMaximumDistance)break;vec3 rayPoint=origin+direction*t;vec4 clip=uViewProjection*vec4(rayPoint,1.0);
        if(clip.w<=0.0)break;vec2 uv=clip.xy/clip.w*0.5+0.5;if(any(lessThanEqual(uv,vec2(0.002)))||any(greaterThanEqual(uv,vec2(0.998))))break;
        vec4 scene=texture(uPosition,uv);if(scene.w>0.5){
            float rayDepth=dot(rayPoint-uCameraPosition,uCameraForward);float sceneDepth=dot(scene.xyz-uCameraPosition,uCameraForward);
            float thickness=uThickness*(1.0+sceneDepth*0.012);
            if(rayDepth>=sceneDepth+0.015&&rayDepth<=sceneDepth+thickness){
                vec3 hitNormal=normalize(texture(uNormalRoughness,uv).xyz);if(uBackface||dot(hitNormal,direction)<0.15){
                    float lo=previousT,hi=t;for(int refine=0;refine<3;++refine){float mid=(lo+hi)*0.5;vec3 q=origin+direction*mid;vec4 qc=uViewProjection*vec4(q,1);vec2 quv=qc.xy/qc.w*0.5+0.5;vec3 sp=texture(uPosition,quv).xyz;float qd=dot(q-uCameraPosition,uCameraForward),sd=dot(sp-uCameraPosition,uCameraForward);if(qd>sd)hi=mid;else lo=mid;}vec3 q=origin+direction*hi;vec4 qc=uViewProjection*vec4(q,1);hitUv=qc.xy/qc.w*0.5+0.5;return true;
                }
            }
        }
        previousT=t;t=t*1.23+0.055;
    }
    return false;
}
void main(){
    vec4 positionHit=texture(uPosition,vUv);if(positionHit.w<0.5){oRay=vec4(0.0);return;}
    vec3 P=positionHit.xyz,N=normalize(texture(uNormalRoughness,vUv).xyz);vec3 probe=SampleVolumeProbe(P,N);
    if(!uScreenTrace){oRay=vec4(probe,0.0);return;}
    vec3 accumulated=vec3(0.0);float hitCount=0.0;vec2 pixel=vUv*vec2(textureSize(uPosition,0));
    for(int ray=0;ray<2;++ray){if(ray>=uRayCount)break;float a=Hash(vec3(pixel,float(uFrame*3+ray*17)));float b=Hash(vec3(pixel.yx+19.7,float(uFrame*7+ray*29)));vec3 direction=CosineDirection(N,a,b);vec2 hitUv;
        if(TraceScreen(P+N*0.065,direction,hitUv)){vec3 outgoing=texture(uDirectRadiance,hitUv).rgb;accumulated+=outgoing*PI;hitCount+=1.0;}else accumulated+=probe;
    }
    float count=float(max(uRayCount,1));oRay=vec4(max(accumulated/count,vec3(0.0)),hitCount/count);
}
