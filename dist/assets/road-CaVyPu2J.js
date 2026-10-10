import"./modulepreload-polyfill-P2Xu9kJm.js";var e=(e=0,t=0,n=0)=>({x:e,y:t,z:n}),t=(e,t)=>({x:e.x+t.x,y:e.y+t.y,z:e.z+t.z}),n=(e,t)=>({x:e.x-t.x,y:e.y-t.y,z:e.z-t.z}),r=(e,t)=>({x:e.x*t,y:e.y*t,z:e.z*t}),i=(e,t)=>e.x*t.x+e.y*t.y+e.z*t.z,a=(e,t)=>({x:e.y*t.z-e.z*t.y,y:e.z*t.x-e.x*t.z,z:e.x*t.y-e.y*t.x}),o=e=>Math.hypot(e.x,e.y,e.z),s=(e,t)=>Math.hypot(e.x-t.x,e.y-t.y,e.z-t.z),c=e=>{let t=o(e)||1;return{x:e.x/t,y:e.y/t,z:e.z/t}},l=(e,t,n)=>e<t?t:e>n?n:e,u=(e,t,n)=>e+(t-e)*n,d=(e,t,n)=>{let r=l((n-e)/(t-e||1e-9),0,1);return r*r*(3-2*r)},f=e=>Math.atan2(e.z,e.x),p=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);function m(e,t,n=p()){for(let r=0;r<4;r++)for(let i=0;i<4;i++)n[r*4+i]=e[i]*t[r*4]+e[4+i]*t[r*4+1]+e[8+i]*t[r*4+2]+e[12+i]*t[r*4+3];return n}function h(e,t,n,r){let i=1/Math.tan(e/2),a=p();return a[0]=i/t,a[5]=i,a[10]=r/(n-r),a[11]=-1,a[14]=r*n/(n-r),a[15]=0,a}function g(e,t,r){let o=c(n(t,e)),s=c(a(o,r)),l=a(s,o),u=p();return u[0]=s.x,u[4]=s.y,u[8]=s.z,u[1]=l.x,u[5]=l.y,u[9]=l.z,u[2]=-o.x,u[6]=-o.y,u[10]=-o.z,u[12]=-i(s,e),u[13]=-i(l,e),u[14]=i(o,e),u}function _(e){let t=p(),n=e[0],r=e[1],i=e[2],a=e[3],o=e[4],s=e[5],c=e[6],l=e[7],u=e[8],d=e[9],f=e[10],m=e[11],h=e[12],g=e[13],_=e[14],v=e[15],y=n*s-r*o,b=n*c-i*o,x=n*l-a*o,S=r*c-i*s,C=r*l-a*s,w=i*l-a*c,T=u*g-d*h,E=u*_-f*h,D=u*v-m*h,O=d*_-f*g,k=d*v-m*g,A=f*v-m*_,j=y*A-b*k+x*O+S*D-C*E+w*T;return j?(j=1/j,t[0]=(s*A-c*k+l*O)*j,t[1]=(i*k-r*A-a*O)*j,t[2]=(g*w-_*C+v*S)*j,t[3]=(f*C-d*w-m*S)*j,t[4]=(c*D-o*A-l*E)*j,t[5]=(n*A-i*D+a*E)*j,t[6]=(_*x-h*w-v*b)*j,t[7]=(u*w-f*x+m*b)*j,t[8]=(o*k-s*D+l*T)*j,t[9]=(r*D-n*k-a*T)*j,t[10]=(h*C-g*x+v*y)*j,t[11]=(d*x-u*C-m*y)*j,t[12]=(s*E-o*O-c*T)*j,t[13]=(n*O-r*E+i*T)*j,t[14]=(g*b-h*S-_*y)*j,t[15]=(u*S-d*b+f*y)*j,t):t}function v(e,t){let n=e[3]*t.x+e[7]*t.y+e[11]*t.z+e[15]||1;return{x:(e[0]*t.x+e[4]*t.y+e[8]*t.z+e[12])/n,y:(e[1]*t.x+e[5]*t.y+e[9]*t.z+e[13])/n,z:(e[2]*t.x+e[6]*t.y+e[10]*t.z+e[14])/n}}function y(e,t){let n=Math.imul(e|0,374761393)+Math.imul(t|0,668265263);return n=Math.imul(n^n>>>13,1274126177),((n^n>>>16)>>>0)/4294967295}function b(e){let t=Math.floor(e),n=e-t,r=n*n*(3-2*n);return u(y(t,0),y(t+1,0),r)*2-1}function x(e,t=4){let n=.5,r=0,i=1;for(let a=0;a<t;a++)r+=b(e*i+a*17.3)*n,n*=.5,i*=2;return r}var S={ASPHALT:0,GUTTER:1,KERB_FACE:2,FOOTWAY:3,VERGE:4,SHOULDER:5,MEDIAN:6,KERB_TOP:7},C=(e,t,n,r=0,i=!1)=>({u:e,h:t,mat:n,div:r,crease:i});function w(e,t,n={}){let r=n.lanes??1,i=n.laneWidth??3.5,a=n.footway??2.4,o=n.kerb??.14,s=n.median??0,c=n.shoulder??0,l=n.crossfall??.025,u=.3,d=r*i+s/2+c,f=Math.max(.5,d-u-s/2),p=f*l,m=Math.max(1,Math.round(f/1.3)),h=Math.max(1,Math.round(a/1.2)),g=Math.max(1,Math.round(s/1.5)),_=[];a>0?(_.push(C(-(d+a),o+a*.02,S.FOOTWAY,h,!0)),_.push(C(-d,o,S.KERB_FACE,0,!0)),_.push(C(-d,0,S.GUTTER,0,!0))):c>0?(_.push(C(-(d+1.6),-.35,S.VERGE,2,!0)),_.push(C(-d,0,S.SHOULDER,0,!0))):(_.push(C(-(d+.9),-.08,S.VERGE,1,!0)),_.push(C(-d,0,S.ASPHALT,0,!0))),_.push(C(-d+u,-.012,S.ASPHALT,m,!0)),s>0?(_.push(C(-s/2,p,S.KERB_FACE,0,!1)),_.push(C(-s/2,p+o,S.MEDIAN,g,!0)),_.push(C(s/2,p+o,S.KERB_FACE,0,!0)),_.push(C(s/2,p,S.ASPHALT,m,!0))):_.push(C(0,p,S.ASPHALT,m,!1)),_.push(C(d-u,-.012,S.GUTTER,0,!0)),a>0?(_.push(C(d,0,S.KERB_FACE,0,!0)),_.push(C(d,o,S.FOOTWAY,h,!0)),_.push(C(d+a,o+a*.02,S.FOOTWAY,0,!0))):c>0?(_.push(C(d,0,S.SHOULDER,2,!0)),_.push(C(d+1.6,-.35,S.VERGE,0,!0))):(_.push(C(d,0,S.VERGE,1,!0)),_.push(C(d+.9,-.08,S.VERGE,0,!0)));let v=[];for(let e=0;e<r;e++){let t=s/2+c+(e+.5)*i;v.push(-t,t)}return{id:e,label:t,pts:_,carriageHalf:d,totalHalf:d+(a>0?a:c>0?1.6:.9),laneOffsets:v,kerbH:o,lanes:r,laneWidth:i,footway:a,kerbRadius:n.kerbRadius??(r>1?9:6)}}var T={lane:w(`lane`,`Service lane`,{lanes:1,laneWidth:2.9,footway:1.5,kerb:.11,kerbRadius:4}),street:w(`street`,`Local street`,{lanes:1,laneWidth:3.2,footway:2.4,kerbRadius:6}),avenue:w(`avenue`,`Avenue, 2+2`,{lanes:2,laneWidth:3.4,footway:3,kerbRadius:9}),boulevard:w(`boulevard`,`Boulevard, 2+2 median`,{lanes:2,laneWidth:3.4,footway:3.2,median:4,kerbRadius:10}),motorway:w(`motorway`,`Motorway, 3+3`,{lanes:3,laneWidth:3.65,footway:0,median:3,shoulder:3,kerb:0,kerbRadius:14})},E=Object.keys(T),D=class i{nodes=new Map;edges=new Map;nextN=1;nextE=1;revision=0;addNode(e,t=!0){let n={id:this.nextN++,p:e,edges:[],junction:t,signals:!1};return this.nodes.set(n.id,n),this.revision++,n}addEdge(e,t,n=`street`){let r={id:this.nextE++,a:e,b:t,ha:.34,hb:.34,da:null,db:null,profile:n,features:[],level:0,bridge:!1,tunnel:!1};return this.edges.set(r.id,r),this.nodes.get(e).edges.push(r.id),this.nodes.get(t).edges.push(r.id),this.revision++,r}removeEdge(e){let t=this.edges.get(e);if(t){for(let n of[this.nodes.get(t.a),this.nodes.get(t.b)])n&&(n.edges=n.edges.filter(t=>t!==e));this.edges.delete(e),this.revision++}}profileOf(e){return T[e.profile]??T.street}outDir(t,r){let i=this.edges.get(r),a=i.a===t,o=a?i.da:i.db;if(o)return c(e(o.x,0,o.z));let s=this.nodes.get(t);if(s.edges.length===2&&s.junction!==!1){let n=s.edges.find(e=>e!==r);if(n!==void 0){let i=e=>{let n=this.edges.get(e);return this.nodes.get(n.a===t?n.b:n.a).p},a=i(r),o=i(n),s=c(e(a.x-o.x,0,a.z-o.z));if(Number.isFinite(s.x))return s}}let l=this.nodes.get(i.a).p,u=this.nodes.get(i.b).p,d=a?n(u,l):n(l,u);return c(e(d.x,0,d.z))}fan(e){return this.nodes.get(e).edges.map(t=>{let n=this.outDir(e,t);return{edge:t,dir:n,ang:f(n)}}).sort((e,t)=>e.ang-t.ang)}bezier(e){let n=this.nodes.get(e.a).p,i=this.nodes.get(e.b).p,a=s(n,i),o=this.outDir(e.a,e.id),c=this.outDir(e.b,e.id);return[n,t(n,r(o,a*e.ha)),t(i,r(c,a*e.hb)),i]}static evalBezier(t,n){let r=1-n,i=r*r*r,a=3*r*r*n,o=3*r*n*n,s=n*n*n;return e(t[0].x*i+t[1].x*a+t[2].x*o+t[3].x*s,t[0].y*i+t[1].y*a+t[2].y*o+t[3].y*s,t[0].z*i+t[1].z*a+t[2].z*o+t[3].z*s)}static tangent(t,n){let r=1-n;return c(e(3*r*r*(t[1].x-t[0].x)+6*r*n*(t[2].x-t[1].x)+3*n*n*(t[3].x-t[2].x),3*r*r*(t[1].y-t[0].y)+6*r*n*(t[2].y-t[1].y)+3*n*n*(t[3].y-t[2].y),3*r*r*(t[1].z-t[0].z)+6*r*n*(t[2].z-t[1].z)+3*n*n*(t[3].z-t[2].z)))}arcTable(e,t=96){let n=this.bezier(e),r=[0],a=i.evalBezier(n,0),o=0;for(let e=1;e<=t;e++){let c=i.evalBezier(n,e/t);o+=s(a,c),r.push(o),a=c}return{s:r,total:o,c:n}}static tAt(e,t){let n=e.s.length-1,r=l(t,0,e.total),i=0,a=n;for(;i+1<a;){let t=i+a>>1;e.s[t]<=r?i=t:a=t}let o=e.s[a]-e.s[i]||1;return(i+(r-e.s[i])/o)/n}static right(t){return c(a(t,e(0,1,0)))}serialise(){return JSON.stringify({nodes:[...this.nodes.values()],edges:[...this.edges.values()]})}};function O(t={}){let n=t.cols??4,r=t.rows??3,i=t.block??86,a=t.jitter??7,o=t.seed??3,s=new D,c=[];for(let t=0;t<=r;t++){c[t]=[];for(let l=0;l<=n;l++){let u=(y(l+o*31,t)-.5)*2*a,d=(y(t+o*17,l+9)-.5)*2*a,f=(l-n/2)*i+u,p=(t-r/2)*i+d;c[t][l]=s.addNode(e(f,0,p)).id}}let l=Math.floor(r/2),u=Math.max(1,Math.floor(n/2));for(let e=0;e<=r;e++)for(let t=0;t<n;t++){let n=e===l?`avenue`:`street`,r=s.addEdge(c[e][t],c[e][t+1],n);r.ha=r.hb=e===l?.3:.26}for(let e=0;e<=n;e++)for(let t=0;t<r;t++){let n=e===u?`boulevard`:`street`,r=s.addEdge(c[t][e],c[t+1][e],n);r.ha=r.hb=.26}let d=s.addNode(e((0-n/2+.5)*i,0,(0-r/2+.5)*i));s.addEdge(c[0][0],d.id,`lane`),s.addEdge(d.id,c[1][1],`lane`);let f=s.addNode(e(n/2*i+62,0,(l-r/2)*i+6)),p=s.addNode(e(n/2*i+138,0,(l-r/2)*i-54)),m=s.addNode(e(n/2*i+138,0,(l-r/2)*i+58)),h=s.addEdge(c[l][n],f.id,`avenue`);h.ha=h.hb=.4;let g=s.addEdge(f.id,p.id,`street`);g.ha=.55,g.hb=.4;let _=s.addEdge(f.id,m.id,`street`);_.ha=.55,_.hb=.4;let v=11,b=()=>y(v++,o*7+3);for(let e of s.edges.values()){let t=s.profileOf(e);t.footway>0&&(e.features.push({kind:`crossing`,t:.12,size:4,seed:v++}),e.features.push({kind:`crossing`,t:.88,size:4,seed:v++})),e.profile===`street`&&b()>.55&&e.features.push({kind:`bump`,t:.4+b()*.2,size:3.7,seed:v++});let n=Math.floor(b()*3);for(let r=0;r<n;r++)e.features.push({kind:`pothole`,t:.2+b()*.6,size:.35+b()*.5,u:(b()-.5)*t.carriageHalf*1.2,seed:v++});b()>.88&&e.features.push({kind:`works`,t:.3+b()*.4,size:14,seed:v++})}for(let e of s.nodes.values())e.signals=e.edges.length>=4;return s}var k=class{verts=[];quads=[];tris=[];push(e){return this.verts.push(e),this.verts.length-1}quad(e,t,r,i){if(e===t||t===r||r===i||i===e||e===r||t===i)return;let o=this.verts,s=a(n(o[t].p,o[e].p),n(o[r].p,o[e].p)),c=a(n(o[r].p,o[e].p),n(o[i].p,o[e].p));(Math.hypot(s.x,s.y,s.z)+Math.hypot(c.x,c.y,c.z))/2<2e-5||this.quads.push(e,t,r,i)}strip(e,t,n){let r=Math.min(e.length,t.length);for(let i=0;i<r-1;i++)n[i]||this.quad(e[i],e[i+1],t[i+1],t[i])}get faceCount(){return this.quads.length/4+this.tris.length/3}get quadRatio(){let e=this.quads.length/4,t=this.tris.length/3;return e+t===0?1:e/(e+t)}computeNormals(){for(let t of this.verts)t.n=e(0,0,0);let i=(e,r,i)=>{let o=this.verts[e].p,s=this.verts[r].p,c=this.verts[i].p,l=a(n(s,o),n(c,o));for(let n of[e,r,i])this.verts[n].n=t(this.verts[n].n,l)};for(let e=0;e<this.quads.length;e+=4){let[t,n,r,a]=[this.quads[e],this.quads[e+1],this.quads[e+2],this.quads[e+3]];i(t,n,r),i(t,r,a)}for(let e=0;e<this.tris.length;e+=3)i(this.tris[e],this.tris[e+1],this.tris[e+2]);for(let t of this.verts){let n=Math.hypot(t.n.x,t.n.y,t.n.z);t.n=n>1e-9?r(t.n,1/n):e(0,1,0)}}toBuffers(){let e=new Float32Array(this.verts.length*16);this.verts.forEach((t,n)=>{let r=n*16;e[r]=t.p.x,e[r+1]=t.p.y,e[r+2]=t.p.z,e[r+3]=t.n.x,e[r+4]=t.n.y,e[r+5]=t.n.z,e[r+6]=t.u,e[r+7]=t.v,e[r+8]=t.mat,e[r+9]=t.kind,e[r+10]=t.half,e[r+11]=t.wear,e[r+12]=t.laneW,e[r+13]=t.lanes,e[r+14]=t.mark});let t=new Uint32Array(this.quads.length/4*6+this.tris.length),n=0;for(let e=0;e<this.quads.length;e+=4){let r=this.quads[e],i=this.quads[e+1],a=this.quads[e+2],o=this.quads[e+3];t[n++]=r,t[n++]=i,t[n++]=a,t[n++]=r,t[n++]=a,t[n++]=o}for(let e=0;e<this.tris.length;e++)t[n++]=this.tris[e];return{verts:e,idx:t}}},A=(t,n,r,i,a=0,o=0,s=0,c=3.5,l=1,u=0)=>({p:t,n:e(0,1,0),u:n,v:r,mat:i,kind:a,half:o,wear:s,laneW:c,lanes:l,mark:u}),j=new Map;function ee(e){let t=j.get(e.id);if(t)return t;let n=[],r=[],i=[],a=(e,t)=>{n.length>0&&r.push(t),n.push(e)};for(let t=0;t<e.pts.length-1;t++){let r=e.pts[t],o=e.pts[t+1];n.length===0?(i[t]=0,a({u:r.u,h:r.h,mat:r.mat},!1)):r.crease?(i[t]=n.length,a({u:r.u,h:r.h,mat:r.mat},!0)):i[t]=n.length-1;let s=Math.max(1,r.div+1);for(let e=1;e<=s;e++){let t=e/s;a({u:u(r.u,o.u,t),h:u(r.h,o.h,t),mat:r.mat},!1)}}i[e.pts.length-1]=n.length-1;let o=-1,s=-1;for(let e=0;e<n.length;e++)n[e].u<0&&Math.abs(n[e].h)<.002&&o<0&&(o=e),n[e].u>0&&Math.abs(n[e].h)<.002&&(s=e);o<0&&(o=0),s<0&&(s=n.length-1);let c={s:n,seam:r,iCarrL:o,iCarrR:s,iKerbL:Math.max(0,o-1),iKerbR:Math.min(n.length-1,s+1),iOutL:0,iOutR:n.length-1};return j.set(e.id,c),c}function te(a,o,s,l,u,d,f,p){let m=t(a,r(s,l)),h=n(a,r(d,f)),g=o.x*u.z-o.z*u.x;if(Math.abs(g)<1e-5)return{ta:0,tb:0,arc:[],ok:!1};let _=h.x-m.x,v=h.z-m.z,y=t(m,r(o,(_*u.z-v*u.x)/g)),b=Math.atan2(u.z,u.x)-Math.atan2(o.z,o.x);for(;b<=0;)b+=Math.PI*2;for(;b>Math.PI*2;)b-=Math.PI*2;let x=b/2,S=Math.sin(x);if(Math.abs(S)<1e-4)return{ta:0,tb:0,arc:[],ok:!1};let C=p/Math.tan(x),w=t(y,r(o,C)),T=t(y,r(u,C)),E=t(y,r(c(t(o,u)),p/S)),D=Math.atan2(w.z-E.z,w.x-E.x),O=Math.atan2(T.z-E.z,T.x-E.x)-D;for(;O>Math.PI;)O-=Math.PI*2;for(;O<-Math.PI;)O+=Math.PI*2;let k=Math.hypot(w.x-E.x,w.z-E.z),A=Math.max(2,Math.ceil(Math.abs(O)*k/.7)),j=[];for(let t=1;t<A;t++){let n=D+t/A*O;j.push(e(E.x+Math.cos(n)*k,0,E.z+Math.sin(n)*k))}let ee=i(n(w,a),o),te=i(n(T,a),u);return{ta:ee,tb:te,arc:j,ok:Number.isFinite(ee)&&Number.isFinite(te)}}function ne(e,t,n,r,i){let a=0;for(let o of e.features){let e=t-o.t*n;if(o.kind===`bump`){if(Math.abs(e)<o.size*.5){let t=e/(o.size*.5);a+=.085*Math.cos(t*Math.PI*.5)**2*l(1.1-Math.abs(r)/i,0,1)}}else if(o.kind===`pothole`){let t=o.u??0,n=Math.hypot(e,(r-t)*1.4);if(n<o.size){let e=1-n/o.size;a-=(.035+.02*y(o.seed,7))*e*e*(.7+.3*x(n*9+o.seed,3))}}else o.kind===`works`&&Math.abs(e)<o.size*.5&&(a-=.03+.012*x(t*2.2+o.seed,3))}return a}function re(e,t,n){for(let r of e.features){let e=Math.abs(t-r.t*n);if(r.kind===`crossing`&&e<r.size*.5)return 1;if(r.kind===`crossing`&&e<r.size*.5+1.6)return 2;if(r.kind===`works`&&e<r.size*.5)return 3}return 0}function ie(e,t,n,r){let i=0;for(let r of e.features){let e=Math.abs(t-r.t*n);r.kind===`works`&&e<r.size*.6&&(i=Math.max(i,1)),r.kind===`pothole`&&e<r.size*1.6&&(i=Math.max(i,.8))}return i}function ae(n,i={}){let a=i.step??2,o=i.flatten??9,s=new k,c=new Map,u=new Map,f=new Map,p=new Map,m=(e,t)=>`${e}:${t}`;for(let e of n.nodes.values()){let t=n.fan(e.id);for(let n of t)f.set(m(e.id,n.edge),0);if(t.length<2||t.length===2&&oe(n,t[0].edge,t[1].edge))continue;let r=[];for(let i=0;i<t.length;i++){let a=t[i],o=t[(i+1)%t.length];if(t.length===2&&i===1)break;let s=n.profileOf(n.edges.get(a.edge)),c=n.profileOf(n.edges.get(o.edge)),u=Math.min(s.kerbRadius,c.kerbRadius),d=D.right(a.dir),p=D.right(o.dir),h=te(e.p,a.dir,d,s.carriageHalf,o.dir,p,c.carriageHalf,u),g=s.carriageHalf*2+u*4,_=c.carriageHalf*2+u*4,v=h.ok?l(h.ta,s.carriageHalf*.6,g):s.carriageHalf*1.1,y=h.ok?l(h.tb,c.carriageHalf*.6,_):c.carriageHalf*1.1;f.set(m(e.id,a.edge),Math.max(f.get(m(e.id,a.edge)),v)),f.set(m(e.id,o.edge),Math.max(f.get(m(e.id,o.edge)),y)),r.push({line:h.arc,radius:u})}p.set(e.id,r)}for(let e of n.edges.values()){let t=n.arcTable(e),r=m(e.a,e.id),i=m(e.b,e.id),a=f.get(r)??0,o=f.get(i)??0,s=Math.min(t.total*.84,t.total-4);if(a+o>s&&s>0){let e=Math.max(.05,s/(a+o));a*=e,o*=e}f.set(r,a),f.set(i,o)}let h=new Map;for(let i of n.edges.values()){let c=n.profileOf(i),p=ee(c),g=n.arcTable(i),_=f.get(m(i.a,i.id)),v=f.get(m(i.b,i.id)),y=Math.max(1,g.total-_-v),b=Math.max(2,Math.round(y/a)),S=[],C=[],w=[];for(let n=0;n<=b;n++){let a=_+y*n/b,u=D.tAt(g,a),f=D.evalBezier(g.c,u),m=D.tangent(g.c,u),h=D.right(m),T=d(0,o,a-_),E=d(0,o,g.total-v-a),O=Math.min(T,E),k=[];for(let n=0;n<p.s.length;n++){let o=p.s[n],u=n>=p.iCarrL&&n<=p.iCarrR,d=u?o.h*O:o.h,m=u?ne(i,a,g.total,o.u,c.carriageHalf):0,_=t(t(f,r(h,o.u)),e(0,d+m,0)),v=l(.25+.5*Math.abs(o.u)/c.totalHalf+.25*x(a*.06+i.id*13.7,4)+ie(i,a,g.total,o.u),0,1);k.push(s.push(A(_,o.u,a,o.mat,0,c.carriageHalf,v,c.laneWidth,c.lanes,re(i,a,g.total))))}S.push(k);let j=c.laneOffsets[0]??-1.75;C.push(t(t(f,r(h,j)),e(0,.02,0))),w.push(t(t(f,r(h,-j)),e(0,.02,0)))}for(let e=0;e<b;e++)s.strip(S[e],S[e+1],p.seam);u.set(i.id,{left:C,right:w});let T=(e,t,r)=>{let a=n.outDir(e,i.id),o=h.get(e)??[];o.push({edge:i.id,node:e,dir:a,right:D.right(a),prof:c,exp:p,trim:e===i.a?_:v,ring:r?[...t].reverse():t}),h.set(e,o)};T(i.a,S[0],!1),T(i.b,S[b],!0)}let g=0;for(let e of n.nodes.values()){let t=h.get(e.id)??[];if(t.length<2)continue;if(t.length===2&&oe(n,t[0].edge,t[1].edge)){se(s,t[0],t[1]);continue}t.sort((e,t)=>Math.atan2(e.dir.z,e.dir.x)-Math.atan2(t.dir.z,t.dir.x)),ce(s,n,e,t),g++;let r=Math.max(...t.map(e=>e.trim+e.prof.totalHalf));c.set(e.id,{centre:e.p,radius:r})}return s.computeNormals(),{mesh:s,junctions:c,lanes:u,stats:{quads:s.quads.length/4,tris:s.tris.length/3,verts:s.verts.length,links:n.edges.size,junctions:g}}}function oe(e,t,n){return e.edges.get(t).profile===e.edges.get(n).profile}function se(e,t,n){let r=t.ring,i=[...n.ring].reverse(),a=Math.min(r.length,i.length);for(let n=0;n<a-1;n++)t.exp.seam[n]||e.quad(r[n],r[n+1],i[n+1],i[n])}function ce(n,i,a,o){let s=o.length,l=e=>n.verts[e].p,d=[],f=[],p=[];for(let i=0;i<s;i++){let m=o[i],h=o[(i+1)%s],g=m.exp,_=h.exp;for(let e=g.iCarrL;e<=g.iCarrR;e++)e>g.iCarrL&&g.seam[e-1]||(d.push(m.ring[e]),f.push(e===g.iCarrL?m.ring[g.iKerbL]:e===g.iCarrR?m.ring[g.iKerbR]:-1),p.push(e===g.iCarrL?m.ring[g.iOutL]:e===g.iCarrR?m.ring[g.iOutR]:-1));if(s===2&&i===1)break;let v=m.prof,y=h.prof,b=Math.min(v.kerbRadius,y.kerbRadius),x=te(a.p,m.dir,m.right,v.carriageHalf,h.dir,h.right,y.carriageHalf,b),C=m.ring[g.iCarrR],w=h.ring[_.iCarrL],T=l(C).y,E=l(w).y,D=x.ok?x.arc:[],O=v.kerbH,k=y.kerbH,j=v.footway,ee=y.footway;for(let i=0;i<D.length;i++){let o=(i+1)/(D.length+1),s=u(T,E,o),l=e(D[i].x,s,D[i].z),m=c(e(l.x-a.p.x,0,l.z-a.p.z)),h=u(O,k,o),g=u(j,ee,o),_=n.push(A(l,0,0,S.GUTTER,2,v.carriageHalf,.5));d.push(_);let y=n.push(A(t(l,e(0,h,0)),0,0,S.KERB_FACE,2,v.carriageHalf,.35));if(f.push(y),g>.05){let i=t(t(l,e(0,h+g*.02,0)),r(m,g));p.push(n.push(A(i,0,0,S.FOOTWAY,2,v.carriageHalf,.3)))}else p.push(-1)}}for(let e=0;e<d.length;e++){let t=(e+1)%d.length,r=f[e],i=f[t];if(r<0||i<0)continue;n.quad(d[e],d[t],i,r);let a=p[e],o=p[t];a>=0&&o>=0&&n.quad(r,i,o,a)}let m=d.length;if(m<4)return;let h=d.map(e=>l(e)),g=le(h);for(let e of d)g.y+=l(e).y/m;let _=[];for(let e=0;e<m;e++){let t=h[e],n=t.x-g.x,r=t.z-g.z,i=Math.hypot(n,r)||1e-6,a=n/i,o=r/i,s=i;for(let e=0;e<m;e++){let t=h[e],n=h[(e+1)%m],r=n.x-t.x,i=n.z-t.z,c=a*i-o*r;if(Math.abs(c)<1e-9)continue;let l=((t.x-g.x)*i-(t.z-g.z)*r)/c,u=((t.x-g.x)*o-(t.z-g.z)*a)/-c;l>1e-4&&u>1e-4&&u<.9999&&(s=Math.min(s,l))}_.push(Math.min(i,s*.985))}let v=d;for(let t of[.66,.4,.18]){let r=[],i=[],a=[];for(let e=0;e<m;e++){let n=h[e],o=n.x-g.x,s=n.z-g.z,c=Math.hypot(o,s)||1e-6,l=t*Math.min(_[e],c);r.push(g.x+o/c*l),i.push(g.z+s/c*l),a.push(u(g.y,n.y,t))}let o=Math.round((1-t)*16);for(let e=0;e<o;e++){let e=[...r],t=[...i];for(let n=0;n<m;n++){let a=(n+m-1)%m,o=(n+1)%m;r[n]=e[n]+((e[a]+e[o])*.5-e[n])*.55,i[n]=t[n]+((t[a]+t[o])*.5-t[n])*.55}}let s=[];for(let t=0;t<m;t++)s.push(n.push(A(e(r[t],a[t],i[t]),0,0,S.ASPHALT,1,8,.55)));for(let e=0;e<m;e++){let t=(e+1)%m;n.quad(v[e],v[t],s[t],s[e])}v=s}let y=n.push(A(g,0,0,S.ASPHALT,1,8,.6));if(m%2==0)for(let e=0;e<m;e+=2)n.quad(v[e],v[(e+1)%m],v[(e+2)%m],y);else{for(let e=0;e<m-1;e+=2)n.quad(v[e],v[e+1],v[(e+2)%m],y);n.tris.push(v[m-1],v[0],y)}}function le(t){let n=1/0,r=-1/0,i=1/0,a=-1/0;for(let e of t)n=Math.min(n,e.x),r=Math.max(r,e.x),i=Math.min(i,e.z),a=Math.max(a,e.z);let o=(e,n)=>{let r=!1;for(let i=0,a=t.length-1;i<t.length;a=i++){let o=t[i],s=t[a];o.z>n!=s.z>n&&e<(s.x-o.x)*(n-o.z)/(s.z-o.z)+o.x&&(r=!r)}return r},s=(e,n)=>{let r=1/0;for(let i=0,a=t.length-1;i<t.length;a=i++){let o=t[i],s=t[a],c=s.x-o.x,u=s.z-o.z,d=l(((e-o.x)*c+(n-o.z)*u)/(c*c+u*u||1e-9),0,1);r=Math.min(r,Math.hypot(e-(o.x+c*d),n-(o.z+u*d)))}return o(e,n)?r:-r},c=(n+r)/2,u=(i+a)/2,d=s(c,u),f=(r-n)/18,p=(a-i)/18;for(let e=0;e<=18;e++)for(let t=0;t<=18;t++){let r=n+f*e,a=i+p*t,o=s(r,a);o>d&&(d=o,c=r,u=a)}for(let e=0;e<3;e++){f*=.4,p*=.4;for(let e=-2;e<=2;e++)for(let t=-2;t<=2;t++){let n=c+f*e,r=u+p*t,i=s(n,r);i>d&&(d=i,c=n,u=r)}}return e(c,0,u)}var ue=`
struct Uniforms {
  vp    : mat4x4f,
  cam   : vec4f,
  sun   : vec4f,
  misc  : vec4f,          // time, mode, hoverNode, selNode
  tint  : vec4f,
  L     : array<vec4f, 16>,
};
@group(0) @binding(0) var<uniform> U : Uniforms;

struct VOut {
  @builtin(position) clip : vec4f,
  @location(0) wp   : vec3f,
  @location(1) nrm  : vec3f,
  @location(2) uv   : vec2f,
  @location(3) a    : vec4f,
  @location(4) b    : vec4f,
};

@vertex
fn vs(@location(0) p : vec3f,
      @location(1) n : vec3f,
      @location(2) uv : vec2f,
      @location(3) a : vec4f,
      @location(4) b : vec4f) -> VOut {
  var o : VOut;
  o.clip = U.vp * vec4f(p, 1.0);
  o.wp = p;
  o.nrm = n;
  o.uv = uv;
  o.a = a;
  o.b = b;
  return o;
}

fn hash21(q : vec2f) -> f32 {
  var p = fract(q * vec2f(0.1031, 0.1030));
  p = p + vec2f(dot(p, p.yx + 33.33));
  return fract((p.x + p.y) * p.x);
}

fn vnoise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p : vec2f, oct : i32) -> f32 {
  var s = 0.0;
  var amp = 0.5;
  var f = 1.0;
  for (var i = 0; i < oct; i = i + 1) {
    s = s + vnoise(p * f) * amp;
    amp = amp * 0.5;
    f = f * 2.03;
  }
  return s;
}

/** Worley-ish cell distance, for aggregate and for paving joints. */
fn cells(p : vec2f) -> vec2f {
  let ip = floor(p);
  let fp = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let g = vec2f(f32(x), f32(y));
      let o = vec2f(hash21(ip + g), hash21(ip + g + 7.31));
      let d = length(g + o - fp);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2f(d1, d2);
}

fn dashes(v : f32, period : f32, duty : f32) -> f32 {
  return step(fract(v / period), duty);
}

/** Painted markings, laid out from the real cross-section, not a texture. */
fn markings(uv : vec2f, a : vec4f, b : vec4f) -> f32 {
  let kind = a.y;
  let half = a.z;
  let laneW = b.x;
  let lanes = b.y;
  let mk = b.z;
  let u = uv.x;
  let v = uv.y;
  if (kind > 0.5) { return 0.0; }            // junction surface stays bare
  var m = 0.0;

  if (mk > 2.5) { return 0.0; }              // a works patch is unpainted
  if (mk > 0.5 && mk < 1.5) {                // zebra crossing
    let bars = step(fract(u / 1.3), 0.52);
    return bars * step(abs(u), half - 0.25);
  }
  if (mk > 1.5 && mk < 2.5) {                // stop bar
    return step(abs(u), half - 0.3);
  }

  // continuous edge line, 100 mm, set 250 mm off the channel
  m = max(m, 1.0 - smoothstep(0.045, 0.065, abs(abs(u) - (half - 0.3))));
  // centre line: double solid where there is more than one lane each way
  if (lanes > 1.5) {
    m = max(m, 1.0 - smoothstep(0.05, 0.07, abs(abs(u) - 0.09)));
  } else {
    let c = 1.0 - smoothstep(0.05, 0.07, abs(u));
    m = max(m, c * dashes(v, 12.0, 0.42));
  }
  // lane dividers
  for (var i = 1; i < 4; i = i + 1) {
    if (f32(i) >= lanes) { break; }
    let off = f32(i) * laneW;
    let d = 1.0 - smoothstep(0.05, 0.07, abs(abs(u) - off));
    m = max(m, d * dashes(v, 12.0, 0.35));
  }
  return m;
}

struct Surf { albedo : vec3f, rough : f32, ao : f32 };

fn surface(wp : vec3f, uv : vec2f, a : vec4f, b : vec4f) -> Surf {
  let mat = i32(a.x + 0.5);
  let wear = a.w;
  var col = vec3f(0.35);
  var rough = 0.85;
  var ao = 1.0;
  let xz = wp.xz;

  if (mat == 0 || mat == 1) {
    // ---- 0 asphalt base
    let L0 = U.L[0];
    let base = mix(vec3f(0.115, 0.118, 0.125), vec3f(0.30, 0.295, 0.285), L0.y);
    col = mix(col, base * mix(1.0, 1.08, L0.z), L0.x);
    rough = 0.92;

    // ---- 1 aggregate
    let L1 = U.L[1];
    if (L1.x > 0.001) {
      let c = cells(xz * (26.0 / max(L1.y, 0.05)));
      let stone = smoothstep(0.0, 0.55, c.y - c.x);
      let grain = fbm(xz * 46.0, 3);
      col = mix(col, col * (0.72 + 0.95 * stone) + vec3f(grain * 0.05), L1.x * L1.z);
      rough = rough - 0.08 * L1.x;
    }
    // ---- 2 binder bleed and old patches
    let L2 = U.L[2];
    if (L2.x > 0.001) {
      let patch = smoothstep(0.52, 0.60, fbm(xz * (0.06 / max(L2.y, 0.05)), 4));
      col = mix(col, col * mix(1.0, 0.62, L2.z), patch * L2.x);
      rough = mix(rough, 0.72, patch * L2.x);
    }
    // ---- 3 tyre polish in the wheel paths
    let L3 = U.L[3];
    if (L3.x > 0.001 && a.y < 0.5) {
      let laneW = max(b.x, 1.0);
      let lane = (abs(uv.x) % laneW) - laneW * 0.5;
      let path = exp(-pow(abs(abs(lane) - 0.85) / max(L3.y, 0.1), 2.0));
      col = col * (1.0 - 0.30 * path * L3.x * L3.z);
      rough = rough - 0.34 * path * L3.x * L3.z;
    }
    // ---- 4 cracking
    let L4 = U.L[4];
    if (L4.x > 0.001) {
      let c = cells(xz * (1.9 / max(L4.y, 0.05)));
      let seam = 1.0 - smoothstep(0.0, 0.045 + 0.05 * L4.z, c.y - c.x);
      let age = smoothstep(0.35, 0.95, wear * (0.5 + L4.z));
      col = mix(col, col * 0.45, seam * age * L4.x);
      ao = ao - 0.35 * seam * age * L4.x;
    }
    // ---- 5 markings
    let L5 = U.L[5];
    if (L5.x > 0.001) {
      let m = markings(uv, a, b);
      let dirt = 0.55 + 0.45 * (1.0 - L5.z * wear);
      let paint = vec3f(0.80, 0.79, 0.74) * L5.y * dirt;
      col = mix(col, paint, clamp(m, 0.0, 1.0) * L5.x);
      rough = mix(rough, 0.55, m * L5.x);
    }
    if (mat == 1) { col = col * 0.88; ao = ao * 0.82; }     // channel sits in shadow
  } else if (mat == 2 || mat == 7) {
    // ---- 6 kerb concrete
    let L6 = U.L[6];
    let c = mix(vec3f(0.30, 0.295, 0.285), vec3f(0.62, 0.615, 0.60), L6.y);
    let joint = 1.0 - smoothstep(0.0, 0.03, abs(fract(uv.y / 0.9) - 0.5) - 0.47);
    col = mix(vec3f(0.4), c, L6.x);
    col = col * (1.0 - 0.35 * joint);
    col = col * (1.0 - L6.z * 0.45 * smoothstep(0.3, 0.9, fbm(xz * 3.0, 3)));
    rough = 0.88;
    ao = 0.75;
  } else if (mat == 3) {
    // ---- 7 footway paving
    let L7 = U.L[7];
    let size = max(L7.z, 0.15);
    var q = xz / size;
    let pattern = i32(L7.y * 3.99);
    if (pattern == 1) {                      // stretcher bond
      let row = floor(q.y);
      q.x = q.x + 0.5 * (row % 2.0);
      q.y = q.y * 2.2;
    } else if (pattern == 2) {               // herringbone
      let r = vec2f(q.x + q.y, q.y - q.x) * 0.707;
      q = vec2f(r.x, r.y * 2.4);
    } else if (pattern == 3) {               // random ashlar
      q = q + vec2f(hash21(floor(q)) * 0.4, 0.0);
    }
    let cellv = fract(q) - 0.5;
    let joint = 1.0 - smoothstep(0.40, 0.48, max(abs(cellv.x), abs(cellv.y)));
    let unit = hash21(floor(q));
    let slab = mix(vec3f(0.38, 0.375, 0.365), vec3f(0.58, 0.565, 0.54), 0.35 + unit * 0.5);
    col = mix(vec3f(0.42), slab, L7.x);
    col = mix(col * 0.55, col, joint);
    col = col * (0.92 + 0.08 * fbm(xz * 22.0, 3));
    rough = 0.9;
    ao = mix(0.72, 1.0, joint);
  } else if (mat == 4 || mat == 6) {
    let g = fbm(xz * 1.4, 4);
    col = mix(vec3f(0.115, 0.165, 0.085), vec3f(0.22, 0.30, 0.135), g);
    rough = 0.98;
  } else if (mat == 5) {
    col = vec3f(0.26, 0.255, 0.25) * (0.8 + 0.4 * fbm(xz * 8.0, 3));
    rough = 0.95;
  } else if (mat == 9) {
    let g = fbm(xz * 0.35, 5);
    col = mix(vec3f(0.085, 0.105, 0.072), vec3f(0.15, 0.175, 0.11), g);
    rough = 1.0;
  }

  // ---- 8 grime, everywhere
  let L8 = U.L[8];
  if (L8.x > 0.001) {
    let g = fbm(xz * (0.9 / max(L8.y, 0.05)) + 11.0, 4);
    col = col * (1.0 - L8.x * L8.z * 0.45 * smoothstep(0.42, 0.85, g));
  }
  var s : Surf;
  s.albedo = col;
  s.rough = clamp(rough, 0.05, 1.0);
  s.ao = clamp(ao, 0.2, 1.0);
  return s;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  let mode = i32(U.misc.y + 0.5);
  var N = normalize(i.nrm);
  let Vv = normalize(U.cam.xyz - i.wp);
  if (dot(N, Vv) < 0.0) { N = -N; }

  if (mode == 2) {                                   // material view
    let m = i.a.x;
    var pal = array<vec3f, 10>(
      vec3f(0.18, 0.19, 0.22), vec3f(0.35, 0.45, 0.6), vec3f(0.85, 0.72, 0.35),
      vec3f(0.55, 0.52, 0.48), vec3f(0.25, 0.45, 0.22), vec3f(0.45, 0.42, 0.40),
      vec3f(0.30, 0.55, 0.32), vec3f(0.70, 0.62, 0.40), vec3f(0.5, 0.5, 0.5),
      vec3f(0.12, 0.15, 0.10));
    let c = pal[clamp(i32(m + 0.5), 0, 9)];
    return vec4f(c * (0.45 + 0.55 * max(dot(N, normalize(U.sun.xyz)), 0.0)), 1.0);
  }
  if (mode == 3) {                                   // topology view
    let k = i.a.y;
    var c = vec3f(0.22, 0.26, 0.32);
    if (k > 0.5 && k < 1.5) { c = vec3f(0.80, 0.55, 0.18); }
    if (k > 1.5) { c = vec3f(0.25, 0.60, 0.45); }
    return vec4f(c * (0.5 + 0.5 * max(dot(N, normalize(U.sun.xyz)), 0.0)), 1.0);
  }

  let s = surface(i.wp, i.uv, i.a, i.b);
  let Ld = normalize(U.sun.xyz);
  let ndl = max(dot(N, Ld), 0.0);

  // sky: a cheap two-lobe gradient, warm sun side, cool zenith
  let up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  let sky = mix(vec3f(0.16, 0.18, 0.21), vec3f(0.42, 0.52, 0.66), up);
  let bounce = vec3f(0.16, 0.15, 0.13) * (1.0 - up);

  var lit = s.albedo * (sky * s.ao + bounce * s.ao);
  lit = lit + s.albedo * U.sun.w * ndl * vec3f(1.0, 0.95, 0.86);

  // specular: wet or polished asphalt picks up a long highlight
  let H = normalize(Ld + Vv);
  let sh = pow(2.0 / max(s.rough * s.rough * s.rough * s.rough, 1e-4), 0.5);
  let spec = pow(max(dot(N, H), 0.0), max(sh, 1.0)) * (1.0 - s.rough) * 0.8;
  let L9 = U.L[9];
  var wet = 0.0;
  if (L9.x > 0.001) {
    wet = L9.x * smoothstep(0.55, 0.85, fbm(i.wp.xz * (0.7 / max(L9.y, 0.05)), 4));
    lit = lit * (1.0 - 0.45 * wet);
  }
  let fres = 0.04 + 0.5 * pow(1.0 - max(dot(N, Vv), 0.0), 5.0);
  lit = lit + vec3f(spec) * U.sun.w + sky * fres * (0.25 + wet * 1.6);

  // selection / hover tint comes in as a flat add
  lit = lit + U.tint.xyz * U.tint.w;

  let fog = 1.0 - exp(-length(U.cam.xyz - i.wp) * 0.0012);
  lit = mix(lit, vec3f(0.26, 0.30, 0.36), fog * 0.7);
  return vec4f(pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}

// ---- flat colour pipeline, for wireframe and gizmos
struct LOut { @builtin(position) clip : vec4f, @location(0) c : vec3f };

@vertex
fn vsLine(@location(0) p : vec3f, @location(1) c : vec3f) -> LOut {
  var o : LOut;
  o.clip = U.vp * vec4f(p, 1.0);
  o.clip.z = o.clip.z - 0.00004 * o.clip.w;      // pull wires towards the eye
  o.c = c;
  return o;
}

@fragment
fn fsLine(i : LOut) -> @location(0) vec4f {
  return vec4f(i.c, 1.0);
}
`,de=class{device;ctx;format;pipe;linePipe;ubo;bind;depth;msaa;sampleCount=4;uData=new Float32Array(128);static async supported(){return`gpu`in navigator?await navigator.gpu.requestAdapter()?null:`No WebGPU adapter. The browser knows the API but could not get a GPU.`:`navigator.gpu is missing — this build needs WebGPU (Chrome/Edge 113+, or Safari 18+).`}async init(e){let t=navigator.gpu,n=await t.requestAdapter({powerPreference:`high-performance`});if(!n)throw Error(`requestAdapter returned null`);this.device=await n.requestDevice(),this.device.lost.then(e=>console.error(`WebGPU device lost:`,e.message)),this.ctx=e.getContext(`webgpu`),this.format=t.getPreferredCanvasFormat(),this.ctx.configure({device:this.device,format:this.format,alphaMode:`opaque`}),this.device.pushErrorScope(`validation`);let r=this.device.createShaderModule({code:ue}),i=(await r.getCompilationInfo()).messages.filter(e=>e.type===`error`);if(i.length)throw Error(`WGSL compile error:
`+i.map(e=>`  line ${e.lineNum}:${e.linePos}  ${e.message}`).join(`
`));this.ubo=this.device.createBuffer({size:this.uData.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let a=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}}]});this.bind=this.device.createBindGroup({layout:a,entries:[{binding:0,resource:{buffer:this.ubo}}]});let o=this.device.createPipelineLayout({bindGroupLayouts:[a]});this.pipe=this.device.createRenderPipeline({layout:o,vertex:{module:r,entryPoint:`vs`,buffers:[{arrayStride:64,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`},{shaderLocation:2,offset:24,format:`float32x2`},{shaderLocation:3,offset:32,format:`float32x4`},{shaderLocation:4,offset:48,format:`float32x4`}]}]},fragment:{module:r,entryPoint:`fs`,targets:[{format:this.format}]},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:{format:`depth24plus`,depthWriteEnabled:!0,depthCompare:`less`},multisample:{count:this.sampleCount}}),this.linePipe=this.device.createRenderPipeline({layout:o,vertex:{module:r,entryPoint:`vsLine`,buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`}]}]},fragment:{module:r,entryPoint:`fsLine`,targets:[{format:this.format}]},primitive:{topology:`line-list`},depthStencil:{format:`depth24plus`,depthWriteEnabled:!1,depthCompare:`less-equal`},multisample:{count:this.sampleCount}});let s=await this.device.popErrorScope();if(s)throw Error(`WebGPU validation: `+s.message)}resize(e,t){let n=this.device;this.depth?.destroy(),this.msaa?.destroy(),this.depth=n.createTexture({size:[e,t],format:`depth24plus`,sampleCount:this.sampleCount,usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.msaa=n.createTexture({size:[e,t],format:this.format,sampleCount:this.sampleCount,usage:GPUTextureUsage.RENDER_ATTACHMENT})}upload(e,t){let n=this.device,r=n.createBuffer({size:e.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});n.queue.writeBuffer(r,0,e);let i=n.createBuffer({size:Math.max(4,t.byteLength),usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});return n.queue.writeBuffer(i,0,t),{vbo:r,ibo:i,count:t.length}}uploadLines(e){let t=this.device,n=t.createBuffer({size:Math.max(24,e.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(n,0,e),{vbo:n,count:e.length/6}}setUniforms(e,t,n,r,i,a){this.uData.set(e,0),this.uData.set(t,16),this.uData[19]=1,this.uData.set(n,20),this.uData.set(r,24),this.uData.set(i,28),this.uData.set(a.subarray(0,64),32),this.device.queue.writeBuffer(this.ubo,0,this.uData)}frame(e,t,n){let r=this.device.createCommandEncoder(),i=r.beginRenderPass({colorAttachments:[{view:this.msaa.createView(),resolveTarget:this.ctx.getCurrentTexture().createView(),clearValue:{r:n[0],g:n[1],b:n[2],a:1},loadOp:`clear`,storeOp:`store`}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`store`}});e&&e.count&&(i.setPipeline(this.pipe),i.setBindGroup(0,this.bind),i.setVertexBuffer(0,e.vbo),i.setIndexBuffer(e.ibo,`uint32`),i.drawIndexed(e.count)),t&&t.count&&(i.setPipeline(this.linePipe),i.setBindGroup(0,this.bind),i.setVertexBuffer(0,t.vbo),i.draw(t.count)),i.end(),this.device.queue.submit([r.finish()])}},M=e=>`${Math.round(e*100)}%`,fe=e=>`${e.toFixed(2)} m`;function pe(){return[{id:`asphalt`,name:`Asphalt base`,note:`AC 10 surf course`,on:!0,opacity:1,slot:0,params:[{key:`lightness`,label:`Lightness`,min:0,max:1,step:.01,fmt:M},{key:`warmth`,label:`Warmth`,min:0,max:1,step:.01,fmt:M}],values:[.3,.35,0]},{id:`aggregate`,name:`Exposed aggregate`,note:`chipping size and bite`,on:!0,opacity:1,slot:1,params:[{key:`size`,label:`Chipping size`,min:.2,max:2,step:.01,fmt:e=>`${(10/e).toFixed(0)} mm`},{key:`contrast`,label:`Contrast`,min:0,max:1,step:.01,fmt:M}],values:[1,.55,0]},{id:`patching`,name:`Patching & bleed`,note:`old reinstatements`,on:!0,opacity:.8,slot:2,params:[{key:`size`,label:`Patch size`,min:.2,max:3,step:.01,fmt:e=>`${(e*16).toFixed(0)} m`},{key:`darkness`,label:`Darkness`,min:0,max:1,step:.01,fmt:M}],values:[1,.6,0]},{id:`polish`,name:`Tyre polish`,note:`wheel-path burnish`,on:!0,opacity:1,slot:3,params:[{key:`width`,label:`Path width`,min:.1,max:1.2,step:.01,fmt:fe},{key:`strength`,label:`Strength`,min:0,max:1,step:.01,fmt:M}],values:[.42,.8,0]},{id:`cracking`,name:`Cracking`,note:`thermal and fatigue`,on:!0,opacity:.85,slot:4,params:[{key:`scale`,label:`Block size`,min:.2,max:3,step:.01,fmt:e=>`${(e*1.9).toFixed(1)} m`},{key:`age`,label:`Age`,min:0,max:1,step:.01,fmt:M}],values:[.8,.45,0]},{id:`markings`,name:`Road markings`,note:`thermoplastic`,on:!0,opacity:1,slot:5,params:[{key:`bright`,label:`Brightness`,min:0,max:1.4,step:.01,fmt:M},{key:`wear`,label:`Wear`,min:0,max:1,step:.01,fmt:M}],values:[1,.45,0]},{id:`kerb`,name:`Kerb concrete`,note:`precast HB2`,on:!0,opacity:1,slot:6,params:[{key:`lightness`,label:`Lightness`,min:0,max:1,step:.01,fmt:M},{key:`staining`,label:`Staining`,min:0,max:1,step:.01,fmt:M}],values:[.62,.5,0]},{id:`paving`,name:`Footway paving`,note:`pattern and unit size`,on:!0,opacity:1,slot:7,params:[{key:`pattern`,label:`Pattern`,min:0,max:.99,step:.33,fmt:e=>[`Slabs`,`Stretcher`,`Herringbone`,`Ashlar`][Math.min(3,Math.floor(e*4))]},{key:`unit`,label:`Unit size`,min:.15,max:1.2,step:.01,fmt:fe}],values:[.34,.45,0]},{id:`grime`,name:`Grime & staining`,note:`global dirt`,on:!0,opacity:.7,slot:8,params:[{key:`scale`,label:`Scale`,min:.2,max:3,step:.01,fmt:e=>`${(e*10).toFixed(0)} m`},{key:`strength`,label:`Strength`,min:0,max:1,step:.01,fmt:M}],values:[1,.6,0]},{id:`water`,name:`Standing water`,note:`ponding in the channel`,on:!1,opacity:.5,slot:9,params:[{key:`coverage`,label:`Coverage`,min:.1,max:2,step:.01,fmt:M},{key:`ripple`,label:`Ripple`,min:0,max:1,step:.01,fmt:M}],values:[.7,.3,0]}]}function me(e,t){t.fill(0);for(let n of e){let e=n.slot*4;t[e]=n.on?n.opacity:0,t[e+1]=n.values[0],t[e+2]=n.values[1],t[e+3]=n.values[2]}}var N=e=>document.getElementById(e),P=N(`view`),he=N(`fail`);function ge(e){he.hidden=!1,he.textContent=e,N(`gpu`).textContent=`no WebGPU`,N(`gpu`).classList.add(`bad`)}var F=O(),I,L=pe(),R=0,z=null,B=null,_e=null,V=`select`,ve=0,ye=new Float32Array(64),H={tgt:e(0,0,0),yaw:.7,pitch:.62,dist:230},U,be=null,xe=null,W=null;function G(){let e=performance.now();I=ae(F);let t=performance.now()-e,{verts:n,idx:r}=I.mesh.toBuffers(),i=2600,a=new Float32Array(64);[[-2600,-2600],[i,-2600],[i,i],[-2600,i]].forEach((e,t)=>{let n=t*16;a[n]=e[0],a[n+1]=-.09,a[n+2]=e[1],a[n+4]=0,a[n+5]=1,a[n+6]=0,a[n+8]=9});let o=new Float32Array(n.length+a.length);o.set(n),o.set(a,n.length);let s=n.length/16,c=new Uint32Array([s,s+1,s+2,s,s+2,s+3]),l=new Uint32Array(r.length+c.length);l.set(r),l.set(c,r.length),be?.vbo.destroy(),be?.ibo.destroy(),be=U.upload(o,l);let u=I.mesh.quads,d=new Float32Array(u.length*2*6),f=0;for(let e=0;e<u.length;e+=4)for(let t=0;t<4;t++){let n=I.mesh.verts[u[e+t]].p,r=I.mesh.verts[u[e+(t+1)%4]].p;d[f++]=n.x,d[f++]=n.y+.012,d[f++]=n.z,d[f++]=.12,d[f++]=.78,d[f++]=.72,d[f++]=r.x,d[f++]=r.y+.012,d[f++]=r.z,d[f++]=.12,d[f++]=.78,d[f++]=.72}xe?.vbo.destroy(),xe=U.uploadLines(d);let p=I.stats;N(`stats`).innerHTML=`<b>${p.quads.toLocaleString()}</b> quads · <b>${p.tris}</b> tris · <b>${(100*I.mesh.quadRatio).toFixed(2)}%</b> quad · <b>${p.verts.toLocaleString()}</b> verts · ${p.links} links · ${p.junctions} junctions · rebuilt in <b>${t.toFixed(0)} ms</b>`,q()}function K(){if(z===null){W?.vbo.destroy(),W=null;return}let i=F.nodes.get(z);if(!i){W=null;return}let a=[],o=(e,t,n)=>{a.push(e.x,e.y,e.z,n[0],n[1],n[2],t.x,t.y,t.z,n[0],n[1],n[2])},s=e(i.p.x,i.p.y+.3,i.p.z);o(s,t(s,e(9,0,0)),[.93,.33,.33]),o(s,t(s,e(0,6.3,0)),[.42,.92,.45]),o(s,t(s,e(0,0,9)),[.36,.6,.98]);for(let[i,a]of[[e(9,0,0),[.93,.33,.33]],[e(0,0,9),[.36,.6,.98]]]){let c=t(s,i),l=e(i.z*.12,0,-i.x*.12);o(c,t(n(c,r(i,.16)),l),a),o(c,n(n(c,r(i,.16)),l),a)}let c=I.junctions.get(z)?.radius??10,l=null;for(let t=0;t<=48;t++){let n=t/48*Math.PI*2,r=e(i.p.x+Math.cos(n)*c,i.p.y+.18,i.p.z+Math.sin(n)*c);l&&o(l,r,[.95,.68,.22]),l=r}W?.vbo.destroy(),W=U.uploadLines(new Float32Array(a))}function q(){let e=N(`outliner`);e.innerHTML=``;let t=t=>{let n=document.createElement(`div`);n.className=`group`,n.textContent=t,e.appendChild(n)};t(`Junctions (${[...F.nodes.values()].filter(e=>e.edges.length>=3).length})`);for(let t of F.nodes.values()){if(t.edges.length<3)continue;let n=document.createElement(`div`);n.className=`row`+(z===t.id?` sel`:``),n.innerHTML=`<span class="ico">◆</span>Junction ${t.id}<span class="tag">${t.edges.length}-way${t.signals?` · signals`:``}</span>`,n.onclick=()=>{z=t.id,B=null,K(),X(),q()},e.appendChild(n)}t(`Roads (${F.edges.size})`);for(let t of F.edges.values()){let n=document.createElement(`div`);n.className=`row`+(B===t.id?` sel`:``),n.innerHTML=`<span class="ico">—</span>${T[t.profile].label} ${t.id}<span class="tag">${t.features.length?`${t.features.length} feat`:``}</span>`,n.onclick=()=>{B=t.id,z=null,K(),X(),q()},e.appendChild(n)}}function Se(){let e=N(`layers`);e.innerHTML=``,L.forEach((t,n)=>{let r=document.createElement(`div`);r.className=`layer`+(n===R?` sel`:``);let i=document.createElement(`input`);i.type=`checkbox`,i.checked=t.on,i.onclick=e=>{e.stopPropagation(),t.on=i.checked,Q()};let a=document.createElement(`div`);a.className=`nm`,a.innerHTML=`<b>${t.name}</b><span>${t.note}</span>`;let o=document.createElement(`div`);o.className=`op`,o.textContent=`${Math.round(t.opacity*100)}%`,r.append(i,a,o),r.onclick=()=>{R=n,Se(),X()},e.appendChild(r)}),N(`layerCount`).textContent=`${L.filter(e=>e.on).length}/${L.length} on`}function Ce(e){let t=R+e;t<0||t>=L.length||([L[R],L[t]]=[L[t],L[R]],R=t,Se(),Q())}function J(e,t,n,r,i,a,o,s){let c=document.createElement(`div`);c.className=`fld`;let l=document.createElement(`label`);l.textContent=t;let u=document.createElement(`input`);u.type=`range`,u.min=String(r),u.max=String(i),u.step=String(a),u.value=String(n);let d=document.createElement(`div`);d.className=`val`,d.textContent=o(n),u.oninput=()=>{let e=parseFloat(u.value);d.textContent=o(e),s(e)},c.append(l,u,d),e.appendChild(c)}function Y(e,t){let n=document.createElement(`div`);n.className=`grp`,n.textContent=t,e.appendChild(n)}function X(){let e=N(`inspector`);e.innerHTML=``;let t=N(`inspectorFor`);if(z!==null&&F.nodes.get(z)){let n=F.nodes.get(z);t.textContent=`junction ${n.id}`,Y(e,`Transform`),J(e,`Position X`,n.p.x,n.p.x-120,n.p.x+120,.5,e=>`${e.toFixed(1)}`,e=>{n.p.x=e,G(),K()}),J(e,`Position Z`,n.p.z,n.p.z-120,n.p.z+120,.5,e=>`${e.toFixed(1)}`,e=>{n.p.z=e,G(),K()}),J(e,`Elevation`,n.p.y,-14,14,.1,e=>`${e.toFixed(1)} m`,e=>{n.p.y=e,G(),K()}),Y(e,`Control`);let r=document.createElement(`div`);r.className=`fld check`,r.innerHTML=`<label>Signalised</label>`;let i=document.createElement(`input`);i.type=`checkbox`,i.checked=n.signals,i.onchange=()=>{n.signals=i.checked,q()},r.appendChild(i),e.appendChild(r),Y(e,`Approaches`);for(let t of F.fan(n.id)){let n=F.edges.get(t.edge),r=document.createElement(`div`);r.className=`fld`,r.innerHTML=`<label>Road ${n.id}</label><div class="val" style="grid-column:2/span 2;text-align:left">${T[n.profile].label} · ${(t.ang*180/Math.PI).toFixed(0)}°</div>`,e.appendChild(r)}return}if(B!==null&&F.edges.get(B)){let n=F.edges.get(B);t.textContent=`road ${n.id}`,Y(e,`Classification`);let r=document.createElement(`div`);r.className=`fld`,r.innerHTML=`<label>Profile</label>`;let i=document.createElement(`select`);for(let e of E){let t=document.createElement(`option`);t.value=e,t.textContent=T[e].label,t.selected=e===n.profile,i.appendChild(t)}i.onchange=()=>{n.profile=i.value,G(),X()},r.appendChild(i),e.appendChild(r);let a=T[n.profile];Y(e,`Geometry`);let o=document.createElement(`div`);o.className=`fld`,o.innerHTML=`<label>Cross section</label><div class="val" style="grid-column:2/span 2;text-align:left">${a.lanes}+${a.lanes} × ${a.laneWidth} m · kerb ${(a.kerbH*1e3).toFixed(0)} mm · footway ${a.footway} m · R${a.kerbRadius}</div>`,e.appendChild(o),J(e,`Curve in`,n.ha,.05,.9,.01,e=>e.toFixed(2),e=>{n.ha=e,G()}),J(e,`Curve out`,n.hb,.05,.9,.01,e=>e.toFixed(2),e=>{n.hb=e,G()}),Y(e,`Features (${n.features.length})`);let s=document.createElement(`div`);s.className=`rowbtns`;for(let e of[`crossing`,`bump`,`pothole`,`works`]){let t=document.createElement(`button`);t.textContent=`+ ${e}`,t.onclick=()=>{n.features.push({kind:e,t:.5,seed:Math.floor(Math.random()*9999),size:e===`crossing`?4:e===`bump`?3.7:e===`works`?14:.6,u:(Math.random()-.5)*a.carriageHalf}),G(),X()},s.appendChild(t)}if(e.appendChild(s),n.features.forEach((t,n)=>{J(e,`${t.kind} ${n+1} · at`,t.t,.05,.95,.005,e=>`${(e*100).toFixed(0)}%`,e=>{t.t=e,G()})}),n.features.length){let t=document.createElement(`div`);t.className=`rowbtns`;let r=document.createElement(`button`);r.className=`danger`,r.textContent=`Clear features`,r.onclick=()=>{n.features.length=0,G(),X()},t.appendChild(r),e.appendChild(t)}return}let n=L[R];t.textContent=`layer · ${n.name}`,Y(e,`Layer`);let r=document.createElement(`div`);r.className=`fld check`,r.innerHTML=`<label>Enabled</label>`;let i=document.createElement(`input`);i.type=`checkbox`,i.checked=n.on,i.onchange=()=>{n.on=i.checked,Se(),Q()},r.appendChild(i),e.appendChild(r),J(e,`Opacity`,n.opacity,0,1,.01,e=>`${Math.round(e*100)}%`,e=>{n.opacity=e,Se(),Q()}),Y(e,`Parameters`),n.params.forEach((t,r)=>{J(e,t.label,n.values[r],t.min,t.max,t.step,t.fmt??(e=>e.toFixed(2)),e=>{n.values[r]=e,Q()})}),Y(e,`Scene`),J(e,`Sun height`,Z.h,.08,1.4,.01,e=>`${(e*57).toFixed(0)}°`,e=>{Z.h=e}),J(e,`Sun azimuth`,Z.a,-3.14,3.14,.01,e=>`${(e*57).toFixed(0)}°`,e=>{Z.a=e}),J(e,`Sun strength`,Z.i,0,3,.01,e=>e.toFixed(2),e=>{Z.i=e})}var Z={h:.62,a:.9,i:1.5};function Q(){me(L,ye)}function we(){let n=P.width/Math.max(1,P.height),r=t(H.tgt,e(Math.cos(H.pitch)*Math.sin(H.yaw)*H.dist,Math.sin(H.pitch)*H.dist,Math.cos(H.pitch)*Math.cos(H.yaw)*H.dist));return{vp:m(h(.86,n,.6,6e3),g(r,H.tgt,e(0,1,0))),eye:r}}function Te(t,r){let i=P.getBoundingClientRect(),a=(t-i.left)/i.width*2-1,o=1-(r-i.top)/i.height*2,{vp:s}=we(),l=_(s),u=v(l,e(a,o,0));return{ro:u,rd:c(n(v(l,e(a,o,1)),u))}}function Ee(e,n,i=0){if(Math.abs(n.y)<1e-6)return null;let a=(i-e.y)/n.y;return a>0?t(e,r(n,a)):null}function De(e,t){let{ro:n,rd:r}=Te(e,t),i=Ee(n,r);if(!i)return null;let a=null,o=1/0;for(let[e,t]of I.junctions){let n=Math.hypot(i.x-t.centre.x,i.z-t.centre.z);n<t.radius*.85&&n<o&&(o=n,a=e)}if(a!==null)return a;for(let e of F.nodes.values()){let t=Math.hypot(i.x-e.p.x,i.z-e.p.z);t<9&&t<o&&(o=t,a=e.id)}return a}function Oe(e,t){let{ro:n,rd:r}=Te(e,t),i=Ee(n,r);if(!i)return null;let a=null,o=1/0;for(let e of F.edges.values()){let t=F.arcTable(e,24);for(let n=0;n<=24;n++){let r=D.evalBezier(t.c,n/24),s=Math.hypot(i.x-r.x,i.z-r.z);s<F.profileOf(e).totalHalf&&s<o&&(o=s,a=e.id)}}return a}var $=null;P.addEventListener(`pointerdown`,e=>{if(P.setPointerCapture(e.pointerId),e.button===2){$={mode:`pan`,x:e.clientX,y:e.clientY,moved:0};return}if(V===`select`&&z!==null&&De(e.clientX,e.clientY)===z){$={mode:`node`,x:e.clientX,y:e.clientY,moved:0};return}$={mode:`orbit`,x:e.clientX,y:e.clientY,moved:0}}),P.addEventListener(`pointermove`,n=>{if(!$){let e=V===`select`?De(n.clientX,n.clientY):null;e!==_e&&(_e=e,P.style.cursor=e===null?`default`:`move`);return}let i=n.clientX-$.x,a=n.clientY-$.y;if($.x=n.clientX,$.y=n.clientY,$.moved+=Math.abs(i)+Math.abs(a),$.mode===`orbit`)H.yaw-=i*.005,H.pitch=l(H.pitch+a*.004,.06,1.48);else if($.mode===`pan`){let n=H.dist*.0016,o=e(Math.cos(H.yaw),0,-Math.sin(H.yaw)),s=e(Math.sin(H.yaw),0,Math.cos(H.yaw));H.tgt=t(H.tgt,t(r(o,-i*n),r(s,-a*n)))}else if($.mode===`node`&&z!==null){let e=Te(n.clientX,n.clientY),t=Ee(e.ro,e.rd),r=F.nodes.get(z);t&&r&&(r.p.x=t.x,r.p.z=t.z,G(),K())}}),P.addEventListener(`pointerup`,t=>{let n=$;if($=null,!n||n.moved>5){n?.mode===`node`&&X();return}if(t.button===0){if(V===`select`){let e=De(t.clientX,t.clientY);e===null?(B=Oe(t.clientX,t.clientY),z=null):(z=e,B=null),K(),X(),q()}else if(V===`draw`){let n=Te(t.clientX,t.clientY),r=Ee(n.ro,n.rd);if(!r)return;let i=De(t.clientX,t.clientY),a=i===null?F.addNode(e(r.x,0,r.z)).id:i;z!==null&&z!==a&&F.addEdge(z,a,`street`),z=a,G(),K(),X(),q()}else if(V===`feature`){let e=Oe(t.clientX,t.clientY);if(e===null)return;let n=F.edges.get(e),r=Te(t.clientX,t.clientY),i=Ee(r.ro,r.rd),a=F.arcTable(n,48),o=.5,s=1/0;for(let e=0;e<=48;e++){let t=D.evalBezier(a.c,e/48),n=Math.hypot(i.x-t.x,i.z-t.z);n<s&&(s=n,o=e/48)}n.features.push({kind:`bump`,t:l(o,.06,.94),size:3.7,seed:Math.random()*9999|0}),B=e,z=null,G(),X(),q()}}}),P.addEventListener(`wheel`,e=>{e.preventDefault(),H.dist=l(H.dist*Math.exp(e.deltaY*.0012),9,1800)},{passive:!1}),P.addEventListener(`contextmenu`,e=>e.preventDefault());for(let e of Array.from(document.querySelectorAll(`#topbar nav button`)))e.addEventListener(`click`,()=>{for(let e of Array.from(document.querySelectorAll(`#topbar nav button`)))e.classList.remove(`on`);e.classList.add(`on`),V=e.dataset.tool});for(let e of Array.from(document.querySelectorAll(`.viewmode button`)))e.addEventListener(`click`,()=>{for(let e of Array.from(document.querySelectorAll(`.viewmode button`)))e.classList.remove(`on`);e.classList.add(`on`),ve=[`lit`,`wire`,`mat`,`topo`].indexOf(e.dataset.view)});N(`layerUp`).onclick=()=>Ce(-1),N(`layerDown`).onclick=()=>Ce(1),window.addEventListener(`keydown`,e=>{e.key===`q`&&document.querySelector(`[data-tool=select]`).click(),e.key===`w`&&document.querySelector(`[data-tool=draw]`).click(),e.key===`e`&&document.querySelector(`[data-tool=feature]`).click(),e.key===`Delete`&&B!==null&&(F.removeEdge(B),B=null,G(),X()),e.key===`f`&&z!==null&&(H.tgt={...F.nodes.get(z).p},H.dist=70)});function ke(){let e=Math.min(devicePixelRatio||1,2),t=Math.max(1,Math.round(P.clientWidth*e)),n=Math.max(1,Math.round(P.clientHeight*e));(P.width!==t||P.height!==n)&&(P.width=t,P.height=n,U.resize(t,n))}var Ae=performance.now(),je=0;function Me(t){let n=Math.min(.1,(t-Ae)/1e3);Ae=t,je=je*.92+1/Math.max(n,1e-4)*.08,ke();let{vp:r,eye:i}=we(),a=c(e(Math.cos(Z.a)*Math.cos(Z.h),Math.sin(Z.h),Math.sin(Z.a)*Math.cos(Z.h)));U.setUniforms(r,[i.x,i.y,i.z],[a.x,a.y,a.z,Z.i],[t/1e3,ve,_e??-1,z??-1],[0,0,0,0],ye);let o=ve===1||ve===3?xe:W;U.frame(be,o,[.055,.065,.08]),N(`hud`).textContent=`${je.toFixed(0)} fps\n${F.nodes.size} nodes · ${F.edges.size} roads\ntool: ${V}${z===null?B===null?``:`\nselected: road ${B}`:`\nselected: junction ${z}`}`,requestAnimationFrame(Me)}(async()=>{let e=await de.supported();if(e){ge(e);return}U=new de;try{await U.init(P)}catch(e){ge(`WebGPU initialisation failed.\n\n${e instanceof Error?e.stack??e.message:String(e)}`);return}ke(),Q(),G(),Se(),X(),requestAnimationFrame(Me)})();