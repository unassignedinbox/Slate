#version 300 es
precision highp float;
precision highp sampler3D;
uniform mat4 uViewProjection;
uniform vec3 uProbeOrigin;
uniform vec3 uProbeSpacing;
uniform ivec3 uProbeDimensions;
uniform sampler3D uProbeVisibility1;
out vec3 vColour;
void main(){int xy=uProbeDimensions.x*uProbeDimensions.y;int z=gl_VertexID/xy;int rem=gl_VertexID-z*xy;int y=rem/uProbeDimensions.x;int x=rem-y*uProbeDimensions.x;ivec3 c=ivec3(x,y,z);vec3 tc=(vec3(c)+0.5)/vec3(uProbeDimensions);vec4 visibility=texture(uProbeVisibility1,tc);vColour=mix(vec3(1.0,0.16,0.06),vec3(0.10,1.0,0.55),visibility.b);gl_Position=uViewProjection*vec4(uProbeOrigin+vec3(c)*uProbeSpacing,1.0);gl_PointSize=mix(5.0,2.5,visibility.b);}
