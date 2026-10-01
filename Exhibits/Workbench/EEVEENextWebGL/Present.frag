#version 300 es
precision highp float;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler3D;
in vec2 vUv;
out vec4 oColour;
uniform sampler2D uPosition;
uniform sampler2D uNormalRoughness;
uniform sampler2D uAlbedoMetalness;
uniform sampler2D uDirectRadiance;
uniform sampler2D uIndirect;
uniform samplerCube uReflectionProbe;
uniform sampler3D uProbeRed;
uniform sampler3D uProbeGreen;
uniform sampler3D uProbeBlue;
uniform sampler3D uProbeVisibility0;
uniform sampler3D uProbeVisibility1;
uniform mat4 uViewProjection;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uCameraTanHalfFov;
uniform float uCameraAspect;
uniform vec3 uProbeOrigin;
uniform vec3 uProbeSpacing;
uniform ivec3 uProbeDimensions;
uniform float uProbeVisibilityDistance;
uniform float uExposure;
uniform int uMode;
uniform bool uLeakRejection;
uniform bool uReflections;
uniform bool uScreenTrace;
uniform bool uFastGI;
const float PI=3.141592653589793;

vec3 Sky(vec3 d){float z=clamp(d.z*0.5+0.5,0.0,1.0);return mix(vec3(0.18,0.26,0.30),vec3(0.025,0.075,0.13),z);}
vec3 EvaluateCoefficients(vec4 r,vec4 g,vec4 b,vec3 n){vec4 basis=vec4(1.0,n);return max(vec3(dot(r,basis),dot(g,basis),dot(b,basis)),vec3(0.0));}
float VisibilityWeight(ivec3 c,vec3 P,vec4 v0,vec4 v1){float validity=v1.b;if(!uLeakRejection)return validity;vec3 pp=uProbeOrigin+vec3(c)*uProbeSpacing,d=P-pp;float dist=length(d);if(dist<1e-4)return validity;d/=dist;vec3 a=abs(d);float reach;if(a.x>=a.y&&a.x>=a.z)reach=(d.x>=0.0?v0.r:v0.g)*uProbeVisibilityDistance;else if(a.y>=a.z)reach=(d.y>=0.0?v0.b:v0.a)*uProbeVisibilityDistance;else reach=(d.z>=0.0?v1.r:v1.g)*uProbeVisibilityDistance;float excess=max(dist-reach-0.35,0.0);return validity*exp(-excess*excess*1.75);}
vec4 ProbeSample(vec3 P,vec3 N){vec3 grid=(P-uProbeOrigin)/uProbeSpacing;ivec3 base=clamp(ivec3(floor(grid)),ivec3(0),uProbeDimensions-ivec3(2));vec3 f=fract(grid);vec3 sum=vec3(0);float weights=0.0,validity=0.0;for(int z=0;z<=1;++z)for(int y=0;y<=1;++y)for(int x=0;x<=1;++x){ivec3 c=base+ivec3(x,y,z);vec3 tc=(vec3(c)+0.5)/vec3(uProbeDimensions);vec4 r=texture(uProbeRed,tc),g=texture(uProbeGreen,tc),b=texture(uProbeBlue,tc),v0=texture(uProbeVisibility0,tc),v1=texture(uProbeVisibility1,tc);float w=(x==1?f.x:1.0-f.x)*(y==1?f.y:1.0-f.y)*(z==1?f.z:1.0-f.z);float vw=VisibilityWeight(c,P,v0,v1);sum+=EvaluateCoefficients(r,g,b,N)*w*vw;weights+=w*vw;validity+=w*v1.b;}return vec4(sum/max(weights,1e-5),validity);}
float FastOcclusion(vec2 uv,vec3 P,vec3 N){if(!uFastGI)return 1.0;vec2 texel=1.0/vec2(textureSize(uPosition,0));float occlusion=0.0;for(int i=0;i<8;++i){float a=6.2831853*(float(i)+0.5)/8.0;vec2 offset=vec2(cos(a),sin(a))*texel*(5.0+float(i%3)*3.0);vec4 q=texture(uPosition,uv+offset);if(q.w<0.5)continue;vec3 delta=q.xyz-P;float distanceToSample=length(delta);float facing=max(dot(N,delta/max(distanceToSample,1e-4)),0.0);occlusion+=facing*(1.0-smoothstep(0.1,2.4,distanceToSample));}return clamp(1.0-occlusion*0.28,0.25,1.0);}
bool TraceReflection(vec3 P,vec3 direction,out vec3 radiance){float t=0.12,previous=0.06;for(int i=0;i<24;++i){vec3 q=P+direction*t;vec4 clip=uViewProjection*vec4(q,1);if(clip.w<=0.0)break;vec2 uv=clip.xy/clip.w*0.5+0.5;if(any(lessThanEqual(uv,vec2(0.002)))||any(greaterThanEqual(uv,vec2(0.998))))break;vec4 scene=texture(uPosition,uv);if(scene.w>0.5){float qd=dot(q-uCameraPosition,uCameraForward),sd=dot(scene.xyz-uCameraPosition,uCameraForward);if(qd>sd+0.02&&qd<sd+0.5){radiance=texture(uDirectRadiance,uv).rgb;return true;}}previous=t;t=t*1.28+0.06;}return false;}
vec3 ToneMap(vec3 x){x=max(x*uExposure,vec3(0));vec3 n=x*(2.51*x+0.03),d=x*(2.43*x+0.59)+0.14;return pow(clamp(n/d,0.0,1.0),vec3(1.0/2.2));}
void main(){
    int mode=uMode;vec2 uv=vUv;if(mode==0){ivec2 panel=ivec2(min(floor(uv*2.0),vec2(1.0)));uv=fract(uv*2.0);if(panel.y==0&&panel.x==0)mode=2;else if(panel.y==0)mode=3;else if(panel.x==0)mode=4;else mode=1;}
    vec4 ph=texture(uPosition,uv);vec2 screen=uv*2.0-1.0;vec3 viewDirection=normalize(uCameraForward+uCameraRight*(screen.x*uCameraTanHalfFov*uCameraAspect)-uCameraUp*(screen.y*uCameraTanHalfFov));if(ph.w<0.5){oColour=vec4(ToneMap(Sky(viewDirection)),1);return;}
    vec4 nr=texture(uNormalRoughness,uv),am=texture(uAlbedoMetalness,uv),direct=texture(uDirectRadiance,uv),indirect=texture(uIndirect,uv);vec3 P=ph.xyz,N=normalize(nr.xyz),V=normalize(uCameraPosition-P);float rough=nr.w,metal=am.a;vec4 probe=ProbeSample(P,N);float ao=FastOcclusion(uv,P,N);
    vec3 probeDiffuse=am.rgb*(1.0-metal)*(probe.rgb/PI)*ao;vec3 tracedDiffuse=am.rgb*(1.0-metal)*(indirect.rgb/PI)*ao;
    vec3 F0=mix(vec3(0.04),am.rgb,metal);float NoV=max(dot(N,V),0.0);vec3 F=F0+(1.0-F0)*pow(1.0-NoV,5.0);vec3 R=reflect(-V,N);vec3 reflection=textureLod(uReflectionProbe,R,rough*7.0).rgb;
    if(uReflections&&uScreenTrace&&rough<0.68){vec3 hit;if(TraceReflection(P+N*0.05,R,hit))reflection=mix(hit,reflection,rough*rough);}
    vec3 specular=uReflections?reflection*F*(1.0-rough*0.35):vec3(0.0);vec3 combined=direct.rgb+tracedDiffuse+specular;vec3 linear;
    if(mode==2)linear=direct.rgb;else if(mode==3)linear=probeDiffuse;else if(mode==4)linear=tracedDiffuse;else if(mode==5)linear=specular;else if(mode==6)linear=vec3(direct.a);else if(mode==7)linear=mix(vec3(0.02,0.01,0.01),vec3(0.08,0.85,0.42),probe.a);else if(mode==8){float emission=max(ph.w-1.0,0.0);linear=am.rgb*emission+tracedDiffuse;}else linear=combined;
    vec3 display=ToneMap(linear);if(uMode==0){float divider=min(abs(vUv.x-0.5),abs(vUv.y-0.5));if(divider<0.0015)display=vec3(0.025);}oColour=vec4(display,1.0);
}
