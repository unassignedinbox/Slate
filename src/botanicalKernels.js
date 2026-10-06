// Analytic fields only: shared by live rendering, PNG baking and JS export.
export function botanicalGLSL() {
  return `
 uniform float uCellLobing,uStomataDensity;
 uniform float uVeinRelief,uCellScale,uCellRelief,uColorGradient,uSpotDensity,uSkinMode,uPlantRibs;
 float bioJoint=0.,bioPore=0.,leatherGrain=0.,leatherFold=0.;
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
 // Continuous rounded grain with sparse deeper folds. No colored cell outlines.
 vec3 hideGrain(vec3 p){
   vec3 q=p*uScale;
   vec3 warp=vec3(noise3(q*.63),noise3(q*.63+11.),noise3(q*.63+43.));
   vec3 fineQ=q*2.7+warp*2.3;
   float coarse=noise3(fineQ);
   float fine=noise3(fineQ*2.31+9.);
   float rounded=smoothstep(.18,.84,coarse*.8+fine*.2);
   float creaseField=noise3(q*.46+warp*.42);
   float aa=max(fwidth(creaseField),.002);
   float furrow=exp(-pow((creaseField-.5)/max(.028,aa),2.));
   furrow*=smoothstep(.32,.72,noise3(q*.37+21.));
   float pores=smoothstep(.7,.86,noise3(q*vec3(9.,13.,9.)));
   float resolved=1.-smoothstep(.4,1.4,length(fwidth(fineQ)));
   float poreResolved=1.-smoothstep(.4,1.4,length(fwidth(q*11.)));
   float h=.42+rounded*.47-furrow*.19;
   return vec3(mix(.64,h,resolved)-pores*.09*poreResolved,furrow*resolved,pores*poreResolved);
 }
 // Distance to a shared, jittered lattice line. Adjacent plates share this
 // same crease rather than owning separate inset borders with empty corners.
 vec3 leatherCoordinate(float coordinate,float seed){
   float base=floor(coordinate),lo=-1e20,hi=1e20,interval=base;
   for(int i=-1;i<=2;i++){
     float line=base+float(i);
     float edge=line+(hash31(vec3(line,seed,uSurfaceSeed))-.5)*.25;
     if(edge<=coordinate && edge>lo){lo=edge;interval=line;}
     if(edge>coordinate)hi=min(hi,edge);
   }
   return vec3(min(coordinate-lo,hi-coordinate),interval,(coordinate-lo)/max(hi-lo,.001));
 }

`;
}
export function botanicalColor() {
  return `
 if(uType==30){
   // A continuous hide, depressed along soft shared crease lines; no tile mask.
   vec2 raw=surfaceUV(pp,weights)*uScale;
   vec2 uv=raw+vec2(noise3(vec3(raw*.62,uSurfaceSeed)),noise3(vec3(raw*.62,uSurfaceSeed+19.)))*.18;
   float flank=smoothstep(.45,.95,abs(sin(raw.x*.16)));
   uv.x-=.75*sin(uv.x*.38);
   uv.y*=mix(1.13,1.6,flank);
   uv.y+=.065*sin(raw.x*2.2)+.018*sin(raw.x*8.3+raw.y*.7);
   vec3 yCell=leatherCoordinate(uv.y,19.);
   float row=yCell.y;
   float rowDrift=(hash31(vec3(row,17.,uSurfaceSeed))-.5)*.2;
   float dy=yCell.x;
   vec3 xCell=leatherCoordinate(uv.x+rowDrift+.025*sin(uv.y*9.),37.+row*3.9);
   float dx=xCell.x;
   // Squared-corner shared network with a soft blend where folds intersect.
   float d=max(0.,smoothMinimum(dx,dy,.022));
   float aa=max(length(fwidth(raw))*.32,.00015);
   float w=max(uGroutWidth,aa*.6);
   float crease=exp(-pow(d/max(w*1.4,aa),2.));
   float shoulder=exp(-pow(d/max(w*3.5,aa),2.));
   float vertical=exp(-dx/.08),horizontal=exp(-dy/.08);
   float folds=mix(noise3(vec3(raw*vec2(38.,13.),uSurfaceSeed)),noise3(vec3(raw*vec2(12.,47.),uSurfaceSeed+23.)),vertical/max(vertical+horizontal,.0001))-.5;
   folds*=1.-smoothstep(.4,1.5,length(fwidth(raw*38.)));
   float fine=noise3(vec3(raw*19.,uSurfaceSeed));
   float wrinkles=noise3(vec3(uv*vec2(5.,26.),uSurfaceSeed));
   vec2 cell=vec2(xCell.y,yCell.y),local=vec2(xCell.z,yCell.z);
   float r=hash31(vec3(cell,uSurfaceSeed));
   vec2 poreAt=vec2(.35+.3*r,.7+.08*sin(r*17.));
   float poreRadius=mix(.006,.013,r);
   float pore=exp(-pow(length(local-poreAt)/max(poreRadius,aa),2.))*min(1.,poreRadius/aa)*step(r,uPoreDensity);
   float resolved=1.-smoothstep(.3,1.1,length(fwidth(raw)));
   bioJoint=shoulder*resolved;
   leatherGrain=fine;leatherFold=crease*resolved;
   float mottling=stoneFBM(vec3(raw*.48,uSurfaceSeed));
   vec3 dye=mix(diffuseColor.rgb,uSecondary,.06+mottling*.15);
   // Narrow dye accumulation, not a dark painted grout strip.
   diffuseColor.rgb=mix(dye,uTertiary,crease*.12*resolved)*(.97+fine*.045-pore*.035);
   float crown=noise3(vec3(raw*vec2(2.,3.),31.))*.0002;
   surfaceHeight=(crown-crease*.00105-shoulder*.00038+folds*shoulder*.00026+(fine-.5)*.00010+(wrinkles-.5)*shoulder*.00012-pore*.00025)*uGrain*resolved;
 }

 if(uType==31 || uType==32 || uType==33 || uType==36){
   // One complete UV surface per existing mesh. Never discard or stamp a silhouette.
   vec2 uv=vProcUv;float y=clamp(uv.y,0.,1.),x=uv.x-.5;
   float aa=max(length(fwidth(uv)),.0001);
   vec2 cellUV=uv*vec2(uCellScale,uCellScale*1.5);
   cellUV+=vec2(noise3(vec3(uv*11.,uSurfaceSeed)),noise3(vec3(uv*13.,19.)))*.5;
   if(uType==36){cellUV=uv*vec2(floor(uCellScale+.5),uCellScale*1.5);cellUV+=vec2(noise3(bioCylinder(uv,vec2(11.),uSurfaceSeed)),noise3(bioCylinder(uv,vec2(13.),19.)))*.5;}
   if(uType==31){
     vec2 domain=cellUV;
     cellUV+=uCellLobing*.24*vec2(sin(domain.y*5.5+sin(domain.x*3.7)),sin(domain.x*5.1+sin(domain.y*4.3)));
   }
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
     // Sparse elliptical stomatal pores, kept microscopic rather than painted spots.
     vec2 stUV=uv*vec2(uCellScale*.31,uCellScale*.42);
     vec2 stId=floor(stUV),stLocal=fract(stUV)-.5;
     float stRandom=hash31(vec3(stId,uSurfaceSeed));
     float stAA=max(length(fwidth(stUV)),.001);
     float stomata=(1.-smoothstep(.09,.15+stAA,length(stLocal*vec2(1.5,.7))))*step(stRandom,uStomataDensity)*cellsResolved;
     float guard=exp(-pow((length(stLocal*vec2(1.5,.7))-.2)/max(.07,stAA),2.))*step(stRandom,uStomataDensity)*cellsResolved;
     surfaceHeight=(veins*.002+tertiary*.00012)*uVeinRelief+(micro*.00035-stomata*.00032+guard*.0001)*uCellRelief;
     diffuseColor.rgb*=1.-stomata*.025;
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
     // Papillate cell caps and filtered cuticular ridges; not leaf-like cell walls.
     float cone=pow(max(0.,1.-cells.x/.58),1.3)*cellsResolved;
     float ridgePhase=cellUV.x*27.+cellUV.y*9.;
     float ridge=sin(ridgePhase)*(1.-smoothstep(.7,2.8,fwidth(ridgePhase)));
     surfaceHeight=veins*uVeinRelief*.00055+(cone*.00045+ridge*cone*.000045)*uCellRelief;
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
     float glandRadius=mix(.2,.34,pore.z);
     float pits=(1.-smoothstep(.055,glandRadius+aa,pore.x))*resolved;
     diffuseColor.rgb*=.88+pigment*.24-pits*.065;
     float rind=noise3(bioCylinder(uv,vec2(around*2.,uScale*2.),uSurfaceSeed));
     surfaceHeight=((.35-pits)*.003+(rind-.5)*.00055)*uGrain;
     bioPore=pits;
   }else{
     float pit=(1.-smoothstep(.11,.36+aa,pore.x))*resolved;
     float seed=(1.-smoothstep(.045,.13+aa,pore.x))*resolved;
     diffuseColor.rgb*=.83+pigment*.25;
     diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,seed*.92);
     float seedDome=exp(-pow(pore.x/.13,2.))*resolved;
     surfaceHeight=(-pit*.005+seedDome*.004)*uGrain;
     bioPore=pit;
   }
 }
 if(uType==34){float cap=smoothstep(0.,.035,vProcUv.y)*(1.-smoothstep(.965,1.,vProcUv.y));surfaceHeight*=cap;bioPore*=cap;}
 if(uType==35){
   vec2 uv=vProcUv,q=uv*vec2(uPlantRibs,uScale);
   q.y+=floor(q.x)*.5;vec2 local=fract(q)-.5;
   vec2 areoleId=floor(q);areoleId.x=mod(areoleId.x,uPlantRibs);
   float areoleRandom=hash31(vec3(areoleId,uSurfaceSeed));
   local-=vec2((areoleRandom-.5)*.055,(hash31(vec3(areoleId,29.))-.5)*.12);
   float aa=max(length(fwidth(q)),.001);
   float areoleRadius=mix(.13,.19,areoleRandom);
   float areole=1.-smoothstep(.04,areoleRadius+aa,length(local*vec2(1.,.75)));
   float ribs=pow(.5+.5*cos((uv.x*uPlantRibs-.5)*6.2831853),.7);
   float wax=stoneFBM(bioCylinder(uv,vec2(12.),uSurfaceSeed));
   vec4 epidermis=bioCellAt(uv*vec2(floor(uCellScale+.5),uCellScale),uSurfaceSeed,floor(uCellScale+.5));
   float detail=1.-smoothstep(.3,1.3,length(fwidth(uv*uCellScale)));
   float wall=1.-smoothstep(.02,.08,epidermis.y);
   diffuseColor.rgb=mix(diffuseColor.rgb,uSecondary,wax*uColorGradient)*(.85+ribs*.15);
   float fuzz=noise3(bioCylinder(uv,vec2(240.,370.),uSurfaceSeed));
   float angle=atan(local.y+.000001,local.x+.000001);
   float filamentPhase=angle*19.+length(local)*75.;
   float filaments=(.5+.5*sin(filamentPhase))*(1.-smoothstep(.7,3.,fwidth(filamentPhase)));
   float felt=areole*(.62+.22*fuzz+.16*filaments);
   float cork=1.-smoothstep(.025,.055+aa,length(local*vec2(1.,.75)));
   diffuseColor.rgb=mix(diffuseColor.rgb,uTertiary*(.88+filaments*.18),felt*.9);
   diffuseColor.rgb*=1.-cork*.13;
   surfaceHeight=(ribs*.004+felt*.0014)*uVeinRelief-wall*uCellRelief*.0002*detail;
   bioPore=areole;
 }
`;
}
