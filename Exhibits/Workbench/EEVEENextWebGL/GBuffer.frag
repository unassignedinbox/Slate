#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vWorldNormal;
flat in vec4 vColourMetalness;
flat in vec2 vRoughnessEmissive;
layout(location=0) out vec4 oPosition;
layout(location=1) out vec4 oNormalRoughness;
layout(location=2) out vec4 oAlbedoMetalness;
void main(){
    oPosition=vec4(vWorldPosition,1.0+max(vRoughnessEmissive.y,0.0));
    oNormalRoughness=vec4(normalize(vWorldNormal),clamp(vRoughnessEmissive.x,0.04,1.0));
    oAlbedoMetalness=vec4(vColourMetalness.rgb,clamp(vColourMetalness.a,0.0,1.0));
}
