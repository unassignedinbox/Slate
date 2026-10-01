#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aInstancePositionEmissive;
layout(location=3) in vec4 aInstanceColourMetalness;
layout(location=4) in vec4 aInstanceScaleRoughness;
uniform mat4 uViewProjection;
out vec3 vNormal;
flat out vec4 vColourMetalness;
flat out float vEmissive;
void main(){vec3 s=max(aInstanceScaleRoughness.xyz,vec3(0.0001));vec3 P=aPosition*s+aInstancePositionEmissive.xyz;vNormal=normalize(aNormal/s);vColourMetalness=aInstanceColourMetalness;vEmissive=aInstancePositionEmissive.w;gl_Position=uViewProjection*vec4(P,1.0);}
