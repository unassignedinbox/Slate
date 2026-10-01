/*
 * Eevee-style realtime SSGI reference browser renderer.
 * Pass order: G-buffer (position/normal/albedo/direct) -> SSGI ray march -> temporal resolve -> bilateral blur -> HDR compose.
 * This is intentionally raw WebGL2 rather than a scene library so every GI piece is visible and inspectable.
 */
const canvas = document.querySelector('#viewport');
const unsupported = document.querySelector('#unsupported');
window.addEventListener('error', (event) => { unsupported.hidden = false; unsupported.textContent = `Renderer startup error: ${event.message}`; });
const gl = canvas.getContext('webgl2', { antialias: false, depth: true, powerPreference: 'high-performance' });
if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
  unsupported.hidden = false;
  unsupported.textContent = 'This demo needs WebGL 2 and EXT_color_buffer_float for the HDR G-buffer / realtime GI passes.';
  throw new Error('WebGL2 float color buffers are unavailable');
}

const $ = (id) => document.querySelector(id);
const controls = {
  gi: $('giEnabled'), temporal: $('temporal'), rays: $('rays'), steps: $('steps'), intensity: $('intensity'), scale: $('scale'),
  fps: $('fps'), resolution: $('resolution'), samples: $('samplesReadout')
};
const settings = { rays: 4, steps: 20, intensity: 1, scale: 1, gi: true, temporal: true };
let resetHistory = true;
for (const [name, input] of Object.entries({ rays: controls.rays, steps: controls.steps, intensity: controls.intensity, scale: controls.scale })) {
  input.addEventListener('input', () => { settings[name] = Number(input.value); $(name + 'Value').value = name === 'scale' ? `${Math.round(settings[name] * 100)}%` : name === 'intensity' ? settings[name].toFixed(2) : settings[name]; resetHistory = true; if (name === 'scale') resize(); });
}
controls.gi.addEventListener('change', () => { settings.gi = controls.gi.checked; resetHistory = true; });
controls.temporal.addEventListener('change', () => { settings.temporal = controls.temporal.checked; resetHistory = true; });

const vsGeometry = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec3 aParams; // metallic, roughness, emission
uniform mat4 uView, uProjection, uLightViewProjection;
out vec3 vViewPosition, vViewNormal, vColor;
out vec3 vParams;out vec4 vLightClip;
void main(){
  vec4 viewPosition = uView * vec4(aPosition, 1.0);
  vViewPosition = viewPosition.xyz;
  vViewNormal = mat3(uView) * aNormal;
  vColor=aColor; vParams=aParams;vLightClip=uLightViewProjection*vec4(aPosition,1.0);
  gl_Position = uProjection * viewPosition;
}`;
const fsGeometry = `#version 300 es
precision highp float;
in vec3 vViewPosition, vViewNormal, vColor, vParams;in vec4 vLightClip;
uniform vec3 uLightViewPosition;uniform sampler2DShadow uShadow;
layout(location=0) out vec4 oPosition;
layout(location=1) out vec4 oNormalRoughness;
layout(location=2) out vec4 oAlbedoMetallic;
layout(location=3) out vec4 oDirect;
const float PI=3.14159265359;
float Dggx(float nh,float r){float a=max(.045,r*r);float a2=a*a;float d=nh*nh*(a2-1.)+1.;return a2/max(PI*d*d,1e-5);}
float G1(float nx,float r){float a=max(.045,r*r);float k=(a+1.)*(a+1.)*.125;return nx/max(nx*(1.-k)+k,1e-4);}
vec3 fresnel(float vh,vec3 f0){return f0+(1.-f0)*pow(1.-vh,5.);}
float shadowVisibility(){vec3 p=vLightClip.xyz/vLightClip.w*.5+.5;if(any(lessThan(p,vec3(.001)))||any(greaterThan(p,vec3(.999))))return 1.;float sum=0.;vec2 t=1./vec2(textureSize(uShadow,0));for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)sum+=texture(uShadow,vec3(p.xy+vec2(x,y)*t,p.z-.0018));return sum/9.;}
void main(){
  vec3 n=normalize(vViewNormal), v=normalize(-vViewPosition);
  float metallic=vParams.x, roughness=clamp(vParams.y,.045,1.), emission=vParams.z;
  vec3 direct=vec3(0.);
  if(emission>0.) direct=vColor*emission;
  else {
    vec3 toLight=uLightViewPosition-vViewPosition;float d=length(toLight);vec3 l=toLight/d;
    float nl=max(dot(n,l),0.);vec3 h=normalize(v+l);float nv=max(dot(n,v),.001),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);
    vec3 f0=mix(vec3(.04),vColor,metallic);vec3 spec=fresnel(vh,f0)*(Dggx(nh,roughness)*G1(nl,roughness)*G1(nv,roughness)/max(4.*nl*nv,.001));
    vec3 diff=vColor*(1.-metallic)/PI;
    // Area-light energy approximation: the emissive 2x2 panel is represented by its centre here; SSGI sees the real panel.
    direct=(diff+spec)*vec3(34.)*nl*shadowVisibility()/max(d*d,.06);
  }
  oPosition=vec4(vViewPosition,1.);oNormalRoughness=vec4(n,roughness);oAlbedoMetallic=vec4(vColor,metallic);oDirect=vec4(direct,1.);
}`;
const vsShadow = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;uniform mat4 uLightViewProjection;
void main(){gl_Position=uLightViewProjection*vec4(aPosition,1.);}`;
const fsShadow = `#version 300 es
precision highp float;void main(){}`;
const vsFullscreen = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const fsSSGI = `#version 300 es
precision highp float;
in vec2 vUv;out vec4 oGI;
uniform sampler2D uPosition,uNormalRoughness,uAlbedoMetallic,uDirect;
uniform mat4 uProjection;uniform vec2 uFullResolution;uniform int uRays,uSteps;uniform float uFrame;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uFrame*19.19)*43758.5453123);}
vec3 cosineHemisphere(float u,float v){float r=sqrt(u),a=6.2831853*v;return vec3(r*cos(a),r*sin(a),sqrt(max(0.,1.-u)));}
vec3 toWorld(vec3 n,vec3 local){vec3 t=normalize(abs(n.z)<.99?cross(vec3(0,0,1),n):cross(vec3(0,1,0),n));return normalize(t*local.x+cross(n,t)*local.y+n*local.z);}
bool projectPoint(vec3 p,out vec2 uv){vec4 c=uProjection*vec4(p,1.);if(c.w<=0.)return false;uv=c.xy/c.w*.5+.5;return all(greaterThan(uv,vec2(.002)))&&all(lessThan(uv,vec2(.998)));}
void main(){
  vec3 p=texture(uPosition,vUv).xyz;if(texture(uPosition,vUv).a<.5){oGI=vec4(0.);return;}
  vec3 n=normalize(texture(uNormalRoughness,vUv).xyz);vec3 albedo=texture(uAlbedoMetallic,vUv).rgb;vec3 gi=vec3(0.);float hits=0.;
  for(int r=0;r<8;r++){if(r>=uRays)break;float seed=hash(gl_FragCoord.xy+float(r)*17.);vec3 direction=toWorld(n,cosineHemisphere(fract(seed*13.37),fract(seed*71.17)));
    float jitter=hash(gl_FragCoord.yx+float(r)*41.);
    for(int s=0;s<32;s++){if(s>=uSteps)break;float distance=.09+(float(s)+jitter)*.145;vec3 probe=p+direction*distance;vec2 uv;
      if(!projectPoint(probe,uv))break;vec4 sceneP=texture(uPosition,uv);if(sceneP.a<.5)continue;
      float thickness=.045+distance*.028;
      if(abs(sceneP.z-probe.z)<thickness){vec3 hn=normalize(texture(uNormalRoughness,uv).xyz);float facing=max(dot(hn,-direction),0.);vec3 source=texture(uDirect,uv).rgb;
        gi+=albedo*source*facing*.26;hits+=1.;break;}
    }
  }
  gi/=float(max(uRays,1));
  // Clamp keeps a bright on-screen emitter from creating unstable temporal fireflies.
  oGI=vec4(min(gi,vec3(8.)),hits/float(max(uRays,1)));
}`;
const fsTemporal = `#version 300 es
precision highp float;
in vec2 vUv;out vec4 oColor;uniform sampler2D uCurrent,uHistory;uniform float uHistoryWeight;uniform bool uHasHistory;
void main(){vec4 c=texture(uCurrent,vUv);if(!uHasHistory){oColor=c;return;}vec4 h=texture(uHistory,vUv);vec3 bounded=clamp(h.rgb,c.rgb-vec3(1.5),c.rgb+vec3(1.5));oColor=vec4(mix(c.rgb,bounded,uHistoryWeight),mix(c.a,h.a,uHistoryWeight));}`;
const fsBilateral = `#version 300 es
precision highp float;
in vec2 vUv;out vec4 oColor;uniform sampler2D uInput,uPosition,uNormal;uniform vec2 uDirection,uFullResolution;
void main(){vec4 center=texture(uInput,vUv);vec3 p=texture(uPosition,vUv).xyz;vec3 n=normalize(texture(uNormal,vUv).xyz);vec3 sum=center.rgb*0.4;float weight=.4;
  for(int i=1;i<=2;i++){for(int sign=-1;sign<=1;sign+=2){vec2 uv=vUv+uDirection*float(i*sign);vec4 q=texture(uInput,uv);vec3 sp=texture(uPosition,uv).xyz;vec3 sn=normalize(texture(uNormal,uv).xyz);float w=.25*exp(-abs(sp.z-p.z)*12.)*pow(max(dot(n,sn),0.),12.);sum+=q.rgb*w;weight+=w;}}
  oColor=vec4(sum/max(weight,.0001),center.a);
}`;
const fsComposite = `#version 300 es
precision highp float;
in vec2 vUv;out vec4 oColor;uniform sampler2D uPosition,uNormal,uDirect,uGI;uniform vec2 uFullResolution,uGiResolution;uniform float uGiIntensity;uniform bool uGiEnabled;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){vec4 direct=texture(uDirect,vUv);if(texture(uPosition,vUv).a<.5){vec3 sky=mix(vec3(.015,.025,.05),vec3(.10,.16,.26),vUv.y);oColor=vec4(pow(aces(sky),vec3(1./2.2)),1.);return;}
  vec3 gi=vec3(0.);if(uGiEnabled){vec2 texel=1./uGiResolution;vec3 p=texture(uPosition,vUv).xyz;vec3 n=normalize(texture(uNormal,vUv).xyz);float total=0.;
    // Joint bilateral upsample: GI is half resolution, while depth/normal guidance is full resolution.
    for(int y=0;y<=1;y++)for(int x=0;x<=1;x++){vec2 offset=(vec2(float(x),float(y))-.5)*texel;vec2 uv=vUv+offset;vec3 sp=texture(uPosition,uv).xyz;vec3 sn=normalize(texture(uNormal,uv).xyz);float w=exp(-abs(sp.z-p.z)*11.)*pow(max(dot(n,sn),0.),10.);gi+=texture(uGI,uv).rgb*w;total+=w;}gi/=max(total,.0001);}
  vec3 color=direct.rgb+gi*uGiIntensity;oColor=vec4(pow(aces(color),vec3(1./2.2)),1.);
}`;

function compile(type, source) { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; }
function program(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
const programs = { shadow: program(vsShadow, fsShadow), geometry: program(vsGeometry, fsGeometry), ssgi: program(vsFullscreen, fsSSGI), temporal: program(vsFullscreen, fsTemporal), bilateral: program(vsFullscreen, fsBilateral), composite: program(vsFullscreen, fsComposite) };
const fullscreenVao = gl.createVertexArray();
function use(p) { gl.useProgram(p); }
function uni(p, name) { return gl.getUniformLocation(p, name); }
function set1i(p, name, value) { const l=uni(p,name); if(l) gl.uniform1i(l,value); }
function set1f(p, name, value) { const l=uni(p,name); if(l) gl.uniform1f(l,value); }
function set2f(p, name, x,y) { const l=uni(p,name); if(l) gl.uniform2f(l,x,y); }
function set3f(p, name, x,y,z) { const l=uni(p,name); if(l) gl.uniform3f(l,x,y,z); }
function setMat(p, name, value) { const l=uni(p,name); if(l) gl.uniformMatrix4fv(l,false,value); }
function bindTexture(unit, texture) { gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D, texture); }

function addVertex(out, p, n, color, metal=0, rough=.5, emission=0) { out.push(...p,...n,...color,metal,rough,emission); }
function triangle(out, a,b,c,n,color,metal,rough,emission=0) { addVertex(out,a,n,color,metal,rough,emission);addVertex(out,b,n,color,metal,rough,emission);addVertex(out,c,n,color,metal,rough,emission); }
function quad(out,a,b,c,d,n,color,metal,rough,emission=0) { triangle(out,a,b,c,n,color,metal,rough,emission);triangle(out,a,c,d,n,color,metal,rough,emission); }
function sphere(out, cx,cy,cz,r,color,metal,rough,emission=0) {
  const rings=16, segments=24;
  for(let y=0;y<rings;y++) for(let x=0;x<segments;x++) {
    const point=(iy,ix)=>{const theta=iy*Math.PI/rings,phi=ix*2*Math.PI/segments;const n=[Math.sin(theta)*Math.cos(phi),Math.sin(theta)*Math.sin(phi),Math.cos(theta)];return {p:[cx+n[0]*r,cy+n[1]*r,cz+n[2]*r],n};};
    const a=point(y,x),b=point(y,x+1),c=point(y+1,x+1),d=point(y+1,x);triangle(out,a.p,b.p,c.p,a.n,color,metal,rough,emission);triangle(out,a.p,c.p,d.p,a.n,color,metal,rough,emission);
  }
}
function createShaderBall() {
  const v=[];quad(v,[-4,-3,0],[4,-3,0],[4,4,0],[-4,4,0],[0,0,1],[.42,.45,.5],0,1);
  const mats=[];for(let i=0;i<6;i++)mats.push([[.65,.10,.11],0,.05+i*.18,0]);
  const metals=[[[1,.72,.25],.24],[[.92,.94,1],.13],[[.95,.48,.27],.3],[[.8,.85,.92],.36],[[.28,.31,.36],.42],[[1,.7,.28],.12]];for(const [c,r] of metals)mats.push([c,1,r,0]);
  mats.push([[.05,.18,.9],0,.48,0],[[.05,.28,.9],0,.30,0],[[.11,.1,.48],0,.62,0],[[.5,.02,.09],0,.35,0],[[.65,.04,.12],0,.7,0],[[.08,.04,.02],1,.08,0]);
  mats.push([[1,.36,.08],0,.3,7],[[.1,.75,.16],0,.3,0],[[.2,.2,.24],0,.2,0],[[.35,.35,.42],0,.72,0],[[.84,.68,.4],0,.65,0],[[.84,.7,.5],0,.95,0]);
  let index=0;for(let row=0;row<4;row++)for(let col=0;col<6;col++,index++){const [c,m,r,e]=mats[index];if(index===19){sphere(v,-3+1.2*col,-1.2+1.2*row,.45,.45,c,m,r,e);continue;}sphere(v,-3+1.2*col,-1.2+1.2*row,.45,.45,c,m,r,e);}
  // Actual emissive panel: it participates in the G-buffer, so screen-space rays can hit it.
  quad(v,[-1,-.4,3.8],[1,-.4,3.8],[1,1.6,3.8],[-1,1.6,3.8],[0,0,-1],[1,.92,.75],0,.3,20);
  return new Float32Array(v);
}
const mesh = createShaderBall();
const meshVao=gl.createVertexArray(), meshBuffer=gl.createBuffer();gl.bindVertexArray(meshVao);gl.bindBuffer(gl.ARRAY_BUFFER,meshBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.STATIC_DRAW);
const stride=12*4;for(const [index,size,offset] of [[0,3,0],[1,3,3*4],[2,3,6*4],[3,3,9*4]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,stride,offset);}gl.bindVertexArray(null);
const meshCount=mesh.length/12;
const shadowCount=meshCount-6; // Do not make the emitter panel cast a shadow over the whole scene.
const shadowSize=1024;
const shadowTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shadowTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,shadowSize,shadowSize,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
const shadowFbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadowTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Shadow framebuffer incomplete');

function texture(w,h,filter=gl.NEAREST) { const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);return t; }
function target(t) { const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete framebuffer');return f; }
let resources={};
function destroyResources(){for(const value of Object.values(resources)){if(!value)continue;if(Array.isArray(value)) value.forEach(x=>gl.deleteTexture(x));else if(value instanceof WebGLTexture)gl.deleteTexture(value);else if(value instanceof WebGLFramebuffer)gl.deleteFramebuffer(value);else if(value instanceof WebGLRenderbuffer)gl.deleteRenderbuffer(value);}}
function resize(){
  const ratio=Math.min(devicePixelRatio||1,2);const w=Math.max(2,Math.floor(canvas.clientWidth*ratio*settings.scale));const h=Math.max(2,Math.floor(canvas.clientHeight*ratio*settings.scale));if(canvas.width===w&&canvas.height===h)return;
  destroyResources();canvas.width=w;canvas.height=h;const hw=Math.max(2,Math.floor(w*.5)),hh=Math.max(2,Math.floor(h*.5));
  const pos=texture(w,h),normal=texture(w,h),albedo=texture(w,h),direct=texture(w,h);const gFbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,gFbo);[pos,normal,albedo,direct].forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0));gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2,gl.COLOR_ATTACHMENT3]);const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('G-buffer framebuffer incomplete');
  const current=texture(hw,hh,gl.LINEAR),hist=[texture(hw,hh,gl.LINEAR),texture(hw,hh,gl.LINEAR)],blurA=texture(hw,hh,gl.LINEAR),blurB=texture(hw,hh,gl.LINEAR);
  resources={w,h,hw,hh,pos,normal,albedo,direct,gFbo,depth,current,currentFbo:target(current),hist,histFbo:[target(hist[0]),target(hist[1])],blurA,blurAFbo:target(blurA),blurB,blurBFbo:target(blurB),historyIndex:0,historyValid:false};
  controls.resolution.textContent=`${hw} × ${hh}`;resetHistory=true;
}

function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);}
function lookAt(eye,center,up=[0,0,1]){let zx=eye[0]-center[0],zy=eye[1]-center[1],zz=eye[2]-center[2];let z=1/Math.hypot(zx,zy,zz);zx*=z;zy*=z;zz*=z;let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx;let l=Math.hypot(xx,xy,xz);xx/=l;xy/=l;xz/=l;const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;return new Float32Array([xx,yx,zx,0,xy,yy,zy,0,xz,yz,zz,0,-(xx*eye[0]+xy*eye[1]+xz*eye[2]),-(yx*eye[0]+yy*eye[1]+yz*eye[2]),-(zx*eye[0]+zy*eye[1]+zz*eye[2]),1]);}
function transformPoint(m,p){return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];}
function multiply(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[0*4+r]*b[c*4]+a[1*4+r]*b[c*4+1]+a[2*4+r]*b[c*4+2]+a[3*4+r]*b[c*4+3];return o;}
function ortho(left,right,bottom,top,near,far){return new Float32Array([2/(right-left),0,0,0,0,2/(top-bottom),0,0,0,0,-2/(far-near),0,-(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1]);}
const lightView=lookAt([0,.6,3.75],[0,.5,0],[0,1,0]);const lightProjection=ortho(-5,5,-5,5,.1,12);const lightViewProjection=multiply(lightProjection,lightView);
const camera={yaw:Math.PI,pitch:.27,distance:8.8,target:[0,.45,.6]};
function matrices(){const cp=Math.cos(camera.pitch),eye=[camera.target[0]+Math.sin(camera.yaw)*cp*camera.distance,camera.target[1]+Math.cos(camera.yaw)*cp*camera.distance,camera.target[2]+Math.sin(camera.pitch)*camera.distance];const view=lookAt(eye,camera.target),projection=perspective(55*Math.PI/180,resources.w/resources.h,.05,50);return {view,projection,light:transformPoint(view,[0,.6,3.8])};}
let dragging=false,lastX=0,lastY=0;canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!dragging)return;camera.yaw+=(e.clientX-lastX)*.008;camera.pitch=Math.max(-.1,Math.min(1.25,camera.pitch-(e.clientY-lastY)*.008));lastX=e.clientX;lastY=e.clientY;resetHistory=true;});canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('wheel',e=>{e.preventDefault();camera.distance=Math.max(4.5,Math.min(15,camera.distance*Math.exp(e.deltaY*.001)));resetHistory=true;},{passive:false});

function drawFullscreen(){gl.bindVertexArray(fullscreenVao);gl.drawArrays(gl.TRIANGLES,0,3);}
function setupInputs(p, names){names.forEach(([name,unit,tex])=>{bindTexture(unit,tex);set1i(p,name,unit);});}
let frame=0,lastTime=performance.now(),frames=0;
function render(now){
  resize();const r=resources,m=matrices();
  if(resetHistory){for(const fbo of r.histFbo){gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,r.hw,r.hh);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}r.historyValid=false;resetHistory=false;}
  // 1. Conventional Eevee-style shadow map for the direct PBR term. The actual emissive panel is excluded from casters.
  gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFbo);gl.viewport(0,0,shadowSize,shadowSize);gl.enable(gl.DEPTH_TEST);gl.colorMask(false,false,false,false);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);use(programs.shadow);setMat(programs.shadow,'uLightViewProjection',lightViewProjection);gl.bindVertexArray(meshVao);gl.drawArrays(gl.TRIANGLES,0,shadowCount);gl.colorMask(true,true,true,true);
  // 2. Deferred geometry / direct lighting into HDR G-buffer targets.
  gl.bindFramebuffer(gl.FRAMEBUFFER,r.gFbo);gl.viewport(0,0,r.w,r.h);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);use(programs.geometry);setMat(programs.geometry,'uView',m.view);setMat(programs.geometry,'uProjection',m.projection);setMat(programs.geometry,'uLightViewProjection',lightViewProjection);set3f(programs.geometry,'uLightViewPosition',...m.light);bindTexture(4,shadowTexture);set1i(programs.geometry,'uShadow',4);gl.bindVertexArray(meshVao);gl.drawArrays(gl.TRIANGLES,0,meshCount);
  let giTexture=r.current;
  if(settings.gi){
    // 2. Half-resolution cosine hemisphere screen-space ray march.
    gl.disable(gl.DEPTH_TEST);gl.bindFramebuffer(gl.FRAMEBUFFER,r.currentFbo);gl.viewport(0,0,r.hw,r.hh);use(programs.ssgi);setupInputs(programs.ssgi,[['uPosition',0,r.pos],['uNormalRoughness',1,r.normal],['uAlbedoMetallic',2,r.albedo],['uDirect',3,r.direct]]);setMat(programs.ssgi,'uProjection',m.projection);set2f(programs.ssgi,'uFullResolution',r.w,r.h);set1i(programs.ssgi,'uRays',settings.rays);set1i(programs.ssgi,'uSteps',settings.steps);set1f(programs.ssgi,'uFrame',frame);drawFullscreen();
    // 3. Temporal resolve. Camera movement/control changes invalidate history above.
    const next=1-r.historyIndex;gl.bindFramebuffer(gl.FRAMEBUFFER,r.histFbo[next]);use(programs.temporal);setupInputs(programs.temporal,[['uCurrent',0,r.current],['uHistory',1,r.hist[r.historyIndex]]]);set1f(programs.temporal,'uHistoryWeight',settings.temporal?.88:0);set1i(programs.temporal,'uHasHistory',settings.temporal&&r.historyValid?1:0);drawFullscreen();r.historyIndex=next;r.historyValid=true;
    // 4. Edge-aware bilateral denoise at GI resolution, guided by full-res depth/normal.
    gl.bindFramebuffer(gl.FRAMEBUFFER,r.blurAFbo);use(programs.bilateral);setupInputs(programs.bilateral,[['uInput',0,r.hist[r.historyIndex]],['uPosition',1,r.pos],['uNormal',2,r.normal]]);set2f(programs.bilateral,'uDirection',1/r.hw,0);set2f(programs.bilateral,'uFullResolution',r.w,r.h);drawFullscreen();
    gl.bindFramebuffer(gl.FRAMEBUFFER,r.blurBFbo);setupInputs(programs.bilateral,[['uInput',0,r.blurA],['uPosition',1,r.pos],['uNormal',2,r.normal]]);set2f(programs.bilateral,'uDirection',0,1/r.hh);drawFullscreen();giTexture=r.blurB;
  }
  // 5. HDR direct + GI composite, joint bilateral upsample, ACES/gamma presentation.
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,r.w,r.h);use(programs.composite);setupInputs(programs.composite,[['uPosition',0,r.pos],['uNormal',1,r.normal],['uDirect',2,r.direct],['uGI',3,giTexture]]);set2f(programs.composite,'uFullResolution',r.w,r.h);set2f(programs.composite,'uGiResolution',r.hw,r.hh);set1f(programs.composite,'uGiIntensity',settings.intensity);set1i(programs.composite,'uGiEnabled',settings.gi?1:0);drawFullscreen();
  frame++;frames++;if(now-lastTime>500){const fps=frames*1000/(now-lastTime);controls.fps.textContent=`${fps.toFixed(0)} fps`;controls.samples.textContent=`${settings.rays} × ${settings.steps}`;frames=0;lastTime=now;}requestAnimationFrame(render);
}
new ResizeObserver(resize).observe(canvas);resize();requestAnimationFrame(render);
