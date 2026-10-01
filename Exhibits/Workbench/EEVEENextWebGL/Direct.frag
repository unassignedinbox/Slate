#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler2DShadow;
precision highp samplerCube;
in vec2 vUv;
layout(location=0) out vec4 oDirect;
uniform sampler2D uPosition;
uniform sampler2D uNormalRoughness;
uniform sampler2D uAlbedoMetalness;
uniform sampler2DShadow uShadowAtlas;
uniform samplerCube uPointShadow;
uniform mat4 uShadowMatrix[3];
uniform vec3 uShadowSplits;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
uniform float uSunIntensity;
uniform vec3 uPointPosition;
uniform vec3 uPointColour;
uniform float uPointIntensity;
uniform float uPointRange;
uniform int uShadowFilterRadius;
uniform bool uShadowsEnabled;
const float PI=3.141592653589793;

float D_GGX(float NoH,float a){float a2=a*a;float d=NoH*NoH*(a2-1.0)+1.0;return a2/max(PI*d*d,1e-5);}
float V_Smith(float NoV,float NoL,float a){
    float a2=a*a;float gv=NoL*sqrt(max(NoV*NoV*(1.0-a2)+a2,1e-5));
    float gl=NoV*sqrt(max(NoL*NoL*(1.0-a2)+a2,1e-5));return 0.5/max(gv+gl,1e-5);
}
vec3 Fresnel(vec3 f0,float VoH){float f=pow(clamp(1.0-VoH,0.0,1.0),5.0);return f0+(1.0-f0)*f;}
vec3 EvaluateLight(vec3 N,vec3 V,vec3 L,vec3 radiance,vec3 albedo,float metal,float rough){
    float NoL=max(dot(N,L),0.0),NoV=max(dot(N,V),1e-4);if(NoL<=0.0)return vec3(0.0);
    vec3 H=normalize(V+L);float NoH=max(dot(N,H),0.0),VoH=max(dot(V,H),0.0);
    float a=max(rough*rough,0.035);vec3 F=Fresnel(mix(vec3(0.04),albedo,metal),VoH);
    vec3 spec=F*(D_GGX(NoH,a)*V_Smith(NoV,NoL,a));
    vec3 diffuse=albedo*(1.0-metal)*(vec3(1.0)-F)*(1.0/PI);
    return (diffuse+spec)*radiance*NoL;
}

int ShadowCascade(float viewDepth){if(viewDepth<uShadowSplits.x)return 0;if(viewDepth<uShadowSplits.y)return 1;return 2;}
vec2 AtlasOffset(int cascade){if(cascade==0)return vec2(0.0,0.0);if(cascade==1)return vec2(0.5,0.0);return vec2(0.0,0.5);}
float DirectionalShadow(vec3 P,vec3 N){
    if(!uShadowsEnabled)return 1.0;
    float viewDepth=max(dot(P-uCameraPosition,uCameraForward),0.0);int cascade=ShadowCascade(viewDepth);
    vec4 clip=uShadowMatrix[cascade]*vec4(P+N*0.012+uSunDirection*0.008,1.0);
    vec3 ndc=clip.xyz/max(clip.w,1e-5);vec2 local=ndc.xy*0.5+0.5;float reference=ndc.z*0.5+0.5;
    if(any(lessThanEqual(local,vec2(0.002)))||any(greaterThanEqual(local,vec2(0.998)))||reference<=0.0||reference>=1.0)return 1.0;
    vec2 atlas=AtlasOffset(cascade)+local*0.5;vec2 texel=1.0/vec2(textureSize(uShadowAtlas,0));
    float slope=1.0-max(dot(N,uSunDirection),0.0);float bias=0.00012+0.00042*slope;
    float sum=0.0,weight=0.0;
    for(int y=-2;y<=2;++y)for(int x=-2;x<=2;++x){
        if(abs(x)>uShadowFilterRadius||abs(y)>uShadowFilterRadius)continue;
        vec2 tap=atlas+vec2(x,y)*texel;sum+=texture(uShadowAtlas,vec3(tap,reference-bias));weight+=1.0;
    }
    return smoothstep(0.05,0.95,sum/max(weight,1.0));
}
float PointShadow(vec3 P,vec3 N){
    if(!uShadowsEnabled)return 1.0;vec3 delta=P-uPointPosition;float distanceToLight=length(delta);
    if(distanceToLight>=uPointRange)return 1.0;vec3 direction=delta/max(distanceToLight,1e-4);
    float reference=distanceToLight/uPointRange;float bias=(0.018+0.035*(1.0-max(dot(N,-direction),0.0)))/uPointRange;
    vec3 axis=abs(direction.z)<0.8?vec3(0,0,1):vec3(0,1,0);vec3 tangent=normalize(cross(axis,direction));vec3 bitangent=cross(direction,tangent);
    float visibility=0.0;float radius=0.0045*(1.0+reference*3.0);
    for(int i=0;i<8;++i){float angle=6.2831853*(float(i)+0.5)/8.0;vec3 tap=normalize(direction+(tangent*cos(angle)+bitangent*sin(angle))*radius);float depth=texture(uPointShadow,tap).r;visibility+=step(reference-bias,depth);}
    return visibility/8.0;
}
void main(){
    vec4 positionHit=texture(uPosition,vUv);if(positionHit.w<0.5){oDirect=vec4(0.0,0.0,0.0,1.0);return;}
    vec4 nr=texture(uNormalRoughness,vUv),am=texture(uAlbedoMetalness,vUv);
    vec3 P=positionHit.xyz,N=normalize(nr.xyz),V=normalize(uCameraPosition-P);float rough=nr.w,metal=am.a;
    float sunVisibility=DirectionalShadow(P,N);vec3 colour=EvaluateLight(N,V,uSunDirection,uSunColour*uSunIntensity*sunVisibility,am.rgb,metal,rough);
    vec3 toPoint=uPointPosition-P;float pointDistance=length(toPoint);if(pointDistance<uPointRange){
        float attenuation=pow(clamp(1.0-pointDistance/uPointRange,0.0,1.0),2.0)/max(pointDistance*pointDistance,0.25);
        colour+=EvaluateLight(N,V,toPoint/max(pointDistance,1e-4),uPointColour*(uPointIntensity*attenuation*PointShadow(P,N)),am.rgb,metal,rough);
    }
    float emissive=max(positionHit.w-1.0,0.0);colour+=am.rgb*emissive;
    oDirect=vec4(max(colour,vec3(0.0)),sunVisibility);
}
