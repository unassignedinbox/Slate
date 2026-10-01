#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
layout(location=0) out vec4 oFiltered;
layout(location=1) out vec4 oHistoryPosition;
uniform sampler2D uRaw;
uniform sampler2D uPosition;
uniform sampler2D uNormalRoughness;
uniform sampler2D uPreviousHistory;
uniform sampler2D uPreviousPosition;
uniform mat4 uPreviousViewProjection;
uniform bool uTemporal;
uniform bool uSpatialReuse;
uniform int uFrame;
void main(){
    vec4 centerPosition=texture(uPosition,vUv);if(centerPosition.w<0.5){oFiltered=vec4(0.0);oHistoryPosition=vec4(0.0);return;}
    vec3 centerNormal=normalize(texture(uNormalRoughness,vUv).xyz);vec2 texel=1.0/vec2(textureSize(uRaw,0));
    vec3 current=vec3(0.0),minimum=vec3(1e9),maximum=vec3(-1e9);float total=0.0;float confidence=0.0;
    for(int y=-1;y<=1;++y)for(int x=-1;x<=1;++x){
        if(!uSpatialReuse&&(x!=0||y!=0))continue;vec2 uv=vUv+vec2(x,y)*texel;vec4 p=texture(uPosition,uv);vec3 n=normalize(texture(uNormalRoughness,uv).xyz);vec4 sampleValue=texture(uRaw,uv);
        float positionWeight=exp(-distance(p.xyz,centerPosition.xyz)*2.5);float normalWeight=pow(max(dot(n,centerNormal),0.0),16.0);float w=positionWeight*normalWeight;
        current+=sampleValue.rgb*w;confidence+=sampleValue.a*w;total+=w;minimum=min(minimum,sampleValue.rgb);maximum=max(maximum,sampleValue.rgb);
    }
    current/=max(total,1e-5);confidence/=max(total,1e-5);vec3 resolved=current;
    if(uTemporal&&uFrame>1){
        vec4 previousClip=uPreviousViewProjection*vec4(centerPosition.xyz,1.0);vec2 previousUv=previousClip.xy/max(previousClip.w,1e-5)*0.5+0.5;
        if(all(greaterThan(previousUv,vec2(0.002)))&&all(lessThan(previousUv,vec2(0.998)))){
            vec4 oldPosition=texture(uPreviousPosition,previousUv);float agreement=distance(oldPosition.xyz,centerPosition.xyz);
            if(oldPosition.w>0.5&&agreement<0.22){vec3 history=clamp(texture(uPreviousHistory,previousUv).rgb,minimum*0.75,maximum*1.25+vec3(0.01));float historyWeight=mix(0.82,0.93,1.0-confidence);resolved=mix(current,history,historyWeight);}
        }
    }
    oFiltered=vec4(max(resolved,vec3(0.0)),confidence);oHistoryPosition=centerPosition;
}
