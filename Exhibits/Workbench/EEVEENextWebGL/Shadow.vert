#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=2) in vec4 aInstancePositionEmissive;
layout(location=4) in vec4 aInstanceScaleRoughness;
uniform mat4 uLightViewProjection;
out vec3 vWorldPosition;
void main(){
    vWorldPosition=aPosition*aInstanceScaleRoughness.xyz+aInstancePositionEmissive.xyz;
    gl_Position=uLightViewProjection*vec4(vWorldPosition,1.0);
}
