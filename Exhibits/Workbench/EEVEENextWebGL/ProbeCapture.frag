#version 300 es
precision highp float;
in vec3 vNormal;
flat in vec4 vColourMetalness;
flat in float vEmissive;
out vec4 oColour;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
void main(){vec3 N=normalize(vNormal);float sun=max(dot(N,uSunDirection),0.0);float sky=0.12+0.18*max(N.z,0.0);vec3 diffuse=vColourMetalness.rgb*(uSunColour*sun*0.72+vec3(0.18,0.25,0.30)*sky)*(1.0-vColourMetalness.a*0.85);oColour=vec4(diffuse+vColourMetalness.rgb*vEmissive,1.0);}
