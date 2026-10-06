// Analytic fields only: shared by live rendering, PNG baking and JS export.
export function botanicalGLSL() {
  return `
 uniform float uVeinRelief,uCellScale,uCellRelief,uColorGradient,uSpotDensity,uSkinMode,uPlantRibs;
 float bioJoint=0.,bioPore=0.;
 // F1/F2 and a stable site ID. Used for microscopic epidermis, not the main hide grain.
 vec3 bioCylinder(vec2 uv,vec2 freq,float seed){float a=uv.x*6.2831853;return vec3(cos(a)*freq.x/6.2831853,sin(a)*freq.x/6.2831853,uv.y*freq.y+seed);}
 vec4 bioCellAt(vec2 p,float seed,float period){
   vec2 cell=floor(p),f=fract(p),winner=vec2(0.);float d1=100.,d2=100.;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
     vec2 id=cell+vec2(float(x),float(y));if(period>0.)id.x=mod(id.x,period);
     vec2 site=.18+.64*vec2(hash31(vec3(id,seed)),hash31(vec3(id+19.3,seed)));
     float d=length(vec2(float(x),float(y))+site-f);
     if(d<d1){d2=d1;d1=d;winner=id;}else d2=min(d2,d);
   }
   return vec4(d1,max(0.,d2-d1),hash31(vec3(winner,seed+37.)),hash31(vec3(winner,seed+83.)));
 }
 vec4 bioCell(vec2 p,float seed){return bioCellAt(p,seed,0.);}
 // Folded hide: overlapping, warped crease bands and short pores, no Voronoi outlines.
 vec3 hideGrain(vec3 p){
   vec3 q=p*uScale;
   vec3 warp=vec3(stoneFBM(q*.31),stoneFBM(q*.31+11.),stoneFBM(q*.31+43.));
   q+=warp*3.4;
   float a=noise3(q*vec3(.7,1.5,.85)),b=noise3(q*vec3(1.6,.6,1.1)+27.);
   float aa=max(fwidth(a),.002),ab=max(fwidth(b),.002);
   float fold=(1.-smoothstep(.014+aa,.06+aa,abs(a-.5)))*(.3+.7*noise3(q*.8+7.));
   float crossFold=(1.-smoothstep(.01+ab,.044+ab,abs(b-.48)))*smoothstep(.34,.7,noise3(q*.43+29.));
   float pores=smoothstep(.69,.88,noise3(q*vec3(7.,11.,7.)));
   float fine=noise3(q*5.7);
   float resolved=1.-smoothstep(.35,1.4,length(fwidth(q)));
   float creases=max(fold,crossFold*.8)*resolved;
   return vec3((.76-creases*.46+(fine-.5)*.15-pores*.16)*resolved+.68*(1.-resolved),creases,pores*resolved);
 }
`;
}
export function botanicalColor() {
  return `
 if(uType==30){
   // Belly scutes grading toward smaller flank scales, with wandering row boundaries.
   vec2 uv=surfaceUV(pp,weights)*uScale;
   uv+=vec2(stoneFBM(vec3(uv*.7,uSurfaceSeed)),stoneFBM(vec3(uv*.7,uSurfaceSeed+11.)))*.3;
   uv.x-=.5*sin(uv.x*.65);
   uv.y+=.095*sin(uv.x*1.4)+.07*noise3(vec3(uv.x*1.7,0.,uSurfaceSeed));
   float row=floor(uv.y),stagger=hash31(vec3(row,uSurfaceSeed,1.));
   float stretch=mix(.78,1.45,.5+.5*sin(row*.65));
   uv.x=uv.x*stretch+stagger*.8;
   vec2 id=floor(uv),q=fract(uv)-.5;
   float r=hash31(vec3(id,uSurfaceSeed));
   q.x+=.065*sin(uv.x*3.7+row*2.7);
   q+=.025*vec2(sin(q.y*13.+r*19.),sin(q.x*11.+r*27.));
   float corner=mix(.06,.16,r);
   vec2 d=abs(q)-vec2(.5-uGroutWidth-corner);
   float sd=length(max(d,0.))+min(max(d.x,d.y),0.)-corner;
   float aa=max(length(fwidth(uv))*.55,.001);
   float scute=1.-smoothstep(-aa,aa,sd);
   float dome=pow(clamp(-sd/.34,0.,1.),.48);
   float fine=noise3(vec3(uv*13.,uSurfaceSeed)),wrinkle=noise3(vec3(uv*vec2(3.,19.),21.));
   bioJoint=1.-scute;
   vec3 scaleColor=mix(diffuseColor.rgb,uSecondary,r*.3);
   diffuseColor.rgb=mix(uTertiary,scaleColor*(.88+.14*fine+.1*dome),scute);
   vec3 microHide=hideGrain(pp*7.);
   diffuseColor.rgb*=1.-microHide.y*.07;
   surfaceHeight=(scute*(.0012+dome*.003)+(microHide.x-.5)*.00035*scute+(wrinkle-.5)*.0004*(1.-scute))*uGrain;
 }
 if(uType==31 || uType==32 || uType==33 || uType==36){
   // One complete UV surface per existing mesh. Never discard or stamp a silhouette.
   vec2 uv=vProcUv;float y=clamp(uv.y,0.,1.),x=uv.x-.5;
   float aa=max(length(fwidth(uv)),.0001);
   vec2 cellUV=uv*vec2(uCellScale,uCellScale*1.5);
   cellUV+=vec2(noise3(vec3(uv*11.,uSurfaceSeed)),noise3(vec3(uv*13.,19.)))*.5;
   if(uType==36){cellUV=uv*vec2(floor(uCellScale+.5),uCellScale*1.5);cellUV+=vec2(noise3(bioCylinder(uv,vec2(11.),uSurfaceSeed)),noise3(bioCylinder(uv,vec2(13.),19.)))*.5;}
   vec4 cells=bioCellAt(cellUV,uSurfaceSeed,uType==36?floor(uCellScale+.5):0.);
   float cellAA=max(length(fwidth(cellUV)),.001);
   float cellWall=1.-smoothstep(.025,.07+cellAA,cells.y);
   float cellsResolved=1.-smoothstep(.3,1.25,cellAA);
   float micro=(.65-cellWall*.18+cells.z*.08)*cellsResolved;
   float pigment=uType==36?stoneFBM(bioCylinder(uv,vec2(8.),uSurfaceSeed)):stoneFBM(vec3(uv*8.,uSurfaceSeed*.1));
   if(uType==31){
     float midWidth=mix(.011,.0025,y);
     float midrib=1.-smoothstep(midWidth-aa*.5,midWidth+aa*.5,abs(x));
     float branch=y*uScale-(abs(x)+x*.07)*uScale*.55+sin(abs(x)*7.+y*2.)*.14+.16*noise3(vec3(y*5.,abs(x)*4.,uSurfaceSeed))+step(0.,x)*.23;
     float ba=max(fwidth(branch)*.5,.003);
     float veinWidth=mix(.026,.008,smoothstep(0.,.45,abs(x)));
     float vein=1.-smoothstep(max(0.,veinWidth-ba),veinWidth+ba,abs(fract(branch)-.5));
     vein*=smoothstep(.008,.035,abs(x))*(1.-smoothstep(.39,.5,abs(x)));
     float tertiary=1.-smoothstep(.02,.09+ba*2.,abs(fract(branch*3.+abs(x)*7.)-.5));
     float veins=max(midrib,vein*.58);
     float aged=smoothstep(.4,.85,pigment+y*.25)*uColorGradient;
     diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary,aged*.7)*(.86+pigment*.23);
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,veins*.43+tertiary*.025);
     diffuseColor.rgb*=1.-cellWall*.045*cellsResolved;
     surfaceHeight=(veins*.002+tertiary*.00012)*uVeinRelief+micro*uCellRelief*.00035;
   }
   if(uType==32){
     float ribCoord=uv.x*uPlantRibs+.08*sin(y*8.);
     float ribs=sin(ribCoord*6.2831853)*.5+.5;
     ribs=mix(.5,ribs,1.-smoothstep(.4,1.,fwidth(ribCoord)));
     float center=exp(-abs(x)*55.);
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,pow(y,1.6)*uColorGradient)*(.82+pigment*.22+ribs*.08);
     surfaceHeight=(ribs*.0009+center*.0012)*uVeinRelief+micro*uCellRelief*.0002;
   }
   if(uType==33){
     float gradient=smoothstep(.03,max(.12,uColorGradient),y);
     float veinCoord=x*(12.+y*18.)+.32*noise3(vec3(uv*5.,uSurfaceSeed));
     float vAA=max(fwidth(veinCoord),.005);
     float veins=1.-smoothstep(.016,.09+vAA,abs(fract(veinCoord)-.5));
     float flecks=smoothstep(.68,.86,noise3(vec3(uv*vec2(52.,95.),uSurfaceSeed)))*uSpotDensity*(1.-smoothstep(.2,.7,y));
     diffuseColor.rgb=mix(uSecondary,diffuseColor.rgb,gradient)*(.93+pigment*.1);
     diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary,flecks*.8);
     diffuseColor.rgb*=1.-veins*.055-cellWall*.025*cellsResolved;
     surfaceHeight=veins*uVeinRelief*.00055+micro*uCellRelief*.0003;
   }
   if(uType==36){
     float fibers=noise3(bioCylinder(uv,vec2(uScale*4.,uScale*.3),uSurfaceSeed));
     float cork=smoothstep(.48,.8,pigment)*uColorGradient;
     float lenticels=smoothstep(.75,.91,noise3(bioCylinder(uv,vec2(95.,190.),uSurfaceSeed)))*uSpotDensity;
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,cork);
     diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary,lenticels*.8)*(.9+fibers*.15);
     surfaceHeight=(fibers-.5)*uVeinRelief*.002+micro*uCellRelief*.0002+lenticels*.0006;
   }
 }
 if(uType==34){
   vec2 uv=vProcUv;
   
   float pigment=stoneFBM(bioCylinder(uv,vec2(8.,3.),uSurfaceSeed));
   float around=floor(uScale*(uSkinMode>1.5?2.6:2.)+.5);
   vec2 poreUV=uv*vec2(around,uScale*(uSkinMode>1.5?.9:1.3));
   vec4 pore=bioCellAt(poreUV,uSurfaceSeed,around);
   float aa=max(length(fwidth(poreUV))*.5,.001);
   float resolved=1.-smoothstep(.35,1.3,aa);
   if(uSkinMode<.5){
     float stripes=noise3(bioCylinder(uv,vec2(55.,6.),uSurfaceSeed));
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,smoothstep(.36,.7,pigment+stripes*.12)*uColorGradient);
     float spots=(1.-smoothstep(.025,.065+aa,pore.x))*step(pore.z,uSpotDensity)*resolved;
     diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary,spots*.8);
     surfaceHeight=(noise3(bioCylinder(uv,vec2(160.),uSurfaceSeed))-.5)*uGrain*.00045-spots*.00025;
     bioPore=spots;
   }else if(uSkinMode<1.5){
     float pits=(1.-smoothstep(.09,.3+aa,pore.x))*resolved;
     diffuseColor.rgb*=.88+pigment*.24-pits*.065;
     surfaceHeight=(.35-pits)*uGrain*.003;
     bioPore=pits;
   }else{
     float pit=(1.-smoothstep(.11,.36+aa,pore.x))*resolved;
     float seed=(1.-smoothstep(.045,.13+aa,pore.x))*resolved;
     diffuseColor.rgb*=.83+pigment*.25;
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,seed*.92);
     surfaceHeight=(-pit*.005+seed*.004)*uGrain;
     bioPore=pit;
   }
 }
 if(uType==34){float cap=smoothstep(0.,.035,vProcUv.y)*(1.-smoothstep(.965,1.,vProcUv.y));surfaceHeight*=cap;bioPore*=cap;}
 if(uType==35){
   vec2 uv=vProcUv,q=uv*vec2(uPlantRibs,uScale);
   q.y+=floor(q.x)*.5;vec2 local=fract(q)-.5;
   float aa=max(length(fwidth(q)),.001);
   float areole=1.-smoothstep(.07,.18+aa,length(local*vec2(1.,.75)));
   float ribs=pow(.5+.5*cos((uv.x*uPlantRibs-.5)*6.2831853),.7);
   float wax=stoneFBM(bioCylinder(uv,vec2(12.),uSurfaceSeed));
   vec4 epidermis=bioCellAt(uv*vec2(floor(uCellScale+.5),uCellScale),uSurfaceSeed,floor(uCellScale+.5));
   float detail=1.-smoothstep(.3,1.3,length(fwidth(uv*uCellScale)));
   float wall=1.-smoothstep(.02,.08,epidermis.y);
   diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,wax*uColorGradient)*(.85+ribs*.15);
   float fuzz=noise3(bioCylinder(uv,vec2(240.,370.),uSurfaceSeed));
   float cork=1.-smoothstep(.035,.07+aa,length(local*vec2(1.,.75)));
   diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary*(.72+fuzz*.45),areole*.78);
   diffuseColor.rgb*=1.-cork*.13;
   surfaceHeight=(ribs*.004+areole*.001)*uVeinRelief-wall*uCellRelief*.0002*detail;
   bioPore=areole;
 }
`;
}
