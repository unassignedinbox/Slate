#version 300 es
precision highp float;
in vec3 vWorldPosition;
uniform vec3 uLightPosition;
uniform float uLightRange;
void main(){gl_FragDepth=clamp(length(vWorldPosition-uLightPosition)/uLightRange,0.0,1.0);}
