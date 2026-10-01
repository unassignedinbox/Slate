#version 300 es
precision highp float;
in vec3 vColour;
out vec4 oColour;
void main(){vec2 p=gl_PointCoord*2.0-1.0;if(dot(p,p)>1.0)discard;oColour=vec4(vColour,0.85);}
