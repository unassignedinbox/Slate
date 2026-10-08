(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&n(o)}).observe(document,{childList:!0,subtree:!0});function e(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=e(s);fetch(s.href,r)}})();const Ul="frontier-road-editor/autosave-v1",da=120;function Sn(i,t,e){const n=i.roads.find(r=>r.id===t);if(!n||!n.points.length)return null;const s=e===0?"start":e===n.points.length-1?"end":null;if(!s||n.closed)return null;for(const r of i.junctions||[])if((r.links||[]).some(o=>o.road===t&&o.end===s))return r;return null}function Ne(i,t){return t.points.map((e,n)=>{const s=Sn(i,t.id,n);return s?{...e,x:s.x,z:s.z,y:s.y}:e})}function Ji(i,t,e,n,s,r){const o=i.roads.find(c=>c.id===t);if(!o||!o.points[e])return!1;const a=Sn(i,t,e);if(a)return n!==void 0&&(a.x=n),s!==void 0&&(a.z=s),r!==void 0&&(a.y=r),!0;const l=o.points[e];return n!==void 0&&(l.x=n),s!==void 0&&(l.z=s),r!==void 0&&(l.y=r),!0}function Ct(i,t){return(i.roads||[]).find(e=>e.id===t)||null}const ua=i=>JSON.parse(JSON.stringify(i));function zc(i){let t=ua(i),e={kind:null,roadId:null,index:-1,junctionId:null},n="select",s="plan",r={snapGrid:!0,gridSize:1,snapNode:!0,showIssues:!0,wireframe:!1,autoRotate:!1},o=null;const a=[],l=[];let c=JSON.stringify(t),u=null;const h=new Set,f=()=>JSON.stringify(t),p={get project(){return t},get selection(){return e},get tool(){return n},get view(){return s},get ui(){return r},get flash(){return o},get dirty(){return f()!==c},subscribe(_){return h.add(_),()=>h.delete(_)},notify(_="project"){for(const S of h)try{S(_,p)}catch(m){console.error(m)}},commit(_,S){a.push({label:_,snapshot:f()}),a.length>da&&a.shift(),l.length=0,S(t),p.notify("project")},checkpoint(_){a.push({label:_,snapshot:f()}),a.length>da&&a.shift(),l.length=0},transient(_){_(t),p.notify("project-live")},endGesture(){const _=a[a.length-1];_&&_.snapshot===f()&&a.pop(),p.notify("project")},undo(){if(!a.length)return null;l.push({snapshot:f()});const{label:_,snapshot:S}=a.pop();return t=JSON.parse(S),p.clampSelection(),p.notify("project"),_},redo(){return l.length?(a.push({label:"redo",snapshot:f()}),t=JSON.parse(l.pop().snapshot),p.clampSelection(),p.notify("project"),!0):null},canUndo(){return a.length>0},canRedo(){return l.length>0},undoLabel(){return a.length?a[a.length-1].label:null},select(_){e={kind:null,roadId:null,index:-1,junctionId:null,..._},p.clampSelection(),p.notify("selection")},clampSelection(){if(e.roadId&&!Ct(t,e.roadId))e={kind:null,roadId:null,index:-1,junctionId:null};else if(e.kind==="point"){const _=Ct(t,e.roadId);(!_||e.index<0||e.index>=_.points.length)&&(e=e.roadId?{kind:"road",roadId:e.roadId,index:-1,junctionId:null}:{kind:null,roadId:null,index:-1,junctionId:null})}else e.kind==="junction"&&((t.junctions||[]).some(_=>_.id===e.junctionId)||(e={kind:null,roadId:null,index:-1,junctionId:null}))},setTool(_){n!==_&&(n=_,p.notify("tool"))},setView(_){s!==_&&(s=_,p.notify("view"))},setUI(_){r={...r,..._},p.notify("ui")},ping(_,S){o={x:_,z:S,until:performance.now()+1600},p.notify("flash"),setTimeout(()=>{o=null,p.notify("flash")},1650)},loadProject(_,{resetHistory:S=!0}={}){t=ua(_),S&&(a.length=0,l.length=0),e={kind:null,roadId:null,index:-1,junctionId:null},c=f(),u=Date.now(),p.notify("project"),p.notify("selection")},markSaved(){c=f(),u=Date.now(),p.notify("saved")},get savedAt(){return u},autosave(){try{return typeof localStorage>"u"?!1:(localStorage.setItem(Ul,JSON.stringify({at:Date.now(),project:t})),!0)}catch{return!1}}};return p}function Bc(){try{if(typeof localStorage>"u")return null;const i=localStorage.getItem(Ul);if(!i)return null;const t=JSON.parse(i);return!t||!t.project||!Array.isArray(t.project.roads)?null:t}catch{return null}}const on=1e-9;function kc(i,t=1e-6){const e=[];for(const n of i||[]){const s={x:+n.x||0,z:+n.z||0,y:+n.y||0,w:n.w==null?1:+n.w||0},r=e[e.length-1];r&&Math.abs(r.x-s.x)<t&&Math.abs(r.z-s.z)<t&&Math.abs(r.y-s.y)<t||e.push(s)}if(e.length>2){const n=e[0],s=e[e.length-1];Math.abs(n.x-s.x)<t&&Math.abs(n.z-s.z)<t&&Math.abs(n.y-s.y)<t&&e.pop()}return e}function Hc(i,t,e,n,s){const r=(d,A)=>Math.pow(Math.max(on,Math.hypot(A.x-d.x,A.z-d.z,(A.y-d.y)*.35)),.5),a=0+r(i,t),l=a+r(t,e),c=l+r(e,n),u=a+s*(l-a),h=(d,A,P,x)=>{const w=x-P;if(Math.abs(w)<on)return{x:d.x,z:d.z,y:d.y,w:d.w};const E=(u-P)/w;return{x:d.x+(A.x-d.x)*E,z:d.z+(A.z-d.z)*E,y:d.y+(A.y-d.y)*E,w:d.w+(A.w-d.w)*E}},f=h(i,t,0,a),p=h(t,e,a,l),_=h(e,n,l,c),S=h(f,p,0,l),m=h(p,_,a,c);return h(S,m,a,l)}function Vc(i,t){return(Math.atan2(i,-t)*180/Math.PI+360)%360}function ha(i,t=1){if(t<=0)return i.slice();const e=i.length,n=new Array(e);for(let s=0;s<e;s++){let r=0,o=0;for(let a=-t;a<=t;a++){const l=s+a;l>=0&&l<e&&(r+=i[l],o++)}n[s]=r/o}return n}function Hi(i,{closed:t=!1,step:e=1}={}){const n={samples:[],length:0,count:0,closed:!!t},s=kc(i);if(s.length<2)return n;const r=[],o=s.length,a=t?o:o-1,l=16;for(let g=0;g<a;g++){const y=s[g%o],U=s[(g+1)%o],k=t?s[(g-1+o)%o]:s[Math.max(0,g-1)],H=t?s[(g+2)%o]:s[Math.min(o-1,g+2)];for(let O=0;O<l;O++)r.push(Hc(k,y,U,H,O/l))}t||r.push({...s[o-1]});const c=new Array(r.length);let u=0;c[0]=0;for(let g=1;g<r.length;g++)u+=Math.hypot(r[g].x-r[g-1].x,r[g].z-r[g-1].z),c[g]=u;if(t&&(u+=Math.hypot(r[0].x-r[r.length-1].x,r[0].z-r[r.length-1].z)),!(u>on))return n;const h=Math.max(.1,e),f=Math.max(2,Math.round(u/h)+(t?0:1)),p=u/(t?f:f-1),_=[];let S=0;const m=g=>{if(!t&&g>=u)return{...r[r.length-1],s:u};let y=t?(g%u+u)%u:Math.min(g,u);for(;S<r.length-2&&c[S+1]<y;)S++;for(;S>0&&c[S]>y;)S--;const U=c[S];let k,H=r[S],O;if(S+1<r.length)k=c[S+1],O=r[S+1];else if(t)k=u,O=r[0];else return{...H,s:u};const V=k-U<on?0:(y-U)/(k-U);return{x:H.x+(O.x-H.x)*V,z:H.z+(O.z-H.z)*V,y:H.y+(O.y-H.y)*V,w:H.w+(O.w-H.w)*V,s:y}};for(let g=0;g<f;g++)_.push(m(g*p));const d=_.length,A=g=>t?(g%d+d)%d:Math.min(d-1,Math.max(0,g)),P=new Array(d).fill(0),x=new Array(d).fill(0);for(let g=0;g<d;g++){const y=_[A(g-1)],U=_[A(g+1)];let k=U.x-y.x,H=U.z-y.z;const O=Math.hypot(k,H);if(O<on){const V=_[g],B=_[A(g+1)];k=B.x-V.x,H=B.z-V.z;const $=Math.hypot(k,H)||1;k/=$,H/=$}else k/=O,H/=O;_[g].tx=k,_[g].tz=H,_[g].hdg=Vc(k,H),x[g]=O<on?0:(U.y-y.y)/O}for(let g=0;g<d;g++){const y=_[A(g-1)],U=_[A(g+1)],k=Math.atan2(y.tx*U.tz-y.tz*U.tx,y.tx*U.tx+y.tz*U.tz),H=t||g>0&&g<d-1?Math.hypot(U.x-y.x,U.z-y.z):Math.max(on,p);P[g]=Math.abs(k)/Math.max(on,H)}const w=ha(P,1),E=ha(x,1);let C=1/0,D=0;for(let g=0;g<d;g++)_[g].curve=w[g],_[g].radius=w[g]<1e-6?1/0:1/w[g],_[g].grade=E[g],Number.isFinite(_[g].radius)&&(C=Math.min(C,_[g].radius)),D=Math.max(D,Math.abs(E[g]));return{samples:_,length:u,count:d,closed:!!t,minRadius:C,maxGrade:D}}function Si(i,t,e,n,s,r){const o=s-e,a=r-n,l=o*o+a*a;let c=l<on?0:((i-e)*o+(t-n)*a)/l;return c=Math.min(1,Math.max(0,c)),{d:Math.hypot(i-(e+o*c),t-(n+a*c)),t:c}}function Nl(i,t,e,n,s=0){const r=t.x-i.x,o=t.z-i.z,a=n.x-e.x,l=n.z-e.z,c=r*l-o*a;if(Math.abs(c)<on)return null;const u=((e.x-i.x)*l-(e.z-i.z)*a)/c,h=((e.x-i.x)*o-(e.z-i.z)*r)/c;if(u>-s&&u<1+s&&h>-s&&h<1+s){const f=Math.min(1,Math.max(0,u));return{x:i.x+r*f,z:i.z+o*f,t:u,u:h}}return null}const be={gateY:1.5,touchXZ:.8,weldGuard:1,mergeDist:2.5,bendDeg:15,mergeDeg:35,selfGap:2,maxPairTests:4e5},fa=(i,t=1)=>Math.max(1.5,(i.lanes*i.laneWidth+i.shoulderL+i.shoulderR)*(t||1)/2);function Se(i,t){if(!i.length)return null;if(t<=i[0].s)return i[0];if(t>=i[i.length-1].s)return i[i.length-1];let e=0,n=i.length-1;for(;n-e>1;){const u=e+n>>1;i[u].s<t?e=u:n=u}const s=i[e],r=i[n],o=(t-s.s)/Math.max(1e-9,r.s-s.s);let a=(s.tx||0)+((r.tx||0)-(s.tx||0))*o,l=(s.tz||0)+((r.tz||0)-(s.tz||0))*o;const c=Math.hypot(a,l)||1;return a/=c,l/=c,{x:s.x+(r.x-s.x)*o,z:s.z+(r.z-s.z)*o,y:s.y+(r.y-s.y)*o,tx:a,tz:l,grade:(s.grade||0)+((r.grade||0)-(s.grade||0))*o,w:(s.w||1)+((r.w||1)-(s.w||1))*o,s:t}}function sr(i,t,e){let n=0,s=1/0;for(let r=0;r<i.length;r++){const o=(i[r].x-t)*(i[r].x-t)+(i[r].z-e)*(i[r].z-e);o<s&&(s=o,n=r)}return i[n].s}function Gc(i){let t=1/0,e=-1/0,n=1/0,s=-1/0;for(const r of i)r.x<t&&(t=r.x),r.x>e&&(e=r.x),r.z<n&&(n=r.z),r.z>s&&(s=r.z);return{minX:t,maxX:e,minZ:n,maxZ:s}}const pa=(i,t,e=0)=>i.minX-e<=t.maxX+e&&t.minX-e<=i.maxX+e&&i.minZ-e<=t.maxZ+e&&t.minZ-e<=i.maxZ+e;function Wc(i){const t=[];for(const e of i.junctions||[]){const n=(e.links||[]).map(s=>s.road);n.length>=2&&t.push({x:e.x,z:e.z,roads:n})}return t}function Bo(i,t,e={}){const n=Math.min(14,Math.max(2,+e.cornerRadius||+i?.settings?.cornerRadius||6)),s=(i.roads||[]).filter(E=>E.visible!==!1&&t.get(E.id)?.count>=2),r=new Map;for(const E of s)r.set(E.id,Gc(t.get(E.id).samples));const o=Wc(i),a=(E,C,D,g)=>o.some(y=>y.roads.includes(E)&&y.roads.includes(C)&&Math.hypot(y.x-D,y.z-g)<=be.weldGuard),l=[],c=[];for(let E=0;E<s.length;E++)for(let C=E;C<s.length;C++){const D=s[E],g=s[C],y=D.id===g.id;if(!pa(r.get(D.id),r.get(g.id)))continue;const U=t.get(D.id),k=t.get(g.id),H=U.samples,O=k.samples,V=U.closed?H.length:H.length-1,B=k.closed?O.length:O.length-1,$=Math.max(1,Math.ceil(Math.sqrt(V*B/be.maxPairTests)));let Z=0;for(let rt=0;rt<V&&Z<be.maxPairTests;rt+=$){const ft=H[rt%H.length],yt=H[(rt+1)%H.length],ct=rt*(U.length/V);for(let pt=y?rt+2:0;pt<B&&Z<be.maxPairTests;pt+=$){if(y&&U.closed&&rt===0&&pt>=B-$)continue;Z++;const Lt=O[pt%O.length],zt=O[(pt+1)%O.length];if(Math.max(ft.x,yt.x)<Math.min(Lt.x,zt.x)||Math.min(ft.x,yt.x)>Math.max(Lt.x,zt.x)||Math.max(ft.z,yt.z)<Math.min(Lt.z,zt.z)||Math.min(ft.z,yt.z)>Math.max(Lt.z,zt.z))continue;const ot=Nl(ft,yt,Lt,zt,1e-6);if(!ot)continue;const ut=ct+(ot.t||0)*(U.length/V),wt=pt*(k.length/B)+(ot.u||0)*(k.length/B);if(y&&Math.abs(ut-wt)<be.selfGap)continue;const W=ft.y+(yt.y-ft.y)*(ot.t||0),G=Lt.y+(zt.y-Lt.y)*(ot.u||0);if(Math.abs(W-G)>=be.gateY){c.push({x:ot.x,z:ot.z,gap:Math.abs(W-G),a:{road:D.id,s:ut,y:W},b:{road:g.id,s:wt,y:G}});continue}!y&&a(D.id,g.id,ot.x,ot.z)||l.some(dt=>dt.kind==="cross"&&(dt.a.road===D.id&&dt.b.road===g.id||dt.a.road===g.id&&dt.b.road===D.id)&&Math.hypot(dt.x-ot.x,dt.z-ot.z)<1.5)||l.push({kind:"cross",x:ot.x,z:ot.z,a:{road:D.id,s:ut,y:W},b:{road:g.id,s:wt,y:G}})}}}for(const E of s){if(E.closed)continue;const C=Ne(i,E);if(!(C.length<2))for(const D of[0,C.length-1]){if(Sn(i,E.id,D))continue;const g=C[D];for(const y of s){if(y.id===E.id||!pa(r.get(y.id),{minX:g.x,maxX:g.x,minZ:g.z,maxZ:g.z},be.touchXZ))continue;const U=t.get(y.id),k=U.samples,H=U.closed?k.length:k.length-1;let O=null;for(let V=0;V<H;V++){const B=k[V%k.length],$=k[(V+1)%k.length];if(g.x<Math.min(B.x,$.x)-be.touchXZ||g.x>Math.max(B.x,$.x)+be.touchXZ||g.z<Math.min(B.z,$.z)-be.touchXZ||g.z>Math.max(B.z,$.z)+be.touchXZ)continue;const{d:Z,t:rt}=Si(g.x,g.z,B.x,B.z,$.x,$.z);if(Z>=be.touchXZ||O&&Z>=O.d)continue;const ft=B.y+($.y-B.y)*rt;Math.abs(g.y-ft)>=be.gateY||(O={d:Z,s:(V+rt)*(U.length/H),x:B.x+($.x-B.x)*rt,z:B.z+($.z-B.z)*rt,y:ft})}O&&l.push({kind:"touch",x:O.x,z:O.z,a:{road:y.id,s:O.s,y:O.y},b:{road:E.id,s:D===0?0:t.get(E.id).length,y:g.y,end:D===0?"start":"end"}})}}}for(const E of i.junctions||[]){const C=(E.links||[]).filter(D=>{const g=Ct(i,D.road);return g&&!g.closed&&t.get(D.road)?.count>=2});C.length<2||l.push({kind:"weld",x:E.x,z:E.z,weldId:E.id,legs:C.map(D=>{const g=t.get(D.road);return{road:D.road,s:D.end==="start"?0:g.length,y:E.y,end:D.end}})})}const u=[];for(const E of l){let C=u.find(D=>D.some(g=>Math.hypot(g.x-E.x,E.z-g.z)<=be.mergeDist));C||(C=[],u.push(C)),C.push(E)}const h=[];for(const E of u){const C=new Map;for(const ct of E)if(ct.kind==="weld")for(const pt of ct.legs)C.has(pt.road)||C.set(pt.road,[]),C.get(pt.road).push({s:pt.s,end:pt.end,weld:!0});else C.has(ct.a.road)||C.set(ct.a.road,[]),C.get(ct.a.road).push({s:ct.a.s,end:null,weld:!1}),C.has(ct.b.road)||C.set(ct.b.road,[]),C.get(ct.b.road).push({s:ct.b.s,end:ct.b.end||null,weld:!1});let D=2;for(const[ct,pt]of C){const Lt=Ct(i,ct),zt=t.get(ct).samples;for(const ot of pt){const ut=Se(zt,ot.s);D=Math.max(D,fa(Lt,ut?.w||1))}}const g=Math.min(20,Math.max(5,n+D)),y=E.reduce((ct,pt)=>ct+pt.x,0)/E.length,U=E.reduce((ct,pt)=>ct+pt.z,0)/E.length,k=[],H=new Set,O=[];for(const[ct,pt]of C){const Lt=Ct(i,ct),zt=t.get(ct),ot=zt.samples,ut=zt.length;H.add(ct);const wt=[...pt].sort((G,K)=>G.s-K.s),W=[];for(const G of wt){const K=W[W.length-1];K&&G.s-K.max<=g?(K.max=G.s,K.list.push(G)):W.push({max:G.s,list:[G]})}for(const G of W){const K=G.list.reduce((T,b)=>T+b.s,0)/G.list.length,dt=!zt.closed&&(G.list.some(T=>T.end)||K<=g*.5||K>=ut-g*.5),v=Se(ot,Math.min(ut-.01,Math.max(.01,K))),F=fa(Lt,v?.w||1);if(dt){const T=G.list.find(nt=>nt.end)?.end==="start"||K<ut/2,b=T?Math.min(ut-1,g):Math.max(1,ut-g);if(T?b>=ut-1:b<=1)continue;const z=Se(ot,b),N=z.x-y,I=z.z-U,X=Math.hypot(N,I)||1,q=G.list.some(nt=>nt.weld);k.push({roadId:ct,sTrim:b,dirx:N/X,dirz:I/X,halfW:F,role:q?"weld":"branch"}),T?O.push({roadId:ct,s0:0,s1:Math.min(ut,K+g)}):O.push({roadId:ct,s0:Math.max(0,K-g),s1:ut})}else{O.push({roadId:ct,s0:K-g,s1:K+g});for(const T of[-1,1]){let b=K+T*g;if(zt.closed)b=(b%ut+ut)%ut;else if(b<1||b>ut-1)continue;const z=Se(ot,b),N=z.x-y,I=z.z-U,X=Math.hypot(N,I)||1;k.push({roadId:ct,sTrim:b,dirx:N/X,dirz:I/X,halfW:F,role:"through"})}}}}if(k.length<2)continue;if(k.length===2){const ct=k[0].dirx*k[1].dirx+k[0].dirz*k[1].dirz;if(Math.acos(Math.min(1,Math.max(-1,ct)))*180/Math.PI>180-be.bendDeg)continue}const V=new Set(k.filter(ct=>ct.role==="through").map(ct=>ct.roadId)),B=k.filter(ct=>ct.role!=="through");let $="multi";if(k.length===2)$="elbow";else if(V.size>=2)$=k.length===4?"cross":"multi";else if(V.size===1)if(B.length===1){const ct=B[0],pt=t.get([...V][0]).samples,Lt=Se(pt,sr(pt,y,U)),zt=Math.abs(ct.dirx*(Lt?.tx||0)+ct.dirz*(Lt?.tz||0));$=Math.acos(Math.min(1,Math.max(-1,zt)))*180/Math.PI<be.mergeDeg?"merge":"tee"}else $="multi";else k.length===3&&($="wye");const Z=k.map(ct=>Math.atan2(ct.dirx,-ct.dirz)).sort((ct,pt)=>ct-pt);let rt=360;for(let ct=0;ct<Z.length;ct++){let pt=(Z[(ct+1)%Z.length]-Z[ct])*180/Math.PI;pt<0&&(pt+=360),rt=Math.min(rt,pt)}const ft=E.reduce((ct,pt)=>ct+(pt.a?.y??pt.legs?.[0]?.y??0),0)/E.length,yt=`x_${k.map(ct=>`${ct.roadId}@${Math.round(ct.sTrim)}`).sort().join("-")}`;h.push({id:yt,x:y,z:U,y:ft,kind:$,legs:k,radius:g,minAngleDeg:rt,roads:[...H],cuts:O})}let f=!0;for(;f;){f=!1;t:for(let E=0;E<h.length;E++)for(let C=E+1;C<h.length;C++){const D=h[E],g=h[C];if(Math.hypot(D.x-g.x,D.z-g.z)<(D.radius+g.radius)*.8){const y=[...D.legs,...g.legs],U=y.length,k=(D.x+g.x)/2,H=(D.z+g.z)/2;for(const B of y){const $=t.get(B.roadId).samples,Z=Se($,B.sTrim),rt=Z.x-k,ft=Z.z-H,yt=Math.hypot(rt,ft)||1;B.dirx=rt/yt,B.dirz=ft/yt}const O=y.map(B=>Math.atan2(B.dirx,-B.dirz)).sort((B,$)=>B-$);let V=360;for(let B=0;B<O.length;B++){let $=(O[(B+1)%O.length]-O[B])*180/Math.PI;$<0&&($+=360),V=Math.min(V,$)}h[E]={id:`x_${y.map(B=>`${B.roadId}@${Math.round(B.sTrim)}`).sort().join("-")}`,x:k,z:H,y:(D.y+g.y)/2,kind:U===4?"cross":"multi",legs:y,radius:Math.max(D.radius,g.radius),minAngleDeg:V,roads:[...new Set([...D.roads,...g.roads])],cuts:[...D.cuts||[],...g.cuts||[]]},h.splice(C,1),f=!0;break t}}}const p=[];for(const E of c){const C=p.find(D=>D.clusters.some(g=>g.a.road===E.a.road&&g.b.road===E.b.road&&Math.hypot(g.x-E.x,g.z-E.z)<2.5));C?C.clusters.push(E):p.push({clusters:[E]})}const _=p.map((E,C)=>{const D=E.clusters.length,g=E.clusters.reduce((B,$)=>B+$.x,0)/D,y=E.clusters.reduce((B,$)=>B+$.z,0)/D,U=E.clusters.reduce((B,$)=>B+$.gap,0)/D,k=E.clusters[0],H=k.a.y>=k.b.y,O=E.clusters.reduce((B,$)=>B+(H?$.a.s:$.b.s),0)/D,V=E.clusters.reduce((B,$)=>B+(H?$.b.s:$.a.s),0)/D;return{id:`o${C+1}_${H?k.a.road:k.b.road}x${H?k.b.road:k.a.road}`,x:g,z:y,gap:U,upper:H?k.a.road:k.b.road,lower:H?k.b.road:k.a.road,sUpper:O,sLower:V}}),S=i.intersectionOverrides&&typeof i.intersectionOverrides=="object"?i.intersectionOverrides:{},m=h.filter(E=>S[E.id]?.enabled!==!1),d=h.filter(E=>S[E.id]?.enabled===!1),A=new Set(m.map(E=>E.id)),P=new Map;for(const E of m)for(const C of E.cuts||[]){const D=t.get(C.roadId);if(!D)continue;const g=D.length;let{s0:y,s1:U}=C;if(!(U>y))continue;P.has(C.roadId)||P.set(C.roadId,[]);const k=P.get(C.roadId);D.closed&&(y<0||U>g)?y<0?(k.push({s0:0,s1:Math.min(g,U)}),k.push({s0:g+y,s1:g})):(k.push({s0:Math.max(0,y),s1:g}),k.push({s0:0,s1:U-g})):k.push({s0:Math.max(0,y),s1:Math.min(g,U)})}const x=new Map;for(const E of s){const C=t.get(E.id),D=C.samples,g=C.length,y=(P.get(E.id)||[]).filter(O=>O.s1-O.s0>.05).sort((O,V)=>O.s0-V.s0),U=[];for(const O of y){const V=U[U.length-1];V&&O.s0<=V.s1+.01?V.s1=Math.max(V.s1,O.s1):U.push({...O})}const k=[];let H=0;for(const O of U)O.s0-H>.3&&k.push([H,O.s0]),H=Math.max(H,O.s1);g-H>.3&&k.push([H,g]),x.set(E.id,k.map(([O,V])=>{const B=D.filter(rt=>rt.s>=O-1e-6&&rt.s<=V+1e-6),$=Se(D,O),Z=Se(D,V);return B.length&&Math.abs(B[0].s-O)>1e-4&&B.unshift({...$}),B.length&&Math.abs(B[B.length-1].s-V)>1e-4&&B.push({...Z}),B}).filter(O=>O.length>=2))}const w=[];for(const E of s){const C=Ne(i,E),D=t.get(E.id).samples,g=C.map((H,O)=>H.bridge?O:-1).filter(H=>H>=0);if(!g.length)continue;let y=g[0],U=g[0];const k=[];for(let H=1;H<=g.length;H++){const O=g[H];if(O===U+1){U=O;continue}U>y&&k.push([y,U]),y=O,U=O}for(const[H,O]of k){const V=sr(D,C[H].x,C[H].z),B=sr(D,C[O].x,C[O].z);B-V>1&&w.push({roadId:E.id,s0:V,s1:B,c0:H,c1:O})}}return{intersections:m,disabled:d,overpasses:_,runs:x,bridges:w,cornerRadius:n,cuts:P,activeIds:A}}function Xc(i){return{cross:"4-way cross",tee:"T-junction",merge:"Merge",wye:"Wye",elbow:"Elbow",multi:"Multi-way"}[i]||i}const Ae={radiusWarn:15,radiusErr:7,gradeWarn:.08,gradeErr:.12,minPointGap:.5,dupGap:.05,maxPairTests:4e5,minJunctionAngle:25,minClearance:4.5,maxIssues:240};function jc(i,t,e){const n=t.name||t.id,s=t.points||[];if(s.length<2)return e.push(qe("error","too-few-points",t.id,n,0,s[0]?.x??0,s[0]?.z??0,s[0]?.y??0,`<b>${n}</b> needs at least 2 control points.`)),null;for(let d=1;d<s.length;d++){const A=Math.hypot(s[d].x-s[d-1].x,s[d].z-s[d-1].z);A<Ae.dupGap?e.push(qe("error","duplicate-point",t.id,n,0,s[d].x,s[d].z,s[d].y,`<b>${n}</b> has stacked points (#${d}–#${d+1}); the curve is pinched there.`)):A<Ae.minPointGap&&e.push(qe("warn","tight-spacing",t.id,n,0,s[d].x,s[d].z,s[d].y,`<b>${n}</b> points #${d}–#${d+1} are ${A.toFixed(2)} m apart — under ${Ae.minPointGap} m.`))}t.lanes*t.laneWidth<=0&&e.push(qe("error","no-width",t.id,n,0,s[0].x,s[0].z,s[0].y,`<b>${n}</b> has no carriageway width (lanes × width ≤ 0).`));const r=Hi(s,{closed:t.closed,step:1});if(!r.count)return null;const o=[],a=r.samples;for(let d=1;d<a.length-1;d++){const A=a[d].radius;!Number.isFinite(A)||A>=Ae.radiusWarn||a[d-1].radius<=A||a[d+1].radius<A||o.push(a[d])}o.sort((d,A)=>d.radius-A.radius);const l=[];for(const d of o){if(l.length>=3)break;l.every(A=>Math.abs(A.s-d.s)>12)&&l.push(d)}for(const d of l){const A=d.radius<Ae.radiusErr?"error":"warn";e.push(qe(A,"tight-curve",t.id,n,d.s,d.x,d.z,d.y,`<b>${n}</b> curve radius <b>${d.radius.toFixed(1)} m</b> at s=${d.s.toFixed(0)} m${A==="error"?" — under the 7 m minimum":""}.`))}const c=[];for(let d=1;d<a.length-1;d++){const A=Math.abs(a[d].grade);A<Ae.gradeWarn||Math.abs(a[d-1].grade)>=A||Math.abs(a[d+1].grade)>A||c.push(a[d])}c.sort((d,A)=>Math.abs(A.grade)-Math.abs(d.grade));const u=[];for(const d of c){if(u.length>=3)break;u.every(A=>Math.abs(A.s-d.s)>15)&&u.push(d)}for(const d of u){const A=Math.abs(d.grade),P=A>Ae.gradeErr?"error":"warn";e.push(qe(P,"steep-grade",t.id,n,d.s,d.x,d.z,d.y,`<b>${n}</b> grade <b>${(A*100).toFixed(1)}%</b> at s=${d.s.toFixed(0)} m${P==="error"?" — over the 12% maximum":""}.`))}const h=a.length,f=!!t.closed,p=f?h:h-1,_=Math.max(1,Math.ceil(p*p/2/Ae.maxPairTests));let S=0,m=0;for(let d=0;d<p&&S<2&&m<Ae.maxPairTests;d+=_){const A=a[d%h],P=a[(d+1)%h];for(let x=d+2;x<p&&m<Ae.maxPairTests;x+=_){if(f&&d===0&&x>=p-_)continue;m++;const w=Nl(A,P,a[x%h],a[(x+1)%h],1e-6);if(w){S++,e.push(qe("error","self-crossing",t.id,n,A.s,w.x,w.z,A.y,`<b>${n}</b> crosses itself near (${w.x.toFixed(1)}, ${w.z.toFixed(1)}).`));break}}}return r}let $c=1;function qe(i,t,e,n,s,r,o,a,l){return{id:`is${$c++}`,severity:i,code:t,road:e,roadName:n,idx:s,x:r,z:o,y:a,text:l}}function Yc(i,t=null){const e=[];for(const o of i.roads||[])if(jc(i,o,e),e.length>Ae.maxIssues)break;const n=o=>(i.roads||[]).find(a=>a.id===o)?.name||o||"—";let s=t;if(!s){const o=new Map;for(const a of i.roads||[])o.set(a.id,Hi(Ne(i,a),{closed:a.closed,step:1}));s=Bo(i,o)}for(const o of s.intersections)o.kind!=="merge"&&o.minAngleDeg<Ae.minJunctionAngle&&e.push(qe("warn","intersection-angle",o.roads[0]||null,n(o.roads[0]),0,o.x,o.z,o.y,`Approach angle <b>${o.minAngleDeg.toFixed(0)}°</b> at the ${o.kind} — under ${Ae.minJunctionAngle}° pinches turning paths.`));for(const o of s.overpasses)o.gap<Ae.minClearance&&e.push(qe("warn","low-clearance",o.upper,n(o.upper),o.sUpper,o.x,o.z,0,`<b>${n(o.upper)}</b> clears <b>${n(o.lower)}</b> by <b>${o.gap.toFixed(1)} m</b> — under ${Ae.minClearance} m.`)),s.bridges.some(l=>l.roadId===o.upper&&l.s0-2<=o.sUpper&&o.sUpper<=l.s1+2)||e.push(qe("info","overpass-span",o.upper,n(o.upper),o.sUpper,o.x,o.z,0,`<b>${n(o.upper)}</b> flies over <b>${n(o.lower)}</b> — flag a bridge span for deck + piers.`));for(const o of i.junctions||[]){const a=o.links||[];a.length<2&&e.push(qe("warn","dangling-junction",a[0]?.road||null,"—",0,o.x,o.z,o.y,`Junction <b>${o.name||o.id}</b> links fewer than 2 road ends.`));for(const l of a)(i.roads||[]).find(u=>u.id===l.road)||e.push(qe("error","broken-link",null,"—",0,o.x,o.z,o.y,`Junction <b>${o.name||o.id}</b> links a deleted road.`))}const r={error:0,warn:1,info:2};return e.sort((o,a)=>r[o.severity]-r[a.severity]),e.slice(0,Ae.maxIssues)}function qc(i,t){let e=0,n=1/0,s=0,r=0;for(const o of i.roads||[]){const a=t.get(o.id);r+=(o.points||[]).length,a&&(e+=a.length,Number.isFinite(a.minRadius)&&(n=Math.min(n,a.minRadius)),s=Math.max(s,a.maxGrade||0))}return{length:e,minRadius:n,maxGrade:s,points:r,roads:(i.roads||[]).length}}const Ui={asphalt:{label:"Asphalt",road:[.2,.212,.23],shoulder:[.16,.168,.182]},concrete:{label:"Concrete",road:[.585,.595,.59],shoulder:[.5,.51,.505]},gravel:{label:"Gravel",road:[.512,.462,.372],shoulder:[.44,.394,.316]},dirt:{label:"Dirt",road:[.41,.3,.196],shoulder:[.345,.25,.163]}},Fl=Object.keys(Ui),Zc={none:"None",single:"Single solid",double:"Double solid",dashed:"Dashed"},bi=[.88,.88,.86],ma=[.91,.74,.23],rr=[.62,.62,.6],Pi=[.7,.72,.74],ga=[.42,.43,.44],He=[.55,.55,.53],$n=[.34,.34,.33],kn=[.45,.46,.48];function Vr(i){return Math.max(.5,i.lanes*i.laneWidth+i.shoulderL+i.shoulderR)}function Kc(i){return 1+.028*Math.sin(i*1.7)+.018*Math.sin(i*.43+2)}function Ti(i,t){const e=t.length,n=t[0].length,s=[],r=[],o=[],a=[],l=[];for(let c=0;c<e;c++)for(let u=0;u<n;u++){const h=t[c][u];s.push(h.x,h.y,h.z),r.push(h.nx,h.ny,h.nz),o.push(h.r,h.g,h.b),a.push(h.u,h.v)}for(let c=0;c<e-1;c++)for(let u=0;u<n-1;u++){const h=c*n+u,f=(c+1)*n+u;l.push(h,h+1,f,h+1,f+1,f)}i.positions=new Float32Array(s),i.normals=new Float32Array(r),i.colors=new Float32Array(o),i.uvs=new Float32Array(a),i.indices=new Uint32Array(l),i.triangles=l.length/3}function hs(i,t,e,n){i=Number.isFinite(i)?i:1,t=Number.isFinite(t)?t:0,e=Number.isFinite(e)?e:0,n=Number.isFinite(n)?n:0;const s=-t,r=n,o=i,a=i,l=e,c=t;let u=r*c-o*l,h=o*a-s*c,f=s*l-r*a;const p=Math.hypot(u,h,f)||1;return[u/p,h/p,f/p]}function Js(i,t){const e=Ui[i.surface]||Ui.asphalt,n=i.conform==="drape"&&typeof t=="function",s=+i.drapeOffset||0;return{surf:e,drape:n,baseY:c=>{if(!n)return c.y;const u=t(c.x,c.z);return u==null||!Number.isFinite(u)?c.y:u+s},halfRoad:c=>Math.max(.25,i.lanes*i.laneWidth*(c.w||1)/2),shoulders:c=>{const u=c.w||1;return[Math.max(0,+i.shoulderL||0)*u,Math.max(0,+i.shoulderR||0)*u]},crossY:(c,u,h,f)=>{const p=Math.abs(f);if(p<=h){const _=+i.camber||0;return _>0?u+_*(1-f/h*(f/h)):u}return u-(p-h)*.025}}}const _a=i=>(i=Math.min(1,Math.max(0,i)),i*i*(3-2*i));function Jc(i,{step:t=1,terrain:e=null}={}){const n=Hi(i.points,{closed:i.closed,step:t}),s={length:n.length,triangles:0,minRadius:n.minRadius??1/0,maxGrade:n.maxGrade??0};if(!n.count)return{parts:[],samples:n,stats:s};const{parts:r,stats:o}=Ol(i,n.samples,Js(i,e),{});return s.triangles=o.triangles,{parts:r,samples:n,stats:s}}function Ol(i,t,e,{tag:n="",railCuts:s=[]}={}){const r=[],o={triangles:0};if(!t||t.length<2)return{parts:r,stats:o};const{surf:a,baseY:l,halfRoad:c,crossY:u}=e,h=_=>n?`${_}.${n}`:_;{const _=Math.max(5,i.lanes+2),S=[];for(let d=0;d<_;d++)S.push(-1+2*d/(_-1));const m=[];for(const d of t){const A=c(d),P=d.w||1,x=Math.max(0,+i.shoulderL||0)*P,w=Math.max(0,+i.shoulderR||0)*P,E=[];x>0&&E.push(-A-x,-A-x*.45);for(const y of S)E.push(y*A);w>0&&E.push(A+w*.45,A+w);const C=l(d),D=Kc(d.s),g=E.map(y=>{const U=u(d,C,A,y),H=Math.abs(y)<=A+1e-6?a.road:a.shoulder;return{o:y,x:d.x-d.tz*y,y:U,z:d.z+d.tx*y,r:H[0]*D,g:H[1]*D,b:H[2]*D,u:y,v:d.s}});for(let y=0;y<g.length;y++){const U=g[Math.max(0,y-1)],k=g[Math.min(g.length-1,y+1)],H=(k.y-U.y)/Math.max(1e-6,k.o-U.o||1e-6),[O,V,B]=hs(d.tx,d.tz,d.grade,H);g[y].nx=O,g[y].ny=V,g[y].nz=B}m.push(g)}if(m.length>1){const d={name:h("surface"),roadId:i.id};Ti(d,m),r.push(d)}}const f=(_,S,m,d,A)=>{const P=[];for(const x of t){if(A&&!A(x))continue;const w=c(x),E=l(x),C=g=>{const y=u(x,E,w,g)+.02;return{x:x.x-x.tz*g,y,z:x.z+x.tx*g,r:d[0],g:d[1],b:d[2],u:g,v:x.s}},D=[C(S),C(m)];for(const g of D){const[y,U,k]=hs(x.tx,x.tz,x.grade,0);g.nx=y,g.ny=U,g.nz=k}P.push(D)}if(P.length>1){const x={name:_,roadId:i.id};Ti(x,P),r.push(x)}},p=i.centerMarking||"none";if(p==="single"?f(h("marking-center"),-.07,.07,bi):p==="double"?(f(h("marking-center-L"),-.24,-.12,ma),f(h("marking-center-R"),.12,.24,ma)):p==="dashed"&&f(h("marking-center"),-.07,.07,bi,_=>_.s%9<3),i.edgeMarking)for(const _ of[-1,1]){const S=[];for(const m of t){const d=c(m);if(d<.6)continue;const A=_*(d-.22),P=l(m),x=w=>{const E=u(m,P,d,w)+.02,[C,D,g]=hs(m.tx,m.tz,m.grade,0);return{x:m.x-m.tz*w,y:E,z:m.z+m.tx*w,nx:C,ny:D,nz:g,r:bi[0],g:bi[1],b:bi[2],u:w,v:m.s}};S.push([x(A-.06),x(A+.06)])}if(S.length>1){const m={name:h(_<0?"marking-edge-L":"marking-edge-R"),roadId:i.id};Ti(m,S),r.push(m)}}for(const _ of[-1,1]){if(!(_<0?i.kerbL:i.kerbR))continue;const m=[];for(const d of t){const A=c(d),P=d.w||1,x=_<0?Math.max(0,+i.shoulderL||0)*P:Math.max(0,+i.shoulderR||0)*P,w=_*(A+x),E=l(d),C=u(d,E,A,w),g=[{o:w,y:C+.005},{o:w+_*.06,y:C+.14},{o:w+_*.3,y:C+.14}].map(({o:y,y:U})=>{const[k,H,O]=hs(d.tx,d.tz,d.grade,_*.4);return{x:d.x-d.tz*y,y:U,z:d.z+d.tx*y,nx:k,ny:H,nz:O,r:rr[0],g:rr[1],b:rr[2],u:y,v:d.s}});m.push(g)}if(m.length>1){const d={name:h(_<0?"kerb-L":"kerb-R"),roadId:i.id};Ti(d,m),r.push(d)}}for(const _ of[-1,1]){if(!(_<0?i.guardrailL:i.guardrailR))continue;const m=A=>{const P=c(A),x=_<0?e.shoulders(A)[0]:e.shoulders(A)[1];return _*(P+x+.6)},d=A=>{const P=c(A),x=_<0?e.shoulders(A)[0]:e.shoulders(A)[1];return u(A,l(A),P,_*(P+x))};for(const A of Bl(t,s))A.length>=2&&r.push(...Hl(A,_,m,d,{roadId:i.id,railName:h(_<0?"rail-L":"rail-R"),postName:h(_<0?"posts-L":"posts-R")}))}for(const _ of r)o.triangles+=_.triangles;return{parts:r,stats:o}}function Qc(i,{terrain:t=null,samples:e=null,topo:n=null}={}){if(e&&n)return ko(i,e,n,t).stats.triangles;let s=0;for(const r of i.roads)r.visible!==!1&&(s+=Jc(r,{terrain:t}).stats.triangles);return s}const zl=i=>String(i||"road").replace(/[^A-Za-z0-9_.-]+/g,"_").slice(0,48)||"road";function td(i,{step:t=1,terrain:e=null,samples:n=null,topo:s=null}={}){const r=[],o=new Date().toISOString(),a=n||(()=>{const p=new Map;for(const _ of i.roads||[])p.set(_.id,Hi(Ne(i,_),{closed:_.closed,step:t}));return p})(),l=s||Bo(i,a);r.push("# Frontier road network | units: meters | Y-up"),r.push(`# Project: ${i.name||"untitled"} | roads: ${i.roads.length} | exported: ${o}`);const c=i.roads.map(p=>{const _=a.get(p.id);return{name:p.name,closed:!!p.closed,points:p.points.length,length_m:+(_?.length||0).toFixed(2),lanes:p.lanes,laneWidth_m:p.laneWidth,surface:p.surface}});r.push(`# Roads: ${JSON.stringify(c)}`),r.push(`# Topology: ${l.intersections.length} intersections, ${l.overpasses.length} overpasses, ${l.bridges.length} bridge spans`);const u=new Map((i.roads||[]).map(p=>[p.id,zl(p.name||p.id)])),{parts:h}=ko(i,a,l,e);let f=0;for(const p of h){const _=p.junction?p.name:`${u.get(p.roadId)||"road"}__${p.name}`;r.push(`o ${_}`);const{positions:S,normals:m,uvs:d,indices:A}=p;for(let P=0;P<S.length;P+=3)r.push(`v ${S[P].toFixed(4)} ${S[P+1].toFixed(4)} ${S[P+2].toFixed(4)}`);for(let P=0;P<d.length;P+=2)r.push(`vt ${d[P].toFixed(3)} ${d[P+1].toFixed(3)}`);for(let P=0;P<m.length;P+=3)r.push(`vn ${m[P].toFixed(5)} ${m[P+1].toFixed(5)} ${m[P+2].toFixed(5)}`);for(let P=0;P<A.length;P+=3){const x=A[P]+1+f,w=A[P+1]+1+f,E=A[P+2]+1+f;r.push(`f ${x}/${x}/${x} ${w}/${w}/${w} ${E}/${E}/${E}`)}f+=S.length/3}return r.join(`
`)+`
`}function Bl(i,t){if(!i.length)return[];if(!t||!t.length)return[i];const e=i[0].s,n=i[i.length-1].s,s=t.filter(l=>l.s1>l.s0).sort((l,c)=>l.s0-c.s0),r=[];for(const l of s){const c=r[r.length-1];c&&l.s0<=c.s1+.01?c.s1=Math.max(c.s1,l.s1):r.push({s0:l.s0,s1:l.s1})}const o=[];let a=e;for(const l of r)l.s0-a>.3&&o.push([a,l.s0]),a=Math.max(a,l.s1);return n-a>.3&&o.push([a,n]),o.map(([l,c])=>{const u=i.filter(p=>p.s>=l-1e-6&&p.s<=c+1e-6),h=Se(i,l),f=Se(i,c);return u.length&&Math.abs(u[0].s-l)>1e-4&&u.unshift({...h}),u.length&&Math.abs(u[u.length-1].s-c)>1e-4&&u.push({...f}),u}).filter(l=>l.length>=2)}function Yn(i,t,e){if(!e||e.length<2)return null;const n={name:i,roadId:t};return Ti(n,e),n}function kl(i,t,e){const n=[],s=[],r=[],o=[],a=[];let l=0;const c=[{n:[1,0,0],c:[[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]]},{n:[-1,0,0],c:[[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]]},{n:[0,1,0],c:[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]},{n:[0,-1,0],c:[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]},{n:[0,0,1],c:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]},{n:[0,0,-1],c:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]}];for(const h of e){const[f,p,_]=h.c,[S,m,d]=h.s,A=h.yaw||0,P=h.color,x=Math.cos(A),w=Math.sin(A);for(const E of c){const[C,D,g]=E.n,y=C*x+g*w,U=-C*w+g*x,k=l;for(const[H,O,V]of E.c){const B=H*S/2,$=V*d/2;n.push(f+B*x+$*w,p+O*m/2,_-B*w+$*x),s.push(y,D,U),r.push(P[0],P[1],P[2]),o.push(H*.5,O*.5)}a.push(k,k+1,k+2,k,k+2,k+3),l+=4}}if(!a.length)return null;const u={name:i,roadId:t};return u.positions=new Float32Array(n),u.normals=new Float32Array(s),u.colors=new Float32Array(r),u.uvs=new Float32Array(o),u.indices=new Uint32Array(a),u.triangles=a.length/3,u}function ed(i,t,e,n,s,r,o){const a=r.length;if(a<3)return null;const l=[e,n,s],c=[0,0,0],u=[...o],h=[e*.05,s*.05];for(const S of r)l.push(S.x,S.y,S.z),c.push(0,0,0),u.push(o[0],o[1],o[2]),h.push(S.x*.05,S.z*.05);const f=[],p=(S,m,d,A)=>{c[S*3]+=m,c[S*3+1]+=d,c[S*3+2]+=A};for(let S=0;S<a;S++){const m=1+S,d=1+(S+1)%a;f.push(0,m,d);const A=l[m*3]-e,P=l[m*3+1]-n,x=l[m*3+2]-s,w=l[d*3]-e,E=l[d*3+1]-n,C=l[d*3+2]-s;let D=P*C-x*E,g=x*w-A*C,y=A*E-P*w;const U=Math.hypot(D,g,y)||1;D/=U,g/=U,y/=U,g<0&&(D=-D,g=-g,y=-y),p(0,D,g,y),p(m,D,g,y),p(d,D,g,y)}for(let S=0;S<=a;S++){const m=Math.hypot(c[S*3],c[S*3+1],c[S*3+2])||1;c[S*3]/=m,c[S*3+1]/=m,c[S*3+2]/=m}const _={name:i,roadId:t};return _.positions=new Float32Array(l),_.normals=new Float32Array(c),_.colors=new Float32Array(u),_.uvs=new Float32Array(h),_.indices=new Uint32Array(f),_.triangles=f.length/3,_}function nd(i,t,e,n){if(!e.length)return null;const s=[],r=[],o=[],a=[],l=[];let c=0;for(const h of e){const f=h[1][0]-h[0][0],p=h[1][1]-h[0][1],_=h[1][2]-h[0][2],S=h[3][0]-h[0][0],m=h[3][1]-h[0][1],d=h[3][2]-h[0][2];let A=p*d-_*m,P=_*S-f*d,x=f*m-p*S;const w=Math.hypot(A,P,x)||1;A/=w,P/=w,x/=w,P<0&&(A=-A,P=-P,x=-x);for(const[E,C,D]of h)s.push(E,C,D),r.push(A,P,x),o.push(n[0],n[1],n[2]),a.push(E*.1,D*.1);l.push(c,c+1,c+2,c,c+2,c+3),c+=4}const u={name:i,roadId:t};return u.positions=new Float32Array(s),u.normals=new Float32Array(r),u.colors=new Float32Array(o),u.uvs=new Float32Array(a),u.indices=new Uint32Array(l),u.triangles=l.length/3,u}const id=[[.5,.02],[.6,-.03],[.71,.03],[.81,-.015]];function Hl(i,t,e,n,{roadId:s=null,railName:r="rail",postName:o="posts",postSpacing:a=2,bury:l=!0,onDeck:c=!1,maxPosts:u=1200}={}){const h=[];if(!i||i.length<2)return h;const f=i[0].s,p=i[i.length-1].s,_=l?Math.min(4,Math.max(0,(p-f)/2-.6)):0,S=x=>_<=0?1:_a((x-f)/_)*_a((p-x)/_),m=[];for(const x of i){const w=e(x),E=n(x),C=S(x.s),D=Math.hypot(1,.12);m.push(id.map(([g,y])=>{const U=w+t*y*C;return{x:x.x-x.tz*U,y:E+.06+(g-.06)*C,z:x.z+x.tx*U,nx:-x.tz*t/D,ny:.12/D,nz:x.tx*t/D,r:Pi[0],g:Pi[1],b:Pi[2],u:U,v:x.s}}))}if(m.length>1){const x={name:r,roadId:s};Ti(x,m),h.push(x)}const d=[],A=x=>e(x)-t*.24;for(let x=f+1;x<p-.5;x+=a){if(S(x)<.4)continue;const w=Se(i,x),E=n(w),C=Math.atan2(w.tx,w.tz),D=c?.55:.78,g=A(w);d.push({c:[w.x-w.tz*g,E+D/2-.06,w.z+w.tx*g],s:[.15,D,.15],yaw:C,color:ga});const y=e(w)-t*.12;if(d.push({c:[w.x-w.tz*y,E+.6,w.z+w.tx*y],s:[.3,.16,.14],yaw:C,color:ga}),d.length>=u*2)break}const P=kl(o,s,d);return P&&h.push(P),h}function sd(i,t,e,n){const s=[],r=[...i.legs].sort((x,w)=>Math.atan2(x.dirx,-x.dirz)-Math.atan2(w.dirx,-w.dirz));if(r.length<2)return s;const o={x:i.x,z:i.z},a=[];for(const x of r){const w=(t.roads||[]).find(k=>k.id===x.roadId),E=e.get(x.roadId);if(!w||!E)continue;const C=Js(w,n),D=Se(E.samples,x.sTrim),g=C.baseY(D),y=C.halfRoad(D),U=[-x.halfW,x.halfW].map(k=>({o:k,x:D.x-D.tz*k,z:D.z+D.tx*k,y:C.crossY(D,g,y,k)}));a.push({leg:x,road:w,smp:E,ctx:C,b:D,yC:C.crossY(D,g,y,0),edges:U})}if(a.length<2)return s;const l=a.length;for(let x=0;x<l;x++){const w=a[x],E=a[(x-1+l)%l],C=a[(x+1)%l],D=w.edges.map(k=>Math.hypot(k.x-E.b.x,k.z-E.b.z)),g=w.edges.map(k=>Math.hypot(k.x-C.b.x,k.z-C.b.z));let y=D[0]<=D[1]?0:1,U=g[0]<=g[1]?0:1;y===U&&(U=1-U),w.ePrev=w.edges[y],w.eNext=w.edges[U]}const c=[];for(let x=0;x<l;x++){const w=a[x].eNext,E=a[(x+1)%l].ePrev;c.push({x:w.x,y:w.y,z:w.z});const C=Math.atan2(w.x-o.x,w.z-o.z);let g=Math.atan2(E.x-o.x,E.z-o.z)-C;for(;g>Math.PI;)g-=2*Math.PI;for(;g<-Math.PI;)g+=2*Math.PI;const y=Math.hypot(w.x-o.x,w.z-o.z),U=Math.hypot(E.x-o.x,E.z-o.z);for(let k=1;k<6;k++){const H=k/6,O=H*H*(3-2*H),V=C+g*H,B=y+(U-y)*H;c.push({x:o.x+B*Math.sin(V),y:w.y+(E.y-w.y)*O,z:o.z+B*Math.cos(V)})}c.push({x:E.x,y:E.y,z:E.z})}const u=a.reduce((x,w)=>x+w.yC,0)/l,h=[...a].sort((x,w)=>w.leg.halfW-x.leg.halfW)[0],f=(Ui[h.road.surface]||Ui.asphalt).road,p=ed("junction-top",null,o.x,u,o.z,c,f);p&&(p.junction=i.id,s.push(p));const _=[];for(let x=0;x<=c.length;x++){const w=c[x%c.length];let E=w.x-o.x,C=w.z-o.z;const D=Math.hypot(E,C)||1;E/=D,C/=D,_.push([{x:w.x,y:w.y+.01,z:w.z,nx:E,ny:.15,nz:C,r:$n[0],g:$n[1],b:$n[2],u:x,v:0},{x:w.x+E*.3,y:w.y-.55,z:w.z+C*.3,nx:E,ny:.15,nz:C,r:$n[0],g:$n[1],b:$n[2],u:x,v:1}])}const S=Yn("junction-skirt",null,_);S&&(S.junction=i.id,s.push(S));const m=[],d=i.radius,A=(x,w,E,C,D=0)=>{const g=x.b,y={x:o.x-g.x,z:o.z-g.z},U=Math.hypot(y.x,y.z)||1,k=Math.sign((y.x*g.tx+y.z*g.tz)/U)||1,H=x.leg.sTrim+k*d*(1-w),O=Se(x.smp.samples,H),V=x.ctx.crossY(O,x.ctx.baseY(O),x.ctx.halfRoad(O),0)+.025;let B=O.tx,$=O.tz;if(D){const ft=Math.cos(D),yt=Math.sin(D),ct=B*ft-$*yt,pt=B*yt+$*ft;B=ct,$=pt}const Z=-$,rt=B;m.push([[O.x-Z*E-B*C/2,V,O.z-rt*E-$*C/2],[O.x+Z*E-B*C/2,V,O.z+rt*E-$*C/2],[O.x+Z*E+B*C/2,V,O.z+rt*E+$*C/2],[O.x-Z*E+B*C/2,V,O.z-rt*E+$*C/2]])};if(i.kind==="merge"){for(const x of a)if(x.leg.role==="branch")for(const w of[.4,.55,.7])A(x,w,1.2,.22,.6)}else{if(i.kind==="tee"||i.kind==="multi")for(const x of a){if(x.leg.role!=="branch")continue;const w=x.leg.halfW*.72;A(x,.55,w,.5)}if(i.kind==="cross"||i.kind==="tee"||i.kind==="wye"||i.kind==="multi")for(const x of a){const w=Math.max(1,x.leg.halfW-.6);for(const E of[.66,.78,.9])A(x,E,w,.45)}}const P=nd("junction-paint",null,m,bi);return P&&(P.junction=i.id,s.push(P)),s}function Vl(i,t){const e=[];for(let n=i.s0+3;n<i.s1-3+1e-6;n+=t)e.push(n);return e}function rd(i,t,e,n,s){const r=[],o=Js(i,n),l=Bl(t,[{s0:-1e9,s1:e.s0},{s0:e.s1,s1:1e9}])[0];if(!l||l.length<2)return r;const c=x=>o.halfRoad(x)+Math.max(o.shoulders(x)[0],o.shoulders(x)[1])+.18,u=x=>o.crossY(x,o.baseY(x),o.halfRoad(x),0);for(const x of[-1,1]){const w=l.map(C=>{const D=x*c(C),g=Math.hypot(1,.05),y=U=>({x:C.x-C.tz*D,y:U,z:C.z+C.tx*D,nx:-C.tz*x/g,ny:.05/g,nz:C.tx*x/g,r:He[0],g:He[1],b:He[2],u:D,v:C.s});return[y(u(C)-.03),y(u(C)-1.15)]}),E=Yn("bridge-fascia",i.id,w);E&&r.push(E)}const h=l.reduce((x,w)=>x+c(w),0)/l.length,f=Math.min(5,Math.max(2,Math.round(h*2/3.2)));for(let x=0;x<f;x++){const w=f===1?0:(-1+2*x/(f-1))*((h-.9)/h),E=[{o:-.2,top:!0,n:[-1,0,0]},{o:.2,top:!0,n:[1,0,0]}];for(const g of E){const y=g.o<0?-1:1,U=l.map(H=>{const O=w*c(H)+g.o,V=B=>({x:H.x-H.tz*O,y:B,z:H.z+H.tx*O,nx:-H.tz*y,ny:0,nz:H.tx*y,r:kn[0],g:kn[1],b:kn[2],u:O,v:H.s});return[V(u(H)-.28),V(u(H)-1.02)]}),k=Yn("bridge-girder",i.id,U);k&&r.push(k)}const C=l.map(g=>{const y=w*c(g),U=u(g)-1.02,k=H=>({x:g.x-g.tz*H,y:U,z:g.z+g.tx*H,nx:0,ny:-1,nz:0,r:kn[0],g:kn[1],b:kn[2],u:H,v:g.s});return[k(y-.2),k(y+.2)]}),D=Yn("bridge-girder",i.id,C);D&&r.push(D)}const p=Math.min(30,Math.max(4,+i.bridgeSpacing||12)),_=(x,w)=>(s?.intersections||[]).some(E=>Math.hypot(E.x-x,E.z-w)<E.radius),S=(x,w,E)=>{if(typeof n=="function"){const C=n(x,w);if(C!=null&&Number.isFinite(C))return C}return E};let m=1/0;for(const x of l)m=Math.min(m,u(x));const d=[];for(const x of Vl(e,p)){const w=Se(t,x);if(_(w.x,w.z))continue;const E=Math.atan2(w.tx,w.tz),C=u(w)-1.02,D=S(w.x,w.z,m-6);if(C-D<1.2)continue;const g=c(w);d.push({c:[w.x,C-.45,w.z],s:[g*2+.8,.9,1.2],yaw:E,color:He});const y=g*2>7?[-(g-1.3),g-1.3]:[0];for(const U of y){const k=w.x-w.tz*U,H=w.z+w.tx*U,O=D+.15;d.push({c:[k,O-.35,H],s:[2,.7,2],yaw:E,color:$n});const V=C-.9-O;V>.3&&d.push({c:[k,O+V/2,H],s:[.85,V,.85],yaw:E,color:He})}d.push({c:[w.x,C-.35,w.z],s:[g*2-.6,.65,.5],yaw:E,color:kn})}for(const[x,w]of[[e.s0,-1],[e.s1,1]]){const E=Se(t,x),C=Math.atan2(E.tx,E.tz),D=Math.cos(C),g=Math.sin(C),y=u(E),U=S(E.x,E.z,y-4),k=c(E),H=Math.max(1.2,y+.4-U);d.push({c:[E.x,U+H/2,E.z],s:[k*2+2.4,H,1.6],yaw:C,color:He});for(const O of[-1,1]){const V=O*(k+1.6),B=w*2.4;d.push({c:[E.x+V*D+B*g,U+H*.75/2,E.z-V*g+B*D],s:[.6,H*.75,4.4],yaw:C+O*w*.6,color:He})}}const A=kl("bridge-substructure",i.id,d);A&&r.push(A);const P=i.bridgeParapet==="wall"?"wall":"rail";for(const x of[-1,1])if(P==="rail"){const w=C=>x*(c(C)+.3),E=C=>o.crossY(C,o.baseY(C),o.halfRoad(C),x*(c(C)-.1));r.push(...Hl(l,x,w,E,{roadId:i.id,railName:"bridge-rail",postName:"bridge-posts",bury:!0,onDeck:!0}))}else{const w=H=>x*(c(H)+.35),E=H=>x*(c(H)+.27),C=H=>w(H)-x*.35,D=[{o0:w,y0:.02,o1:E,y1:.85,n:x},{o0:C,y0:.02,o1:C,y1:.85,n:-x}];for(const H of D){const O=l.map(B=>{const $=u(B),Z=(rt,ft)=>({x:B.x-B.tz*rt,y:$+ft,z:B.z+B.tx*rt,nx:-B.tz*H.n,ny:.06,nz:B.tx*H.n,r:He[0],g:He[1],b:He[2],u:rt,v:B.s});return[Z(H.o0(B),H.y0),Z(H.o1(B),H.y1)]}),V=Yn("bridge-parapet",i.id,O);V&&r.push(V)}const g=l.map(H=>{const O=u(H),V=(B,$)=>({x:H.x-H.tz*B,y:O+$,z:H.z+H.tx*B,nx:0,ny:1,nz:0,r:He[0],g:He[1],b:He[2],u:B,v:H.s});return[V(C(H),.85),V(E(H),.85)]}),y=Yn("bridge-parapet",i.id,g);y&&r.push(y);const U=l.map(H=>{const O=u(H),V=E(H)+x*.02,B=$=>({x:H.x-H.tz*V,y:O+$,z:H.z+H.tx*V,nx:-H.tz*x,ny:0,nz:H.tx*x,r:Pi[0],g:Pi[1],b:Pi[2],u:V,v:H.s});return[B(.88),B(1.06)]}),k=Yn("bridge-parapet-rail",i.id,U);k&&r.push(k)}return r}function ko(i,t,e,n){const s=[],r={triangles:0,roads:0,junctions:0,bridges:0,overpasses:0},o=typeof n=="function"?n:null;for(const a of i.roads||[]){if(a.visible===!1)continue;const l=t.get(a.id);if(!l||!l.count)continue;const c=Js(a,o),u=e?.runs?.get(a.id)||[l.samples],h=(e?.bridges||[]).filter(f=>f.roadId===a.id);u.forEach((f,p)=>{const{parts:_,stats:S}=Ol(a,f,c,{tag:u.length>1?String(p):"",railCuts:h});s.push(..._),r.triangles+=S.triangles}),r.roads++}for(const a of e?.intersections||[]){for(const l of sd(a,i,t,o))l.junction=a.id,l.name=`junction_${zl(a.id)}__${l.name}`,s.push(l),r.triangles+=l.triangles;r.junctions++}for(const a of e?.bridges||[]){const l=(i.roads||[]).find(u=>u.id===a.roadId),c=t.get(a.roadId);if(!(!l||!c||l.visible===!1)){for(const u of rd(l,c.samples,a,o,e))s.push(u),r.triangles+=u.triangles;r.bridges++}}return r.overpasses=e?.overpasses?.length||0,{parts:s,stats:r}}const Gr="frontier-road-network",Wr=1,xa=["#4a90e2","#e2a44a","#7ee7a5","#c792ea","#f6c66a","#6cd5e0","#f28b82","#9aa0a6"],de=(i,t)=>Number.isFinite(+i)?+i:t;function ts(i,t,e={}){return{id:i,name:`Road ${t}`,color:xa[(t-1)%xa.length],visible:!0,closed:!1,lanes:2,laneWidth:3.5,shoulderL:1,shoulderR:1,kerbL:!1,kerbR:!1,camber:.06,surface:"asphalt",centerMarking:"dashed",edgeMarking:!0,guardrailL:!1,guardrailR:!1,bridgeParapet:"rail",bridgeSpacing:12,conform:"design",drapeOffset:.15,points:[],...e}}function Ho(i="Untitled route"){return{format:Gr,version:Wr,units:"meters",up:"+Y",name:i,nextId:1,roads:[],junctions:[],heightmap:null,settings:{cornerRadius:6},intersectionOverrides:{}}}function Ws(i,t){return`${t}${i.nextId++}`}function od(i,t){const e=(Array.isArray(i.points)?i.points:[]).map((s,r)=>{(!Number.isFinite(+s?.x)||!Number.isFinite(+s?.z))&&t.push(`point #${r+1} had bad XZ and was reset to origin`);const o={x:de(s?.x,0),z:de(s?.z,0),y:de(s?.y,0),w:de(s?.w,1)||1};return s?.bridge&&(o.bridge=!0),o}),n=Math.min(6,Math.max(1,Math.round(de(i.lanes,2))));return{id:String(i.id||`r${Math.floor(Math.random()*1e9)}`),name:String(i.name||"Road"),color:/^#[0-9a-f]{6}$/i.test(i.color||"")?i.color:"#4a90e2",visible:i.visible!==!1,closed:!!i.closed,lanes:n,laneWidth:Math.min(12,Math.max(1.5,de(i.laneWidth,3.5))),shoulderL:Math.min(12,Math.max(0,de(i.shoulderL,1))),shoulderR:Math.min(12,Math.max(0,de(i.shoulderR,1))),kerbL:!!i.kerbL,kerbR:!!i.kerbR,camber:Math.min(.5,Math.max(0,de(i.camber,.06))),surface:Fl.includes(i.surface)?i.surface:"asphalt",centerMarking:["none","single","double","dashed"].includes(i.centerMarking)?i.centerMarking:"dashed",edgeMarking:i.edgeMarking!==!1,guardrailL:!!i.guardrailL,guardrailR:!!i.guardrailR,bridgeParapet:i.bridgeParapet==="wall"?"wall":"rail",bridgeSpacing:Math.min(30,Math.max(4,de(i.bridgeSpacing,12))),conform:i.conform==="drape"?"drape":"design",drapeOffset:Math.min(50,Math.max(-50,de(i.drapeOffset,.15))),points:e}}function Xr(i){const t=[];let e=i;if(typeof e=="string")try{e=JSON.parse(e)}catch{throw new Error("Not valid JSON — the file could not be parsed.")}if(!e||typeof e!="object")throw new Error("Not a road project file.");e.format!==Gr&&t.push(`format is “${e.format||"?"}”, expected “${Gr}” — loading anyway`),de(e.version,1)>Wr&&t.push(`version ${e.version} is newer than this editor (v${Wr}) — some data may be ignored`);const n=Ho(String(e.name||"Imported route"));n.nextId=Math.max(1,Math.round(de(e.nextId,1))||1),n.roads=(Array.isArray(e.roads)?e.roads:[]).map(o=>od(o,t)),n.junctions=(Array.isArray(e.junctions)?e.junctions:[]).map((o,a)=>({id:String(o.id||`j${a+1}`),name:String(o.name||`Junction ${a+1}`),x:de(o.x,0),z:de(o.z,0),y:de(o.y,0),links:(Array.isArray(o.links)?o.links:[]).filter(l=>l&&l.road&&(l.end==="start"||l.end==="end")).map(l=>({road:String(l.road),end:l.end}))}));for(const o of n.junctions){const a=o.links.length;o.links=o.links.filter(l=>n.roads.some(c=>c.id===l.road)),o.links.length!==a&&t.push(`junction “${o.name}” referenced a missing road — link dropped`)}const s=e.heightmap;if(s&&typeof s=="object"&&(n.heightmap={name:String(s.name||"heightmap"),kind:s.kind==="demo"?"demo":"image",width:Math.round(de(s.width,0))||0,height:Math.round(de(s.height,0))||0,minX:de(s.minX,-100),maxX:de(s.maxX,100),minZ:de(s.minZ,-100),maxZ:de(s.maxZ,100),base:de(s.base,0),scale:de(s.scale,30),image:typeof s.image=="string"&&s.image.startsWith("data:image/")?s.image:null},(n.heightmap.width<=0||!n.heightmap.image)&&s.grid&&(n.heightmap.grid=s.grid)),n.settings={cornerRadius:Math.min(14,Math.max(2,de(e.settings?.cornerRadius,6)))},n.intersectionOverrides={},e.intersectionOverrides&&typeof e.intersectionOverrides=="object")for(const[o,a]of Object.entries(e.intersectionOverrides))/^[\w@.-]{1,80}$/.test(o)&&a&&typeof a=="object"&&(n.intersectionOverrides[o]={enabled:a.enabled!==!1});const r=new Set;for(const o of n.roads)r.has(o.id)&&(o.id=`${o.id}_${Math.floor(Math.random()*1e6)}`,t.push("duplicate road id repaired")),r.add(o.id);for(const o of n.junctions)r.has(o.id)&&(o.id=`${o.id}_${Math.floor(Math.random()*1e6)}`,t.push("duplicate junction id repaired")),r.add(o.id);return{project:n,warnings:t}}function ad(i){return JSON.stringify(i,null,2)}function ld(i,{step:t=2}={}){const e=["road_id,road_name,s_m,x_m,y_m,z_m,heading_deg,grade_pct,radius_m,width_m"];for(const n of i.roads||[]){const s=Hi(n.points,{closed:n.closed,step:t}),r=n.lanes*n.laneWidth+n.shoulderL+n.shoulderR;for(const o of s.samples)e.push([n.id,`"${String(n.name).replace(/"/g,'""')}"`,o.s.toFixed(2),o.x.toFixed(3),o.y.toFixed(3),o.z.toFixed(3),o.hdg.toFixed(1),(o.grade*100).toFixed(2),Number.isFinite(o.radius)?o.radius.toFixed(1):"",(r*(o.w||1)).toFixed(2)].join(","))}return e.join(`
`)+`
`}function cd(i,t,e,n,s){if(!(n>=0&&s>=0&&n<=t-1&&s<=e-1))return null;const r=Math.floor(n),o=Math.floor(s),a=Math.min(t-1,r+1),l=Math.min(e-1,o+1),c=n-r,u=s-o,h=i[o*t+r],f=i[o*t+a],p=i[l*t+r],_=i[l*t+a];return(h*(1-c)+f*c)*(1-u)+(p*(1-c)+_*c)*u}function Xs(i,t,e,n,s=1){const{minX:r,maxX:o,minZ:a,maxZ:l}=n;let c=1/0,u=-1/0;for(let h=0;h<i.length;h++)i[h]<c&&(c=i[h]),i[h]>u&&(u=i[h]);return{rev:s,bounds:{...n},minY:c,maxY:u,gridW:t,gridH:e,grid:i,sample(h,f){if(h<r||h>o||f<a||f>l)return null;const p=(h-r)/(o-r)*(t-1),_=(f-a)/(l-a)*(e-1);return cd(i,t,e,p,_)}}}function Gl(i={minX:-160,maxX:160,minZ:-160,maxZ:160},t=128){const e=t,n=t,s=new Float32Array(e*n);for(let r=0;r<n;r++)for(let o=0;o<e;o++){const a=i.minX+(i.maxX-i.minX)*o/(e-1),l=i.minZ+(i.maxZ-i.minZ)*r/(n-1);s[r*e+o]=26*Math.exp(-((a+70)**2+(l-40)**2)/9800)+40*Math.exp(-((a-80)**2+(l+60)**2)/6050)+9*Math.exp(-((a-20)**2+(l-90)**2)/3200)+3.2*Math.sin(a*.045)*Math.cos(l*.05)+1.1*Math.sin(a*.13+1.7)*Math.sin(l*.11+.4)}return{grid:s,w:e,h:n,bounds:i}}const Vo=()=>typeof document<"u";async function Wl(i,{bounds:t,base:e=0,scale:n=30,maxCells:s=256}={}){if(!Vo())throw new Error("Image decoding needs a browser.");const r=await new Promise((p,_)=>{const S=new Image;S.onload=()=>p(S),S.onerror=()=>_(new Error("Could not decode that image as a heightmap.")),S.src=i}),o=Math.min(1,s/Math.max(r.naturalWidth,r.naturalHeight)),a=Math.max(2,Math.round(r.naturalWidth*o)),l=Math.max(2,Math.round(r.naturalHeight*o)),c=document.createElement("canvas");c.width=a,c.height=l;const u=c.getContext("2d",{willReadFrequently:!0});u.drawImage(r,0,0,a,l);const h=u.getImageData(0,0,a,l).data,f=new Float32Array(a*l);for(let p=0;p<a*l;p++){const _=(h[p*4]*.299+h[p*4+1]*.587+h[p*4+2]*.114)/255;f[p]=e+_*n}return Xs(f,a,l,t||{minX:-a/2,maxX:a/2,minZ:-l/2,maxZ:l/2})}function dd(i){return new Promise((t,e)=>{const n=new FileReader;n.onload=()=>t(n.result),n.onerror=()=>e(new Error("Could not read that file.")),n.readAsDataURL(i)})}function or(i,t,e="application/json"){if(!Vo())return;const n=new Blob([t],{type:e}),s=URL.createObjectURL(n),r=document.createElement("a");r.href=s,r.download=i,document.body.appendChild(r),r.click(),r.remove(),setTimeout(()=>URL.revokeObjectURL(s),8e3)}function ud(i,t){Vo()&&i.toBlob(e=>{if(!e)return;const n=URL.createObjectURL(e),s=document.createElement("a");s.href=n,s.download=t,document.body.appendChild(s),s.click(),s.remove(),setTimeout(()=>URL.revokeObjectURL(n),8e3)},"image/png")}function hd(){const i=Ho("Ridge Pass");return i.nextId=5,i.roads=[{...ts("r1",1,{name:"Ridge Pass",color:"#4a90e2"}),lanes:2,laneWidth:3.5,shoulderL:1.2,shoulderR:1.2,centerMarking:"double",edgeMarking:!0,guardrailL:!0,guardrailR:!0,surface:"asphalt",points:[{x:-150,z:60,y:2,w:1},{x:-105,z:44,y:5,w:1},{x:-62,z:52,y:8,w:1},{x:-28,z:22,y:11,w:1},{x:-34,z:-22,y:14,w:1},{x:-4,z:-48,y:17,w:1},{x:38,z:-38,y:20,w:1},{x:52,z:2,y:22,w:1}]},{...ts("r2",2,{name:"Quarry Spur",color:"#e2a44a"}),lanes:1,laneWidth:4.5,shoulderL:.8,shoulderR:.8,centerMarking:"none",edgeMarking:!1,surface:"gravel",points:[{x:52,z:2,y:22,w:1},{x:92,z:10,y:19,w:1},{x:128,z:34,y:16,w:1.15},{x:142,z:72,y:13,w:1.25}]},{...ts("r3",3,{name:"Overlook Loop",color:"#7ee7a5"}),closed:!0,lanes:1,laneWidth:3.2,shoulderL:.5,shoulderR:.5,centerMarking:"dashed",edgeMarking:!0,surface:"dirt",points:[{x:-78,z:-72,y:30,w:1},{x:-44,z:-84,y:31,w:1},{x:-18,z:-62,y:30,w:1},{x:-30,z:-34,y:29,w:1},{x:-66,z:-38,y:29,w:1}]}],i.junctions=[{id:"j4",name:"Pass Summit",x:52,z:2,y:22,links:[{road:"r1",end:"end"},{road:"r2",end:"start"}]}],i}const va={asphalt:{road:"#43474e",shoulder:"#33363c"},concrete:{road:"#8f9494",shoulder:"#717677"},gravel:{road:"#7d6f52",shoulder:"#66593f"},dirt:{road:"#6e5230",shoulder:"#59432a"}},ai="#4a90e2";function fd(i,t,e){const n=i.getContext("2d"),s=i.parentElement;let r=300,o=300,a=1;const l={cx:0,cz:0,scale:4};let c=null,u=null,h=null,f=!1,p=!1,_=null,S=null,m={rev:-1,canvas:null};const d=(W,G)=>[(W-l.cx)*l.scale+r/2,(G-l.cz)*l.scale+o/2],A=(W,G)=>({x:(W-r/2)/l.scale+l.cx,z:(G-o/2)/l.scale+l.cz});function P(){const W=s.getBoundingClientRect();a=Math.min(2,window.devicePixelRatio||1),r=Math.max(50,W.width),o=Math.max(50,W.height),i.width=Math.round(r*a),i.height=Math.round(o*a),rt()}function x(W=null,G=-1){const K=[],dt=t.project;for(const v of dt.roads){if(v.visible===!1)continue;const F=Ne(dt,v),T=F.length;for(let b=0;b<T;b++)v.closed||b!==0&&b!==T-1||v.id===W&&b===G||K.push({x:F[b].x,z:F[b].z,roadId:v.id,index:b})}return K}function w(W,G,K=null,dt=!1){let v=W,F=G,T=null,b=null,z=null,N=!1;if(t.ui.snapNode){let I=12/l.scale;for(const X of x(K?.roadId,K?.index??-1)){const q=Math.hypot(X.x-W,X.z-G);q<I&&(I=q,b=X)}b&&(v=b.x,F=b.z)}if(!b&&dt&&t.ui.snapNode){let I=12/l.scale,X=null;for(const q of t.project.roads){if(q.visible===!1||K&&q.id===K.roadId)continue;const nt=e.getSamples(q.id);if(!nt||!nt.count)continue;const R=nt.samples,M=R.length,j=nt.closed?M:M-1;for(let tt=0;tt<j;tt++){const st=R[tt],it=R[(tt+1)%M];if(W<Math.min(st.x,it.x)-I||W>Math.max(st.x,it.x)+I||G<Math.min(st.z,it.z)-I||G>Math.max(st.z,it.z)+I)continue;const{d:Et,t:mt}=Si(W,G,st.x,st.z,it.x,it.z);Et<I&&(I=Et,X={a:st,b:it,t:mt,roadId:q.id})}}if(X){const{a:q,b:nt,t:R}=X;v=q.x+(nt.x-q.x)*R,F=q.z+(nt.z-q.z)*R,T=q.y+(nt.y-q.y)*R,z={roadId:X.roadId}}}if(!b&&!z&&t.ui.snapGrid){const I=t.ui.gridSize||1;v=Math.round(W/I)*I,F=Math.round(G/I)*I,N=!0}return{x:v,z:F,y:T,node:b,curve:z,grid:N}}function E(W,G){const K=t.project,dt=A(W,G);for(const z of K.junctions||[]){const[N,I]=d(z.x,z.z);if(Math.hypot(N-W,I-G)<13)return{kind:"junction",junctionId:z.id}}let v=null,F=11;for(const z of K.roads){if(z.visible===!1)continue;const N=Ne(K,z);for(let I=0;I<N.length;I++){const[X,q]=d(N[I].x,N[I].z),nt=Math.hypot(X-W,q-G);nt<F&&(F=nt,v={kind:"point",roadId:z.id,index:I})}}if(v)return v;let T=null,b=9/l.scale;for(const z of K.roads){if(z.visible===!1)continue;const N=e.getSamples(z.id);if(!N||!N.count)continue;const I=N.samples,X=I.length,q=N.closed?X:X-1;for(let nt=0;nt<q;nt++){const R=I[nt],M=I[(nt+1)%X],{d:j}=Si(dt.x,dt.z,R.x,R.z,M.x,M.z),tt=Vr(z)*(R.w||1)/2;j<Math.max(b,tt+1.5/l.scale)&&(T={kind:"road",roadId:z.id,seg:nt,t:0},b=j)}}return T}function C(W,G,K){const dt=e.getSamples(W);if(!dt||!dt.count)return null;const v=dt.samples,F=v.length,T=dt.closed?F:F-1;let b=null;for(let z=0;z<T;z++){const N=v[z],I=v[(z+1)%F],{d:X,t:q}=Si(G,K,N.x,N.z,I.x,I.z);(!b||X<b.d)&&(b={d:X,i:z,t:q,x:N.x+(I.x-N.x)*q,z:N.z+(I.z-N.z)*q,s:N.s+(I.s-N.s)*q})}return b}function D(){const W=e.getTerrain();if(!W)return m={rev:-1,canvas:null},null;if(m.rev===W.rev&&m.canvas)return m.canvas;const G=220,K=document.createElement("canvas");K.width=G,K.height=G;const dt=K.getContext("2d"),v=dt.createImageData(G,G),F=Math.max(1e-6,W.maxY-W.minY);for(let T=0;T<G;T++)for(let b=0;b<G;b++){const z=W.bounds.minX+(W.bounds.maxX-W.bounds.minX)*b/(G-1),N=W.bounds.minZ+(W.bounds.maxZ-W.bounds.minZ)*T/(G-1),I=W.sample(z,N),X=I==null?0:(I-W.minY)/F,q=18+X*66,nt=26+X*52,R=20+X*30,M=(T*G+b)*4;v.data[M]=q,v.data[M+1]=nt,v.data[M+2]=R,v.data[M+3]=I==null?0:235}return dt.putImageData(v,0,0),m={rev:W.rev,canvas:K},K}function g(W,G,K,dt){n.strokeStyle=K,n.lineWidth=dt,n.lineJoin="round",n.lineCap=G?"round":"butt",n.beginPath(),W.forEach((v,F)=>{const[T,b]=d(v.x,v.z);F===0?n.moveTo(T,b):n.lineTo(T,b)}),G&&n.closePath(),n.stroke()}function y(W,G,K,dt){const v=[],F=[];for(const T of W){const b=K(T),z=dt(T);v.push([T.x-T.tz*b,T.z+T.tx*b]),F.push([T.x-T.tz*z,T.z+T.tx*z])}n.beginPath(),v.forEach(([T,b],z)=>{const[N,I]=d(T,b);z===0?n.moveTo(N,I):n.lineTo(N,I)});for(let T=F.length-1;T>=0;T--){const[b,z]=d(F[T][0],F[T][1]);n.lineTo(b,z)}n.closePath()}function U(W,G,K,dt,v){if(!G.length)return;const F=va[W.surface]||va.asphalt,T=X=>W.lanes*W.laneWidth*(X.w||1)/2,b=X=>-(T(X)+W.shoulderL*(X.w||1)),z=X=>T(X)+W.shoulderR*(X.w||1),N=Vr(W),I=N*l.scale>=5;if(dt&&(n.save(),n.shadowColor=ai,n.shadowBlur=14,g(G,K,"rgba(74,144,226,.55)",Math.max(3,N*l.scale+5)),n.restore()),I){n.fillStyle="rgba(0,0,0,.9)",y(G,K,q=>b(q)-.35,q=>z(q)+.35),n.fill(),(W.shoulderL>0||W.shoulderR>0)&&(n.fillStyle=F.shoulder,y(G,K,b,z),n.fill()),n.fillStyle=F.road,y(G,K,q=>-T(q),q=>T(q)),n.fill();const X=W.centerMarking;if(X==="single"||X==="double"){const q=X==="single"?[0]:[-.18,.18];for(const nt of q)n.strokeStyle=X==="double"?"#d8b93a":"#dfe3e6",n.lineWidth=Math.max(1,.13*l.scale),n.beginPath(),G.forEach((R,M)=>{const[j,tt]=d(R.x-R.tz*nt,R.z+R.tx*nt);M===0?n.moveTo(j,tt):n.lineTo(j,tt)}),K&&n.closePath(),n.stroke()}else if(X==="dashed"){n.strokeStyle="#dfe3e6",n.lineWidth=Math.max(1,.13*l.scale),n.lineCap="butt";let q=[];const nt=()=>{q.length>1&&(n.beginPath(),q.forEach(([R,M],j)=>j===0?n.moveTo(R,M):n.lineTo(R,M)),n.stroke()),q=[]};G.forEach(R=>{if(R.s%9<3){const[M,j]=d(R.x,R.z);q.push([M,j])}else nt()}),nt()}if(W.edgeMarking){n.strokeStyle="rgba(223,227,230,.85)",n.lineWidth=Math.max(1,.11*l.scale);for(const q of[-1,1]){n.beginPath();let nt=!1;for(const R of G){const M=T(R);if(M<.7){nt=!1;continue}const j=q*(M-.22),[tt,st]=d(R.x-R.tz*j,R.z+R.tx*j);nt?n.lineTo(tt,st):(n.moveTo(tt,st),nt=!0)}n.stroke()}}}else g(G,K,"rgba(0,0,0,.9)",5),g(G,K,W.color||F.road,3);if(l.scale>=1.2&&!K){n.fillStyle=dt?"#fff":"rgba(255,255,255,.5)";const X=Math.max(1,Math.round(28/(l.scale*1)));for(let q=X;q<G.length-1;q+=X*3){const nt=G[q],[R,M]=d(nt.x,nt.z),j=Math.atan2(nt.tz,nt.tx);n.save(),n.translate(R,M),n.rotate(j),n.beginPath(),n.moveTo(-3.4,-4),n.lineTo(3.6,0),n.lineTo(-3.4,4),n.closePath(),n.fill(),n.restore()}}if(v&&l.scale>=2.2){const X=G[Math.floor(G.length/2)],[q,nt]=d(X.x,X.z);n.font='600 11px "Segoe UI",system-ui,sans-serif';const R=n.measureText(W.name).width;n.fillStyle="rgba(0,0,0,.72)";const M=q-R/2-7,j=nt-26;n.beginPath(),n.roundRect(M,j,R+14,18,9),n.fill(),n.fillStyle=dt?"#fff":"rgba(237,237,237,.75)",n.textAlign="center",n.textBaseline="middle",n.fillText(W.name,q,j+9.5)}}function k(W,G){const K=t.project,dt=Ne(K,W),v=t.selection;G&&dt.length>1&&(n.strokeStyle="rgba(74,144,226,.5)",n.lineWidth=1,n.setLineDash([5,4]),n.beginPath(),dt.forEach((T,b)=>{const[z,N]=d(T.x,T.z);b===0?n.moveTo(z,N):n.lineTo(z,N)}),W.closed&&n.closePath(),n.stroke(),n.setLineDash([]));const F=!G&&l.scale>=4;if(!(!G&&!F))for(let T=0;T<dt.length;T++){const[b,z]=d(dt[T].x,dt[T].z),N=G&&v.kind==="point"&&v.index===T,I=c?.kind==="point"&&c.roadId===W.id&&c.index===T,X=!!Sn(K,W.id,T);if(!G){n.fillStyle="rgba(255,255,255,.55)",n.fillRect(b-2,z-2,4,4);continue}const q=N||I?11:9;n.fillStyle=N?ai:"#f4f4f5",n.strokeStyle="#0a0a0b",n.lineWidth=2,n.beginPath(),n.rect(b-q/2,z-q/2,q,q),n.fill(),n.stroke(),X&&(n.strokeStyle="#f59e0b",n.lineWidth=1.6,n.beginPath(),n.arc(b,z,q/2+4,0,Math.PI*2),n.stroke()),W.points[T]?.bridge&&(n.fillStyle="#6cd5e0",n.fillRect(b-2.5,z+7,5,5)),!W.closed&&(T===0||T===dt.length-1)&&(n.fillStyle="rgba(255,255,255,.85)",n.font='700 8px "Segoe UI",system-ui,sans-serif',n.textAlign="center",n.fillText(T===0?"A":"B",b,z-9))}}function H(W){if(W){for(const G of W.intersections||[]){const[K,dt]=d(G.x,G.z),v=G.radius*l.scale;if(!(v<6)){n.beginPath(),n.arc(K,dt,v,0,Math.PI*2),n.fillStyle="rgba(38,40,45,.92)",n.fill(),n.strokeStyle="rgba(246,198,106,.55)",n.lineWidth=1.5,n.stroke(),n.strokeStyle="rgba(255,255,255,.28)",n.lineWidth=1,n.beginPath();for(const F of G.legs)n.moveTo(K,dt),n.lineTo(K+F.dirx*v*.8,dt+F.dirz*v*.8);n.stroke(),n.fillStyle="rgba(246,198,106,.95)",n.font='700 10px "Segoe UI",system-ui,sans-serif',n.textAlign="center",n.textBaseline="middle",n.fillText({cross:"X",tee:"T",merge:"M",wye:"Y",elbow:"L",multi:"*"}[G.kind]||"?",K,dt)}}for(const G of W.overpasses||[]){const[K,dt]=d(G.x,G.z),v=G.gap<4.5;n.strokeStyle=v?"#ef4444":"rgba(125,231,165,.85)",n.lineWidth=1.6,n.beginPath(),n.arc(K,dt,9,0,Math.PI*2),n.stroke(),n.fillStyle=v?"#ef4444":"rgba(125,231,165,.95)",n.font='600 10px "Segoe UI",system-ui,sans-serif',n.textAlign="left",n.textBaseline="middle",n.fillText(`${G.gap.toFixed(1)}m`,K+12,dt)}for(const G of W.bridges||[]){const K=Ct(t.project,G.roadId),dt=e.getSamples(G.roadId);if(!K||!dt)continue;const v=dt.samples.filter(F=>F.s>=G.s0&&F.s<=G.s1);if(v.length>1)for(const F of[-1,1])n.strokeStyle="rgba(125,213,224,.9)",n.lineWidth=1.4,n.beginPath(),v.forEach((T,b)=>{const z=K.lanes*K.laneWidth*(T.w||1)/2,N=(F<0?K.shoulderL:K.shoulderR)*(T.w||1),I=F*(z+N+.18),[X,q]=d(T.x-T.tz*I,T.z+T.tx*I);b===0?n.moveTo(X,q):n.lineTo(X,q)}),n.stroke();n.fillStyle="rgba(125,213,224,.95)";for(const F of Vl(G,+K.bridgeSpacing||12)){const T=Se(dt.samples,F),[b,z]=d(T.x,T.z);n.fillRect(b-2.5,z-2.5,5,5)}}}}function O(){const W=t.project,G=t.selection;n.textAlign="left",n.textBaseline="middle";for(const K of W.junctions||[]){const[dt,v]=d(K.x,K.z),F=G.kind==="junction"&&G.junctionId===K.id,T=c?.kind==="junction"&&c.junctionId===K.id;n.save(),n.translate(dt,v),n.rotate(Math.PI/4);const b=F||T?13:11;n.fillStyle=F?ai:"#f59e0b",n.strokeStyle="#0a0a0b",n.lineWidth=2,n.fillRect(-b/2,-b/2,b,b),n.strokeRect(-b/2,-b/2,b,b),n.restore(),n.font='600 10.5px "Segoe UI",system-ui,sans-serif',n.fillStyle="rgba(246,198,106,.9)",n.fillText(K.name||K.id,dt+11,v-10)}}function V(){if(t.ui.showIssues)for(const W of e.getIssues()){if(W.x==null)continue;const[G,K]=d(W.x,W.z);G<-20||K<-20||G>r+20||K>o+20||(n.fillStyle=W.severity==="error"?"#ef4444":W.severity==="warn"?"#f59e0b":ai,n.strokeStyle="#0a0a0b",n.lineWidth=1.5,n.beginPath(),n.moveTo(G,K-8),n.lineTo(G+7,K+5),n.lineTo(G-7,K+5),n.closePath(),n.fill(),n.stroke(),n.fillStyle="#0a0a0b",n.font='800 8px "Segoe UI",system-ui,sans-serif',n.textAlign="center",n.textBaseline="middle",n.fillText("!",G,K+1.5))}}function B(){let G=[.5,1,2,5,10,25,50,100,250,500,1e3].find(N=>N*l.scale>=26)||1e3;const K=l.cx-r/2/l.scale,dt=l.cx+r/2/l.scale,v=l.cz-o/2/l.scale,F=l.cz+o/2/l.scale;n.lineWidth=1;for(let N=0;N<2;N++){const I=N===0?G:G*5;n.strokeStyle=N===0?"rgba(255,255,255,.055)":"rgba(255,255,255,.11)",n.beginPath();for(let X=Math.ceil(K/I)*I;X<=dt;X+=I){const[q]=d(X,0);n.moveTo(Math.round(q)+.5,0),n.lineTo(Math.round(q)+.5,o)}for(let X=Math.ceil(v/I)*I;X<=F;X+=I){const[,q]=d(0,X);n.moveTo(0,Math.round(q)+.5),n.lineTo(r,Math.round(q)+.5)}n.stroke()}n.font='10px "Segoe UI",system-ui,sans-serif',n.fillStyle="rgba(255,255,255,.28)",n.textAlign="left",n.textBaseline="top";const T=G*5;for(let N=Math.ceil(K/T)*T;N<=dt;N+=T){const[I]=d(N,0);n.fillText(`${N}`,I+4,4)}const[b,z]=d(0,0);b>-30&&b<r+30&&z>-30&&z<o+30&&(n.strokeStyle="rgba(74,144,226,.6)",n.lineWidth=1.5,n.beginPath(),n.moveTo(b-8,z),n.lineTo(b+8,z),n.moveTo(b,z-8),n.lineTo(b,z+8),n.stroke())}function $(){const G=130/l.scale,K=Math.pow(10,Math.floor(Math.log10(G))),dt=[1,2,5,10].map(N=>N*K).find(N=>N>=G)||10*K,v=dt*l.scale,F=14,T=o-24;n.fillStyle="rgba(0,0,0,.65)",n.beginPath(),n.roundRect(F-8,T-8,v+16,30,8),n.fill(),n.fillStyle="#e9e9ec",n.fillRect(F,T+8,v,3),n.fillRect(F,T+4,2,7),n.fillRect(F+v-2,T+4,2,7),n.font='600 10px "Segoe UI",system-ui,sans-serif',n.textAlign="left",n.textBaseline="alphabetic",n.fillText(dt>=1e3?`${(dt/1e3).toFixed(1)} km`:`${dt} m`,F,T+5);const b=r-30,z=34;n.fillStyle="rgba(0,0,0,.65)",n.beginPath(),n.arc(b,z,15,0,Math.PI*2),n.fill(),n.fillStyle="#e9e9ec",n.beginPath(),n.moveTo(b,z-9),n.lineTo(b+5,z+4),n.lineTo(b,z+1),n.lineTo(b-5,z+4),n.closePath(),n.fill(),n.font='700 8px "Segoe UI",system-ui,sans-serif',n.textAlign="center",n.fillText("N",b,z+12)}function Z(){if(!S||!u)return;const W=Ct(t.project,S.roadId);if(!W||!W.points.length)return;const G=W.points[W.points.length-1],[K,dt]=d(G.x,G.z),[v,F]=d(u.x,u.z);n.strokeStyle=ai,n.lineWidth=1.6,n.setLineDash([6,4]),n.beginPath(),n.moveTo(K,dt),n.lineTo(v,F),n.stroke(),n.setLineDash([]),n.fillStyle=ai,n.beginPath(),n.arc(v,F,4,0,Math.PI*2),n.fill()}function rt(){n.setTransform(a,0,0,a,0,0),n.fillStyle="#101010",n.fillRect(0,0,r,o);const W=e.getTerrain(),G=D();if(W&&G){const[T,b]=d(W.bounds.minX,W.bounds.minZ),[z,N]=d(W.bounds.maxX,W.bounds.maxZ);n.imageSmoothingEnabled=!0,n.drawImage(G,T,b,z-T,N-b)}B();const K=t.project,dt=t.selection,v=e.getTopology?.();for(const T of K.roads){if(T.visible===!1)continue;const b=e.getSamples(T.id);if(!b||!b.count)continue;const z=v?.runs?.get(T.id)||[b.samples],N=z.length===1&&z[0].length===b.samples.length,I=z.reduce((X,q)=>q.length>X.length?q:X,z[0]);for(const X of z)U(T,X,N&&b.closed,dt.roadId===T.id,X===I)}H(v);for(const T of K.roads)T.visible!==!1&&k(T,dt.roadId===T.id);if(O(),V(),Z(),h){const[T,b]=d(h.x,h.z);n.strokeStyle=h.node?"#f59e0b":h.curve?"#7ee7a5":"rgba(74,144,226,.8)",n.lineWidth=1.6,n.beginPath(),n.arc(T,b,9,0,Math.PI*2),n.stroke(),n.beginPath(),n.moveTo(T-13,b),n.lineTo(T-6,b),n.moveTo(T+6,b),n.lineTo(T+13,b),n.moveTo(T,b-13),n.lineTo(T,b-6),n.moveTo(T,b+6),n.lineTo(T,b+13),n.stroke()}if(c?.kind==="point"){const T=Ct(K,c.roadId);if(T){const z=Ne(K,T)[c.index];if(z){const[N,I]=d(z.x,z.z);n.strokeStyle="rgba(255,255,255,.7)",n.lineWidth=1.4,n.beginPath(),n.arc(N,I,10,0,Math.PI*2),n.stroke()}}}const F=t.flash;if(F){const[T,b]=d(F.x,F.z),z=1-Math.max(0,(F.until-performance.now())/1600);n.strokeStyle=`rgba(74,144,226,${1-z})`,n.lineWidth=2,n.beginPath(),n.arc(T,b,8+z*30,0,Math.PI*2),n.stroke(),z<1&&requestAnimationFrame(rt)}$()}function ft(){const W=t.project;let G=1/0,K=-1/0,dt=1/0,v=-1/0;const F=(I,X)=>{I<G&&(G=I),I>K&&(K=I),X<dt&&(dt=X),X>v&&(v=X)};for(const I of W.roads){const X=e.getSamples(I.id);if(X&&X.count)for(const q of X.samples)F(q.x,q.z);else for(const q of I.points)F(q.x,q.z)}const T=e.getTerrain();Number.isFinite(G)||(T?(G=T.bounds.minX,K=T.bounds.maxX,dt=T.bounds.minZ,v=T.bounds.maxZ):(G=-60,K=60,dt=-60,v=60));const b=30,z=(r-b*2)/Math.max(10,K-G),N=(o-b*2)/Math.max(10,v-dt);l.scale=Math.min(60,Math.max(.2,Math.min(z,N))),l.cx=(G+K)/2,l.cz=(dt+v)/2,rt()}function yt(W,G,K){l.cx=W,l.cz=G,K&&(l.scale=Math.min(60,Math.max(.2,K))),rt()}function ct(){let W=Ct(t.project,S?.roadId);if(!W){const G=Ws(t.project,"r"),K=t.project.roads.length+1;t.transient(dt=>{dt.roads.push(ts(G,K))}),t.select({kind:"road",roadId:G}),S.roadId=G,W=Ct(t.project,G)}return W}function pt(){if(S)return;t.checkpoint("draw road");const W=t.selection,G=W.roadId&&!Ct(t.project,W.roadId)?.closed?W.roadId:null;S={roadId:G,created:!G}}function Lt(W){if(S){if(W)t.undo();else{const G=Ct(t.project,S.roadId);G&&G.points.length<2?t.undo():t.endGesture()}S=null,rt()}}function zt(W,G,K){const dt=t.project,v=Ct(dt,W);if(!v||v.closed||G!==0&&G!==v.points.length-1||K.roadId===W)return;const F=Ct(dt,K.roadId);if(!F||F.closed)return;const T=G===0?"start":"end",b=K.index===0?"start":"end",z=Sn(dt,W,G),N=Sn(dt,K.roadId,K.index);z&&N&&z.id===N.id||(t.transient(I=>{if(z&&N&&z.id!==N.id){for(const q of N.links)z.links.push(q);I.junctions=I.junctions.filter(q=>q.id!==N.id),I.junctions.includes(z)&&(z.x=K.x,z.z=K.z)}else if(z)z.links.push({road:K.roadId,end:b});else if(N)N.links.push({road:W,end:T});else{const q=Ws(I,"j");I.junctions.push({id:q,name:`Junction ${(I.junctions||[]).length+1}`,x:K.x,z:K.z,y:(v.points[G].y+F.points[K.index].y)/2,links:[{road:W,end:T},{road:K.roadId,end:b}]})}const X=Sn(I,W,G);if(X){const q=Ne(I,F)[K.index];X.x=q.x,X.z=q.z,X.y=(v.points[G].y+q.y)/2}}),e.toast("Endpoints welded — junction created"))}function ot(W){const G=i.getBoundingClientRect();return[W.clientX-G.left,W.clientY-G.top]}i.addEventListener("contextmenu",W=>W.preventDefault()),i.addEventListener("pointerdown",W=>{i.setPointerCapture(W.pointerId),i.focus?.();const[G,K]=ot(W),dt=A(G,K),v=p||W.button===1||W.button===2?"pan":t.tool;if(v==="pan"){_={mode:"pan",sx:G,sy:K,cx:l.cx,cz:l.cz},s.dataset.tool="pan",i.classList.add("dragging");return}if(t.tool==="draw"&&v!=="pan"){if(W.button!==0)return;pt();const T=ct();if(T.closed){Lt(!1);return}if(T.points.length>=3){const N=T.points[0],[I,X]=d(N.x,N.z);if(Math.hypot(I-G,X-K)<12){t.transient(q=>{Ct(q,T.id).closed=!0}),t.select({kind:"road",roadId:T.id}),Lt(!1),e.toast("Loop closed");return}}const b=w(dt.x,dt.z,null,!0),z=b.curve&&b.y!=null?+b.y.toFixed(2):T.points.length?T.points[T.points.length-1].y:0;if(t.transient(N=>{Ct(N,T.id).points.push({x:+b.x.toFixed(3),z:+b.z.toFixed(3),y:z,w:1})}),t.select({kind:"point",roadId:T.id,index:Ct(t.project,T.id).points.length-1}),b.node&&(b.node.roadId!==T.id||b.node.index!==0)){const N=Ct(t.project,T.id).points.length-1;b.node.roadId!==T.id&&zt(T.id,N,b.node)}rt();return}const F=E(G,K);if(W.button!==0){W.button===2&&t.select({kind:null});return}if(f&&F?.kind==="road"){const T=Ct(t.project,F.roadId),b=C(F.roadId,dt.x,dt.z);if(T&&b&&!T.closed){const z=Ne(t.project,T);let N=0,I=1/0;for(let nt=0;nt<z.length-1;nt++){const{d:R}=Si(dt.x,dt.z,z[nt].x,z[nt].z,z[nt+1].x,z[nt+1].z);R<I&&(I=R,N=nt)}const X=z[N].y,q=z[N+1].y;t.commit("insert point",nt=>{Ct(nt,T.id).points.splice(N+1,0,{x:+b.x.toFixed(3),z:+b.z.toFixed(3),y:+((X+q)/2).toFixed(2),w:1})}),t.select({kind:"point",roadId:T.id,index:N+1})}else if(T&&b&&T.closed){const z=Ne(t.project,T);let N=0,I=1/0;for(let X=0;X<z.length;X++){const q=z[X],nt=z[(X+1)%z.length],{d:R}=Si(dt.x,dt.z,q.x,q.z,nt.x,nt.z);R<I&&(I=R,N=X)}t.commit("insert point",X=>{Ct(X,T.id).points.splice(N+1,0,{x:+b.x.toFixed(3),z:+b.z.toFixed(3),y:+z[N].y.toFixed(2),w:1})}),t.select({kind:"point",roadId:T.id,index:(N+1)%z.length})}rt();return}if(!F){t.select({kind:null}),_={mode:"pan",sx:G,sy:K,cx:l.cx,cz:l.cz,maybe:!0};return}if(F.kind==="junction"){t.select({kind:"junction",junctionId:F.junctionId});const T=t.project.junctions.find(b=>b.id===F.junctionId);t.checkpoint("move junction"),_={mode:"junction",jid:F.junctionId,dx:dt.x-T.x,dz:dt.z-T.z};return}if(F.kind==="road"){t.select({kind:"road",roadId:F.roadId}),_={mode:"pan",sx:G,sy:K,cx:l.cx,cz:l.cz,maybe:!0};return}t.select({kind:"point",roadId:F.roadId,index:F.index}),t.checkpoint("move point"),_={mode:"point",roadId:F.roadId,index:F.index,moved:!1}}),i.addEventListener("pointermove",W=>{const[G,K]=ot(W),dt=A(G,K);if(u={x:dt.x,z:dt.z},e.onCursor?.(dt.x,dt.z),_?.mode==="pan"){l.cx=_.cx-(G-_.sx)/l.scale,l.cz=_.cz-(K-_.sy)/l.scale,rt();return}if(_?.mode==="junction"){const v=w(dt.x-_.dx,dt.z-_.dz);t.transient(F=>{const T=F.junctions.find(b=>b.id===_.jid);T&&(T.x=+v.x.toFixed(3),T.z=+v.z.toFixed(3))}),h=v.node||v.grid?{x:v.x,z:v.z,node:!!v.node}:null,rt();return}if(_?.mode==="point"){_.moved=!0;const v=Ct(t.project,_.roadId),F=v&&!v.closed&&(_.index===0||_.index===v.points.length-1),T=w(dt.x,dt.z,{roadId:_.roadId,index:_.index},!!F);t.transient(b=>{Ji(b,_.roadId,_.index,+T.x.toFixed(3),+T.z.toFixed(3),T.curve&&T.y!=null?+T.y.toFixed(2):void 0)}),h=T.node||T.curve||T.grid?{x:T.x,z:T.z,node:!!T.node,curve:!!T.curve}:null,_.snapNode=T.node,rt();return}if(t.tool==="draw"){const v=w(dt.x,dt.z,null,!0);u={x:v.x,z:v.z},h=v.node||v.curve||v.grid?{x:v.x,z:v.z,node:!!v.node,curve:!!v.curve}:null,c=null}else c=E(G,K),h=null;rt()});const ut=W=>{i.classList.remove("dragging"),s.dataset.tool=p?"pan":t.tool,_?.mode==="point"&&_.snapNode&&_.moved&&zt(_.roadId,_.index,_.snapNode),_&&(_.mode==="point"||_.mode==="junction")&&t.endGesture(),_=null,h=null,rt()};i.addEventListener("pointerup",ut),i.addEventListener("pointercancel",ut),i.addEventListener("pointerleave",()=>{u=null,c=null,h=null,e.onCursor?.(null,null),rt()}),i.addEventListener("wheel",W=>{W.preventDefault();const[G,K]=ot(W),dt=A(G,K),v=Math.exp(-W.deltaY*.0012);l.scale=Math.min(120,Math.max(.15,l.scale*v));const F=A(G,K);l.cx+=dt.x-F.x,l.cz+=dt.z-F.z,rt()},{passive:!1}),i.addEventListener("dblclick",W=>{if(t.tool!=="select")return;const[G,K]=ot(W);if(E(G,K))return;const v=t.selection,F=Ct(t.project,v.roadId||wt);if(!F||F.closed||!F.points.length)return;const T=A(G,K),b=w(T.x,T.z),z=Ne(t.project,F),N=Math.hypot(z[0].x-b.x,z[0].z-b.z),I=Math.hypot(z[z.length-1].x-b.x,z[z.length-1].z-b.z),X=N<I;if(Sn(t.project,F.id,X?0:z.length-1)){e.toast("That end is welded to a junction — unweld it first");return}t.commit("extend road",q=>{const nt=Ct(q,F.id),R=X?nt.points[0].y:nt.points[nt.points.length-1].y,M={x:+b.x.toFixed(3),z:+b.z.toFixed(3),y:R,w:1};X?nt.points.unshift(M):nt.points.push(M)}),t.select({kind:"point",roadId:F.id,index:X?0:Ct(t.project,F.id).points.length-1})}),window.addEventListener("keydown",W=>{W.key==="Alt"&&(f=!0),W.code==="Space"&&!W.repeat&&W.target===document.body&&(p=!0,W.preventDefault()),W.key==="Enter"&&S&&(W.preventDefault(),Lt(!1)),W.key==="Escape"&&S&&(W.preventDefault(),Lt(!0),e.toast("Draw cancelled"))}),window.addEventListener("keyup",W=>{W.key==="Alt"&&(f=!1),W.code==="Space"&&(p=!1)});let wt=null;return t.subscribe(W=>{W==="selection"&&t.selection.roadId&&(wt=t.selection.roadId),W==="tool"&&(s.dataset.tool=t.tool,t.tool!=="draw"&&S&&Lt(!1)),(W==="project"||W==="project-live"||W==="selection"||W==="ui"||W==="flash")&&rt()}),s.dataset.tool=t.tool,new ResizeObserver(P).observe(s),{redraw:rt,fitAll:ft,centerOn:yt,w2s:d,s2w:A,get drawing(){return!!S},finishDraw:Lt,exportPNG(W){rt(),ud(i,W)}}}const Go="180",Li={ROTATE:0,DOLLY:1,PAN:2},wi={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},pd=0,Ma=1,md=2,Xl=1,jl=2,yn=3,Fn=0,Fe=1,ln=2,Un=0,Di=1,ya=2,Sa=3,ba=4,gd=5,Zn=100,_d=101,xd=102,vd=103,Md=104,yd=200,Sd=201,bd=202,Ed=203,jr=204,$r=205,Td=206,wd=207,Ad=208,Rd=209,Cd=210,Pd=211,Ld=212,Dd=213,Id=214,Yr=0,qr=1,Zr=2,Ni=3,Kr=4,Jr=5,Qr=6,to=7,$l=0,Ud=1,Nd=2,Nn=0,Fd=1,Od=2,zd=3,Yl=4,Bd=5,kd=6,Hd=7,ql=300,Fi=301,Oi=302,eo=303,no=304,Qs=306,io=1e3,Jn=1001,so=1002,nn=1003,Vd=1004,fs=1005,dn=1006,ar=1007,Qn=1008,fn=1009,Zl=1010,Kl=1011,ns=1012,Wo=1013,ei=1014,bn=1015,as=1016,Xo=1017,jo=1018,is=1020,Jl=35902,Ql=35899,tc=1021,ec=1022,en=1023,ss=1026,rs=1027,nc=1028,$o=1029,ic=1030,Yo=1031,qo=1033,zs=33776,Bs=33777,ks=33778,Hs=33779,ro=35840,oo=35841,ao=35842,lo=35843,co=36196,uo=37492,ho=37496,fo=37808,po=37809,mo=37810,go=37811,_o=37812,xo=37813,vo=37814,Mo=37815,yo=37816,So=37817,bo=37818,Eo=37819,To=37820,wo=37821,Ao=36492,Ro=36494,Co=36495,Po=36283,Lo=36284,Do=36285,Io=36286,Gd=3200,Wd=3201,sc=0,Xd=1,In="",Ze="srgb",zi="srgb-linear",js="linear",re="srgb",li=7680,Ea=519,jd=512,$d=513,Yd=514,rc=515,qd=516,Zd=517,Kd=518,Jd=519,Ta=35044,wa="300 es",un=2e3,$s=2001;class ri{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){const n=this._listeners;return n===void 0?!1:n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){const n=this._listeners;if(n===void 0)return;const s=n[t];if(s!==void 0){const r=s.indexOf(e);r!==-1&&s.splice(r,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const n=e[t.type];if(n!==void 0){t.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,t);t.target=null}}}const Ee=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Vs=Math.PI/180,Uo=180/Math.PI;function ls(){const i=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Ee[i&255]+Ee[i>>8&255]+Ee[i>>16&255]+Ee[i>>24&255]+"-"+Ee[t&255]+Ee[t>>8&255]+"-"+Ee[t>>16&15|64]+Ee[t>>24&255]+"-"+Ee[e&63|128]+Ee[e>>8&255]+"-"+Ee[e>>16&255]+Ee[e>>24&255]+Ee[n&255]+Ee[n>>8&255]+Ee[n>>16&255]+Ee[n>>24&255]).toLowerCase()}function Qt(i,t,e){return Math.max(t,Math.min(e,i))}function Qd(i,t){return(i%t+t)%t}function lr(i,t,e){return(1-e)*i+e*t}function Xi(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function De(i,t){switch(t.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const tu={DEG2RAD:Vs};class $t{constructor(t=0,e=0){$t.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,n=this.y,s=t.elements;return this.x=s[0]*e+s[3]*n+s[6],this.y=s[1]*e+s[4]*n+s[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Qt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const n=Math.cos(e),s=Math.sin(e),r=this.x-t.x,o=this.y-t.y;return this.x=r*n-o*s+t.x,this.y=r*s+o*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class ni{constructor(t=0,e=0,n=0,s=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=s}static slerpFlat(t,e,n,s,r,o,a){let l=n[s+0],c=n[s+1],u=n[s+2],h=n[s+3];const f=r[o+0],p=r[o+1],_=r[o+2],S=r[o+3];if(a===0){t[e+0]=l,t[e+1]=c,t[e+2]=u,t[e+3]=h;return}if(a===1){t[e+0]=f,t[e+1]=p,t[e+2]=_,t[e+3]=S;return}if(h!==S||l!==f||c!==p||u!==_){let m=1-a;const d=l*f+c*p+u*_+h*S,A=d>=0?1:-1,P=1-d*d;if(P>Number.EPSILON){const w=Math.sqrt(P),E=Math.atan2(w,d*A);m=Math.sin(m*E)/w,a=Math.sin(a*E)/w}const x=a*A;if(l=l*m+f*x,c=c*m+p*x,u=u*m+_*x,h=h*m+S*x,m===1-a){const w=1/Math.sqrt(l*l+c*c+u*u+h*h);l*=w,c*=w,u*=w,h*=w}}t[e]=l,t[e+1]=c,t[e+2]=u,t[e+3]=h}static multiplyQuaternionsFlat(t,e,n,s,r,o){const a=n[s],l=n[s+1],c=n[s+2],u=n[s+3],h=r[o],f=r[o+1],p=r[o+2],_=r[o+3];return t[e]=a*_+u*h+l*p-c*f,t[e+1]=l*_+u*f+c*h-a*p,t[e+2]=c*_+u*p+a*f-l*h,t[e+3]=u*_-a*h-l*f-c*p,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,s){return this._x=t,this._y=e,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const n=t._x,s=t._y,r=t._z,o=t._order,a=Math.cos,l=Math.sin,c=a(n/2),u=a(s/2),h=a(r/2),f=l(n/2),p=l(s/2),_=l(r/2);switch(o){case"XYZ":this._x=f*u*h+c*p*_,this._y=c*p*h-f*u*_,this._z=c*u*_+f*p*h,this._w=c*u*h-f*p*_;break;case"YXZ":this._x=f*u*h+c*p*_,this._y=c*p*h-f*u*_,this._z=c*u*_-f*p*h,this._w=c*u*h+f*p*_;break;case"ZXY":this._x=f*u*h-c*p*_,this._y=c*p*h+f*u*_,this._z=c*u*_+f*p*h,this._w=c*u*h-f*p*_;break;case"ZYX":this._x=f*u*h-c*p*_,this._y=c*p*h+f*u*_,this._z=c*u*_-f*p*h,this._w=c*u*h+f*p*_;break;case"YZX":this._x=f*u*h+c*p*_,this._y=c*p*h+f*u*_,this._z=c*u*_-f*p*h,this._w=c*u*h-f*p*_;break;case"XZY":this._x=f*u*h-c*p*_,this._y=c*p*h-f*u*_,this._z=c*u*_+f*p*h,this._w=c*u*h+f*p*_;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const n=e/2,s=Math.sin(n);return this._x=t.x*s,this._y=t.y*s,this._z=t.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,n=e[0],s=e[4],r=e[8],o=e[1],a=e[5],l=e[9],c=e[2],u=e[6],h=e[10],f=n+a+h;if(f>0){const p=.5/Math.sqrt(f+1);this._w=.25/p,this._x=(u-l)*p,this._y=(r-c)*p,this._z=(o-s)*p}else if(n>a&&n>h){const p=2*Math.sqrt(1+n-a-h);this._w=(u-l)/p,this._x=.25*p,this._y=(s+o)/p,this._z=(r+c)/p}else if(a>h){const p=2*Math.sqrt(1+a-n-h);this._w=(r-c)/p,this._x=(s+o)/p,this._y=.25*p,this._z=(l+u)/p}else{const p=2*Math.sqrt(1+h-n-a);this._w=(o-s)/p,this._x=(r+c)/p,this._y=(l+u)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<1e-8?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Qt(this.dot(t),-1,1)))}rotateTowards(t,e){const n=this.angleTo(t);if(n===0)return this;const s=Math.min(1,e/n);return this.slerp(t,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const n=t._x,s=t._y,r=t._z,o=t._w,a=e._x,l=e._y,c=e._z,u=e._w;return this._x=n*u+o*a+s*c-r*l,this._y=s*u+o*l+r*a-n*c,this._z=r*u+o*c+n*l-s*a,this._w=o*u-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*t._w+n*t._x+s*t._y+r*t._z;if(a<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,a=-a):this.copy(t),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const l=1-a*a;if(l<=Number.EPSILON){const p=1-e;return this._w=p*o+e*this._w,this._x=p*n+e*this._x,this._y=p*s+e*this._y,this._z=p*r+e*this._z,this.normalize(),this}const c=Math.sqrt(l),u=Math.atan2(c,a),h=Math.sin((1-e)*u)/c,f=Math.sin(e*u)/c;return this._w=o*h+this._w*f,this._x=n*h+this._x*f,this._y=s*h+this._y*f,this._z=r*h+this._z*f,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(t),s*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class J{constructor(t=0,e=0,n=0){J.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(Aa.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(Aa.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,n=this.y,s=this.z,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6]*s,this.y=r[1]*e+r[4]*n+r[7]*s,this.z=r[2]*e+r[5]*n+r[8]*s,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,n=this.y,s=this.z,r=t.elements,o=1/(r[3]*e+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*e+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*e+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*e+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(t){const e=this.x,n=this.y,s=this.z,r=t.x,o=t.y,a=t.z,l=t.w,c=2*(o*s-a*n),u=2*(a*e-r*s),h=2*(r*n-o*e);return this.x=e+l*c+o*h-a*u,this.y=n+l*u+a*c-r*h,this.z=s+l*h+r*u-o*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,n=this.y,s=this.z,r=t.elements;return this.x=r[0]*e+r[4]*n+r[8]*s,this.y=r[1]*e+r[5]*n+r[9]*s,this.z=r[2]*e+r[6]*n+r[10]*s,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this.z=Qt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this.z=Qt(this.z,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const n=t.x,s=t.y,r=t.z,o=e.x,a=e.y,l=e.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return cr.copy(this).projectOnVector(t),this.sub(cr)}reflect(t){return this.sub(cr.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Qt(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y,s=this.z-t.z;return e*e+n*n+s*s}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){const s=Math.sin(e)*t;return this.x=s*Math.sin(n),this.y=Math.cos(e)*t,this.z=s*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),s=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=s,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const cr=new J,Aa=new ni;class Zt{constructor(t,e,n,s,r,o,a,l,c){Zt.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,s,r,o,a,l,c)}set(t,e,n,s,r,o,a,l,c){const u=this.elements;return u[0]=t,u[1]=s,u[2]=a,u[3]=e,u[4]=r,u[5]=l,u[6]=n,u[7]=o,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,s=e.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],u=n[4],h=n[7],f=n[2],p=n[5],_=n[8],S=s[0],m=s[3],d=s[6],A=s[1],P=s[4],x=s[7],w=s[2],E=s[5],C=s[8];return r[0]=o*S+a*A+l*w,r[3]=o*m+a*P+l*E,r[6]=o*d+a*x+l*C,r[1]=c*S+u*A+h*w,r[4]=c*m+u*P+h*E,r[7]=c*d+u*x+h*C,r[2]=f*S+p*A+_*w,r[5]=f*m+p*P+_*E,r[8]=f*d+p*x+_*C,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],u=t[8];return e*o*u-e*a*c-n*r*u+n*a*l+s*r*c-s*o*l}invert(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],u=t[8],h=u*o-a*c,f=a*l-u*r,p=c*r-o*l,_=e*h+n*f+s*p;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);const S=1/_;return t[0]=h*S,t[1]=(s*c-u*n)*S,t[2]=(a*n-s*o)*S,t[3]=f*S,t[4]=(u*e-s*l)*S,t[5]=(s*r-a*e)*S,t[6]=p*S,t[7]=(n*l-c*e)*S,t[8]=(o*e-n*r)*S,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,s,r,o,a){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+t,-s*c,s*l,-s*(-c*o+l*a)+a+e,0,0,1),this}scale(t,e){return this.premultiply(dr.makeScale(t,e)),this}rotate(t){return this.premultiply(dr.makeRotation(-t)),this}translate(t,e){return this.premultiply(dr.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,n=t.elements;for(let s=0;s<9;s++)if(e[s]!==n[s])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const dr=new Zt;function oc(i){for(let t=i.length-1;t>=0;--t)if(i[t]>=65535)return!0;return!1}function Ys(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function eu(){const i=Ys("canvas");return i.style.display="block",i}const Ra={};function os(i){i in Ra||(Ra[i]=!0,console.warn(i))}function nu(i,t,e){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(t,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:n()}}setTimeout(r,e)})}const Ca=new Zt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Pa=new Zt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function iu(){const i={enabled:!0,workingColorSpace:zi,spaces:{},convert:function(s,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===re&&(s.r=En(s.r),s.g=En(s.g),s.b=En(s.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===re&&(s.r=Ii(s.r),s.g=Ii(s.g),s.b=Ii(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===In?js:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,o){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(s,r){return os("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(s,r)},toWorkingColorSpace:function(s,r){return os("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(s,r)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[zi]:{primaries:t,whitePoint:n,transfer:js,toXYZ:Ca,fromXYZ:Pa,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:Ze},outputColorSpaceConfig:{drawingBufferColorSpace:Ze}},[Ze]:{primaries:t,whitePoint:n,transfer:re,toXYZ:Ca,fromXYZ:Pa,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:Ze}}}),i}const ne=iu();function En(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Ii(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let ci;class su{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let n;if(t instanceof HTMLCanvasElement)n=t;else{ci===void 0&&(ci=Ys("canvas")),ci.width=t.width,ci.height=t.height;const s=ci.getContext("2d");t instanceof ImageData?s.putImageData(t,0,0):s.drawImage(t,0,0,t.width,t.height),n=ci}return n.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Ys("canvas");e.width=t.width,e.height=t.height;const n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);const s=n.getImageData(0,0,t.width,t.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=En(r[o]/255)*255;return n.putImageData(s,0,0),e}else if(t.data){const e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(En(e[n]/255)*255):e[n]=En(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let ru=0;class Zo{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:ru++}),this.uuid=ls(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):e instanceof VideoFrame?t.set(e.displayHeight,e.displayWidth,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(ur(s[o].image)):r.push(ur(s[o]))}else r=ur(s);n.url=r}return e||(t.images[this.uuid]=n),n}}function ur(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?su.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let ou=0;const hr=new J;class Oe extends ri{constructor(t=Oe.DEFAULT_IMAGE,e=Oe.DEFAULT_MAPPING,n=Jn,s=Jn,r=dn,o=Qn,a=en,l=fn,c=Oe.DEFAULT_ANISOTROPY,u=In){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:ou++}),this.uuid=ls(),this.name="",this.source=new Zo(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new $t(0,0),this.repeat=new $t(1,1),this.center=new $t(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Zt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(hr).x}get height(){return this.source.getSize(hr).y}get depth(){return this.source.getSize(hr).z}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const s=this[e];if(s===void 0){console.warn(`THREE.Texture.setValues(): property '${e}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==ql)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case io:t.x=t.x-Math.floor(t.x);break;case Jn:t.x=t.x<0?0:1;break;case so:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case io:t.y=t.y-Math.floor(t.y);break;case Jn:t.y=t.y<0?0:1;break;case so:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Oe.DEFAULT_IMAGE=null;Oe.DEFAULT_MAPPING=ql;Oe.DEFAULT_ANISOTROPY=1;class pe{constructor(t=0,e=0,n=0,s=1){pe.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=s}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,s){return this.x=t,this.y=e,this.z=n,this.w=s,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,n=this.y,s=this.z,r=this.w,o=t.elements;return this.x=o[0]*e+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*e+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*e+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*e+o[7]*n+o[11]*s+o[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,s,r;const l=t.elements,c=l[0],u=l[4],h=l[8],f=l[1],p=l[5],_=l[9],S=l[2],m=l[6],d=l[10];if(Math.abs(u-f)<.01&&Math.abs(h-S)<.01&&Math.abs(_-m)<.01){if(Math.abs(u+f)<.1&&Math.abs(h+S)<.1&&Math.abs(_+m)<.1&&Math.abs(c+p+d-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const P=(c+1)/2,x=(p+1)/2,w=(d+1)/2,E=(u+f)/4,C=(h+S)/4,D=(_+m)/4;return P>x&&P>w?P<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(P),s=E/n,r=C/n):x>w?x<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(x),n=E/s,r=D/s):w<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(w),n=C/r,s=D/r),this.set(n,s,r,e),this}let A=Math.sqrt((m-_)*(m-_)+(h-S)*(h-S)+(f-u)*(f-u));return Math.abs(A)<.001&&(A=1),this.x=(m-_)/A,this.y=(h-S)/A,this.z=(f-u)/A,this.w=Math.acos((c+p+d-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Qt(this.x,t.x,e.x),this.y=Qt(this.y,t.y,e.y),this.z=Qt(this.z,t.z,e.z),this.w=Qt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Qt(this.x,t,e),this.y=Qt(this.y,t,e),this.z=Qt(this.z,t,e),this.w=Qt(this.w,t,e),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Qt(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class au extends ri{constructor(t=1,e=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:dn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=n.depth,this.scissor=new pe(0,0,t,e),this.scissorTest=!1,this.viewport=new pe(0,0,t,e);const s={width:t,height:e,depth:n.depth},r=new Oe(s);this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(t={}){const e={minFilter:dn,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=t,this.textures[s].image.height=e,this.textures[s].image.depth=n,this.textures[s].isArrayTexture=this.textures[s].image.depth>1;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,n=t.textures.length;e<n;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const s=Object.assign({},t.textures[e].image);this.textures[e].source=new Zo(s)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class ii extends au{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}}class ac extends Oe{constructor(t=null,e=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:s},this.magFilter=nn,this.minFilter=nn,this.wrapR=Jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class lu extends Oe{constructor(t=null,e=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:s},this.magFilter=nn,this.minFilter=nn,this.wrapR=Jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class si{constructor(t=new J(1/0,1/0,1/0),e=new J(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Je.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Je.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const n=Je.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const n=t.geometry;if(n!==void 0){const r=n.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)t.isMesh===!0?t.getVertexPosition(o,Je):Je.fromBufferAttribute(r,o),Je.applyMatrix4(t.matrixWorld),this.expandByPoint(Je);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),ps.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),ps.copy(n.boundingBox)),ps.applyMatrix4(t.matrixWorld),this.union(ps)}const s=t.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Je),Je.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(ji),ms.subVectors(this.max,ji),di.subVectors(t.a,ji),ui.subVectors(t.b,ji),hi.subVectors(t.c,ji),Tn.subVectors(ui,di),wn.subVectors(hi,ui),Hn.subVectors(di,hi);let e=[0,-Tn.z,Tn.y,0,-wn.z,wn.y,0,-Hn.z,Hn.y,Tn.z,0,-Tn.x,wn.z,0,-wn.x,Hn.z,0,-Hn.x,-Tn.y,Tn.x,0,-wn.y,wn.x,0,-Hn.y,Hn.x,0];return!fr(e,di,ui,hi,ms)||(e=[1,0,0,0,1,0,0,0,1],!fr(e,di,ui,hi,ms))?!1:(gs.crossVectors(Tn,wn),e=[gs.x,gs.y,gs.z],fr(e,di,ui,hi,ms))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Je).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Je).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(gn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),gn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),gn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),gn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),gn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),gn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),gn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),gn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(gn),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const gn=[new J,new J,new J,new J,new J,new J,new J,new J],Je=new J,ps=new si,di=new J,ui=new J,hi=new J,Tn=new J,wn=new J,Hn=new J,ji=new J,ms=new J,gs=new J,Vn=new J;function fr(i,t,e,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){Vn.fromArray(i,r);const a=s.x*Math.abs(Vn.x)+s.y*Math.abs(Vn.y)+s.z*Math.abs(Vn.z),l=t.dot(Vn),c=e.dot(Vn),u=n.dot(Vn);if(Math.max(-Math.max(l,c,u),Math.min(l,c,u))>a)return!1}return!0}const cu=new si,$i=new J,pr=new J;class tr{constructor(t=new J,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const n=this.center;e!==void 0?n.copy(e):cu.setFromPoints(t).getCenter(n);let s=0;for(let r=0,o=t.length;r<o;r++)s=Math.max(s,n.distanceToSquared(t[r]));return this.radius=Math.sqrt(s),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;$i.subVectors(t,this.center);const e=$i.lengthSq();if(e>this.radius*this.radius){const n=Math.sqrt(e),s=(n-this.radius)*.5;this.center.addScaledVector($i,s/n),this.radius+=s}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(pr.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint($i.copy(t.center).add(pr)),this.expandByPoint($i.copy(t.center).sub(pr))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}const _n=new J,mr=new J,_s=new J,An=new J,gr=new J,xs=new J,_r=new J;class Ko{constructor(t=new J,e=new J(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,_n)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=_n.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(_n.copy(this.origin).addScaledVector(this.direction,e),_n.distanceToSquared(t))}distanceSqToSegment(t,e,n,s){mr.copy(t).add(e).multiplyScalar(.5),_s.copy(e).sub(t).normalize(),An.copy(this.origin).sub(mr);const r=t.distanceTo(e)*.5,o=-this.direction.dot(_s),a=An.dot(this.direction),l=-An.dot(_s),c=An.lengthSq(),u=Math.abs(1-o*o);let h,f,p,_;if(u>0)if(h=o*l-a,f=o*a-l,_=r*u,h>=0)if(f>=-_)if(f<=_){const S=1/u;h*=S,f*=S,p=h*(h+o*f+2*a)+f*(o*h+f+2*l)+c}else f=r,h=Math.max(0,-(o*f+a)),p=-h*h+f*(f+2*l)+c;else f=-r,h=Math.max(0,-(o*f+a)),p=-h*h+f*(f+2*l)+c;else f<=-_?(h=Math.max(0,-(-o*r+a)),f=h>0?-r:Math.min(Math.max(-r,-l),r),p=-h*h+f*(f+2*l)+c):f<=_?(h=0,f=Math.min(Math.max(-r,-l),r),p=f*(f+2*l)+c):(h=Math.max(0,-(o*r+a)),f=h>0?r:Math.min(Math.max(-r,-l),r),p=-h*h+f*(f+2*l)+c);else f=o>0?-r:r,h=Math.max(0,-(o*f+a)),p=-h*h+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,h),s&&s.copy(mr).addScaledVector(_s,f),p}intersectSphere(t,e){_n.subVectors(t.center,this.origin);const n=_n.dot(this.direction),s=_n.dot(_n)-n*n,r=t.radius*t.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,e):this.at(a,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){const n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,s,r,o,a,l;const c=1/this.direction.x,u=1/this.direction.y,h=1/this.direction.z,f=this.origin;return c>=0?(n=(t.min.x-f.x)*c,s=(t.max.x-f.x)*c):(n=(t.max.x-f.x)*c,s=(t.min.x-f.x)*c),u>=0?(r=(t.min.y-f.y)*u,o=(t.max.y-f.y)*u):(r=(t.max.y-f.y)*u,o=(t.min.y-f.y)*u),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),h>=0?(a=(t.min.z-f.z)*h,l=(t.max.z-f.z)*h):(a=(t.max.z-f.z)*h,l=(t.min.z-f.z)*h),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,e)}intersectsBox(t){return this.intersectBox(t,_n)!==null}intersectTriangle(t,e,n,s,r){gr.subVectors(e,t),xs.subVectors(n,t),_r.crossVectors(gr,xs);let o=this.direction.dot(_r),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;An.subVectors(this.origin,t);const l=a*this.direction.dot(xs.crossVectors(An,xs));if(l<0)return null;const c=a*this.direction.dot(gr.cross(An));if(c<0||l+c>o)return null;const u=-a*An.dot(_r);return u<0?null:this.at(u/o,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class me{constructor(t,e,n,s,r,o,a,l,c,u,h,f,p,_,S,m){me.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,s,r,o,a,l,c,u,h,f,p,_,S,m)}set(t,e,n,s,r,o,a,l,c,u,h,f,p,_,S,m){const d=this.elements;return d[0]=t,d[4]=e,d[8]=n,d[12]=s,d[1]=r,d[5]=o,d[9]=a,d[13]=l,d[2]=c,d[6]=u,d[10]=h,d[14]=f,d[3]=p,d[7]=_,d[11]=S,d[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new me().fromArray(this.elements)}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){const e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){const e=this.elements,n=t.elements,s=1/fi.setFromMatrixColumn(t,0).length(),r=1/fi.setFromMatrixColumn(t,1).length(),o=1/fi.setFromMatrixColumn(t,2).length();return e[0]=n[0]*s,e[1]=n[1]*s,e[2]=n[2]*s,e[3]=0,e[4]=n[4]*r,e[5]=n[5]*r,e[6]=n[6]*r,e[7]=0,e[8]=n[8]*o,e[9]=n[9]*o,e[10]=n[10]*o,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,n=t.x,s=t.y,r=t.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),u=Math.cos(r),h=Math.sin(r);if(t.order==="XYZ"){const f=o*u,p=o*h,_=a*u,S=a*h;e[0]=l*u,e[4]=-l*h,e[8]=c,e[1]=p+_*c,e[5]=f-S*c,e[9]=-a*l,e[2]=S-f*c,e[6]=_+p*c,e[10]=o*l}else if(t.order==="YXZ"){const f=l*u,p=l*h,_=c*u,S=c*h;e[0]=f+S*a,e[4]=_*a-p,e[8]=o*c,e[1]=o*h,e[5]=o*u,e[9]=-a,e[2]=p*a-_,e[6]=S+f*a,e[10]=o*l}else if(t.order==="ZXY"){const f=l*u,p=l*h,_=c*u,S=c*h;e[0]=f-S*a,e[4]=-o*h,e[8]=_+p*a,e[1]=p+_*a,e[5]=o*u,e[9]=S-f*a,e[2]=-o*c,e[6]=a,e[10]=o*l}else if(t.order==="ZYX"){const f=o*u,p=o*h,_=a*u,S=a*h;e[0]=l*u,e[4]=_*c-p,e[8]=f*c+S,e[1]=l*h,e[5]=S*c+f,e[9]=p*c-_,e[2]=-c,e[6]=a*l,e[10]=o*l}else if(t.order==="YZX"){const f=o*l,p=o*c,_=a*l,S=a*c;e[0]=l*u,e[4]=S-f*h,e[8]=_*h+p,e[1]=h,e[5]=o*u,e[9]=-a*u,e[2]=-c*u,e[6]=p*h+_,e[10]=f-S*h}else if(t.order==="XZY"){const f=o*l,p=o*c,_=a*l,S=a*c;e[0]=l*u,e[4]=-h,e[8]=c*u,e[1]=f*h+S,e[5]=o*u,e[9]=p*h-_,e[2]=_*h-p,e[6]=a*u,e[10]=S*h+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(du,t,uu)}lookAt(t,e,n){const s=this.elements;return Ve.subVectors(t,e),Ve.lengthSq()===0&&(Ve.z=1),Ve.normalize(),Rn.crossVectors(n,Ve),Rn.lengthSq()===0&&(Math.abs(n.z)===1?Ve.x+=1e-4:Ve.z+=1e-4,Ve.normalize(),Rn.crossVectors(n,Ve)),Rn.normalize(),vs.crossVectors(Ve,Rn),s[0]=Rn.x,s[4]=vs.x,s[8]=Ve.x,s[1]=Rn.y,s[5]=vs.y,s[9]=Ve.y,s[2]=Rn.z,s[6]=vs.z,s[10]=Ve.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,s=e.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],u=n[1],h=n[5],f=n[9],p=n[13],_=n[2],S=n[6],m=n[10],d=n[14],A=n[3],P=n[7],x=n[11],w=n[15],E=s[0],C=s[4],D=s[8],g=s[12],y=s[1],U=s[5],k=s[9],H=s[13],O=s[2],V=s[6],B=s[10],$=s[14],Z=s[3],rt=s[7],ft=s[11],yt=s[15];return r[0]=o*E+a*y+l*O+c*Z,r[4]=o*C+a*U+l*V+c*rt,r[8]=o*D+a*k+l*B+c*ft,r[12]=o*g+a*H+l*$+c*yt,r[1]=u*E+h*y+f*O+p*Z,r[5]=u*C+h*U+f*V+p*rt,r[9]=u*D+h*k+f*B+p*ft,r[13]=u*g+h*H+f*$+p*yt,r[2]=_*E+S*y+m*O+d*Z,r[6]=_*C+S*U+m*V+d*rt,r[10]=_*D+S*k+m*B+d*ft,r[14]=_*g+S*H+m*$+d*yt,r[3]=A*E+P*y+x*O+w*Z,r[7]=A*C+P*U+x*V+w*rt,r[11]=A*D+P*k+x*B+w*ft,r[15]=A*g+P*H+x*$+w*yt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[4],s=t[8],r=t[12],o=t[1],a=t[5],l=t[9],c=t[13],u=t[2],h=t[6],f=t[10],p=t[14],_=t[3],S=t[7],m=t[11],d=t[15];return _*(+r*l*h-s*c*h-r*a*f+n*c*f+s*a*p-n*l*p)+S*(+e*l*p-e*c*f+r*o*f-s*o*p+s*c*u-r*l*u)+m*(+e*c*h-e*a*p-r*o*h+n*o*p+r*a*u-n*c*u)+d*(-s*a*u-e*l*h+e*a*f+s*o*h-n*o*f+n*l*u)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){const s=this.elements;return t.isVector3?(s[12]=t.x,s[13]=t.y,s[14]=t.z):(s[12]=t,s[13]=e,s[14]=n),this}invert(){const t=this.elements,e=t[0],n=t[1],s=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],u=t[8],h=t[9],f=t[10],p=t[11],_=t[12],S=t[13],m=t[14],d=t[15],A=h*m*c-S*f*c+S*l*p-a*m*p-h*l*d+a*f*d,P=_*f*c-u*m*c-_*l*p+o*m*p+u*l*d-o*f*d,x=u*S*c-_*h*c+_*a*p-o*S*p-u*a*d+o*h*d,w=_*h*l-u*S*l-_*a*f+o*S*f+u*a*m-o*h*m,E=e*A+n*P+s*x+r*w;if(E===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const C=1/E;return t[0]=A*C,t[1]=(S*f*r-h*m*r-S*s*p+n*m*p+h*s*d-n*f*d)*C,t[2]=(a*m*r-S*l*r+S*s*c-n*m*c-a*s*d+n*l*d)*C,t[3]=(h*l*r-a*f*r-h*s*c+n*f*c+a*s*p-n*l*p)*C,t[4]=P*C,t[5]=(u*m*r-_*f*r+_*s*p-e*m*p-u*s*d+e*f*d)*C,t[6]=(_*l*r-o*m*r-_*s*c+e*m*c+o*s*d-e*l*d)*C,t[7]=(o*f*r-u*l*r+u*s*c-e*f*c-o*s*p+e*l*p)*C,t[8]=x*C,t[9]=(_*h*r-u*S*r-_*n*p+e*S*p+u*n*d-e*h*d)*C,t[10]=(o*S*r-_*a*r+_*n*c-e*S*c-o*n*d+e*a*d)*C,t[11]=(u*a*r-o*h*r-u*n*c+e*h*c+o*n*p-e*a*p)*C,t[12]=w*C,t[13]=(u*S*s-_*h*s+_*n*f-e*S*f-u*n*m+e*h*m)*C,t[14]=(_*a*s-o*S*s-_*n*l+e*S*l+o*n*m-e*a*m)*C,t[15]=(o*h*s-u*a*s+u*n*l-e*h*l-o*n*f+e*a*f)*C,this}scale(t){const e=this.elements,n=t.x,s=t.y,r=t.z;return e[0]*=n,e[4]*=s,e[8]*=r,e[1]*=n,e[5]*=s,e[9]*=r,e[2]*=n,e[6]*=s,e[10]*=r,e[3]*=n,e[7]*=s,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],s=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,s))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const n=Math.cos(e),s=Math.sin(e),r=1-n,o=t.x,a=t.y,l=t.z,c=r*o,u=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,u*a+n,u*l-s*o,0,c*l-s*a,u*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,s,r,o){return this.set(1,n,r,0,t,1,o,0,e,s,1,0,0,0,0,1),this}compose(t,e,n){const s=this.elements,r=e._x,o=e._y,a=e._z,l=e._w,c=r+r,u=o+o,h=a+a,f=r*c,p=r*u,_=r*h,S=o*u,m=o*h,d=a*h,A=l*c,P=l*u,x=l*h,w=n.x,E=n.y,C=n.z;return s[0]=(1-(S+d))*w,s[1]=(p+x)*w,s[2]=(_-P)*w,s[3]=0,s[4]=(p-x)*E,s[5]=(1-(f+d))*E,s[6]=(m+A)*E,s[7]=0,s[8]=(_+P)*C,s[9]=(m-A)*C,s[10]=(1-(f+S))*C,s[11]=0,s[12]=t.x,s[13]=t.y,s[14]=t.z,s[15]=1,this}decompose(t,e,n){const s=this.elements;let r=fi.set(s[0],s[1],s[2]).length();const o=fi.set(s[4],s[5],s[6]).length(),a=fi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),t.x=s[12],t.y=s[13],t.z=s[14],Qe.copy(this);const c=1/r,u=1/o,h=1/a;return Qe.elements[0]*=c,Qe.elements[1]*=c,Qe.elements[2]*=c,Qe.elements[4]*=u,Qe.elements[5]*=u,Qe.elements[6]*=u,Qe.elements[8]*=h,Qe.elements[9]*=h,Qe.elements[10]*=h,e.setFromRotationMatrix(Qe),n.x=r,n.y=o,n.z=a,this}makePerspective(t,e,n,s,r,o,a=un,l=!1){const c=this.elements,u=2*r/(e-t),h=2*r/(n-s),f=(e+t)/(e-t),p=(n+s)/(n-s);let _,S;if(l)_=r/(o-r),S=o*r/(o-r);else if(a===un)_=-(o+r)/(o-r),S=-2*o*r/(o-r);else if(a===$s)_=-o/(o-r),S=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=u,c[4]=0,c[8]=f,c[12]=0,c[1]=0,c[5]=h,c[9]=p,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,e,n,s,r,o,a=un,l=!1){const c=this.elements,u=2/(e-t),h=2/(n-s),f=-(e+t)/(e-t),p=-(n+s)/(n-s);let _,S;if(l)_=1/(o-r),S=o/(o-r);else if(a===un)_=-2/(o-r),S=-(o+r)/(o-r);else if(a===$s)_=-1/(o-r),S=-r/(o-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=u,c[4]=0,c[8]=0,c[12]=f,c[1]=0,c[5]=h,c[9]=0,c[13]=p,c[2]=0,c[6]=0,c[10]=_,c[14]=S,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){const e=this.elements,n=t.elements;for(let s=0;s<16;s++)if(e[s]!==n[s])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}}const fi=new J,Qe=new me,du=new J(0,0,0),uu=new J(1,1,1),Rn=new J,vs=new J,Ve=new J,La=new me,Da=new ni;class pn{constructor(t=0,e=0,n=0,s=pn.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=s}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,s=this._order){return this._x=t,this._y=e,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){const s=t.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],u=s[9],h=s[2],f=s[6],p=s[10];switch(e){case"XYZ":this._y=Math.asin(Qt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,p),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Qt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-h,r),this._z=0);break;case"ZXY":this._x=Math.asin(Qt(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-h,p),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Qt(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(f,p),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Qt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-h,r)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Qt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-u,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return La.makeRotationFromQuaternion(t),this.setFromRotationMatrix(La,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Da.setFromEuler(this),this.setFromQuaternion(Da,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}pn.DEFAULT_ORDER="XYZ";let lc=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},hu=0;const Ia=new J,pi=new ni,xn=new me,Ms=new J,Yi=new J,fu=new J,pu=new ni,Ua=new J(1,0,0),Na=new J(0,1,0),Fa=new J(0,0,1),Oa={type:"added"},mu={type:"removed"},mi={type:"childadded",child:null},xr={type:"childremoved",child:null};class ye extends ri{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:hu++}),this.uuid=ls(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=ye.DEFAULT_UP.clone();const t=new J,e=new pn,n=new ni,s=new J(1,1,1);function r(){n.setFromEuler(e,!1)}function o(){e.setFromQuaternion(n,void 0,!1)}e._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new me},normalMatrix:{value:new Zt}}),this.matrix=new me,this.matrixWorld=new me,this.matrixAutoUpdate=ye.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=ye.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new lc,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return pi.setFromAxisAngle(t,e),this.quaternion.multiply(pi),this}rotateOnWorldAxis(t,e){return pi.setFromAxisAngle(t,e),this.quaternion.premultiply(pi),this}rotateX(t){return this.rotateOnAxis(Ua,t)}rotateY(t){return this.rotateOnAxis(Na,t)}rotateZ(t){return this.rotateOnAxis(Fa,t)}translateOnAxis(t,e){return Ia.copy(t).applyQuaternion(this.quaternion),this.position.add(Ia.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(Ua,t)}translateY(t){return this.translateOnAxis(Na,t)}translateZ(t){return this.translateOnAxis(Fa,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(xn.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?Ms.copy(t):Ms.set(t,e,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Yi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?xn.lookAt(Yi,Ms,this.up):xn.lookAt(Ms,Yi,this.up),this.quaternion.setFromRotationMatrix(xn),s&&(xn.extractRotation(s.matrixWorld),pi.setFromRotationMatrix(xn),this.quaternion.premultiply(pi.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Oa),mi.child=t,this.dispatchEvent(mi),mi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(mu),xr.child=t,this.dispatchEvent(xr),xr.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),xn.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),xn.multiply(t.parent.matrixWorld)),t.applyMatrix4(xn),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Oa),mi.child=t,this.dispatchEvent(mi),mi.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(t,e);if(o!==void 0)return o}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Yi,t,fu),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Yi,pu,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let n=0,s=e.length;n<s;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(t){const e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(a=>({...a})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(t),s.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(t.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,u=l.length;c<u;c++){const h=l[c];r(t.shapes,h)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(t.materials,this.material[l]));s.material=a}else s.material=r(t.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(t).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];s.animations.push(r(t.animations,l))}}if(e){const a=o(t.geometries),l=o(t.materials),c=o(t.textures),u=o(t.images),h=o(t.shapes),f=o(t.skeletons),p=o(t.animations),_=o(t.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),u.length>0&&(n.images=u),h.length>0&&(n.shapes=h),f.length>0&&(n.skeletons=f),p.length>0&&(n.animations=p),_.length>0&&(n.nodes=_)}return n.object=s,n;function o(a){const l=[];for(const c in a){const u=a[c];delete u.metadata,l.push(u)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){const s=t.children[n];this.add(s.clone())}return this}}ye.DEFAULT_UP=new J(0,1,0);ye.DEFAULT_MATRIX_AUTO_UPDATE=!0;ye.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const tn=new J,vn=new J,vr=new J,Mn=new J,gi=new J,_i=new J,za=new J,Mr=new J,yr=new J,Sr=new J,br=new pe,Er=new pe,Tr=new pe;let qi=class Ei{constructor(t=new J,e=new J,n=new J){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,s){s.subVectors(n,e),tn.subVectors(t,e),s.cross(tn);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(t,e,n,s,r){tn.subVectors(s,e),vn.subVectors(n,e),vr.subVectors(t,e);const o=tn.dot(tn),a=tn.dot(vn),l=tn.dot(vr),c=vn.dot(vn),u=vn.dot(vr),h=o*c-a*a;if(h===0)return r.set(0,0,0),null;const f=1/h,p=(c*l-a*u)*f,_=(o*u-a*l)*f;return r.set(1-p-_,_,p)}static containsPoint(t,e,n,s){return this.getBarycoord(t,e,n,s,Mn)===null?!1:Mn.x>=0&&Mn.y>=0&&Mn.x+Mn.y<=1}static getInterpolation(t,e,n,s,r,o,a,l){return this.getBarycoord(t,e,n,s,Mn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,Mn.x),l.addScaledVector(o,Mn.y),l.addScaledVector(a,Mn.z),l)}static getInterpolatedAttribute(t,e,n,s,r,o){return br.setScalar(0),Er.setScalar(0),Tr.setScalar(0),br.fromBufferAttribute(t,e),Er.fromBufferAttribute(t,n),Tr.fromBufferAttribute(t,s),o.setScalar(0),o.addScaledVector(br,r.x),o.addScaledVector(Er,r.y),o.addScaledVector(Tr,r.z),o}static isFrontFacing(t,e,n,s){return tn.subVectors(n,e),vn.subVectors(t,e),tn.cross(vn).dot(s)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,s){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[s]),this}setFromAttributeAndIndices(t,e,n,s){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,s),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return tn.subVectors(this.c,this.b),vn.subVectors(this.a,this.b),tn.cross(vn).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Ei.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Ei.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,s,r){return Ei.getInterpolation(t,this.a,this.b,this.c,e,n,s,r)}containsPoint(t){return Ei.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Ei.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const n=this.a,s=this.b,r=this.c;let o,a;gi.subVectors(s,n),_i.subVectors(r,n),Mr.subVectors(t,n);const l=gi.dot(Mr),c=_i.dot(Mr);if(l<=0&&c<=0)return e.copy(n);yr.subVectors(t,s);const u=gi.dot(yr),h=_i.dot(yr);if(u>=0&&h<=u)return e.copy(s);const f=l*h-u*c;if(f<=0&&l>=0&&u<=0)return o=l/(l-u),e.copy(n).addScaledVector(gi,o);Sr.subVectors(t,r);const p=gi.dot(Sr),_=_i.dot(Sr);if(_>=0&&p<=_)return e.copy(r);const S=p*c-l*_;if(S<=0&&c>=0&&_<=0)return a=c/(c-_),e.copy(n).addScaledVector(_i,a);const m=u*_-p*h;if(m<=0&&h-u>=0&&p-_>=0)return za.subVectors(r,s),a=(h-u)/(h-u+(p-_)),e.copy(s).addScaledVector(za,a);const d=1/(m+S+f);return o=S*d,a=f*d,e.copy(n).addScaledVector(gi,o).addScaledVector(_i,a)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}};const cc={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cn={h:0,s:0,l:0},ys={h:0,s:0,l:0};function wr(i,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?i+(t-i)*6*e:e<1/2?t:e<2/3?i+(t-i)*6*(2/3-e):i}class Jt{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){const s=t;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Ze){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,ne.colorSpaceToWorking(this,e),this}setRGB(t,e,n,s=ne.workingColorSpace){return this.r=t,this.g=e,this.b=n,ne.colorSpaceToWorking(this,s),this}setHSL(t,e,n,s=ne.workingColorSpace){if(t=Qd(t,1),e=Qt(e,0,1),n=Qt(n,0,1),e===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+e):n+e-n*e,o=2*n-r;this.r=wr(o,r,t+1/3),this.g=wr(o,r,t),this.b=wr(o,r,t-1/3)}return ne.colorSpaceToWorking(this,s),this}setStyle(t,e=Ze){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(o===6)return this.setHex(parseInt(r,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Ze){const n=cc[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=En(t.r),this.g=En(t.g),this.b=En(t.b),this}copyLinearToSRGB(t){return this.r=Ii(t.r),this.g=Ii(t.g),this.b=Ii(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Ze){return ne.workingToColorSpace(Te.copy(this),t),Math.round(Qt(Te.r*255,0,255))*65536+Math.round(Qt(Te.g*255,0,255))*256+Math.round(Qt(Te.b*255,0,255))}getHexString(t=Ze){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=ne.workingColorSpace){ne.workingToColorSpace(Te.copy(this),e);const n=Te.r,s=Te.g,r=Te.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let l,c;const u=(a+o)/2;if(a===o)l=0,c=0;else{const h=o-a;switch(c=u<=.5?h/(o+a):h/(2-o-a),o){case n:l=(s-r)/h+(s<r?6:0);break;case s:l=(r-n)/h+2;break;case r:l=(n-s)/h+4;break}l/=6}return t.h=l,t.s=c,t.l=u,t}getRGB(t,e=ne.workingColorSpace){return ne.workingToColorSpace(Te.copy(this),e),t.r=Te.r,t.g=Te.g,t.b=Te.b,t}getStyle(t=Ze){ne.workingToColorSpace(Te.copy(this),t);const e=Te.r,n=Te.g,s=Te.b;return t!==Ze?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(t,e,n){return this.getHSL(Cn),this.setHSL(Cn.h+t,Cn.s+e,Cn.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(Cn),t.getHSL(ys);const n=lr(Cn.h,ys.h,e),s=lr(Cn.s,ys.s,e),r=lr(Cn.l,ys.l,e);return this.setHSL(n,s,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,n=this.g,s=this.b,r=t.elements;return this.r=r[0]*e+r[3]*n+r[6]*s,this.g=r[1]*e+r[4]*n+r[7]*s,this.b=r[2]*e+r[5]*n+r[8]*s,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Te=new Jt;Jt.NAMES=cc;let gu=0;class Vi extends ri{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:gu++}),this.uuid=ls(),this.name="",this.type="Material",this.blending=Di,this.side=Fn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=jr,this.blendDst=$r,this.blendEquation=Zn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Jt(0,0,0),this.blendAlpha=0,this.depthFunc=Ni,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ea,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=li,this.stencilZFail=li,this.stencilZPass=li,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}const s=this[e];if(s===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Di&&(n.blending=this.blending),this.side!==Fn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==jr&&(n.blendSrc=this.blendSrc),this.blendDst!==$r&&(n.blendDst=this.blendDst),this.blendEquation!==Zn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ni&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ea&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==li&&(n.stencilFail=this.stencilFail),this.stencilZFail!==li&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==li&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const l=r[a];delete l.metadata,o.push(l)}return o}if(e){const r=s(t.textures),o=s(t.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let n=null;if(e!==null){const s=e.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=e[r].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class dc extends Vi{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Jt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new pn,this.combine=$l,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const ge=new J,Ss=new $t;let _u=0;class Re{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:_u++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Ta,this.updateRanges=[],this.gpuType=bn,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[t+s]=e.array[n+s];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)Ss.fromBufferAttribute(this,e),Ss.applyMatrix3(t),this.setXY(e,Ss.x,Ss.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyMatrix3(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyMatrix4(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyNormalMatrix(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.transformDirection(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=Xi(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=De(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Xi(e,this.array)),e}setX(t,e){return this.normalized&&(e=De(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Xi(e,this.array)),e}setY(t,e){return this.normalized&&(e=De(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Xi(e,this.array)),e}setZ(t,e){return this.normalized&&(e=De(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Xi(e,this.array)),e}setW(t,e){return this.normalized&&(e=De(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=De(e,this.array),n=De(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,s){return t*=this.itemSize,this.normalized&&(e=De(e,this.array),n=De(n,this.array),s=De(s,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=s,this}setXYZW(t,e,n,s,r){return t*=this.itemSize,this.normalized&&(e=De(e,this.array),n=De(n,this.array),s=De(s,this.array),r=De(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=s,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Ta&&(t.usage=this.usage),t}}class uc extends Re{constructor(t,e,n){super(new Uint16Array(t),e,n)}}class hc extends Re{constructor(t,e,n){super(new Uint32Array(t),e,n)}}class ze extends Re{constructor(t,e,n){super(new Float32Array(t),e,n)}}let xu=0;const Ye=new me,Ar=new ye,xi=new J,Ge=new si,Zi=new si,Me=new J;class sn extends ri{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:xu++}),this.uuid=ls(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(oc(t)?hc:uc)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Zt().getNormalMatrix(t);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(t),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return Ye.makeRotationFromQuaternion(t),this.applyMatrix4(Ye),this}rotateX(t){return Ye.makeRotationX(t),this.applyMatrix4(Ye),this}rotateY(t){return Ye.makeRotationY(t),this.applyMatrix4(Ye),this}rotateZ(t){return Ye.makeRotationZ(t),this.applyMatrix4(Ye),this}translate(t,e,n){return Ye.makeTranslation(t,e,n),this.applyMatrix4(Ye),this}scale(t,e,n){return Ye.makeScale(t,e,n),this.applyMatrix4(Ye),this}lookAt(t){return Ar.lookAt(t),Ar.updateMatrix(),this.applyMatrix4(Ar.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(xi).negate(),this.translate(xi.x,xi.y,xi.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const n=[];for(let s=0,r=t.length;s<r;s++){const o=t[s];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new ze(n,3))}else{const n=Math.min(t.length,e.count);for(let s=0;s<n;s++){const r=t[s];e.setXYZ(s,r.x,r.y,r.z||0)}t.length>e.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new si);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new J(-1/0,-1/0,-1/0),new J(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,s=e.length;n<s;n++){const r=e[n];Ge.setFromBufferAttribute(r),this.morphTargetsRelative?(Me.addVectors(this.boundingBox.min,Ge.min),this.boundingBox.expandByPoint(Me),Me.addVectors(this.boundingBox.max,Ge.max),this.boundingBox.expandByPoint(Me)):(this.boundingBox.expandByPoint(Ge.min),this.boundingBox.expandByPoint(Ge.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new tr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new J,1/0);return}if(t){const n=this.boundingSphere.center;if(Ge.setFromBufferAttribute(t),e)for(let r=0,o=e.length;r<o;r++){const a=e[r];Zi.setFromBufferAttribute(a),this.morphTargetsRelative?(Me.addVectors(Ge.min,Zi.min),Ge.expandByPoint(Me),Me.addVectors(Ge.max,Zi.max),Ge.expandByPoint(Me)):(Ge.expandByPoint(Zi.min),Ge.expandByPoint(Zi.max))}Ge.getCenter(n);let s=0;for(let r=0,o=t.count;r<o;r++)Me.fromBufferAttribute(t,r),s=Math.max(s,n.distanceToSquared(Me));if(e)for(let r=0,o=e.length;r<o;r++){const a=e[r],l=this.morphTargetsRelative;for(let c=0,u=a.count;c<u;c++)Me.fromBufferAttribute(a,c),l&&(xi.fromBufferAttribute(t,c),Me.add(xi)),s=Math.max(s,n.distanceToSquared(Me))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.position,s=e.normal,r=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Re(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],l=[];for(let D=0;D<n.count;D++)a[D]=new J,l[D]=new J;const c=new J,u=new J,h=new J,f=new $t,p=new $t,_=new $t,S=new J,m=new J;function d(D,g,y){c.fromBufferAttribute(n,D),u.fromBufferAttribute(n,g),h.fromBufferAttribute(n,y),f.fromBufferAttribute(r,D),p.fromBufferAttribute(r,g),_.fromBufferAttribute(r,y),u.sub(c),h.sub(c),p.sub(f),_.sub(f);const U=1/(p.x*_.y-_.x*p.y);isFinite(U)&&(S.copy(u).multiplyScalar(_.y).addScaledVector(h,-p.y).multiplyScalar(U),m.copy(h).multiplyScalar(p.x).addScaledVector(u,-_.x).multiplyScalar(U),a[D].add(S),a[g].add(S),a[y].add(S),l[D].add(m),l[g].add(m),l[y].add(m))}let A=this.groups;A.length===0&&(A=[{start:0,count:t.count}]);for(let D=0,g=A.length;D<g;++D){const y=A[D],U=y.start,k=y.count;for(let H=U,O=U+k;H<O;H+=3)d(t.getX(H+0),t.getX(H+1),t.getX(H+2))}const P=new J,x=new J,w=new J,E=new J;function C(D){w.fromBufferAttribute(s,D),E.copy(w);const g=a[D];P.copy(g),P.sub(w.multiplyScalar(w.dot(g))).normalize(),x.crossVectors(E,g);const U=x.dot(l[D])<0?-1:1;o.setXYZW(D,P.x,P.y,P.z,U)}for(let D=0,g=A.length;D<g;++D){const y=A[D],U=y.start,k=y.count;for(let H=U,O=U+k;H<O;H+=3)C(t.getX(H+0)),C(t.getX(H+1)),C(t.getX(H+2))}}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Re(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,p=n.count;f<p;f++)n.setXYZ(f,0,0,0);const s=new J,r=new J,o=new J,a=new J,l=new J,c=new J,u=new J,h=new J;if(t)for(let f=0,p=t.count;f<p;f+=3){const _=t.getX(f+0),S=t.getX(f+1),m=t.getX(f+2);s.fromBufferAttribute(e,_),r.fromBufferAttribute(e,S),o.fromBufferAttribute(e,m),u.subVectors(o,r),h.subVectors(s,r),u.cross(h),a.fromBufferAttribute(n,_),l.fromBufferAttribute(n,S),c.fromBufferAttribute(n,m),a.add(u),l.add(u),c.add(u),n.setXYZ(_,a.x,a.y,a.z),n.setXYZ(S,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let f=0,p=e.count;f<p;f+=3)s.fromBufferAttribute(e,f+0),r.fromBufferAttribute(e,f+1),o.fromBufferAttribute(e,f+2),u.subVectors(o,r),h.subVectors(s,r),u.cross(h),n.setXYZ(f+0,u.x,u.y,u.z),n.setXYZ(f+1,u.x,u.y,u.z),n.setXYZ(f+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Me.fromBufferAttribute(t,e),Me.normalize(),t.setXYZ(e,Me.x,Me.y,Me.z)}toNonIndexed(){function t(a,l){const c=a.array,u=a.itemSize,h=a.normalized,f=new c.constructor(l.length*u);let p=0,_=0;for(let S=0,m=l.length;S<m;S++){a.isInterleavedBufferAttribute?p=l[S]*a.data.stride+a.offset:p=l[S]*u;for(let d=0;d<u;d++)f[_++]=c[p++]}return new Re(f,u,h)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new sn,n=this.index.array,s=this.attributes;for(const a in s){const l=s[a],c=t(l,n);e.setAttribute(a,c)}const r=this.morphAttributes;for(const a in r){const l=[],c=r[a];for(let u=0,h=c.length;u<h;u++){const f=c[u],p=t(f,n);l.push(p)}e.morphAttributes[a]=l}e.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const n=this.attributes;for(const l in n){const c=n[l];t.data.attributes[l]=c.toJSON(t.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],u=[];for(let h=0,f=c.length;h<f;h++){const p=c[h];u.push(p.toJSON(t.data))}u.length>0&&(s[l]=u,r=!0)}r&&(t.data.morphAttributes=s,t.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(t.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(t.data.boundingSphere=a.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const n=t.index;n!==null&&this.setIndex(n.clone());const s=t.attributes;for(const c in s){const u=s[c];this.setAttribute(c,u.clone(e))}const r=t.morphAttributes;for(const c in r){const u=[],h=r[c];for(let f=0,p=h.length;f<p;f++)u.push(h[f].clone(e));this.morphAttributes[c]=u}this.morphTargetsRelative=t.morphTargetsRelative;const o=t.groups;for(let c=0,u=o.length;c<u;c++){const h=o[c];this.addGroup(h.start,h.count,h.materialIndex)}const a=t.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Ba=new me,Gn=new Ko,bs=new tr,ka=new J,Es=new J,Ts=new J,ws=new J,Rr=new J,As=new J,Ha=new J,Rs=new J;class We extends ye{constructor(t=new sn,e=new dc){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const s=e[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(t,e){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;e.fromBufferAttribute(s,t);const a=this.morphTargetInfluences;if(r&&a){As.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const u=a[l],h=r[l];u!==0&&(Rr.fromBufferAttribute(h,t),o?As.addScaledVector(Rr,u):As.addScaledVector(Rr.sub(e),u))}e.add(As)}return e}raycast(t,e){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),bs.copy(n.boundingSphere),bs.applyMatrix4(r),Gn.copy(t.ray).recast(t.near),!(bs.containsPoint(Gn.origin)===!1&&(Gn.intersectSphere(bs,ka)===null||Gn.origin.distanceToSquared(ka)>(t.far-t.near)**2))&&(Ba.copy(r).invert(),Gn.copy(t.ray).applyMatrix4(Ba),!(n.boundingBox!==null&&Gn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,Gn)))}_computeIntersections(t,e,n){let s;const r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,u=r.attributes.uv1,h=r.attributes.normal,f=r.groups,p=r.drawRange;if(a!==null)if(Array.isArray(o))for(let _=0,S=f.length;_<S;_++){const m=f[_],d=o[m.materialIndex],A=Math.max(m.start,p.start),P=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let x=A,w=P;x<w;x+=3){const E=a.getX(x),C=a.getX(x+1),D=a.getX(x+2);s=Cs(this,d,t,n,c,u,h,E,C,D),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=m.materialIndex,e.push(s))}}else{const _=Math.max(0,p.start),S=Math.min(a.count,p.start+p.count);for(let m=_,d=S;m<d;m+=3){const A=a.getX(m),P=a.getX(m+1),x=a.getX(m+2);s=Cs(this,o,t,n,c,u,h,A,P,x),s&&(s.faceIndex=Math.floor(m/3),e.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let _=0,S=f.length;_<S;_++){const m=f[_],d=o[m.materialIndex],A=Math.max(m.start,p.start),P=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let x=A,w=P;x<w;x+=3){const E=x,C=x+1,D=x+2;s=Cs(this,d,t,n,c,u,h,E,C,D),s&&(s.faceIndex=Math.floor(x/3),s.face.materialIndex=m.materialIndex,e.push(s))}}else{const _=Math.max(0,p.start),S=Math.min(l.count,p.start+p.count);for(let m=_,d=S;m<d;m+=3){const A=m,P=m+1,x=m+2;s=Cs(this,o,t,n,c,u,h,A,P,x),s&&(s.faceIndex=Math.floor(m/3),e.push(s))}}}}function vu(i,t,e,n,s,r,o,a){let l;if(t.side===Fe?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,t.side===Fn,a),l===null)return null;Rs.copy(a),Rs.applyMatrix4(i.matrixWorld);const c=e.ray.origin.distanceTo(Rs);return c<e.near||c>e.far?null:{distance:c,point:Rs.clone(),object:i}}function Cs(i,t,e,n,s,r,o,a,l,c){i.getVertexPosition(a,Es),i.getVertexPosition(l,Ts),i.getVertexPosition(c,ws);const u=vu(i,t,e,n,Es,Ts,ws,Ha);if(u){const h=new J;qi.getBarycoord(Ha,Es,Ts,ws,h),s&&(u.uv=qi.getInterpolatedAttribute(s,a,l,c,h,new $t)),r&&(u.uv1=qi.getInterpolatedAttribute(r,a,l,c,h,new $t)),o&&(u.normal=qi.getInterpolatedAttribute(o,a,l,c,h,new J),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));const f={a,b:l,c,normal:new J,materialIndex:0};qi.getNormal(Es,Ts,ws,f.normal),u.face=f,u.barycoord=h}return u}class cs extends sn{constructor(t=1,e=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const l=[],c=[],u=[],h=[];let f=0,p=0;_("z","y","x",-1,-1,n,e,t,o,r,0),_("z","y","x",1,-1,n,e,-t,o,r,1),_("x","z","y",1,1,t,n,e,s,o,2),_("x","z","y",1,-1,t,n,-e,s,o,3),_("x","y","z",1,-1,t,e,n,s,r,4),_("x","y","z",-1,-1,t,e,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ze(c,3)),this.setAttribute("normal",new ze(u,3)),this.setAttribute("uv",new ze(h,2));function _(S,m,d,A,P,x,w,E,C,D,g){const y=x/C,U=w/D,k=x/2,H=w/2,O=E/2,V=C+1,B=D+1;let $=0,Z=0;const rt=new J;for(let ft=0;ft<B;ft++){const yt=ft*U-H;for(let ct=0;ct<V;ct++){const pt=ct*y-k;rt[S]=pt*A,rt[m]=yt*P,rt[d]=O,c.push(rt.x,rt.y,rt.z),rt[S]=0,rt[m]=0,rt[d]=E>0?1:-1,u.push(rt.x,rt.y,rt.z),h.push(ct/C),h.push(1-ft/D),$+=1}}for(let ft=0;ft<D;ft++)for(let yt=0;yt<C;yt++){const ct=f+yt+V*ft,pt=f+yt+V*(ft+1),Lt=f+(yt+1)+V*(ft+1),zt=f+(yt+1)+V*ft;l.push(ct,pt,zt),l.push(pt,Lt,zt),Z+=6}a.addGroup(p,Z,g),p+=Z,f+=$}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new cs(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}function Bi(i){const t={};for(const e in i){t[e]={};for(const n in i[e]){const s=i[e][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=s.clone():Array.isArray(s)?t[e][n]=s.slice():t[e][n]=s}}return t}function Pe(i){const t={};for(let e=0;e<i.length;e++){const n=Bi(i[e]);for(const s in n)t[s]=n[s]}return t}function Mu(i){const t=[];for(let e=0;e<i.length;e++)t.push(i[e].clone());return t}function fc(i){const t=i.getRenderTarget();return t===null?i.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:ne.workingColorSpace}const yu={clone:Bi,merge:Pe};var Su=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,bu=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class On extends Vi{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Su,this.fragmentShader=bu,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Bi(t.uniforms),this.uniformsGroups=Mu(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?e.uniforms[s]={type:"t",value:o.toJSON(t).uuid}:o&&o.isColor?e.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?e.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?e.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?e.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?e.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?e.uniforms[s]={type:"m4",value:o.toArray()}:e.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}}let pc=class extends ye{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new me,this.projectionMatrix=new me,this.projectionMatrixInverse=new me,this.coordinateSystem=un,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}};const Pn=new J,Va=new $t,Ga=new $t;class Ke extends pc{constructor(t=50,e=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=Uo*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Vs*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return Uo*2*Math.atan(Math.tan(Vs*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Pn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Pn.x,Pn.y).multiplyScalar(-t/Pn.z),Pn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Pn.x,Pn.y).multiplyScalar(-t/Pn.z)}getViewSize(t,e){return this.getViewBounds(t,Va,Ga),e.subVectors(Ga,Va)}setViewOffset(t,e,n,s,r,o){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Vs*.5*this.fov)/this.zoom,n=2*e,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,e-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(r+=t*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,e,e-n,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}const vi=-90,Mi=1;class Eu extends ye{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Ke(vi,Mi,t,e);s.layers=this.layers,this.add(s);const r=new Ke(vi,Mi,t,e);r.layers=this.layers,this.add(r);const o=new Ke(vi,Mi,t,e);o.layers=this.layers,this.add(o);const a=new Ke(vi,Mi,t,e);a.layers=this.layers,this.add(a);const l=new Ke(vi,Mi,t,e);l.layers=this.layers,this.add(l);const c=new Ke(vi,Mi,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[n,s,r,o,a,l]=e;for(const c of e)this.remove(c);if(t===un)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===$s)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,l,c,u]=this.children,h=t.getRenderTarget(),f=t.getActiveCubeFace(),p=t.getActiveMipmapLevel(),_=t.xr.enabled;t.xr.enabled=!1;const S=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,s),t.render(e,r),t.setRenderTarget(n,1,s),t.render(e,o),t.setRenderTarget(n,2,s),t.render(e,a),t.setRenderTarget(n,3,s),t.render(e,l),t.setRenderTarget(n,4,s),t.render(e,c),n.texture.generateMipmaps=S,t.setRenderTarget(n,5,s),t.render(e,u),t.setRenderTarget(h,f,p),t.xr.enabled=_,n.texture.needsPMREMUpdate=!0}}class mc extends Oe{constructor(t=[],e=Fi,n,s,r,o,a,l,c,u){super(t,e,n,s,r,o,a,l,c,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Tu extends ii{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const n={width:t,height:t,depth:1},s=[n,n,n,n,n,n];this.texture=new mc(s),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new cs(5,5,5),r=new On({name:"CubemapFromEquirect",uniforms:Bi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Fe,blending:Un});r.uniforms.tEquirect.value=e;const o=new We(s,r),a=e.minFilter;return e.minFilter===Qn&&(e.minFilter=dn),new Eu(1,10,this).update(t,o),e.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(t,e=!0,n=!0,s=!0){const r=t.getRenderTarget();for(let o=0;o<6;o++)t.setRenderTarget(this,o),t.clear(e,n,s);t.setRenderTarget(r)}}class Ai extends ye{constructor(){super(),this.isGroup=!0,this.type="Group"}}const wu={type:"move"};class Cr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ai,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ai,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new J,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new J),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ai,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new J,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new J),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let s=null,r=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){o=!0;for(const S of t.hand.values()){const m=e.getJointPose(S,n),d=this._getHandJoint(c,S);m!==null&&(d.matrix.fromArray(m.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=m.radius),d.visible=m!==null}const u=c.joints["index-finger-tip"],h=c.joints["thumb-tip"],f=u.position.distanceTo(h.position),p=.02,_=.005;c.inputState.pinching&&f>p+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&f<=p-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=e.getPose(t.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(wu)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const n=new Ai;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}}class Jo{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new Jt(t),this.density=e}clone(){return new Jo(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class Au extends ye{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new pn,this.environmentIntensity=1,this.environmentRotation=new pn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}const Pr=new J,Ru=new J,Cu=new Zt;class Dn{constructor(t=new J(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,s){return this.normal.set(t,e,n),this.constant=s,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){const s=Pr.subVectors(n,e).cross(Ru.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(s,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){const n=t.delta(Pr),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const r=-(t.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:e.copy(t.start).addScaledVector(n,r)}intersectsLine(t){const e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const n=e||Cu.getNormalMatrix(t),s=this.coplanarPoint(Pr).applyMatrix4(t),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Wn=new tr,Pu=new $t(.5,.5),Ps=new J;class Qo{constructor(t=new Dn,e=new Dn,n=new Dn,s=new Dn,r=new Dn,o=new Dn){this.planes=[t,e,n,s,r,o]}set(t,e,n,s,r,o){const a=this.planes;return a[0].copy(t),a[1].copy(e),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(t){const e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=un,n=!1){const s=this.planes,r=t.elements,o=r[0],a=r[1],l=r[2],c=r[3],u=r[4],h=r[5],f=r[6],p=r[7],_=r[8],S=r[9],m=r[10],d=r[11],A=r[12],P=r[13],x=r[14],w=r[15];if(s[0].setComponents(c-o,p-u,d-_,w-A).normalize(),s[1].setComponents(c+o,p+u,d+_,w+A).normalize(),s[2].setComponents(c+a,p+h,d+S,w+P).normalize(),s[3].setComponents(c-a,p-h,d-S,w-P).normalize(),n)s[4].setComponents(l,f,m,x).normalize(),s[5].setComponents(c-l,p-f,d-m,w-x).normalize();else if(s[4].setComponents(c-l,p-f,d-m,w-x).normalize(),e===un)s[5].setComponents(c+l,p+f,d+m,w+x).normalize();else if(e===$s)s[5].setComponents(l,f,m,x).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Wn.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Wn.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Wn)}intersectsSprite(t){Wn.center.set(0,0,0);const e=Pu.distanceTo(t.center);return Wn.radius=.7071067811865476+e,Wn.applyMatrix4(t.matrixWorld),this.intersectsSphere(Wn)}intersectsSphere(t){const e=this.planes,n=t.center,s=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(t){const e=this.planes;for(let n=0;n<6;n++){const s=e[n];if(Ps.x=s.normal.x>0?t.max.x:t.min.x,Ps.y=s.normal.y>0?t.max.y:t.min.y,Ps.z=s.normal.z>0?t.max.z:t.min.z,s.distanceToPoint(Ps)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class gc extends Vi{constructor(t){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Jt(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}}const qs=new J,Zs=new J,Wa=new me,Ki=new Ko,Ls=new tr,Lr=new J,Xa=new J;class Lu extends ye{constructor(t=new sn,e=new gc){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[0];for(let s=1,r=e.count;s<r;s++)qs.fromBufferAttribute(e,s-1),Zs.fromBufferAttribute(e,s),n[s]=n[s-1],n[s]+=qs.distanceTo(Zs);t.setAttribute("lineDistance",new ze(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){const n=this.geometry,s=this.matrixWorld,r=t.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ls.copy(n.boundingSphere),Ls.applyMatrix4(s),Ls.radius+=r,t.ray.intersectsSphere(Ls)===!1)return;Wa.copy(s).invert(),Ki.copy(t.ray).applyMatrix4(Wa);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,u=n.index,f=n.attributes.position;if(u!==null){const p=Math.max(0,o.start),_=Math.min(u.count,o.start+o.count);for(let S=p,m=_-1;S<m;S+=c){const d=u.getX(S),A=u.getX(S+1),P=Ds(this,t,Ki,l,d,A,S);P&&e.push(P)}if(this.isLineLoop){const S=u.getX(_-1),m=u.getX(p),d=Ds(this,t,Ki,l,S,m,_-1);d&&e.push(d)}}else{const p=Math.max(0,o.start),_=Math.min(f.count,o.start+o.count);for(let S=p,m=_-1;S<m;S+=c){const d=Ds(this,t,Ki,l,S,S+1,S);d&&e.push(d)}if(this.isLineLoop){const S=Ds(this,t,Ki,l,_-1,p,_-1);S&&e.push(S)}}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const s=e[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function Ds(i,t,e,n,s,r,o){const a=i.geometry.attributes.position;if(qs.fromBufferAttribute(a,s),Zs.fromBufferAttribute(a,r),e.distanceSqToSegment(qs,Zs,Lr,Xa)>n)return;Lr.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(Lr);if(!(c<t.near||c>t.far))return{distance:c,point:Xa.clone().applyMatrix4(i.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:i}}const ja=new J,$a=new J;class Du extends Lu{constructor(t,e){super(t,e),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[];for(let s=0,r=e.count;s<r;s+=2)ja.fromBufferAttribute(e,s),$a.fromBufferAttribute(e,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+ja.distanceTo($a);t.setAttribute("lineDistance",new ze(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class _c extends Oe{constructor(t,e,n=ei,s,r,o,a=nn,l=nn,c,u=ss,h=1){if(u!==ss&&u!==rs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const f={width:t,height:e,depth:h};super(f,s,r,o,a,l,u,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Zo(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class xc extends Oe{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class ta extends sn{constructor(t=[],e=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:s};const r=[],o=[];a(s),c(n),u(),this.setAttribute("position",new ze(r,3)),this.setAttribute("normal",new ze(r.slice(),3)),this.setAttribute("uv",new ze(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(A){const P=new J,x=new J,w=new J;for(let E=0;E<e.length;E+=3)p(e[E+0],P),p(e[E+1],x),p(e[E+2],w),l(P,x,w,A)}function l(A,P,x,w){const E=w+1,C=[];for(let D=0;D<=E;D++){C[D]=[];const g=A.clone().lerp(x,D/E),y=P.clone().lerp(x,D/E),U=E-D;for(let k=0;k<=U;k++)k===0&&D===E?C[D][k]=g:C[D][k]=g.clone().lerp(y,k/U)}for(let D=0;D<E;D++)for(let g=0;g<2*(E-D)-1;g++){const y=Math.floor(g/2);g%2===0?(f(C[D][y+1]),f(C[D+1][y]),f(C[D][y])):(f(C[D][y+1]),f(C[D+1][y+1]),f(C[D+1][y]))}}function c(A){const P=new J;for(let x=0;x<r.length;x+=3)P.x=r[x+0],P.y=r[x+1],P.z=r[x+2],P.normalize().multiplyScalar(A),r[x+0]=P.x,r[x+1]=P.y,r[x+2]=P.z}function u(){const A=new J;for(let P=0;P<r.length;P+=3){A.x=r[P+0],A.y=r[P+1],A.z=r[P+2];const x=m(A)/2/Math.PI+.5,w=d(A)/Math.PI+.5;o.push(x,1-w)}_(),h()}function h(){for(let A=0;A<o.length;A+=6){const P=o[A+0],x=o[A+2],w=o[A+4],E=Math.max(P,x,w),C=Math.min(P,x,w);E>.9&&C<.1&&(P<.2&&(o[A+0]+=1),x<.2&&(o[A+2]+=1),w<.2&&(o[A+4]+=1))}}function f(A){r.push(A.x,A.y,A.z)}function p(A,P){const x=A*3;P.x=t[x+0],P.y=t[x+1],P.z=t[x+2]}function _(){const A=new J,P=new J,x=new J,w=new J,E=new $t,C=new $t,D=new $t;for(let g=0,y=0;g<r.length;g+=9,y+=6){A.set(r[g+0],r[g+1],r[g+2]),P.set(r[g+3],r[g+4],r[g+5]),x.set(r[g+6],r[g+7],r[g+8]),E.set(o[y+0],o[y+1]),C.set(o[y+2],o[y+3]),D.set(o[y+4],o[y+5]),w.copy(A).add(P).add(x).divideScalar(3);const U=m(w);S(E,y+0,A,U),S(C,y+2,P,U),S(D,y+4,x,U)}}function S(A,P,x,w){w<0&&A.x===1&&(o[P]=A.x-1),x.x===0&&x.z===0&&(o[P]=w/2/Math.PI+.5)}function m(A){return Math.atan2(A.z,-A.x)}function d(A){return Math.atan2(-A.y,Math.sqrt(A.x*A.x+A.z*A.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ta(t.vertices,t.indices,t.radius,t.details)}}class ea extends ta{constructor(t=1,e=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],s=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,s,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new ea(t.radius,t.detail)}}class ki extends sn{constructor(t=1,e=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:s};const r=t/2,o=e/2,a=Math.floor(n),l=Math.floor(s),c=a+1,u=l+1,h=t/a,f=e/l,p=[],_=[],S=[],m=[];for(let d=0;d<u;d++){const A=d*f-o;for(let P=0;P<c;P++){const x=P*h-r;_.push(x,-A,0),S.push(0,0,1),m.push(P/a),m.push(1-d/l)}}for(let d=0;d<l;d++)for(let A=0;A<a;A++){const P=A+c*d,x=A+c*(d+1),w=A+1+c*(d+1),E=A+1+c*d;p.push(P,x,E),p.push(x,w,E)}this.setIndex(p),this.setAttribute("position",new ze(_,3)),this.setAttribute("normal",new ze(S,3)),this.setAttribute("uv",new ze(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ki(t.width,t.height,t.widthSegments,t.heightSegments)}}class Is extends Vi{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Jt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Jt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=sc,this.normalScale=new $t(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new pn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Iu extends Vi{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Gd,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class Uu extends Vi{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}class vc extends ye{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Jt(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}}class Nu extends vc{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(ye.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Jt(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}}const Dr=new me,Ya=new J,qa=new J;class Fu{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new $t(512,512),this.mapType=fn,this.map=null,this.mapPass=null,this.matrix=new me,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Qo,this._frameExtents=new $t(1,1),this._viewportCount=1,this._viewports=[new pe(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,n=this.matrix;Ya.setFromMatrixPosition(t.matrixWorld),e.position.copy(Ya),qa.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(qa),e.updateMatrixWorld(),Dr.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Dr,e.coordinateSystem,e.reversedDepth),e.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Dr)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}class Mc extends pc{constructor(t=-1,e=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-t,o=n+t,a=s+e,l=s-e;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=u*this.view.offsetY,l=a-u*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}class Ou extends Fu{constructor(){super(new Mc(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Za extends vc{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ye.DEFAULT_UP),this.updateMatrix(),this.target=new ye,this.shadow=new Ou}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}class zu extends Ke{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}class Bu{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}class Ka{constructor(t=1,e=0,n=0){this.radius=t,this.phi=e,this.theta=n}set(t,e,n){return this.radius=t,this.phi=e,this.theta=n,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=Qt(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+e*e+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,n),this.phi=Math.acos(Qt(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}class Ja extends Du{constructor(t=10,e=10,n=4473924,s=8947848){n=new Jt(n),s=new Jt(s);const r=e/2,o=t/e,a=t/2,l=[],c=[];for(let f=0,p=0,_=-a;f<=e;f++,_+=o){l.push(-a,0,_,a,0,_),l.push(_,0,-a,_,0,a);const S=f===r?n:s;S.toArray(c,p),p+=3,S.toArray(c,p),p+=3,S.toArray(c,p),p+=3,S.toArray(c,p),p+=3}const u=new sn;u.setAttribute("position",new ze(l,3)),u.setAttribute("color",new ze(c,3));const h=new gc({vertexColors:!0,toneMapped:!1});super(u,h),this.type="GridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}}class ku extends ri{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){if(t===void 0){console.warn("THREE.Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}}function Qa(i,t,e,n){const s=Hu(n);switch(e){case tc:return i*t;case nc:return i*t/s.components*s.byteLength;case $o:return i*t/s.components*s.byteLength;case ic:return i*t*2/s.components*s.byteLength;case Yo:return i*t*2/s.components*s.byteLength;case ec:return i*t*3/s.components*s.byteLength;case en:return i*t*4/s.components*s.byteLength;case qo:return i*t*4/s.components*s.byteLength;case zs:case Bs:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case ks:case Hs:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case oo:case lo:return Math.max(i,16)*Math.max(t,8)/4;case ro:case ao:return Math.max(i,8)*Math.max(t,8)/2;case co:case uo:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*8;case ho:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case fo:return Math.floor((i+3)/4)*Math.floor((t+3)/4)*16;case po:return Math.floor((i+4)/5)*Math.floor((t+3)/4)*16;case mo:return Math.floor((i+4)/5)*Math.floor((t+4)/5)*16;case go:return Math.floor((i+5)/6)*Math.floor((t+4)/5)*16;case _o:return Math.floor((i+5)/6)*Math.floor((t+5)/6)*16;case xo:return Math.floor((i+7)/8)*Math.floor((t+4)/5)*16;case vo:return Math.floor((i+7)/8)*Math.floor((t+5)/6)*16;case Mo:return Math.floor((i+7)/8)*Math.floor((t+7)/8)*16;case yo:return Math.floor((i+9)/10)*Math.floor((t+4)/5)*16;case So:return Math.floor((i+9)/10)*Math.floor((t+5)/6)*16;case bo:return Math.floor((i+9)/10)*Math.floor((t+7)/8)*16;case Eo:return Math.floor((i+9)/10)*Math.floor((t+9)/10)*16;case To:return Math.floor((i+11)/12)*Math.floor((t+9)/10)*16;case wo:return Math.floor((i+11)/12)*Math.floor((t+11)/12)*16;case Ao:case Ro:case Co:return Math.ceil(i/4)*Math.ceil(t/4)*16;case Po:case Lo:return Math.ceil(i/4)*Math.ceil(t/4)*8;case Do:case Io:return Math.ceil(i/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Hu(i){switch(i){case fn:case Zl:return{byteLength:1,components:1};case ns:case Kl:case as:return{byteLength:2,components:1};case Xo:case jo:return{byteLength:2,components:4};case ei:case Wo:case bn:return{byteLength:4,components:1};case Jl:case Ql:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Go}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Go);function yc(){let i=null,t=!1,e=null,n=null;function s(r,o){e(r,o),n=i.requestAnimationFrame(s)}return{start:function(){t!==!0&&e!==null&&(n=i.requestAnimationFrame(s),t=!0)},stop:function(){i.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){i=r}}}function Vu(i){const t=new WeakMap;function e(a,l){const c=a.array,u=a.usage,h=c.byteLength,f=i.createBuffer();i.bindBuffer(l,f),i.bufferData(l,c,u),a.onUploadCallback();let p;if(c instanceof Float32Array)p=i.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)p=i.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?p=i.HALF_FLOAT:p=i.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=i.SHORT;else if(c instanceof Uint32Array)p=i.UNSIGNED_INT;else if(c instanceof Int32Array)p=i.INT;else if(c instanceof Int8Array)p=i.BYTE;else if(c instanceof Uint8Array)p=i.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:f,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:h}}function n(a,l,c){const u=l.array,h=l.updateRanges;if(i.bindBuffer(c,a),h.length===0)i.bufferSubData(c,0,u);else{h.sort((p,_)=>p.start-_.start);let f=0;for(let p=1;p<h.length;p++){const _=h[f],S=h[p];S.start<=_.start+_.count+1?_.count=Math.max(_.count,S.start+S.count-_.start):(++f,h[f]=S)}h.length=f+1;for(let p=0,_=h.length;p<_;p++){const S=h[p];i.bufferSubData(c,S.start*u.BYTES_PER_ELEMENT,u,S.start,S.count)}l.clearUpdateRanges()}l.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),t.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);const l=t.get(a);l&&(i.deleteBuffer(l.buffer),t.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const u=t.get(a);(!u||u.version<a.version)&&t.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const c=t.get(a);if(c===void 0)t.set(a,e(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:s,remove:r,update:o}}var Gu=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Wu=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Xu=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,ju=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,$u=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Yu=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,qu=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Zu=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Ku=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Ju=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Qu=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,th=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,eh=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,nh=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,ih=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,sh=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,rh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,oh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,ah=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,lh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,ch=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,dh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,uh=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,hh=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,fh=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,ph=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,mh=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,gh=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,_h=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,xh=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,vh="gl_FragColor = linearToOutputTexel( gl_FragColor );",Mh=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,yh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Sh=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,bh=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Eh=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Th=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,wh=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Ah=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Rh=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Ch=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Ph=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Lh=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Dh=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Ih=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Uh=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Nh=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Fh=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Oh=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,zh=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Bh=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,kh=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Hh=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Vh=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Gh=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Wh=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Xh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,jh=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,$h=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Yh=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,qh=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Zh=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Kh=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Jh=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Qh=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,tf=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,ef=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,nf=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,sf=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,rf=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,of=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,af=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,lf=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,cf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,df=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,uf=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,hf=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,ff=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,pf=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,mf=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,gf=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,_f=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,xf=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,vf=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Mf=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,yf=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Sf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,bf=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Ef=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Tf=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,wf=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Af=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,Rf=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Cf=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Pf=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Lf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Df=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,If=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Uf=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Nf=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Ff=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Of=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,zf=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Bf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,kf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Hf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Vf=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Gf=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Wf=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Xf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,jf=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,$f=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Yf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,qf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Zf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Kf=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Jf=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Qf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,tp=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ep=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,np=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,ip=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,sp=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,rp=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,op=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ap=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,lp=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,cp=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,dp=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,up=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,hp=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,fp=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,pp=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mp=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,gp=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,_p=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,xp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,vp=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Mp=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,yp=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Sp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Kt={alphahash_fragment:Gu,alphahash_pars_fragment:Wu,alphamap_fragment:Xu,alphamap_pars_fragment:ju,alphatest_fragment:$u,alphatest_pars_fragment:Yu,aomap_fragment:qu,aomap_pars_fragment:Zu,batching_pars_vertex:Ku,batching_vertex:Ju,begin_vertex:Qu,beginnormal_vertex:th,bsdfs:eh,iridescence_fragment:nh,bumpmap_pars_fragment:ih,clipping_planes_fragment:sh,clipping_planes_pars_fragment:rh,clipping_planes_pars_vertex:oh,clipping_planes_vertex:ah,color_fragment:lh,color_pars_fragment:ch,color_pars_vertex:dh,color_vertex:uh,common:hh,cube_uv_reflection_fragment:fh,defaultnormal_vertex:ph,displacementmap_pars_vertex:mh,displacementmap_vertex:gh,emissivemap_fragment:_h,emissivemap_pars_fragment:xh,colorspace_fragment:vh,colorspace_pars_fragment:Mh,envmap_fragment:yh,envmap_common_pars_fragment:Sh,envmap_pars_fragment:bh,envmap_pars_vertex:Eh,envmap_physical_pars_fragment:Nh,envmap_vertex:Th,fog_vertex:wh,fog_pars_vertex:Ah,fog_fragment:Rh,fog_pars_fragment:Ch,gradientmap_pars_fragment:Ph,lightmap_pars_fragment:Lh,lights_lambert_fragment:Dh,lights_lambert_pars_fragment:Ih,lights_pars_begin:Uh,lights_toon_fragment:Fh,lights_toon_pars_fragment:Oh,lights_phong_fragment:zh,lights_phong_pars_fragment:Bh,lights_physical_fragment:kh,lights_physical_pars_fragment:Hh,lights_fragment_begin:Vh,lights_fragment_maps:Gh,lights_fragment_end:Wh,logdepthbuf_fragment:Xh,logdepthbuf_pars_fragment:jh,logdepthbuf_pars_vertex:$h,logdepthbuf_vertex:Yh,map_fragment:qh,map_pars_fragment:Zh,map_particle_fragment:Kh,map_particle_pars_fragment:Jh,metalnessmap_fragment:Qh,metalnessmap_pars_fragment:tf,morphinstance_vertex:ef,morphcolor_vertex:nf,morphnormal_vertex:sf,morphtarget_pars_vertex:rf,morphtarget_vertex:of,normal_fragment_begin:af,normal_fragment_maps:lf,normal_pars_fragment:cf,normal_pars_vertex:df,normal_vertex:uf,normalmap_pars_fragment:hf,clearcoat_normal_fragment_begin:ff,clearcoat_normal_fragment_maps:pf,clearcoat_pars_fragment:mf,iridescence_pars_fragment:gf,opaque_fragment:_f,packing:xf,premultiplied_alpha_fragment:vf,project_vertex:Mf,dithering_fragment:yf,dithering_pars_fragment:Sf,roughnessmap_fragment:bf,roughnessmap_pars_fragment:Ef,shadowmap_pars_fragment:Tf,shadowmap_pars_vertex:wf,shadowmap_vertex:Af,shadowmask_pars_fragment:Rf,skinbase_vertex:Cf,skinning_pars_vertex:Pf,skinning_vertex:Lf,skinnormal_vertex:Df,specularmap_fragment:If,specularmap_pars_fragment:Uf,tonemapping_fragment:Nf,tonemapping_pars_fragment:Ff,transmission_fragment:Of,transmission_pars_fragment:zf,uv_pars_fragment:Bf,uv_pars_vertex:kf,uv_vertex:Hf,worldpos_vertex:Vf,background_vert:Gf,background_frag:Wf,backgroundCube_vert:Xf,backgroundCube_frag:jf,cube_vert:$f,cube_frag:Yf,depth_vert:qf,depth_frag:Zf,distanceRGBA_vert:Kf,distanceRGBA_frag:Jf,equirect_vert:Qf,equirect_frag:tp,linedashed_vert:ep,linedashed_frag:np,meshbasic_vert:ip,meshbasic_frag:sp,meshlambert_vert:rp,meshlambert_frag:op,meshmatcap_vert:ap,meshmatcap_frag:lp,meshnormal_vert:cp,meshnormal_frag:dp,meshphong_vert:up,meshphong_frag:hp,meshphysical_vert:fp,meshphysical_frag:pp,meshtoon_vert:mp,meshtoon_frag:gp,points_vert:_p,points_frag:xp,shadow_vert:vp,shadow_frag:Mp,sprite_vert:yp,sprite_frag:Sp},Tt={common:{diffuse:{value:new Jt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Zt},alphaMap:{value:null},alphaMapTransform:{value:new Zt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Zt}},envmap:{envMap:{value:null},envMapRotation:{value:new Zt},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Zt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Zt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Zt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Zt},normalScale:{value:new $t(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Zt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Zt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Zt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Zt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Jt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Jt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Zt},alphaTest:{value:0},uvTransform:{value:new Zt}},sprite:{diffuse:{value:new Jt(16777215)},opacity:{value:1},center:{value:new $t(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Zt},alphaMap:{value:null},alphaMapTransform:{value:new Zt},alphaTest:{value:0}}},an={basic:{uniforms:Pe([Tt.common,Tt.specularmap,Tt.envmap,Tt.aomap,Tt.lightmap,Tt.fog]),vertexShader:Kt.meshbasic_vert,fragmentShader:Kt.meshbasic_frag},lambert:{uniforms:Pe([Tt.common,Tt.specularmap,Tt.envmap,Tt.aomap,Tt.lightmap,Tt.emissivemap,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,Tt.fog,Tt.lights,{emissive:{value:new Jt(0)}}]),vertexShader:Kt.meshlambert_vert,fragmentShader:Kt.meshlambert_frag},phong:{uniforms:Pe([Tt.common,Tt.specularmap,Tt.envmap,Tt.aomap,Tt.lightmap,Tt.emissivemap,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,Tt.fog,Tt.lights,{emissive:{value:new Jt(0)},specular:{value:new Jt(1118481)},shininess:{value:30}}]),vertexShader:Kt.meshphong_vert,fragmentShader:Kt.meshphong_frag},standard:{uniforms:Pe([Tt.common,Tt.envmap,Tt.aomap,Tt.lightmap,Tt.emissivemap,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,Tt.roughnessmap,Tt.metalnessmap,Tt.fog,Tt.lights,{emissive:{value:new Jt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Kt.meshphysical_vert,fragmentShader:Kt.meshphysical_frag},toon:{uniforms:Pe([Tt.common,Tt.aomap,Tt.lightmap,Tt.emissivemap,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,Tt.gradientmap,Tt.fog,Tt.lights,{emissive:{value:new Jt(0)}}]),vertexShader:Kt.meshtoon_vert,fragmentShader:Kt.meshtoon_frag},matcap:{uniforms:Pe([Tt.common,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,Tt.fog,{matcap:{value:null}}]),vertexShader:Kt.meshmatcap_vert,fragmentShader:Kt.meshmatcap_frag},points:{uniforms:Pe([Tt.points,Tt.fog]),vertexShader:Kt.points_vert,fragmentShader:Kt.points_frag},dashed:{uniforms:Pe([Tt.common,Tt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Kt.linedashed_vert,fragmentShader:Kt.linedashed_frag},depth:{uniforms:Pe([Tt.common,Tt.displacementmap]),vertexShader:Kt.depth_vert,fragmentShader:Kt.depth_frag},normal:{uniforms:Pe([Tt.common,Tt.bumpmap,Tt.normalmap,Tt.displacementmap,{opacity:{value:1}}]),vertexShader:Kt.meshnormal_vert,fragmentShader:Kt.meshnormal_frag},sprite:{uniforms:Pe([Tt.sprite,Tt.fog]),vertexShader:Kt.sprite_vert,fragmentShader:Kt.sprite_frag},background:{uniforms:{uvTransform:{value:new Zt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Kt.background_vert,fragmentShader:Kt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Zt}},vertexShader:Kt.backgroundCube_vert,fragmentShader:Kt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Kt.cube_vert,fragmentShader:Kt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Kt.equirect_vert,fragmentShader:Kt.equirect_frag},distanceRGBA:{uniforms:Pe([Tt.common,Tt.displacementmap,{referencePosition:{value:new J},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Kt.distanceRGBA_vert,fragmentShader:Kt.distanceRGBA_frag},shadow:{uniforms:Pe([Tt.lights,Tt.fog,{color:{value:new Jt(0)},opacity:{value:1}}]),vertexShader:Kt.shadow_vert,fragmentShader:Kt.shadow_frag}};an.physical={uniforms:Pe([an.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Zt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Zt},clearcoatNormalScale:{value:new $t(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Zt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Zt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Zt},sheen:{value:0},sheenColor:{value:new Jt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Zt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Zt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Zt},transmissionSamplerSize:{value:new $t},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Zt},attenuationDistance:{value:0},attenuationColor:{value:new Jt(0)},specularColor:{value:new Jt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Zt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Zt},anisotropyVector:{value:new $t},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Zt}}]),vertexShader:Kt.meshphysical_vert,fragmentShader:Kt.meshphysical_frag};const Us={r:0,b:0,g:0},Xn=new pn,bp=new me;function Ep(i,t,e,n,s,r,o){const a=new Jt(0);let l=r===!0?0:1,c,u,h=null,f=0,p=null;function _(P){let x=P.isScene===!0?P.background:null;return x&&x.isTexture&&(x=(P.backgroundBlurriness>0?e:t).get(x)),x}function S(P){let x=!1;const w=_(P);w===null?d(a,l):w&&w.isColor&&(d(w,1),x=!0);const E=i.xr.getEnvironmentBlendMode();E==="additive"?n.buffers.color.setClear(0,0,0,1,o):E==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||x)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function m(P,x){const w=_(x);w&&(w.isCubeTexture||w.mapping===Qs)?(u===void 0&&(u=new We(new cs(1,1,1),new On({name:"BackgroundCubeMaterial",uniforms:Bi(an.backgroundCube.uniforms),vertexShader:an.backgroundCube.vertexShader,fragmentShader:an.backgroundCube.fragmentShader,side:Fe,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(E,C,D){this.matrixWorld.copyPosition(D.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(u)),Xn.copy(x.backgroundRotation),Xn.x*=-1,Xn.y*=-1,Xn.z*=-1,w.isCubeTexture&&w.isRenderTargetTexture===!1&&(Xn.y*=-1,Xn.z*=-1),u.material.uniforms.envMap.value=w,u.material.uniforms.flipEnvMap.value=w.isCubeTexture&&w.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=x.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(bp.makeRotationFromEuler(Xn)),u.material.toneMapped=ne.getTransfer(w.colorSpace)!==re,(h!==w||f!==w.version||p!==i.toneMapping)&&(u.material.needsUpdate=!0,h=w,f=w.version,p=i.toneMapping),u.layers.enableAll(),P.unshift(u,u.geometry,u.material,0,0,null)):w&&w.isTexture&&(c===void 0&&(c=new We(new ki(2,2),new On({name:"BackgroundMaterial",uniforms:Bi(an.background.uniforms),vertexShader:an.background.vertexShader,fragmentShader:an.background.fragmentShader,side:Fn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=w,c.material.uniforms.backgroundIntensity.value=x.backgroundIntensity,c.material.toneMapped=ne.getTransfer(w.colorSpace)!==re,w.matrixAutoUpdate===!0&&w.updateMatrix(),c.material.uniforms.uvTransform.value.copy(w.matrix),(h!==w||f!==w.version||p!==i.toneMapping)&&(c.material.needsUpdate=!0,h=w,f=w.version,p=i.toneMapping),c.layers.enableAll(),P.unshift(c,c.geometry,c.material,0,0,null))}function d(P,x){P.getRGB(Us,fc(i)),n.buffers.color.setClear(Us.r,Us.g,Us.b,x,o)}function A(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return a},setClearColor:function(P,x=1){a.set(P),l=x,d(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(P){l=P,d(a,l)},render:S,addToRenderList:m,dispose:A}}function Tp(i,t){const e=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=f(null);let r=s,o=!1;function a(y,U,k,H,O){let V=!1;const B=h(H,k,U);r!==B&&(r=B,c(r.object)),V=p(y,H,k,O),V&&_(y,H,k,O),O!==null&&t.update(O,i.ELEMENT_ARRAY_BUFFER),(V||o)&&(o=!1,x(y,U,k,H),O!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(O).buffer))}function l(){return i.createVertexArray()}function c(y){return i.bindVertexArray(y)}function u(y){return i.deleteVertexArray(y)}function h(y,U,k){const H=k.wireframe===!0;let O=n[y.id];O===void 0&&(O={},n[y.id]=O);let V=O[U.id];V===void 0&&(V={},O[U.id]=V);let B=V[H];return B===void 0&&(B=f(l()),V[H]=B),B}function f(y){const U=[],k=[],H=[];for(let O=0;O<e;O++)U[O]=0,k[O]=0,H[O]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:U,enabledAttributes:k,attributeDivisors:H,object:y,attributes:{},index:null}}function p(y,U,k,H){const O=r.attributes,V=U.attributes;let B=0;const $=k.getAttributes();for(const Z in $)if($[Z].location>=0){const ft=O[Z];let yt=V[Z];if(yt===void 0&&(Z==="instanceMatrix"&&y.instanceMatrix&&(yt=y.instanceMatrix),Z==="instanceColor"&&y.instanceColor&&(yt=y.instanceColor)),ft===void 0||ft.attribute!==yt||yt&&ft.data!==yt.data)return!0;B++}return r.attributesNum!==B||r.index!==H}function _(y,U,k,H){const O={},V=U.attributes;let B=0;const $=k.getAttributes();for(const Z in $)if($[Z].location>=0){let ft=V[Z];ft===void 0&&(Z==="instanceMatrix"&&y.instanceMatrix&&(ft=y.instanceMatrix),Z==="instanceColor"&&y.instanceColor&&(ft=y.instanceColor));const yt={};yt.attribute=ft,ft&&ft.data&&(yt.data=ft.data),O[Z]=yt,B++}r.attributes=O,r.attributesNum=B,r.index=H}function S(){const y=r.newAttributes;for(let U=0,k=y.length;U<k;U++)y[U]=0}function m(y){d(y,0)}function d(y,U){const k=r.newAttributes,H=r.enabledAttributes,O=r.attributeDivisors;k[y]=1,H[y]===0&&(i.enableVertexAttribArray(y),H[y]=1),O[y]!==U&&(i.vertexAttribDivisor(y,U),O[y]=U)}function A(){const y=r.newAttributes,U=r.enabledAttributes;for(let k=0,H=U.length;k<H;k++)U[k]!==y[k]&&(i.disableVertexAttribArray(k),U[k]=0)}function P(y,U,k,H,O,V,B){B===!0?i.vertexAttribIPointer(y,U,k,O,V):i.vertexAttribPointer(y,U,k,H,O,V)}function x(y,U,k,H){S();const O=H.attributes,V=k.getAttributes(),B=U.defaultAttributeValues;for(const $ in V){const Z=V[$];if(Z.location>=0){let rt=O[$];if(rt===void 0&&($==="instanceMatrix"&&y.instanceMatrix&&(rt=y.instanceMatrix),$==="instanceColor"&&y.instanceColor&&(rt=y.instanceColor)),rt!==void 0){const ft=rt.normalized,yt=rt.itemSize,ct=t.get(rt);if(ct===void 0)continue;const pt=ct.buffer,Lt=ct.type,zt=ct.bytesPerElement,ot=Lt===i.INT||Lt===i.UNSIGNED_INT||rt.gpuType===Wo;if(rt.isInterleavedBufferAttribute){const ut=rt.data,wt=ut.stride,W=rt.offset;if(ut.isInstancedInterleavedBuffer){for(let G=0;G<Z.locationSize;G++)d(Z.location+G,ut.meshPerAttribute);y.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=ut.meshPerAttribute*ut.count)}else for(let G=0;G<Z.locationSize;G++)m(Z.location+G);i.bindBuffer(i.ARRAY_BUFFER,pt);for(let G=0;G<Z.locationSize;G++)P(Z.location+G,yt/Z.locationSize,Lt,ft,wt*zt,(W+yt/Z.locationSize*G)*zt,ot)}else{if(rt.isInstancedBufferAttribute){for(let ut=0;ut<Z.locationSize;ut++)d(Z.location+ut,rt.meshPerAttribute);y.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=rt.meshPerAttribute*rt.count)}else for(let ut=0;ut<Z.locationSize;ut++)m(Z.location+ut);i.bindBuffer(i.ARRAY_BUFFER,pt);for(let ut=0;ut<Z.locationSize;ut++)P(Z.location+ut,yt/Z.locationSize,Lt,ft,yt*zt,yt/Z.locationSize*ut*zt,ot)}}else if(B!==void 0){const ft=B[$];if(ft!==void 0)switch(ft.length){case 2:i.vertexAttrib2fv(Z.location,ft);break;case 3:i.vertexAttrib3fv(Z.location,ft);break;case 4:i.vertexAttrib4fv(Z.location,ft);break;default:i.vertexAttrib1fv(Z.location,ft)}}}}A()}function w(){D();for(const y in n){const U=n[y];for(const k in U){const H=U[k];for(const O in H)u(H[O].object),delete H[O];delete U[k]}delete n[y]}}function E(y){if(n[y.id]===void 0)return;const U=n[y.id];for(const k in U){const H=U[k];for(const O in H)u(H[O].object),delete H[O];delete U[k]}delete n[y.id]}function C(y){for(const U in n){const k=n[U];if(k[y.id]===void 0)continue;const H=k[y.id];for(const O in H)u(H[O].object),delete H[O];delete k[y.id]}}function D(){g(),o=!0,r!==s&&(r=s,c(r.object))}function g(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:D,resetDefaultState:g,dispose:w,releaseStatesOfGeometry:E,releaseStatesOfProgram:C,initAttributes:S,enableAttribute:m,disableUnusedAttributes:A}}function wp(i,t,e){let n;function s(c){n=c}function r(c,u){i.drawArrays(n,c,u),e.update(u,n,1)}function o(c,u,h){h!==0&&(i.drawArraysInstanced(n,c,u,h),e.update(u,n,h))}function a(c,u,h){if(h===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,u,0,h);let p=0;for(let _=0;_<h;_++)p+=u[_];e.update(p,n,1)}function l(c,u,h,f){if(h===0)return;const p=t.get("WEBGL_multi_draw");if(p===null)for(let _=0;_<c.length;_++)o(c[_],u[_],f[_]);else{p.multiDrawArraysInstancedWEBGL(n,c,0,u,0,f,0,h);let _=0;for(let S=0;S<h;S++)_+=u[S]*f[S];e.update(_,n,1)}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=l}function Ap(i,t,e,n){let s;function r(){if(s!==void 0)return s;if(t.has("EXT_texture_filter_anisotropic")===!0){const C=t.get("EXT_texture_filter_anisotropic");s=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(C){return!(C!==en&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){const D=C===as&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(C!==fn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==bn&&!D)}function l(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp";const u=l(c);u!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",u,"instead."),c=u);const h=e.logarithmicDepthBuffer===!0,f=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control"),p=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),_=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),S=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),d=i.getParameter(i.MAX_VERTEX_ATTRIBS),A=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),P=i.getParameter(i.MAX_VARYING_VECTORS),x=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),w=_>0,E=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:h,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:_,maxTextureSize:S,maxCubemapSize:m,maxAttributes:d,maxVertexUniforms:A,maxVaryings:P,maxFragmentUniforms:x,vertexTextures:w,maxSamples:E}}function Rp(i){const t=this;let e=null,n=0,s=!1,r=!1;const o=new Dn,a=new Zt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(h,f){const p=h.length!==0||f||n!==0||s;return s=f,n=h.length,p},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(h,f){e=u(h,f,0)},this.setState=function(h,f,p){const _=h.clippingPlanes,S=h.clipIntersection,m=h.clipShadows,d=i.get(h);if(!s||_===null||_.length===0||r&&!m)r?u(null):c();else{const A=r?0:n,P=A*4;let x=d.clippingState||null;l.value=x,x=u(_,f,P,p);for(let w=0;w!==P;++w)x[w]=e[w];d.clippingState=x,this.numIntersection=S?this.numPlanes:0,this.numPlanes+=A}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function u(h,f,p,_){const S=h!==null?h.length:0;let m=null;if(S!==0){if(m=l.value,_!==!0||m===null){const d=p+S*4,A=f.matrixWorldInverse;a.getNormalMatrix(A),(m===null||m.length<d)&&(m=new Float32Array(d));for(let P=0,x=p;P!==S;++P,x+=4)o.copy(h[P]).applyMatrix4(A,a),o.normal.toArray(m,x),m[x+3]=o.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=S,t.numIntersection=0,m}}function Cp(i){let t=new WeakMap;function e(o,a){return a===eo?o.mapping=Fi:a===no&&(o.mapping=Oi),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===eo||a===no)if(t.has(o)){const l=t.get(o).texture;return e(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new Tu(l.height);return c.fromEquirectangularTexture(i,o),t.set(o,c),o.addEventListener("dispose",s),e(c.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const l=t.get(a);l!==void 0&&(t.delete(a),l.dispose())}function r(){t=new WeakMap}return{get:n,dispose:r}}const Ri=4,tl=[.125,.215,.35,.446,.526,.582],Kn=20,Ir=new Mc,el=new Jt;let Ur=null,Nr=0,Fr=0,Or=!1;const qn=(1+Math.sqrt(5))/2,yi=1/qn,nl=[new J(-qn,yi,0),new J(qn,yi,0),new J(-yi,0,qn),new J(yi,0,qn),new J(0,qn,-yi),new J(0,qn,yi),new J(-1,1,-1),new J(1,1,-1),new J(-1,1,1),new J(1,1,1)],Pp=new J;class il{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,s=100,r={}){const{size:o=256,position:a=Pp}=r;Ur=this._renderer.getRenderTarget(),Nr=this._renderer.getActiveCubeFace(),Fr=this._renderer.getActiveMipmapLevel(),Or=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);const l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,n,s,l,a),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=ol(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=rl(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(Ur,Nr,Fr),this._renderer.xr.enabled=Or,t.scissorTest=!1,Ns(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Fi||t.mapping===Oi?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Ur=this._renderer.getRenderTarget(),Nr=this._renderer.getActiveCubeFace(),Fr=this._renderer.getActiveMipmapLevel(),Or=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:dn,minFilter:dn,generateMipmaps:!1,type:as,format:en,colorSpace:zi,depthBuffer:!1},s=sl(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=sl(t,e,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Lp(r)),this._blurMaterial=Dp(r,t,e)}return s}_compileMaterial(t){const e=new We(this._lodPlanes[0],t);this._renderer.compile(e,Ir)}_sceneToCubeUV(t,e,n,s,r){const l=new Ke(90,1,e,n),c=[1,-1,1,1,1,1],u=[1,1,1,-1,-1,-1],h=this._renderer,f=h.autoClear,p=h.toneMapping;h.getClearColor(el),h.toneMapping=Nn,h.autoClear=!1,h.state.buffers.depth.getReversed()&&(h.setRenderTarget(s),h.clearDepth(),h.setRenderTarget(null));const S=new dc({name:"PMREM.Background",side:Fe,depthWrite:!1,depthTest:!1}),m=new We(new cs,S);let d=!1;const A=t.background;A?A.isColor&&(S.color.copy(A),t.background=null,d=!0):(S.color.copy(el),d=!0);for(let P=0;P<6;P++){const x=P%3;x===0?(l.up.set(0,c[P],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+u[P],r.y,r.z)):x===1?(l.up.set(0,0,c[P]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+u[P],r.z)):(l.up.set(0,c[P],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+u[P]));const w=this._cubeSize;Ns(s,x*w,P>2?w:0,w,w),h.setRenderTarget(s),d&&h.render(m,l),h.render(t,l)}m.geometry.dispose(),m.material.dispose(),h.toneMapping=p,h.autoClear=f,t.background=A}_textureToCubeUV(t,e){const n=this._renderer,s=t.mapping===Fi||t.mapping===Oi;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=ol()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=rl());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new We(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=t;const l=this._cubeSize;Ns(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(o,Ir)}_applyPMREM(t){const e=this._renderer,n=e.autoClear;e.autoClear=!1;const s=this._lodPlanes.length;for(let r=1;r<s;r++){const o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=nl[(s-r-1)%nl.length];this._blur(t,r-1,r,o,a)}e.autoClear=n}_blur(t,e,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(t,o,e,n,s,"latitudinal",r),this._halfBlur(o,t,n,n,s,"longitudinal",r)}_halfBlur(t,e,n,s,r,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const u=3,h=new We(this._lodPlanes[s],c),f=c.uniforms,p=this._sizeLods[n]-1,_=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*Kn-1),S=r/_,m=isFinite(r)?1+Math.floor(u*S):Kn;m>Kn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Kn}`);const d=[];let A=0;for(let C=0;C<Kn;++C){const D=C/S,g=Math.exp(-D*D/2);d.push(g),C===0?A+=g:C<m&&(A+=2*g)}for(let C=0;C<d.length;C++)d[C]=d[C]/A;f.envMap.value=t.texture,f.samples.value=m,f.weights.value=d,f.latitudinal.value=o==="latitudinal",a&&(f.poleAxis.value=a);const{_lodMax:P}=this;f.dTheta.value=_,f.mipInt.value=P-n;const x=this._sizeLods[s],w=3*x*(s>P-Ri?s-P+Ri:0),E=4*(this._cubeSize-x);Ns(e,w,E,3*x,2*x),l.setRenderTarget(e),l.render(h,Ir)}}function Lp(i){const t=[],e=[],n=[];let s=i;const r=i-Ri+1+tl.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);e.push(a);let l=1/a;o>i-Ri?l=tl[o-i+Ri-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),u=-c,h=1+c,f=[u,u,h,u,h,h,u,u,h,h,u,h],p=6,_=6,S=3,m=2,d=1,A=new Float32Array(S*_*p),P=new Float32Array(m*_*p),x=new Float32Array(d*_*p);for(let E=0;E<p;E++){const C=E%3*2/3-1,D=E>2?0:-1,g=[C,D,0,C+2/3,D,0,C+2/3,D+1,0,C,D,0,C+2/3,D+1,0,C,D+1,0];A.set(g,S*_*E),P.set(f,m*_*E);const y=[E,E,E,E,E,E];x.set(y,d*_*E)}const w=new sn;w.setAttribute("position",new Re(A,S)),w.setAttribute("uv",new Re(P,m)),w.setAttribute("faceIndex",new Re(x,d)),t.push(w),s>Ri&&s--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function sl(i,t,e){const n=new ii(i,t,e);return n.texture.mapping=Qs,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Ns(i,t,e,n,s){i.viewport.set(t,e,n,s),i.scissor.set(t,e,n,s)}function Dp(i,t,e){const n=new Float32Array(Kn),s=new J(0,1,0);return new On({name:"SphericalGaussianBlur",defines:{n:Kn,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:na(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Un,depthTest:!1,depthWrite:!1})}function rl(){return new On({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:na(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Un,depthTest:!1,depthWrite:!1})}function ol(){return new On({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:na(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Un,depthTest:!1,depthWrite:!1})}function na(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Ip(i){let t=new WeakMap,e=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===eo||l===no,u=l===Fi||l===Oi;if(c||u){let h=t.get(a);const f=h!==void 0?h.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==f)return e===null&&(e=new il(i)),h=c?e.fromEquirectangular(a,h):e.fromCubemap(a,h),h.texture.pmremVersion=a.pmremVersion,t.set(a,h),h.texture;if(h!==void 0)return h.texture;{const p=a.image;return c&&p&&p.height>0||u&&p&&s(p)?(e===null&&(e=new il(i)),h=c?e.fromEquirectangular(a):e.fromCubemap(a),h.texture.pmremVersion=a.pmremVersion,t.set(a,h),a.addEventListener("dispose",r),h.texture):null}}}return a}function s(a){let l=0;const c=6;for(let u=0;u<c;u++)a[u]!==void 0&&l++;return l===c}function r(a){const l=a.target;l.removeEventListener("dispose",r);const c=t.get(l);c!==void 0&&(t.delete(l),c.dispose())}function o(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:o}}function Up(i){const t={};function e(n){if(t[n]!==void 0)return t[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return t[n]=s,s}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){const s=e(n);return s===null&&os("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Np(i,t,e,n){const s={},r=new WeakMap;function o(h){const f=h.target;f.index!==null&&t.remove(f.index);for(const _ in f.attributes)t.remove(f.attributes[_]);f.removeEventListener("dispose",o),delete s[f.id];const p=r.get(f);p&&(t.remove(p),r.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function a(h,f){return s[f.id]===!0||(f.addEventListener("dispose",o),s[f.id]=!0,e.memory.geometries++),f}function l(h){const f=h.attributes;for(const p in f)t.update(f[p],i.ARRAY_BUFFER)}function c(h){const f=[],p=h.index,_=h.attributes.position;let S=0;if(p!==null){const A=p.array;S=p.version;for(let P=0,x=A.length;P<x;P+=3){const w=A[P+0],E=A[P+1],C=A[P+2];f.push(w,E,E,C,C,w)}}else if(_!==void 0){const A=_.array;S=_.version;for(let P=0,x=A.length/3-1;P<x;P+=3){const w=P+0,E=P+1,C=P+2;f.push(w,E,E,C,C,w)}}else return;const m=new(oc(f)?hc:uc)(f,1);m.version=S;const d=r.get(h);d&&t.remove(d),r.set(h,m)}function u(h){const f=r.get(h);if(f){const p=h.index;p!==null&&f.version<p.version&&c(h)}else c(h);return r.get(h)}return{get:a,update:l,getWireframeAttribute:u}}function Fp(i,t,e){let n;function s(f){n=f}let r,o;function a(f){r=f.type,o=f.bytesPerElement}function l(f,p){i.drawElements(n,p,r,f*o),e.update(p,n,1)}function c(f,p,_){_!==0&&(i.drawElementsInstanced(n,p,r,f*o,_),e.update(p,n,_))}function u(f,p,_){if(_===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,f,0,_);let m=0;for(let d=0;d<_;d++)m+=p[d];e.update(m,n,1)}function h(f,p,_,S){if(_===0)return;const m=t.get("WEBGL_multi_draw");if(m===null)for(let d=0;d<f.length;d++)c(f[d]/o,p[d],S[d]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,f,0,S,0,_);let d=0;for(let A=0;A<_;A++)d+=p[A]*S[A];e.update(d,n,1)}}this.setMode=s,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=u,this.renderMultiDrawInstances=h}function Op(i){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(e.calls++,o){case i.TRIANGLES:e.triangles+=a*(r/3);break;case i.LINES:e.lines+=a*(r/2);break;case i.LINE_STRIP:e.lines+=a*(r-1);break;case i.LINE_LOOP:e.lines+=a*r;break;case i.POINTS:e.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:s,update:n}}function zp(i,t,e){const n=new WeakMap,s=new pe;function r(o,a,l){const c=o.morphTargetInfluences,u=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,h=u!==void 0?u.length:0;let f=n.get(a);if(f===void 0||f.count!==h){let y=function(){D.dispose(),n.delete(a),a.removeEventListener("dispose",y)};var p=y;f!==void 0&&f.texture.dispose();const _=a.morphAttributes.position!==void 0,S=a.morphAttributes.normal!==void 0,m=a.morphAttributes.color!==void 0,d=a.morphAttributes.position||[],A=a.morphAttributes.normal||[],P=a.morphAttributes.color||[];let x=0;_===!0&&(x=1),S===!0&&(x=2),m===!0&&(x=3);let w=a.attributes.position.count*x,E=1;w>t.maxTextureSize&&(E=Math.ceil(w/t.maxTextureSize),w=t.maxTextureSize);const C=new Float32Array(w*E*4*h),D=new ac(C,w,E,h);D.type=bn,D.needsUpdate=!0;const g=x*4;for(let U=0;U<h;U++){const k=d[U],H=A[U],O=P[U],V=w*E*4*U;for(let B=0;B<k.count;B++){const $=B*g;_===!0&&(s.fromBufferAttribute(k,B),C[V+$+0]=s.x,C[V+$+1]=s.y,C[V+$+2]=s.z,C[V+$+3]=0),S===!0&&(s.fromBufferAttribute(H,B),C[V+$+4]=s.x,C[V+$+5]=s.y,C[V+$+6]=s.z,C[V+$+7]=0),m===!0&&(s.fromBufferAttribute(O,B),C[V+$+8]=s.x,C[V+$+9]=s.y,C[V+$+10]=s.z,C[V+$+11]=O.itemSize===4?s.w:1)}}f={count:h,texture:D,size:new $t(w,E)},n.set(a,f),a.addEventListener("dispose",y)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(i,"morphTexture",o.morphTexture,e);else{let _=0;for(let m=0;m<c.length;m++)_+=c[m];const S=a.morphTargetsRelative?1:1-_;l.getUniforms().setValue(i,"morphTargetBaseInfluence",S),l.getUniforms().setValue(i,"morphTargetInfluences",c)}l.getUniforms().setValue(i,"morphTargetsTexture",f.texture,e),l.getUniforms().setValue(i,"morphTargetsTextureSize",f.size)}return{update:r}}function Bp(i,t,e,n){let s=new WeakMap;function r(l){const c=n.render.frame,u=l.geometry,h=t.get(l,u);if(s.get(h)!==c&&(t.update(h),s.set(h,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(e.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&e.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const f=l.skeleton;s.get(f)!==c&&(f.update(),s.set(f,c))}return h}function o(){s=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:r,dispose:o}}const Sc=new Oe,al=new _c(1,1),bc=new ac,Ec=new lu,Tc=new mc,ll=[],cl=[],dl=new Float32Array(16),ul=new Float32Array(9),hl=new Float32Array(4);function Gi(i,t,e){const n=i[0];if(n<=0||n>0)return i;const s=t*e;let r=ll[s];if(r===void 0&&(r=new Float32Array(s),ll[s]=r),t!==0){n.toArray(r,0);for(let o=1,a=0;o!==t;++o)a+=e,i[o].toArray(r,a)}return r}function xe(i,t){if(i.length!==t.length)return!1;for(let e=0,n=i.length;e<n;e++)if(i[e]!==t[e])return!1;return!0}function ve(i,t){for(let e=0,n=t.length;e<n;e++)i[e]=t[e]}function er(i,t){let e=cl[t];e===void 0&&(e=new Int32Array(t),cl[t]=e);for(let n=0;n!==t;++n)e[n]=i.allocateTextureUnit();return e}function kp(i,t){const e=this.cache;e[0]!==t&&(i.uniform1f(this.addr,t),e[0]=t)}function Hp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;i.uniform2fv(this.addr,t),ve(e,t)}}function Vp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(i.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(xe(e,t))return;i.uniform3fv(this.addr,t),ve(e,t)}}function Gp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;i.uniform4fv(this.addr,t),ve(e,t)}}function Wp(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;i.uniformMatrix2fv(this.addr,!1,t),ve(e,t)}else{if(xe(e,n))return;hl.set(n),i.uniformMatrix2fv(this.addr,!1,hl),ve(e,n)}}function Xp(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;i.uniformMatrix3fv(this.addr,!1,t),ve(e,t)}else{if(xe(e,n))return;ul.set(n),i.uniformMatrix3fv(this.addr,!1,ul),ve(e,n)}}function jp(i,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;i.uniformMatrix4fv(this.addr,!1,t),ve(e,t)}else{if(xe(e,n))return;dl.set(n),i.uniformMatrix4fv(this.addr,!1,dl),ve(e,n)}}function $p(i,t){const e=this.cache;e[0]!==t&&(i.uniform1i(this.addr,t),e[0]=t)}function Yp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;i.uniform2iv(this.addr,t),ve(e,t)}}function qp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(xe(e,t))return;i.uniform3iv(this.addr,t),ve(e,t)}}function Zp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;i.uniform4iv(this.addr,t),ve(e,t)}}function Kp(i,t){const e=this.cache;e[0]!==t&&(i.uniform1ui(this.addr,t),e[0]=t)}function Jp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(i.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;i.uniform2uiv(this.addr,t),ve(e,t)}}function Qp(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(i.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(xe(e,t))return;i.uniform3uiv(this.addr,t),ve(e,t)}}function tm(i,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(i.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;i.uniform4uiv(this.addr,t),ve(e,t)}}function em(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(al.compareFunction=rc,r=al):r=Sc,e.setTexture2D(t||r,s)}function nm(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTexture3D(t||Ec,s)}function im(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTextureCube(t||Tc,s)}function sm(i,t,e){const n=this.cache,s=e.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),e.setTexture2DArray(t||bc,s)}function rm(i){switch(i){case 5126:return kp;case 35664:return Hp;case 35665:return Vp;case 35666:return Gp;case 35674:return Wp;case 35675:return Xp;case 35676:return jp;case 5124:case 35670:return $p;case 35667:case 35671:return Yp;case 35668:case 35672:return qp;case 35669:case 35673:return Zp;case 5125:return Kp;case 36294:return Jp;case 36295:return Qp;case 36296:return tm;case 35678:case 36198:case 36298:case 36306:case 35682:return em;case 35679:case 36299:case 36307:return nm;case 35680:case 36300:case 36308:case 36293:return im;case 36289:case 36303:case 36311:case 36292:return sm}}function om(i,t){i.uniform1fv(this.addr,t)}function am(i,t){const e=Gi(t,this.size,2);i.uniform2fv(this.addr,e)}function lm(i,t){const e=Gi(t,this.size,3);i.uniform3fv(this.addr,e)}function cm(i,t){const e=Gi(t,this.size,4);i.uniform4fv(this.addr,e)}function dm(i,t){const e=Gi(t,this.size,4);i.uniformMatrix2fv(this.addr,!1,e)}function um(i,t){const e=Gi(t,this.size,9);i.uniformMatrix3fv(this.addr,!1,e)}function hm(i,t){const e=Gi(t,this.size,16);i.uniformMatrix4fv(this.addr,!1,e)}function fm(i,t){i.uniform1iv(this.addr,t)}function pm(i,t){i.uniform2iv(this.addr,t)}function mm(i,t){i.uniform3iv(this.addr,t)}function gm(i,t){i.uniform4iv(this.addr,t)}function _m(i,t){i.uniform1uiv(this.addr,t)}function xm(i,t){i.uniform2uiv(this.addr,t)}function vm(i,t){i.uniform3uiv(this.addr,t)}function Mm(i,t){i.uniform4uiv(this.addr,t)}function ym(i,t,e){const n=this.cache,s=t.length,r=er(e,s);xe(n,r)||(i.uniform1iv(this.addr,r),ve(n,r));for(let o=0;o!==s;++o)e.setTexture2D(t[o]||Sc,r[o])}function Sm(i,t,e){const n=this.cache,s=t.length,r=er(e,s);xe(n,r)||(i.uniform1iv(this.addr,r),ve(n,r));for(let o=0;o!==s;++o)e.setTexture3D(t[o]||Ec,r[o])}function bm(i,t,e){const n=this.cache,s=t.length,r=er(e,s);xe(n,r)||(i.uniform1iv(this.addr,r),ve(n,r));for(let o=0;o!==s;++o)e.setTextureCube(t[o]||Tc,r[o])}function Em(i,t,e){const n=this.cache,s=t.length,r=er(e,s);xe(n,r)||(i.uniform1iv(this.addr,r),ve(n,r));for(let o=0;o!==s;++o)e.setTexture2DArray(t[o]||bc,r[o])}function Tm(i){switch(i){case 5126:return om;case 35664:return am;case 35665:return lm;case 35666:return cm;case 35674:return dm;case 35675:return um;case 35676:return hm;case 5124:case 35670:return fm;case 35667:case 35671:return pm;case 35668:case 35672:return mm;case 35669:case 35673:return gm;case 5125:return _m;case 36294:return xm;case 36295:return vm;case 36296:return Mm;case 35678:case 36198:case 36298:case 36306:case 35682:return ym;case 35679:case 36299:case 36307:return Sm;case 35680:case 36300:case 36308:case 36293:return bm;case 36289:case 36303:case 36311:case 36292:return Em}}class wm{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=rm(e.type)}}class Am{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=Tm(e.type)}}class Rm{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(t,e[a.id],n)}}}const zr=/(\w+)(\])?(\[|\.)?/g;function fl(i,t){i.seq.push(t),i.map[t.id]=t}function Cm(i,t,e){const n=i.name,s=n.length;for(zr.lastIndex=0;;){const r=zr.exec(n),o=zr.lastIndex;let a=r[1];const l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){fl(e,c===void 0?new wm(a,i,t):new Am(a,i,t));break}else{let h=e.map[a];h===void 0&&(h=new Rm(a),fl(e,h)),e=h}}}class Gs{constructor(t,e){this.seq=[],this.map={};const n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=t.getActiveUniform(e,s),o=t.getUniformLocation(e,r.name);Cm(r,o,this)}}setValue(t,e,n,s){const r=this.map[e];r!==void 0&&r.setValue(t,n,s)}setOptional(t,e,n){const s=e[n];s!==void 0&&this.setValue(t,n,s)}static upload(t,e,n,s){for(let r=0,o=e.length;r!==o;++r){const a=e[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(t,l.value,s)}}static seqWithValue(t,e){const n=[];for(let s=0,r=t.length;s!==r;++s){const o=t[s];o.id in e&&n.push(o)}return n}}function pl(i,t,e){const n=i.createShader(t);return i.shaderSource(n,e),i.compileShader(n),n}const Pm=37297;let Lm=0;function Dm(i,t){const e=i.split(`
`),n=[],s=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===t?">":" "} ${a}: ${e[o]}`)}return n.join(`
`)}const ml=new Zt;function Im(i){ne._getMatrix(ml,ne.workingColorSpace,i);const t=`mat3( ${ml.elements.map(e=>e.toFixed(4))} )`;switch(ne.getTransfer(i)){case js:return[t,"LinearTransferOETF"];case re:return[t,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[t,"LinearTransferOETF"]}}function gl(i,t,e){const n=i.getShaderParameter(t,i.COMPILE_STATUS),r=(i.getShaderInfoLog(t)||"").trim();if(n&&r==="")return"";const o=/ERROR: 0:(\d+)/.exec(r);if(o){const a=parseInt(o[1]);return e.toUpperCase()+`

`+r+`

`+Dm(i.getShaderSource(t),a)}else return r}function Um(i,t){const e=Im(t);return[`vec4 ${i}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}function Nm(i,t){let e;switch(t){case Fd:e="Linear";break;case Od:e="Reinhard";break;case zd:e="Cineon";break;case Yl:e="ACESFilmic";break;case kd:e="AgX";break;case Hd:e="Neutral";break;case Bd:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+i+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const Fs=new J;function Fm(){ne.getLuminanceCoefficients(Fs);const i=Fs.x.toFixed(4),t=Fs.y.toFixed(4),e=Fs.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Om(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Qi).join(`
`)}function zm(i){const t=[];for(const e in i){const n=i[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function Bm(i,t){const e={},n=i.getProgramParameter(t,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(t,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),e[o]={type:r.type,location:i.getAttribLocation(t,o),locationSize:a}}return e}function Qi(i){return i!==""}function _l(i,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function xl(i,t){return i.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const km=/^[ \t]*#include +<([\w\d./]+)>/gm;function No(i){return i.replace(km,Vm)}const Hm=new Map;function Vm(i,t){let e=Kt[t];if(e===void 0){const n=Hm.get(t);if(n!==void 0)e=Kt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return No(e)}const Gm=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function vl(i){return i.replace(Gm,Wm)}function Wm(i,t,e,n){let s="";for(let r=parseInt(t);r<parseInt(e);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Ml(i){let t=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?t+=`
#define HIGH_PRECISION`:i.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function Xm(i){let t="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Xl?t="SHADOWMAP_TYPE_PCF":i.shadowMapType===jl?t="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===yn&&(t="SHADOWMAP_TYPE_VSM"),t}function jm(i){let t="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Fi:case Oi:t="ENVMAP_TYPE_CUBE";break;case Qs:t="ENVMAP_TYPE_CUBE_UV";break}return t}function $m(i){let t="ENVMAP_MODE_REFLECTION";return i.envMap&&i.envMapMode===Oi&&(t="ENVMAP_MODE_REFRACTION"),t}function Ym(i){let t="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case $l:t="ENVMAP_BLENDING_MULTIPLY";break;case Ud:t="ENVMAP_BLENDING_MIX";break;case Nd:t="ENVMAP_BLENDING_ADD";break}return t}function qm(i){const t=i.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:n,maxMip:e}}function Zm(i,t,e,n){const s=i.getContext(),r=e.defines;let o=e.vertexShader,a=e.fragmentShader;const l=Xm(e),c=jm(e),u=$m(e),h=Ym(e),f=qm(e),p=Om(e),_=zm(r),S=s.createProgram();let m,d,A=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_].filter(Qi).join(`
`),m.length>0&&(m+=`
`),d=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_].filter(Qi).join(`
`),d.length>0&&(d+=`
`)):(m=[Ml(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+u:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Qi).join(`
`),d=[Ml(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,_,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+u:"",e.envMap?"#define "+h:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Nn?"#define TONE_MAPPING":"",e.toneMapping!==Nn?Kt.tonemapping_pars_fragment:"",e.toneMapping!==Nn?Nm("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Kt.colorspace_pars_fragment,Um("linearToOutputTexel",e.outputColorSpace),Fm(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Qi).join(`
`)),o=No(o),o=_l(o,e),o=xl(o,e),a=No(a),a=_l(a,e),a=xl(a,e),o=vl(o),a=vl(a),e.isRawShaderMaterial!==!0&&(A=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,d=["#define varying in",e.glslVersion===wa?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===wa?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+d);const P=A+m+o,x=A+d+a,w=pl(s,s.VERTEX_SHADER,P),E=pl(s,s.FRAGMENT_SHADER,x);s.attachShader(S,w),s.attachShader(S,E),e.index0AttributeName!==void 0?s.bindAttribLocation(S,0,e.index0AttributeName):e.morphTargets===!0&&s.bindAttribLocation(S,0,"position"),s.linkProgram(S);function C(U){if(i.debug.checkShaderErrors){const k=s.getProgramInfoLog(S)||"",H=s.getShaderInfoLog(w)||"",O=s.getShaderInfoLog(E)||"",V=k.trim(),B=H.trim(),$=O.trim();let Z=!0,rt=!0;if(s.getProgramParameter(S,s.LINK_STATUS)===!1)if(Z=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,S,w,E);else{const ft=gl(s,w,"vertex"),yt=gl(s,E,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(S,s.VALIDATE_STATUS)+`

Material Name: `+U.name+`
Material Type: `+U.type+`

Program Info Log: `+V+`
`+ft+`
`+yt)}else V!==""?console.warn("THREE.WebGLProgram: Program Info Log:",V):(B===""||$==="")&&(rt=!1);rt&&(U.diagnostics={runnable:Z,programLog:V,vertexShader:{log:B,prefix:m},fragmentShader:{log:$,prefix:d}})}s.deleteShader(w),s.deleteShader(E),D=new Gs(s,S),g=Bm(s,S)}let D;this.getUniforms=function(){return D===void 0&&C(this),D};let g;this.getAttributes=function(){return g===void 0&&C(this),g};let y=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=s.getProgramParameter(S,Pm)),y},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(S),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Lm++,this.cacheKey=t,this.usedTimes=1,this.program=S,this.vertexShader=w,this.fragmentShader=E,this}let Km=0;class Jm{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){const e=t.vertexShader,n=t.fragmentShader,s=this._getShaderStage(e),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(t);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){const e=this.shaderCache;let n=e.get(t);return n===void 0&&(n=new Qm(t),e.set(t,n)),n}}class Qm{constructor(t){this.id=Km++,this.code=t,this.usedTimes=0}}function tg(i,t,e,n,s,r,o){const a=new lc,l=new Jm,c=new Set,u=[],h=s.logarithmicDepthBuffer,f=s.vertexTextures;let p=s.precision;const _={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function S(g){return c.add(g),g===0?"uv":`uv${g}`}function m(g,y,U,k,H){const O=k.fog,V=H.geometry,B=g.isMeshStandardMaterial?k.environment:null,$=(g.isMeshStandardMaterial?e:t).get(g.envMap||B),Z=$&&$.mapping===Qs?$.image.height:null,rt=_[g.type];g.precision!==null&&(p=s.getMaxPrecision(g.precision),p!==g.precision&&console.warn("THREE.WebGLProgram.getParameters:",g.precision,"not supported, using",p,"instead."));const ft=V.morphAttributes.position||V.morphAttributes.normal||V.morphAttributes.color,yt=ft!==void 0?ft.length:0;let ct=0;V.morphAttributes.position!==void 0&&(ct=1),V.morphAttributes.normal!==void 0&&(ct=2),V.morphAttributes.color!==void 0&&(ct=3);let pt,Lt,zt,ot;if(rt){const ie=an[rt];pt=ie.vertexShader,Lt=ie.fragmentShader}else pt=g.vertexShader,Lt=g.fragmentShader,l.update(g),zt=l.getVertexShaderID(g),ot=l.getFragmentShaderID(g);const ut=i.getRenderTarget(),wt=i.state.buffers.depth.getReversed(),W=H.isInstancedMesh===!0,G=H.isBatchedMesh===!0,K=!!g.map,dt=!!g.matcap,v=!!$,F=!!g.aoMap,T=!!g.lightMap,b=!!g.bumpMap,z=!!g.normalMap,N=!!g.displacementMap,I=!!g.emissiveMap,X=!!g.metalnessMap,q=!!g.roughnessMap,nt=g.anisotropy>0,R=g.clearcoat>0,M=g.dispersion>0,j=g.iridescence>0,tt=g.sheen>0,st=g.transmission>0,it=nt&&!!g.anisotropyMap,Et=R&&!!g.clearcoatMap,mt=R&&!!g.clearcoatNormalMap,Dt=R&&!!g.clearcoatRoughnessMap,Pt=j&&!!g.iridescenceMap,gt=j&&!!g.iridescenceThicknessMap,bt=tt&&!!g.sheenColorMap,Xt=tt&&!!g.sheenRoughnessMap,Bt=!!g.specularMap,At=!!g.specularColorMap,qt=!!g.specularIntensityMap,Y=st&&!!g.transmissionMap,vt=st&&!!g.thicknessMap,St=!!g.gradientMap,Ut=!!g.alphaMap,_t=g.alphaTest>0,ht=!!g.alphaHash,Ot=!!g.extensions;let Yt=Nn;g.toneMapped&&(ut===null||ut.isXRRenderTarget===!0)&&(Yt=i.toneMapping);const le={shaderID:rt,shaderType:g.type,shaderName:g.name,vertexShader:pt,fragmentShader:Lt,defines:g.defines,customVertexShaderID:zt,customFragmentShaderID:ot,isRawShaderMaterial:g.isRawShaderMaterial===!0,glslVersion:g.glslVersion,precision:p,batching:G,batchingColor:G&&H._colorsTexture!==null,instancing:W,instancingColor:W&&H.instanceColor!==null,instancingMorph:W&&H.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:ut===null?i.outputColorSpace:ut.isXRRenderTarget===!0?ut.texture.colorSpace:zi,alphaToCoverage:!!g.alphaToCoverage,map:K,matcap:dt,envMap:v,envMapMode:v&&$.mapping,envMapCubeUVHeight:Z,aoMap:F,lightMap:T,bumpMap:b,normalMap:z,displacementMap:f&&N,emissiveMap:I,normalMapObjectSpace:z&&g.normalMapType===Xd,normalMapTangentSpace:z&&g.normalMapType===sc,metalnessMap:X,roughnessMap:q,anisotropy:nt,anisotropyMap:it,clearcoat:R,clearcoatMap:Et,clearcoatNormalMap:mt,clearcoatRoughnessMap:Dt,dispersion:M,iridescence:j,iridescenceMap:Pt,iridescenceThicknessMap:gt,sheen:tt,sheenColorMap:bt,sheenRoughnessMap:Xt,specularMap:Bt,specularColorMap:At,specularIntensityMap:qt,transmission:st,transmissionMap:Y,thicknessMap:vt,gradientMap:St,opaque:g.transparent===!1&&g.blending===Di&&g.alphaToCoverage===!1,alphaMap:Ut,alphaTest:_t,alphaHash:ht,combine:g.combine,mapUv:K&&S(g.map.channel),aoMapUv:F&&S(g.aoMap.channel),lightMapUv:T&&S(g.lightMap.channel),bumpMapUv:b&&S(g.bumpMap.channel),normalMapUv:z&&S(g.normalMap.channel),displacementMapUv:N&&S(g.displacementMap.channel),emissiveMapUv:I&&S(g.emissiveMap.channel),metalnessMapUv:X&&S(g.metalnessMap.channel),roughnessMapUv:q&&S(g.roughnessMap.channel),anisotropyMapUv:it&&S(g.anisotropyMap.channel),clearcoatMapUv:Et&&S(g.clearcoatMap.channel),clearcoatNormalMapUv:mt&&S(g.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Dt&&S(g.clearcoatRoughnessMap.channel),iridescenceMapUv:Pt&&S(g.iridescenceMap.channel),iridescenceThicknessMapUv:gt&&S(g.iridescenceThicknessMap.channel),sheenColorMapUv:bt&&S(g.sheenColorMap.channel),sheenRoughnessMapUv:Xt&&S(g.sheenRoughnessMap.channel),specularMapUv:Bt&&S(g.specularMap.channel),specularColorMapUv:At&&S(g.specularColorMap.channel),specularIntensityMapUv:qt&&S(g.specularIntensityMap.channel),transmissionMapUv:Y&&S(g.transmissionMap.channel),thicknessMapUv:vt&&S(g.thicknessMap.channel),alphaMapUv:Ut&&S(g.alphaMap.channel),vertexTangents:!!V.attributes.tangent&&(z||nt),vertexColors:g.vertexColors,vertexAlphas:g.vertexColors===!0&&!!V.attributes.color&&V.attributes.color.itemSize===4,pointsUvs:H.isPoints===!0&&!!V.attributes.uv&&(K||Ut),fog:!!O,useFog:g.fog===!0,fogExp2:!!O&&O.isFogExp2,flatShading:g.flatShading===!0&&g.wireframe===!1,sizeAttenuation:g.sizeAttenuation===!0,logarithmicDepthBuffer:h,reversedDepthBuffer:wt,skinning:H.isSkinnedMesh===!0,morphTargets:V.morphAttributes.position!==void 0,morphNormals:V.morphAttributes.normal!==void 0,morphColors:V.morphAttributes.color!==void 0,morphTargetsCount:yt,morphTextureStride:ct,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:g.dithering,shadowMapEnabled:i.shadowMap.enabled&&U.length>0,shadowMapType:i.shadowMap.type,toneMapping:Yt,decodeVideoTexture:K&&g.map.isVideoTexture===!0&&ne.getTransfer(g.map.colorSpace)===re,decodeVideoTextureEmissive:I&&g.emissiveMap.isVideoTexture===!0&&ne.getTransfer(g.emissiveMap.colorSpace)===re,premultipliedAlpha:g.premultipliedAlpha,doubleSided:g.side===ln,flipSided:g.side===Fe,useDepthPacking:g.depthPacking>=0,depthPacking:g.depthPacking||0,index0AttributeName:g.index0AttributeName,extensionClipCullDistance:Ot&&g.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Ot&&g.extensions.multiDraw===!0||G)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:g.customProgramCacheKey()};return le.vertexUv1s=c.has(1),le.vertexUv2s=c.has(2),le.vertexUv3s=c.has(3),c.clear(),le}function d(g){const y=[];if(g.shaderID?y.push(g.shaderID):(y.push(g.customVertexShaderID),y.push(g.customFragmentShaderID)),g.defines!==void 0)for(const U in g.defines)y.push(U),y.push(g.defines[U]);return g.isRawShaderMaterial===!1&&(A(y,g),P(y,g),y.push(i.outputColorSpace)),y.push(g.customProgramCacheKey),y.join()}function A(g,y){g.push(y.precision),g.push(y.outputColorSpace),g.push(y.envMapMode),g.push(y.envMapCubeUVHeight),g.push(y.mapUv),g.push(y.alphaMapUv),g.push(y.lightMapUv),g.push(y.aoMapUv),g.push(y.bumpMapUv),g.push(y.normalMapUv),g.push(y.displacementMapUv),g.push(y.emissiveMapUv),g.push(y.metalnessMapUv),g.push(y.roughnessMapUv),g.push(y.anisotropyMapUv),g.push(y.clearcoatMapUv),g.push(y.clearcoatNormalMapUv),g.push(y.clearcoatRoughnessMapUv),g.push(y.iridescenceMapUv),g.push(y.iridescenceThicknessMapUv),g.push(y.sheenColorMapUv),g.push(y.sheenRoughnessMapUv),g.push(y.specularMapUv),g.push(y.specularColorMapUv),g.push(y.specularIntensityMapUv),g.push(y.transmissionMapUv),g.push(y.thicknessMapUv),g.push(y.combine),g.push(y.fogExp2),g.push(y.sizeAttenuation),g.push(y.morphTargetsCount),g.push(y.morphAttributeCount),g.push(y.numDirLights),g.push(y.numPointLights),g.push(y.numSpotLights),g.push(y.numSpotLightMaps),g.push(y.numHemiLights),g.push(y.numRectAreaLights),g.push(y.numDirLightShadows),g.push(y.numPointLightShadows),g.push(y.numSpotLightShadows),g.push(y.numSpotLightShadowsWithMaps),g.push(y.numLightProbes),g.push(y.shadowMapType),g.push(y.toneMapping),g.push(y.numClippingPlanes),g.push(y.numClipIntersection),g.push(y.depthPacking)}function P(g,y){a.disableAll(),y.supportsVertexTextures&&a.enable(0),y.instancing&&a.enable(1),y.instancingColor&&a.enable(2),y.instancingMorph&&a.enable(3),y.matcap&&a.enable(4),y.envMap&&a.enable(5),y.normalMapObjectSpace&&a.enable(6),y.normalMapTangentSpace&&a.enable(7),y.clearcoat&&a.enable(8),y.iridescence&&a.enable(9),y.alphaTest&&a.enable(10),y.vertexColors&&a.enable(11),y.vertexAlphas&&a.enable(12),y.vertexUv1s&&a.enable(13),y.vertexUv2s&&a.enable(14),y.vertexUv3s&&a.enable(15),y.vertexTangents&&a.enable(16),y.anisotropy&&a.enable(17),y.alphaHash&&a.enable(18),y.batching&&a.enable(19),y.dispersion&&a.enable(20),y.batchingColor&&a.enable(21),y.gradientMap&&a.enable(22),g.push(a.mask),a.disableAll(),y.fog&&a.enable(0),y.useFog&&a.enable(1),y.flatShading&&a.enable(2),y.logarithmicDepthBuffer&&a.enable(3),y.reversedDepthBuffer&&a.enable(4),y.skinning&&a.enable(5),y.morphTargets&&a.enable(6),y.morphNormals&&a.enable(7),y.morphColors&&a.enable(8),y.premultipliedAlpha&&a.enable(9),y.shadowMapEnabled&&a.enable(10),y.doubleSided&&a.enable(11),y.flipSided&&a.enable(12),y.useDepthPacking&&a.enable(13),y.dithering&&a.enable(14),y.transmission&&a.enable(15),y.sheen&&a.enable(16),y.opaque&&a.enable(17),y.pointsUvs&&a.enable(18),y.decodeVideoTexture&&a.enable(19),y.decodeVideoTextureEmissive&&a.enable(20),y.alphaToCoverage&&a.enable(21),g.push(a.mask)}function x(g){const y=_[g.type];let U;if(y){const k=an[y];U=yu.clone(k.uniforms)}else U=g.uniforms;return U}function w(g,y){let U;for(let k=0,H=u.length;k<H;k++){const O=u[k];if(O.cacheKey===y){U=O,++U.usedTimes;break}}return U===void 0&&(U=new Zm(i,y,g,r),u.push(U)),U}function E(g){if(--g.usedTimes===0){const y=u.indexOf(g);u[y]=u[u.length-1],u.pop(),g.destroy()}}function C(g){l.remove(g)}function D(){l.dispose()}return{getParameters:m,getProgramCacheKey:d,getUniforms:x,acquireProgram:w,releaseProgram:E,releaseShaderCache:C,programs:u,dispose:D}}function eg(){let i=new WeakMap;function t(o){return i.has(o)}function e(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,l){i.get(o)[a]=l}function r(){i=new WeakMap}return{has:t,get:e,remove:n,update:s,dispose:r}}function ng(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.material.id!==t.material.id?i.material.id-t.material.id:i.z!==t.z?i.z-t.z:i.id-t.id}function yl(i,t){return i.groupOrder!==t.groupOrder?i.groupOrder-t.groupOrder:i.renderOrder!==t.renderOrder?i.renderOrder-t.renderOrder:i.z!==t.z?t.z-i.z:i.id-t.id}function Sl(){const i=[];let t=0;const e=[],n=[],s=[];function r(){t=0,e.length=0,n.length=0,s.length=0}function o(h,f,p,_,S,m){let d=i[t];return d===void 0?(d={id:h.id,object:h,geometry:f,material:p,groupOrder:_,renderOrder:h.renderOrder,z:S,group:m},i[t]=d):(d.id=h.id,d.object=h,d.geometry=f,d.material=p,d.groupOrder=_,d.renderOrder=h.renderOrder,d.z=S,d.group=m),t++,d}function a(h,f,p,_,S,m){const d=o(h,f,p,_,S,m);p.transmission>0?n.push(d):p.transparent===!0?s.push(d):e.push(d)}function l(h,f,p,_,S,m){const d=o(h,f,p,_,S,m);p.transmission>0?n.unshift(d):p.transparent===!0?s.unshift(d):e.unshift(d)}function c(h,f){e.length>1&&e.sort(h||ng),n.length>1&&n.sort(f||yl),s.length>1&&s.sort(f||yl)}function u(){for(let h=t,f=i.length;h<f;h++){const p=i[h];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:u,sort:c}}function ig(){let i=new WeakMap;function t(n,s){const r=i.get(n);let o;return r===void 0?(o=new Sl,i.set(n,[o])):s>=r.length?(o=new Sl,r.push(o)):o=r[s],o}function e(){i=new WeakMap}return{get:t,dispose:e}}function sg(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new J,color:new Jt};break;case"SpotLight":e={position:new J,direction:new J,color:new Jt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new J,color:new Jt,distance:0,decay:0};break;case"HemisphereLight":e={direction:new J,skyColor:new Jt,groundColor:new Jt};break;case"RectAreaLight":e={color:new Jt,position:new J,halfWidth:new J,halfHeight:new J};break}return i[t.id]=e,e}}}function rg(){const i={};return{get:function(t){if(i[t.id]!==void 0)return i[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $t};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $t};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new $t,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[t.id]=e,e}}}let og=0;function ag(i,t){return(t.castShadow?2:0)-(i.castShadow?2:0)+(t.map?1:0)-(i.map?1:0)}function lg(i){const t=new sg,e=rg(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new J);const s=new J,r=new me,o=new me;function a(c){let u=0,h=0,f=0;for(let g=0;g<9;g++)n.probe[g].set(0,0,0);let p=0,_=0,S=0,m=0,d=0,A=0,P=0,x=0,w=0,E=0,C=0;c.sort(ag);for(let g=0,y=c.length;g<y;g++){const U=c[g],k=U.color,H=U.intensity,O=U.distance,V=U.shadow&&U.shadow.map?U.shadow.map.texture:null;if(U.isAmbientLight)u+=k.r*H,h+=k.g*H,f+=k.b*H;else if(U.isLightProbe){for(let B=0;B<9;B++)n.probe[B].addScaledVector(U.sh.coefficients[B],H);C++}else if(U.isDirectionalLight){const B=t.get(U);if(B.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){const $=U.shadow,Z=e.get(U);Z.shadowIntensity=$.intensity,Z.shadowBias=$.bias,Z.shadowNormalBias=$.normalBias,Z.shadowRadius=$.radius,Z.shadowMapSize=$.mapSize,n.directionalShadow[p]=Z,n.directionalShadowMap[p]=V,n.directionalShadowMatrix[p]=U.shadow.matrix,A++}n.directional[p]=B,p++}else if(U.isSpotLight){const B=t.get(U);B.position.setFromMatrixPosition(U.matrixWorld),B.color.copy(k).multiplyScalar(H),B.distance=O,B.coneCos=Math.cos(U.angle),B.penumbraCos=Math.cos(U.angle*(1-U.penumbra)),B.decay=U.decay,n.spot[S]=B;const $=U.shadow;if(U.map&&(n.spotLightMap[w]=U.map,w++,$.updateMatrices(U),U.castShadow&&E++),n.spotLightMatrix[S]=$.matrix,U.castShadow){const Z=e.get(U);Z.shadowIntensity=$.intensity,Z.shadowBias=$.bias,Z.shadowNormalBias=$.normalBias,Z.shadowRadius=$.radius,Z.shadowMapSize=$.mapSize,n.spotShadow[S]=Z,n.spotShadowMap[S]=V,x++}S++}else if(U.isRectAreaLight){const B=t.get(U);B.color.copy(k).multiplyScalar(H),B.halfWidth.set(U.width*.5,0,0),B.halfHeight.set(0,U.height*.5,0),n.rectArea[m]=B,m++}else if(U.isPointLight){const B=t.get(U);if(B.color.copy(U.color).multiplyScalar(U.intensity),B.distance=U.distance,B.decay=U.decay,U.castShadow){const $=U.shadow,Z=e.get(U);Z.shadowIntensity=$.intensity,Z.shadowBias=$.bias,Z.shadowNormalBias=$.normalBias,Z.shadowRadius=$.radius,Z.shadowMapSize=$.mapSize,Z.shadowCameraNear=$.camera.near,Z.shadowCameraFar=$.camera.far,n.pointShadow[_]=Z,n.pointShadowMap[_]=V,n.pointShadowMatrix[_]=U.shadow.matrix,P++}n.point[_]=B,_++}else if(U.isHemisphereLight){const B=t.get(U);B.skyColor.copy(U.color).multiplyScalar(H),B.groundColor.copy(U.groundColor).multiplyScalar(H),n.hemi[d]=B,d++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=Tt.LTC_FLOAT_1,n.rectAreaLTC2=Tt.LTC_FLOAT_2):(n.rectAreaLTC1=Tt.LTC_HALF_1,n.rectAreaLTC2=Tt.LTC_HALF_2)),n.ambient[0]=u,n.ambient[1]=h,n.ambient[2]=f;const D=n.hash;(D.directionalLength!==p||D.pointLength!==_||D.spotLength!==S||D.rectAreaLength!==m||D.hemiLength!==d||D.numDirectionalShadows!==A||D.numPointShadows!==P||D.numSpotShadows!==x||D.numSpotMaps!==w||D.numLightProbes!==C)&&(n.directional.length=p,n.spot.length=S,n.rectArea.length=m,n.point.length=_,n.hemi.length=d,n.directionalShadow.length=A,n.directionalShadowMap.length=A,n.pointShadow.length=P,n.pointShadowMap.length=P,n.spotShadow.length=x,n.spotShadowMap.length=x,n.directionalShadowMatrix.length=A,n.pointShadowMatrix.length=P,n.spotLightMatrix.length=x+w-E,n.spotLightMap.length=w,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=C,D.directionalLength=p,D.pointLength=_,D.spotLength=S,D.rectAreaLength=m,D.hemiLength=d,D.numDirectionalShadows=A,D.numPointShadows=P,D.numSpotShadows=x,D.numSpotMaps=w,D.numLightProbes=C,n.version=og++)}function l(c,u){let h=0,f=0,p=0,_=0,S=0;const m=u.matrixWorldInverse;for(let d=0,A=c.length;d<A;d++){const P=c[d];if(P.isDirectionalLight){const x=n.directional[h];x.direction.setFromMatrixPosition(P.matrixWorld),s.setFromMatrixPosition(P.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(m),h++}else if(P.isSpotLight){const x=n.spot[p];x.position.setFromMatrixPosition(P.matrixWorld),x.position.applyMatrix4(m),x.direction.setFromMatrixPosition(P.matrixWorld),s.setFromMatrixPosition(P.target.matrixWorld),x.direction.sub(s),x.direction.transformDirection(m),p++}else if(P.isRectAreaLight){const x=n.rectArea[_];x.position.setFromMatrixPosition(P.matrixWorld),x.position.applyMatrix4(m),o.identity(),r.copy(P.matrixWorld),r.premultiply(m),o.extractRotation(r),x.halfWidth.set(P.width*.5,0,0),x.halfHeight.set(0,P.height*.5,0),x.halfWidth.applyMatrix4(o),x.halfHeight.applyMatrix4(o),_++}else if(P.isPointLight){const x=n.point[f];x.position.setFromMatrixPosition(P.matrixWorld),x.position.applyMatrix4(m),f++}else if(P.isHemisphereLight){const x=n.hemi[S];x.direction.setFromMatrixPosition(P.matrixWorld),x.direction.transformDirection(m),S++}}}return{setup:a,setupView:l,state:n}}function bl(i){const t=new lg(i),e=[],n=[];function s(u){c.camera=u,e.length=0,n.length=0}function r(u){e.push(u)}function o(u){n.push(u)}function a(){t.setup(e)}function l(u){t.setupView(e,u)}const c={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:s,state:c,setupLights:a,setupLightsView:l,pushLight:r,pushShadow:o}}function cg(i){let t=new WeakMap;function e(s,r=0){const o=t.get(s);let a;return o===void 0?(a=new bl(i),t.set(s,[a])):r>=o.length?(a=new bl(i),o.push(a)):a=o[r],a}function n(){t=new WeakMap}return{get:e,dispose:n}}const dg=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,ug=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function hg(i,t,e){let n=new Qo;const s=new $t,r=new $t,o=new pe,a=new Iu({depthPacking:Wd}),l=new Uu,c={},u=e.maxTextureSize,h={[Fn]:Fe,[Fe]:Fn,[ln]:ln},f=new On({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new $t},radius:{value:4}},vertexShader:dg,fragmentShader:ug}),p=f.clone();p.defines.HORIZONTAL_PASS=1;const _=new sn;_.setAttribute("position",new Re(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const S=new We(_,f),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Xl;let d=this.type;this.render=function(E,C,D){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||E.length===0)return;const g=i.getRenderTarget(),y=i.getActiveCubeFace(),U=i.getActiveMipmapLevel(),k=i.state;k.setBlending(Un),k.buffers.depth.getReversed()===!0?k.buffers.color.setClear(0,0,0,0):k.buffers.color.setClear(1,1,1,1),k.buffers.depth.setTest(!0),k.setScissorTest(!1);const H=d!==yn&&this.type===yn,O=d===yn&&this.type!==yn;for(let V=0,B=E.length;V<B;V++){const $=E[V],Z=$.shadow;if(Z===void 0){console.warn("THREE.WebGLShadowMap:",$,"has no shadow.");continue}if(Z.autoUpdate===!1&&Z.needsUpdate===!1)continue;s.copy(Z.mapSize);const rt=Z.getFrameExtents();if(s.multiply(rt),r.copy(Z.mapSize),(s.x>u||s.y>u)&&(s.x>u&&(r.x=Math.floor(u/rt.x),s.x=r.x*rt.x,Z.mapSize.x=r.x),s.y>u&&(r.y=Math.floor(u/rt.y),s.y=r.y*rt.y,Z.mapSize.y=r.y)),Z.map===null||H===!0||O===!0){const yt=this.type!==yn?{minFilter:nn,magFilter:nn}:{};Z.map!==null&&Z.map.dispose(),Z.map=new ii(s.x,s.y,yt),Z.map.texture.name=$.name+".shadowMap",Z.camera.updateProjectionMatrix()}i.setRenderTarget(Z.map),i.clear();const ft=Z.getViewportCount();for(let yt=0;yt<ft;yt++){const ct=Z.getViewport(yt);o.set(r.x*ct.x,r.y*ct.y,r.x*ct.z,r.y*ct.w),k.viewport(o),Z.updateMatrices($,yt),n=Z.getFrustum(),x(C,D,Z.camera,$,this.type)}Z.isPointLightShadow!==!0&&this.type===yn&&A(Z,D),Z.needsUpdate=!1}d=this.type,m.needsUpdate=!1,i.setRenderTarget(g,y,U)};function A(E,C){const D=t.update(S);f.defines.VSM_SAMPLES!==E.blurSamples&&(f.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new ii(s.x,s.y)),f.uniforms.shadow_pass.value=E.map.texture,f.uniforms.resolution.value=E.mapSize,f.uniforms.radius.value=E.radius,i.setRenderTarget(E.mapPass),i.clear(),i.renderBufferDirect(C,null,D,f,S,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,i.setRenderTarget(E.map),i.clear(),i.renderBufferDirect(C,null,D,p,S,null)}function P(E,C,D,g){let y=null;const U=D.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(U!==void 0)y=U;else if(y=D.isPointLight===!0?l:a,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){const k=y.uuid,H=C.uuid;let O=c[k];O===void 0&&(O={},c[k]=O);let V=O[H];V===void 0&&(V=y.clone(),O[H]=V,C.addEventListener("dispose",w)),y=V}if(y.visible=C.visible,y.wireframe=C.wireframe,g===yn?y.side=C.shadowSide!==null?C.shadowSide:C.side:y.side=C.shadowSide!==null?C.shadowSide:h[C.side],y.alphaMap=C.alphaMap,y.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,y.map=C.map,y.clipShadows=C.clipShadows,y.clippingPlanes=C.clippingPlanes,y.clipIntersection=C.clipIntersection,y.displacementMap=C.displacementMap,y.displacementScale=C.displacementScale,y.displacementBias=C.displacementBias,y.wireframeLinewidth=C.wireframeLinewidth,y.linewidth=C.linewidth,D.isPointLight===!0&&y.isMeshDistanceMaterial===!0){const k=i.properties.get(y);k.light=D}return y}function x(E,C,D,g,y){if(E.visible===!1)return;if(E.layers.test(C.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&y===yn)&&(!E.frustumCulled||n.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(D.matrixWorldInverse,E.matrixWorld);const H=t.update(E),O=E.material;if(Array.isArray(O)){const V=H.groups;for(let B=0,$=V.length;B<$;B++){const Z=V[B],rt=O[Z.materialIndex];if(rt&&rt.visible){const ft=P(E,rt,g,y);E.onBeforeShadow(i,E,C,D,H,ft,Z),i.renderBufferDirect(D,null,H,ft,E,Z),E.onAfterShadow(i,E,C,D,H,ft,Z)}}}else if(O.visible){const V=P(E,O,g,y);E.onBeforeShadow(i,E,C,D,H,V,null),i.renderBufferDirect(D,null,H,V,E,null),E.onAfterShadow(i,E,C,D,H,V,null)}}const k=E.children;for(let H=0,O=k.length;H<O;H++)x(k[H],C,D,g,y)}function w(E){E.target.removeEventListener("dispose",w);for(const D in c){const g=c[D],y=E.target.uuid;y in g&&(g[y].dispose(),delete g[y])}}}const fg={[Yr]:qr,[Zr]:Qr,[Kr]:to,[Ni]:Jr,[qr]:Yr,[Qr]:Zr,[to]:Kr,[Jr]:Ni};function pg(i,t){function e(){let Y=!1;const vt=new pe;let St=null;const Ut=new pe(0,0,0,0);return{setMask:function(_t){St!==_t&&!Y&&(i.colorMask(_t,_t,_t,_t),St=_t)},setLocked:function(_t){Y=_t},setClear:function(_t,ht,Ot,Yt,le){le===!0&&(_t*=Yt,ht*=Yt,Ot*=Yt),vt.set(_t,ht,Ot,Yt),Ut.equals(vt)===!1&&(i.clearColor(_t,ht,Ot,Yt),Ut.copy(vt))},reset:function(){Y=!1,St=null,Ut.set(-1,0,0,0)}}}function n(){let Y=!1,vt=!1,St=null,Ut=null,_t=null;return{setReversed:function(ht){if(vt!==ht){const Ot=t.get("EXT_clip_control");ht?Ot.clipControlEXT(Ot.LOWER_LEFT_EXT,Ot.ZERO_TO_ONE_EXT):Ot.clipControlEXT(Ot.LOWER_LEFT_EXT,Ot.NEGATIVE_ONE_TO_ONE_EXT),vt=ht;const Yt=_t;_t=null,this.setClear(Yt)}},getReversed:function(){return vt},setTest:function(ht){ht?ut(i.DEPTH_TEST):wt(i.DEPTH_TEST)},setMask:function(ht){St!==ht&&!Y&&(i.depthMask(ht),St=ht)},setFunc:function(ht){if(vt&&(ht=fg[ht]),Ut!==ht){switch(ht){case Yr:i.depthFunc(i.NEVER);break;case qr:i.depthFunc(i.ALWAYS);break;case Zr:i.depthFunc(i.LESS);break;case Ni:i.depthFunc(i.LEQUAL);break;case Kr:i.depthFunc(i.EQUAL);break;case Jr:i.depthFunc(i.GEQUAL);break;case Qr:i.depthFunc(i.GREATER);break;case to:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}Ut=ht}},setLocked:function(ht){Y=ht},setClear:function(ht){_t!==ht&&(vt&&(ht=1-ht),i.clearDepth(ht),_t=ht)},reset:function(){Y=!1,St=null,Ut=null,_t=null,vt=!1}}}function s(){let Y=!1,vt=null,St=null,Ut=null,_t=null,ht=null,Ot=null,Yt=null,le=null;return{setTest:function(ie){Y||(ie?ut(i.STENCIL_TEST):wt(i.STENCIL_TEST))},setMask:function(ie){vt!==ie&&!Y&&(i.stencilMask(ie),vt=ie)},setFunc:function(ie,mn,rn){(St!==ie||Ut!==mn||_t!==rn)&&(i.stencilFunc(ie,mn,rn),St=ie,Ut=mn,_t=rn)},setOp:function(ie,mn,rn){(ht!==ie||Ot!==mn||Yt!==rn)&&(i.stencilOp(ie,mn,rn),ht=ie,Ot=mn,Yt=rn)},setLocked:function(ie){Y=ie},setClear:function(ie){le!==ie&&(i.clearStencil(ie),le=ie)},reset:function(){Y=!1,vt=null,St=null,Ut=null,_t=null,ht=null,Ot=null,Yt=null,le=null}}}const r=new e,o=new n,a=new s,l=new WeakMap,c=new WeakMap;let u={},h={},f=new WeakMap,p=[],_=null,S=!1,m=null,d=null,A=null,P=null,x=null,w=null,E=null,C=new Jt(0,0,0),D=0,g=!1,y=null,U=null,k=null,H=null,O=null;const V=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let B=!1,$=0;const Z=i.getParameter(i.VERSION);Z.indexOf("WebGL")!==-1?($=parseFloat(/^WebGL (\d)/.exec(Z)[1]),B=$>=1):Z.indexOf("OpenGL ES")!==-1&&($=parseFloat(/^OpenGL ES (\d)/.exec(Z)[1]),B=$>=2);let rt=null,ft={};const yt=i.getParameter(i.SCISSOR_BOX),ct=i.getParameter(i.VIEWPORT),pt=new pe().fromArray(yt),Lt=new pe().fromArray(ct);function zt(Y,vt,St,Ut){const _t=new Uint8Array(4),ht=i.createTexture();i.bindTexture(Y,ht),i.texParameteri(Y,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(Y,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Ot=0;Ot<St;Ot++)Y===i.TEXTURE_3D||Y===i.TEXTURE_2D_ARRAY?i.texImage3D(vt,0,i.RGBA,1,1,Ut,0,i.RGBA,i.UNSIGNED_BYTE,_t):i.texImage2D(vt+Ot,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,_t);return ht}const ot={};ot[i.TEXTURE_2D]=zt(i.TEXTURE_2D,i.TEXTURE_2D,1),ot[i.TEXTURE_CUBE_MAP]=zt(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),ot[i.TEXTURE_2D_ARRAY]=zt(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),ot[i.TEXTURE_3D]=zt(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),ut(i.DEPTH_TEST),o.setFunc(Ni),b(!1),z(Ma),ut(i.CULL_FACE),F(Un);function ut(Y){u[Y]!==!0&&(i.enable(Y),u[Y]=!0)}function wt(Y){u[Y]!==!1&&(i.disable(Y),u[Y]=!1)}function W(Y,vt){return h[Y]!==vt?(i.bindFramebuffer(Y,vt),h[Y]=vt,Y===i.DRAW_FRAMEBUFFER&&(h[i.FRAMEBUFFER]=vt),Y===i.FRAMEBUFFER&&(h[i.DRAW_FRAMEBUFFER]=vt),!0):!1}function G(Y,vt){let St=p,Ut=!1;if(Y){St=f.get(vt),St===void 0&&(St=[],f.set(vt,St));const _t=Y.textures;if(St.length!==_t.length||St[0]!==i.COLOR_ATTACHMENT0){for(let ht=0,Ot=_t.length;ht<Ot;ht++)St[ht]=i.COLOR_ATTACHMENT0+ht;St.length=_t.length,Ut=!0}}else St[0]!==i.BACK&&(St[0]=i.BACK,Ut=!0);Ut&&i.drawBuffers(St)}function K(Y){return _!==Y?(i.useProgram(Y),_=Y,!0):!1}const dt={[Zn]:i.FUNC_ADD,[_d]:i.FUNC_SUBTRACT,[xd]:i.FUNC_REVERSE_SUBTRACT};dt[vd]=i.MIN,dt[Md]=i.MAX;const v={[yd]:i.ZERO,[Sd]:i.ONE,[bd]:i.SRC_COLOR,[jr]:i.SRC_ALPHA,[Cd]:i.SRC_ALPHA_SATURATE,[Ad]:i.DST_COLOR,[Td]:i.DST_ALPHA,[Ed]:i.ONE_MINUS_SRC_COLOR,[$r]:i.ONE_MINUS_SRC_ALPHA,[Rd]:i.ONE_MINUS_DST_COLOR,[wd]:i.ONE_MINUS_DST_ALPHA,[Pd]:i.CONSTANT_COLOR,[Ld]:i.ONE_MINUS_CONSTANT_COLOR,[Dd]:i.CONSTANT_ALPHA,[Id]:i.ONE_MINUS_CONSTANT_ALPHA};function F(Y,vt,St,Ut,_t,ht,Ot,Yt,le,ie){if(Y===Un){S===!0&&(wt(i.BLEND),S=!1);return}if(S===!1&&(ut(i.BLEND),S=!0),Y!==gd){if(Y!==m||ie!==g){if((d!==Zn||x!==Zn)&&(i.blendEquation(i.FUNC_ADD),d=Zn,x=Zn),ie)switch(Y){case Di:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ya:i.blendFunc(i.ONE,i.ONE);break;case Sa:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case ba:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",Y);break}else switch(Y){case Di:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case ya:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case Sa:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case ba:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",Y);break}A=null,P=null,w=null,E=null,C.set(0,0,0),D=0,m=Y,g=ie}return}_t=_t||vt,ht=ht||St,Ot=Ot||Ut,(vt!==d||_t!==x)&&(i.blendEquationSeparate(dt[vt],dt[_t]),d=vt,x=_t),(St!==A||Ut!==P||ht!==w||Ot!==E)&&(i.blendFuncSeparate(v[St],v[Ut],v[ht],v[Ot]),A=St,P=Ut,w=ht,E=Ot),(Yt.equals(C)===!1||le!==D)&&(i.blendColor(Yt.r,Yt.g,Yt.b,le),C.copy(Yt),D=le),m=Y,g=!1}function T(Y,vt){Y.side===ln?wt(i.CULL_FACE):ut(i.CULL_FACE);let St=Y.side===Fe;vt&&(St=!St),b(St),Y.blending===Di&&Y.transparent===!1?F(Un):F(Y.blending,Y.blendEquation,Y.blendSrc,Y.blendDst,Y.blendEquationAlpha,Y.blendSrcAlpha,Y.blendDstAlpha,Y.blendColor,Y.blendAlpha,Y.premultipliedAlpha),o.setFunc(Y.depthFunc),o.setTest(Y.depthTest),o.setMask(Y.depthWrite),r.setMask(Y.colorWrite);const Ut=Y.stencilWrite;a.setTest(Ut),Ut&&(a.setMask(Y.stencilWriteMask),a.setFunc(Y.stencilFunc,Y.stencilRef,Y.stencilFuncMask),a.setOp(Y.stencilFail,Y.stencilZFail,Y.stencilZPass)),I(Y.polygonOffset,Y.polygonOffsetFactor,Y.polygonOffsetUnits),Y.alphaToCoverage===!0?ut(i.SAMPLE_ALPHA_TO_COVERAGE):wt(i.SAMPLE_ALPHA_TO_COVERAGE)}function b(Y){y!==Y&&(Y?i.frontFace(i.CW):i.frontFace(i.CCW),y=Y)}function z(Y){Y!==pd?(ut(i.CULL_FACE),Y!==U&&(Y===Ma?i.cullFace(i.BACK):Y===md?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):wt(i.CULL_FACE),U=Y}function N(Y){Y!==k&&(B&&i.lineWidth(Y),k=Y)}function I(Y,vt,St){Y?(ut(i.POLYGON_OFFSET_FILL),(H!==vt||O!==St)&&(i.polygonOffset(vt,St),H=vt,O=St)):wt(i.POLYGON_OFFSET_FILL)}function X(Y){Y?ut(i.SCISSOR_TEST):wt(i.SCISSOR_TEST)}function q(Y){Y===void 0&&(Y=i.TEXTURE0+V-1),rt!==Y&&(i.activeTexture(Y),rt=Y)}function nt(Y,vt,St){St===void 0&&(rt===null?St=i.TEXTURE0+V-1:St=rt);let Ut=ft[St];Ut===void 0&&(Ut={type:void 0,texture:void 0},ft[St]=Ut),(Ut.type!==Y||Ut.texture!==vt)&&(rt!==St&&(i.activeTexture(St),rt=St),i.bindTexture(Y,vt||ot[Y]),Ut.type=Y,Ut.texture=vt)}function R(){const Y=ft[rt];Y!==void 0&&Y.type!==void 0&&(i.bindTexture(Y.type,null),Y.type=void 0,Y.texture=void 0)}function M(){try{i.compressedTexImage2D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function j(){try{i.compressedTexImage3D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function tt(){try{i.texSubImage2D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function st(){try{i.texSubImage3D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function it(){try{i.compressedTexSubImage2D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function Et(){try{i.compressedTexSubImage3D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function mt(){try{i.texStorage2D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function Dt(){try{i.texStorage3D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function Pt(){try{i.texImage2D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function gt(){try{i.texImage3D(...arguments)}catch(Y){console.error("THREE.WebGLState:",Y)}}function bt(Y){pt.equals(Y)===!1&&(i.scissor(Y.x,Y.y,Y.z,Y.w),pt.copy(Y))}function Xt(Y){Lt.equals(Y)===!1&&(i.viewport(Y.x,Y.y,Y.z,Y.w),Lt.copy(Y))}function Bt(Y,vt){let St=c.get(vt);St===void 0&&(St=new WeakMap,c.set(vt,St));let Ut=St.get(Y);Ut===void 0&&(Ut=i.getUniformBlockIndex(vt,Y.name),St.set(Y,Ut))}function At(Y,vt){const Ut=c.get(vt).get(Y);l.get(vt)!==Ut&&(i.uniformBlockBinding(vt,Ut,Y.__bindingPointIndex),l.set(vt,Ut))}function qt(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),o.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),u={},rt=null,ft={},h={},f=new WeakMap,p=[],_=null,S=!1,m=null,d=null,A=null,P=null,x=null,w=null,E=null,C=new Jt(0,0,0),D=0,g=!1,y=null,U=null,k=null,H=null,O=null,pt.set(0,0,i.canvas.width,i.canvas.height),Lt.set(0,0,i.canvas.width,i.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:ut,disable:wt,bindFramebuffer:W,drawBuffers:G,useProgram:K,setBlending:F,setMaterial:T,setFlipSided:b,setCullFace:z,setLineWidth:N,setPolygonOffset:I,setScissorTest:X,activeTexture:q,bindTexture:nt,unbindTexture:R,compressedTexImage2D:M,compressedTexImage3D:j,texImage2D:Pt,texImage3D:gt,updateUBOMapping:Bt,uniformBlockBinding:At,texStorage2D:mt,texStorage3D:Dt,texSubImage2D:tt,texSubImage3D:st,compressedTexSubImage2D:it,compressedTexSubImage3D:Et,scissor:bt,viewport:Xt,reset:qt}}function mg(i,t,e,n,s,r,o){const a=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new $t,u=new WeakMap;let h;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(R,M){return p?new OffscreenCanvas(R,M):Ys("canvas")}function S(R,M,j){let tt=1;const st=nt(R);if((st.width>j||st.height>j)&&(tt=j/Math.max(st.width,st.height)),tt<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){const it=Math.floor(tt*st.width),Et=Math.floor(tt*st.height);h===void 0&&(h=_(it,Et));const mt=M?_(it,Et):h;return mt.width=it,mt.height=Et,mt.getContext("2d").drawImage(R,0,0,it,Et),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+st.width+"x"+st.height+") to ("+it+"x"+Et+")."),mt}else return"data"in R&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+st.width+"x"+st.height+")."),R;return R}function m(R){return R.generateMipmaps}function d(R){i.generateMipmap(R)}function A(R){return R.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?i.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function P(R,M,j,tt,st=!1){if(R!==null){if(i[R]!==void 0)return i[R];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let it=M;if(M===i.RED&&(j===i.FLOAT&&(it=i.R32F),j===i.HALF_FLOAT&&(it=i.R16F),j===i.UNSIGNED_BYTE&&(it=i.R8)),M===i.RED_INTEGER&&(j===i.UNSIGNED_BYTE&&(it=i.R8UI),j===i.UNSIGNED_SHORT&&(it=i.R16UI),j===i.UNSIGNED_INT&&(it=i.R32UI),j===i.BYTE&&(it=i.R8I),j===i.SHORT&&(it=i.R16I),j===i.INT&&(it=i.R32I)),M===i.RG&&(j===i.FLOAT&&(it=i.RG32F),j===i.HALF_FLOAT&&(it=i.RG16F),j===i.UNSIGNED_BYTE&&(it=i.RG8)),M===i.RG_INTEGER&&(j===i.UNSIGNED_BYTE&&(it=i.RG8UI),j===i.UNSIGNED_SHORT&&(it=i.RG16UI),j===i.UNSIGNED_INT&&(it=i.RG32UI),j===i.BYTE&&(it=i.RG8I),j===i.SHORT&&(it=i.RG16I),j===i.INT&&(it=i.RG32I)),M===i.RGB_INTEGER&&(j===i.UNSIGNED_BYTE&&(it=i.RGB8UI),j===i.UNSIGNED_SHORT&&(it=i.RGB16UI),j===i.UNSIGNED_INT&&(it=i.RGB32UI),j===i.BYTE&&(it=i.RGB8I),j===i.SHORT&&(it=i.RGB16I),j===i.INT&&(it=i.RGB32I)),M===i.RGBA_INTEGER&&(j===i.UNSIGNED_BYTE&&(it=i.RGBA8UI),j===i.UNSIGNED_SHORT&&(it=i.RGBA16UI),j===i.UNSIGNED_INT&&(it=i.RGBA32UI),j===i.BYTE&&(it=i.RGBA8I),j===i.SHORT&&(it=i.RGBA16I),j===i.INT&&(it=i.RGBA32I)),M===i.RGB&&(j===i.UNSIGNED_INT_5_9_9_9_REV&&(it=i.RGB9_E5),j===i.UNSIGNED_INT_10F_11F_11F_REV&&(it=i.R11F_G11F_B10F)),M===i.RGBA){const Et=st?js:ne.getTransfer(tt);j===i.FLOAT&&(it=i.RGBA32F),j===i.HALF_FLOAT&&(it=i.RGBA16F),j===i.UNSIGNED_BYTE&&(it=Et===re?i.SRGB8_ALPHA8:i.RGBA8),j===i.UNSIGNED_SHORT_4_4_4_4&&(it=i.RGBA4),j===i.UNSIGNED_SHORT_5_5_5_1&&(it=i.RGB5_A1)}return(it===i.R16F||it===i.R32F||it===i.RG16F||it===i.RG32F||it===i.RGBA16F||it===i.RGBA32F)&&t.get("EXT_color_buffer_float"),it}function x(R,M){let j;return R?M===null||M===ei||M===is?j=i.DEPTH24_STENCIL8:M===bn?j=i.DEPTH32F_STENCIL8:M===ns&&(j=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):M===null||M===ei||M===is?j=i.DEPTH_COMPONENT24:M===bn?j=i.DEPTH_COMPONENT32F:M===ns&&(j=i.DEPTH_COMPONENT16),j}function w(R,M){return m(R)===!0||R.isFramebufferTexture&&R.minFilter!==nn&&R.minFilter!==dn?Math.log2(Math.max(M.width,M.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?M.mipmaps.length:1}function E(R){const M=R.target;M.removeEventListener("dispose",E),D(M),M.isVideoTexture&&u.delete(M)}function C(R){const M=R.target;M.removeEventListener("dispose",C),y(M)}function D(R){const M=n.get(R);if(M.__webglInit===void 0)return;const j=R.source,tt=f.get(j);if(tt){const st=tt[M.__cacheKey];st.usedTimes--,st.usedTimes===0&&g(R),Object.keys(tt).length===0&&f.delete(j)}n.remove(R)}function g(R){const M=n.get(R);i.deleteTexture(M.__webglTexture);const j=R.source,tt=f.get(j);delete tt[M.__cacheKey],o.memory.textures--}function y(R){const M=n.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),n.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let tt=0;tt<6;tt++){if(Array.isArray(M.__webglFramebuffer[tt]))for(let st=0;st<M.__webglFramebuffer[tt].length;st++)i.deleteFramebuffer(M.__webglFramebuffer[tt][st]);else i.deleteFramebuffer(M.__webglFramebuffer[tt]);M.__webglDepthbuffer&&i.deleteRenderbuffer(M.__webglDepthbuffer[tt])}else{if(Array.isArray(M.__webglFramebuffer))for(let tt=0;tt<M.__webglFramebuffer.length;tt++)i.deleteFramebuffer(M.__webglFramebuffer[tt]);else i.deleteFramebuffer(M.__webglFramebuffer);if(M.__webglDepthbuffer&&i.deleteRenderbuffer(M.__webglDepthbuffer),M.__webglMultisampledFramebuffer&&i.deleteFramebuffer(M.__webglMultisampledFramebuffer),M.__webglColorRenderbuffer)for(let tt=0;tt<M.__webglColorRenderbuffer.length;tt++)M.__webglColorRenderbuffer[tt]&&i.deleteRenderbuffer(M.__webglColorRenderbuffer[tt]);M.__webglDepthRenderbuffer&&i.deleteRenderbuffer(M.__webglDepthRenderbuffer)}const j=R.textures;for(let tt=0,st=j.length;tt<st;tt++){const it=n.get(j[tt]);it.__webglTexture&&(i.deleteTexture(it.__webglTexture),o.memory.textures--),n.remove(j[tt])}n.remove(R)}let U=0;function k(){U=0}function H(){const R=U;return R>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+R+" texture units while this GPU supports only "+s.maxTextures),U+=1,R}function O(R){const M=[];return M.push(R.wrapS),M.push(R.wrapT),M.push(R.wrapR||0),M.push(R.magFilter),M.push(R.minFilter),M.push(R.anisotropy),M.push(R.internalFormat),M.push(R.format),M.push(R.type),M.push(R.generateMipmaps),M.push(R.premultiplyAlpha),M.push(R.flipY),M.push(R.unpackAlignment),M.push(R.colorSpace),M.join()}function V(R,M){const j=n.get(R);if(R.isVideoTexture&&X(R),R.isRenderTargetTexture===!1&&R.isExternalTexture!==!0&&R.version>0&&j.__version!==R.version){const tt=R.image;if(tt===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(tt.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{ot(j,R,M);return}}else R.isExternalTexture&&(j.__webglTexture=R.sourceTexture?R.sourceTexture:null);e.bindTexture(i.TEXTURE_2D,j.__webglTexture,i.TEXTURE0+M)}function B(R,M){const j=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&j.__version!==R.version){ot(j,R,M);return}e.bindTexture(i.TEXTURE_2D_ARRAY,j.__webglTexture,i.TEXTURE0+M)}function $(R,M){const j=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&j.__version!==R.version){ot(j,R,M);return}e.bindTexture(i.TEXTURE_3D,j.__webglTexture,i.TEXTURE0+M)}function Z(R,M){const j=n.get(R);if(R.version>0&&j.__version!==R.version){ut(j,R,M);return}e.bindTexture(i.TEXTURE_CUBE_MAP,j.__webglTexture,i.TEXTURE0+M)}const rt={[io]:i.REPEAT,[Jn]:i.CLAMP_TO_EDGE,[so]:i.MIRRORED_REPEAT},ft={[nn]:i.NEAREST,[Vd]:i.NEAREST_MIPMAP_NEAREST,[fs]:i.NEAREST_MIPMAP_LINEAR,[dn]:i.LINEAR,[ar]:i.LINEAR_MIPMAP_NEAREST,[Qn]:i.LINEAR_MIPMAP_LINEAR},yt={[jd]:i.NEVER,[Jd]:i.ALWAYS,[$d]:i.LESS,[rc]:i.LEQUAL,[Yd]:i.EQUAL,[Kd]:i.GEQUAL,[qd]:i.GREATER,[Zd]:i.NOTEQUAL};function ct(R,M){if(M.type===bn&&t.has("OES_texture_float_linear")===!1&&(M.magFilter===dn||M.magFilter===ar||M.magFilter===fs||M.magFilter===Qn||M.minFilter===dn||M.minFilter===ar||M.minFilter===fs||M.minFilter===Qn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(R,i.TEXTURE_WRAP_S,rt[M.wrapS]),i.texParameteri(R,i.TEXTURE_WRAP_T,rt[M.wrapT]),(R===i.TEXTURE_3D||R===i.TEXTURE_2D_ARRAY)&&i.texParameteri(R,i.TEXTURE_WRAP_R,rt[M.wrapR]),i.texParameteri(R,i.TEXTURE_MAG_FILTER,ft[M.magFilter]),i.texParameteri(R,i.TEXTURE_MIN_FILTER,ft[M.minFilter]),M.compareFunction&&(i.texParameteri(R,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(R,i.TEXTURE_COMPARE_FUNC,yt[M.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(M.magFilter===nn||M.minFilter!==fs&&M.minFilter!==Qn||M.type===bn&&t.has("OES_texture_float_linear")===!1)return;if(M.anisotropy>1||n.get(M).__currentAnisotropy){const j=t.get("EXT_texture_filter_anisotropic");i.texParameterf(R,j.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(M.anisotropy,s.getMaxAnisotropy())),n.get(M).__currentAnisotropy=M.anisotropy}}}function pt(R,M){let j=!1;R.__webglInit===void 0&&(R.__webglInit=!0,M.addEventListener("dispose",E));const tt=M.source;let st=f.get(tt);st===void 0&&(st={},f.set(tt,st));const it=O(M);if(it!==R.__cacheKey){st[it]===void 0&&(st[it]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,j=!0),st[it].usedTimes++;const Et=st[R.__cacheKey];Et!==void 0&&(st[R.__cacheKey].usedTimes--,Et.usedTimes===0&&g(M)),R.__cacheKey=it,R.__webglTexture=st[it].texture}return j}function Lt(R,M,j){return Math.floor(Math.floor(R/j)/M)}function zt(R,M,j,tt){const it=R.updateRanges;if(it.length===0)e.texSubImage2D(i.TEXTURE_2D,0,0,0,M.width,M.height,j,tt,M.data);else{it.sort((gt,bt)=>gt.start-bt.start);let Et=0;for(let gt=1;gt<it.length;gt++){const bt=it[Et],Xt=it[gt],Bt=bt.start+bt.count,At=Lt(Xt.start,M.width,4),qt=Lt(bt.start,M.width,4);Xt.start<=Bt+1&&At===qt&&Lt(Xt.start+Xt.count-1,M.width,4)===At?bt.count=Math.max(bt.count,Xt.start+Xt.count-bt.start):(++Et,it[Et]=Xt)}it.length=Et+1;const mt=i.getParameter(i.UNPACK_ROW_LENGTH),Dt=i.getParameter(i.UNPACK_SKIP_PIXELS),Pt=i.getParameter(i.UNPACK_SKIP_ROWS);i.pixelStorei(i.UNPACK_ROW_LENGTH,M.width);for(let gt=0,bt=it.length;gt<bt;gt++){const Xt=it[gt],Bt=Math.floor(Xt.start/4),At=Math.ceil(Xt.count/4),qt=Bt%M.width,Y=Math.floor(Bt/M.width),vt=At,St=1;i.pixelStorei(i.UNPACK_SKIP_PIXELS,qt),i.pixelStorei(i.UNPACK_SKIP_ROWS,Y),e.texSubImage2D(i.TEXTURE_2D,0,qt,Y,vt,St,j,tt,M.data)}R.clearUpdateRanges(),i.pixelStorei(i.UNPACK_ROW_LENGTH,mt),i.pixelStorei(i.UNPACK_SKIP_PIXELS,Dt),i.pixelStorei(i.UNPACK_SKIP_ROWS,Pt)}}function ot(R,M,j){let tt=i.TEXTURE_2D;(M.isDataArrayTexture||M.isCompressedArrayTexture)&&(tt=i.TEXTURE_2D_ARRAY),M.isData3DTexture&&(tt=i.TEXTURE_3D);const st=pt(R,M),it=M.source;e.bindTexture(tt,R.__webglTexture,i.TEXTURE0+j);const Et=n.get(it);if(it.version!==Et.__version||st===!0){e.activeTexture(i.TEXTURE0+j);const mt=ne.getPrimaries(ne.workingColorSpace),Dt=M.colorSpace===In?null:ne.getPrimaries(M.colorSpace),Pt=M.colorSpace===In||mt===Dt?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,M.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,M.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Pt);let gt=S(M.image,!1,s.maxTextureSize);gt=q(M,gt);const bt=r.convert(M.format,M.colorSpace),Xt=r.convert(M.type);let Bt=P(M.internalFormat,bt,Xt,M.colorSpace,M.isVideoTexture);ct(tt,M);let At;const qt=M.mipmaps,Y=M.isVideoTexture!==!0,vt=Et.__version===void 0||st===!0,St=it.dataReady,Ut=w(M,gt);if(M.isDepthTexture)Bt=x(M.format===rs,M.type),vt&&(Y?e.texStorage2D(i.TEXTURE_2D,1,Bt,gt.width,gt.height):e.texImage2D(i.TEXTURE_2D,0,Bt,gt.width,gt.height,0,bt,Xt,null));else if(M.isDataTexture)if(qt.length>0){Y&&vt&&e.texStorage2D(i.TEXTURE_2D,Ut,Bt,qt[0].width,qt[0].height);for(let _t=0,ht=qt.length;_t<ht;_t++)At=qt[_t],Y?St&&e.texSubImage2D(i.TEXTURE_2D,_t,0,0,At.width,At.height,bt,Xt,At.data):e.texImage2D(i.TEXTURE_2D,_t,Bt,At.width,At.height,0,bt,Xt,At.data);M.generateMipmaps=!1}else Y?(vt&&e.texStorage2D(i.TEXTURE_2D,Ut,Bt,gt.width,gt.height),St&&zt(M,gt,bt,Xt)):e.texImage2D(i.TEXTURE_2D,0,Bt,gt.width,gt.height,0,bt,Xt,gt.data);else if(M.isCompressedTexture)if(M.isCompressedArrayTexture){Y&&vt&&e.texStorage3D(i.TEXTURE_2D_ARRAY,Ut,Bt,qt[0].width,qt[0].height,gt.depth);for(let _t=0,ht=qt.length;_t<ht;_t++)if(At=qt[_t],M.format!==en)if(bt!==null)if(Y){if(St)if(M.layerUpdates.size>0){const Ot=Qa(At.width,At.height,M.format,M.type);for(const Yt of M.layerUpdates){const le=At.data.subarray(Yt*Ot/At.data.BYTES_PER_ELEMENT,(Yt+1)*Ot/At.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,_t,0,0,Yt,At.width,At.height,1,bt,le)}M.clearLayerUpdates()}else e.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,_t,0,0,0,At.width,At.height,gt.depth,bt,At.data)}else e.compressedTexImage3D(i.TEXTURE_2D_ARRAY,_t,Bt,At.width,At.height,gt.depth,0,At.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Y?St&&e.texSubImage3D(i.TEXTURE_2D_ARRAY,_t,0,0,0,At.width,At.height,gt.depth,bt,Xt,At.data):e.texImage3D(i.TEXTURE_2D_ARRAY,_t,Bt,At.width,At.height,gt.depth,0,bt,Xt,At.data)}else{Y&&vt&&e.texStorage2D(i.TEXTURE_2D,Ut,Bt,qt[0].width,qt[0].height);for(let _t=0,ht=qt.length;_t<ht;_t++)At=qt[_t],M.format!==en?bt!==null?Y?St&&e.compressedTexSubImage2D(i.TEXTURE_2D,_t,0,0,At.width,At.height,bt,At.data):e.compressedTexImage2D(i.TEXTURE_2D,_t,Bt,At.width,At.height,0,At.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Y?St&&e.texSubImage2D(i.TEXTURE_2D,_t,0,0,At.width,At.height,bt,Xt,At.data):e.texImage2D(i.TEXTURE_2D,_t,Bt,At.width,At.height,0,bt,Xt,At.data)}else if(M.isDataArrayTexture)if(Y){if(vt&&e.texStorage3D(i.TEXTURE_2D_ARRAY,Ut,Bt,gt.width,gt.height,gt.depth),St)if(M.layerUpdates.size>0){const _t=Qa(gt.width,gt.height,M.format,M.type);for(const ht of M.layerUpdates){const Ot=gt.data.subarray(ht*_t/gt.data.BYTES_PER_ELEMENT,(ht+1)*_t/gt.data.BYTES_PER_ELEMENT);e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,ht,gt.width,gt.height,1,bt,Xt,Ot)}M.clearLayerUpdates()}else e.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,gt.width,gt.height,gt.depth,bt,Xt,gt.data)}else e.texImage3D(i.TEXTURE_2D_ARRAY,0,Bt,gt.width,gt.height,gt.depth,0,bt,Xt,gt.data);else if(M.isData3DTexture)Y?(vt&&e.texStorage3D(i.TEXTURE_3D,Ut,Bt,gt.width,gt.height,gt.depth),St&&e.texSubImage3D(i.TEXTURE_3D,0,0,0,0,gt.width,gt.height,gt.depth,bt,Xt,gt.data)):e.texImage3D(i.TEXTURE_3D,0,Bt,gt.width,gt.height,gt.depth,0,bt,Xt,gt.data);else if(M.isFramebufferTexture){if(vt)if(Y)e.texStorage2D(i.TEXTURE_2D,Ut,Bt,gt.width,gt.height);else{let _t=gt.width,ht=gt.height;for(let Ot=0;Ot<Ut;Ot++)e.texImage2D(i.TEXTURE_2D,Ot,Bt,_t,ht,0,bt,Xt,null),_t>>=1,ht>>=1}}else if(qt.length>0){if(Y&&vt){const _t=nt(qt[0]);e.texStorage2D(i.TEXTURE_2D,Ut,Bt,_t.width,_t.height)}for(let _t=0,ht=qt.length;_t<ht;_t++)At=qt[_t],Y?St&&e.texSubImage2D(i.TEXTURE_2D,_t,0,0,bt,Xt,At):e.texImage2D(i.TEXTURE_2D,_t,Bt,bt,Xt,At);M.generateMipmaps=!1}else if(Y){if(vt){const _t=nt(gt);e.texStorage2D(i.TEXTURE_2D,Ut,Bt,_t.width,_t.height)}St&&e.texSubImage2D(i.TEXTURE_2D,0,0,0,bt,Xt,gt)}else e.texImage2D(i.TEXTURE_2D,0,Bt,bt,Xt,gt);m(M)&&d(tt),Et.__version=it.version,M.onUpdate&&M.onUpdate(M)}R.__version=M.version}function ut(R,M,j){if(M.image.length!==6)return;const tt=pt(R,M),st=M.source;e.bindTexture(i.TEXTURE_CUBE_MAP,R.__webglTexture,i.TEXTURE0+j);const it=n.get(st);if(st.version!==it.__version||tt===!0){e.activeTexture(i.TEXTURE0+j);const Et=ne.getPrimaries(ne.workingColorSpace),mt=M.colorSpace===In?null:ne.getPrimaries(M.colorSpace),Dt=M.colorSpace===In||Et===mt?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,M.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,M.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Dt);const Pt=M.isCompressedTexture||M.image[0].isCompressedTexture,gt=M.image[0]&&M.image[0].isDataTexture,bt=[];for(let ht=0;ht<6;ht++)!Pt&&!gt?bt[ht]=S(M.image[ht],!0,s.maxCubemapSize):bt[ht]=gt?M.image[ht].image:M.image[ht],bt[ht]=q(M,bt[ht]);const Xt=bt[0],Bt=r.convert(M.format,M.colorSpace),At=r.convert(M.type),qt=P(M.internalFormat,Bt,At,M.colorSpace),Y=M.isVideoTexture!==!0,vt=it.__version===void 0||tt===!0,St=st.dataReady;let Ut=w(M,Xt);ct(i.TEXTURE_CUBE_MAP,M);let _t;if(Pt){Y&&vt&&e.texStorage2D(i.TEXTURE_CUBE_MAP,Ut,qt,Xt.width,Xt.height);for(let ht=0;ht<6;ht++){_t=bt[ht].mipmaps;for(let Ot=0;Ot<_t.length;Ot++){const Yt=_t[Ot];M.format!==en?Bt!==null?Y?St&&e.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot,0,0,Yt.width,Yt.height,Bt,Yt.data):e.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot,qt,Yt.width,Yt.height,0,Yt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Y?St&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot,0,0,Yt.width,Yt.height,Bt,At,Yt.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot,qt,Yt.width,Yt.height,0,Bt,At,Yt.data)}}}else{if(_t=M.mipmaps,Y&&vt){_t.length>0&&Ut++;const ht=nt(bt[0]);e.texStorage2D(i.TEXTURE_CUBE_MAP,Ut,qt,ht.width,ht.height)}for(let ht=0;ht<6;ht++)if(gt){Y?St&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,0,0,bt[ht].width,bt[ht].height,Bt,At,bt[ht].data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,qt,bt[ht].width,bt[ht].height,0,Bt,At,bt[ht].data);for(let Ot=0;Ot<_t.length;Ot++){const le=_t[Ot].image[ht].image;Y?St&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot+1,0,0,le.width,le.height,Bt,At,le.data):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot+1,qt,le.width,le.height,0,Bt,At,le.data)}}else{Y?St&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,0,0,Bt,At,bt[ht]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,0,qt,Bt,At,bt[ht]);for(let Ot=0;Ot<_t.length;Ot++){const Yt=_t[Ot];Y?St&&e.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot+1,0,0,Bt,At,Yt.image[ht]):e.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ht,Ot+1,qt,Bt,At,Yt.image[ht])}}}m(M)&&d(i.TEXTURE_CUBE_MAP),it.__version=st.version,M.onUpdate&&M.onUpdate(M)}R.__version=M.version}function wt(R,M,j,tt,st,it){const Et=r.convert(j.format,j.colorSpace),mt=r.convert(j.type),Dt=P(j.internalFormat,Et,mt,j.colorSpace),Pt=n.get(M),gt=n.get(j);if(gt.__renderTarget=M,!Pt.__hasExternalTextures){const bt=Math.max(1,M.width>>it),Xt=Math.max(1,M.height>>it);st===i.TEXTURE_3D||st===i.TEXTURE_2D_ARRAY?e.texImage3D(st,it,Dt,bt,Xt,M.depth,0,Et,mt,null):e.texImage2D(st,it,Dt,bt,Xt,0,Et,mt,null)}e.bindFramebuffer(i.FRAMEBUFFER,R),I(M)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,tt,st,gt.__webglTexture,0,N(M)):(st===i.TEXTURE_2D||st>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&st<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,tt,st,gt.__webglTexture,it),e.bindFramebuffer(i.FRAMEBUFFER,null)}function W(R,M,j){if(i.bindRenderbuffer(i.RENDERBUFFER,R),M.depthBuffer){const tt=M.depthTexture,st=tt&&tt.isDepthTexture?tt.type:null,it=x(M.stencilBuffer,st),Et=M.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,mt=N(M);I(M)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,mt,it,M.width,M.height):j?i.renderbufferStorageMultisample(i.RENDERBUFFER,mt,it,M.width,M.height):i.renderbufferStorage(i.RENDERBUFFER,it,M.width,M.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,Et,i.RENDERBUFFER,R)}else{const tt=M.textures;for(let st=0;st<tt.length;st++){const it=tt[st],Et=r.convert(it.format,it.colorSpace),mt=r.convert(it.type),Dt=P(it.internalFormat,Et,mt,it.colorSpace),Pt=N(M);j&&I(M)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Pt,Dt,M.width,M.height):I(M)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Pt,Dt,M.width,M.height):i.renderbufferStorage(i.RENDERBUFFER,Dt,M.width,M.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function G(R,M){if(M&&M.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(i.FRAMEBUFFER,R),!(M.depthTexture&&M.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const tt=n.get(M.depthTexture);tt.__renderTarget=M,(!tt.__webglTexture||M.depthTexture.image.width!==M.width||M.depthTexture.image.height!==M.height)&&(M.depthTexture.image.width=M.width,M.depthTexture.image.height=M.height,M.depthTexture.needsUpdate=!0),V(M.depthTexture,0);const st=tt.__webglTexture,it=N(M);if(M.depthTexture.format===ss)I(M)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,st,0,it):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,st,0);else if(M.depthTexture.format===rs)I(M)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,st,0,it):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,st,0);else throw new Error("Unknown depthTexture format")}function K(R){const M=n.get(R),j=R.isWebGLCubeRenderTarget===!0;if(M.__boundDepthTexture!==R.depthTexture){const tt=R.depthTexture;if(M.__depthDisposeCallback&&M.__depthDisposeCallback(),tt){const st=()=>{delete M.__boundDepthTexture,delete M.__depthDisposeCallback,tt.removeEventListener("dispose",st)};tt.addEventListener("dispose",st),M.__depthDisposeCallback=st}M.__boundDepthTexture=tt}if(R.depthTexture&&!M.__autoAllocateDepthBuffer){if(j)throw new Error("target.depthTexture not supported in Cube render targets");const tt=R.texture.mipmaps;tt&&tt.length>0?G(M.__webglFramebuffer[0],R):G(M.__webglFramebuffer,R)}else if(j){M.__webglDepthbuffer=[];for(let tt=0;tt<6;tt++)if(e.bindFramebuffer(i.FRAMEBUFFER,M.__webglFramebuffer[tt]),M.__webglDepthbuffer[tt]===void 0)M.__webglDepthbuffer[tt]=i.createRenderbuffer(),W(M.__webglDepthbuffer[tt],R,!1);else{const st=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,it=M.__webglDepthbuffer[tt];i.bindRenderbuffer(i.RENDERBUFFER,it),i.framebufferRenderbuffer(i.FRAMEBUFFER,st,i.RENDERBUFFER,it)}}else{const tt=R.texture.mipmaps;if(tt&&tt.length>0?e.bindFramebuffer(i.FRAMEBUFFER,M.__webglFramebuffer[0]):e.bindFramebuffer(i.FRAMEBUFFER,M.__webglFramebuffer),M.__webglDepthbuffer===void 0)M.__webglDepthbuffer=i.createRenderbuffer(),W(M.__webglDepthbuffer,R,!1);else{const st=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,it=M.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,it),i.framebufferRenderbuffer(i.FRAMEBUFFER,st,i.RENDERBUFFER,it)}}e.bindFramebuffer(i.FRAMEBUFFER,null)}function dt(R,M,j){const tt=n.get(R);M!==void 0&&wt(tt.__webglFramebuffer,R,R.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),j!==void 0&&K(R)}function v(R){const M=R.texture,j=n.get(R),tt=n.get(M);R.addEventListener("dispose",C);const st=R.textures,it=R.isWebGLCubeRenderTarget===!0,Et=st.length>1;if(Et||(tt.__webglTexture===void 0&&(tt.__webglTexture=i.createTexture()),tt.__version=M.version,o.memory.textures++),it){j.__webglFramebuffer=[];for(let mt=0;mt<6;mt++)if(M.mipmaps&&M.mipmaps.length>0){j.__webglFramebuffer[mt]=[];for(let Dt=0;Dt<M.mipmaps.length;Dt++)j.__webglFramebuffer[mt][Dt]=i.createFramebuffer()}else j.__webglFramebuffer[mt]=i.createFramebuffer()}else{if(M.mipmaps&&M.mipmaps.length>0){j.__webglFramebuffer=[];for(let mt=0;mt<M.mipmaps.length;mt++)j.__webglFramebuffer[mt]=i.createFramebuffer()}else j.__webglFramebuffer=i.createFramebuffer();if(Et)for(let mt=0,Dt=st.length;mt<Dt;mt++){const Pt=n.get(st[mt]);Pt.__webglTexture===void 0&&(Pt.__webglTexture=i.createTexture(),o.memory.textures++)}if(R.samples>0&&I(R)===!1){j.__webglMultisampledFramebuffer=i.createFramebuffer(),j.__webglColorRenderbuffer=[],e.bindFramebuffer(i.FRAMEBUFFER,j.__webglMultisampledFramebuffer);for(let mt=0;mt<st.length;mt++){const Dt=st[mt];j.__webglColorRenderbuffer[mt]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,j.__webglColorRenderbuffer[mt]);const Pt=r.convert(Dt.format,Dt.colorSpace),gt=r.convert(Dt.type),bt=P(Dt.internalFormat,Pt,gt,Dt.colorSpace,R.isXRRenderTarget===!0),Xt=N(R);i.renderbufferStorageMultisample(i.RENDERBUFFER,Xt,bt,R.width,R.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+mt,i.RENDERBUFFER,j.__webglColorRenderbuffer[mt])}i.bindRenderbuffer(i.RENDERBUFFER,null),R.depthBuffer&&(j.__webglDepthRenderbuffer=i.createRenderbuffer(),W(j.__webglDepthRenderbuffer,R,!0)),e.bindFramebuffer(i.FRAMEBUFFER,null)}}if(it){e.bindTexture(i.TEXTURE_CUBE_MAP,tt.__webglTexture),ct(i.TEXTURE_CUBE_MAP,M);for(let mt=0;mt<6;mt++)if(M.mipmaps&&M.mipmaps.length>0)for(let Dt=0;Dt<M.mipmaps.length;Dt++)wt(j.__webglFramebuffer[mt][Dt],R,M,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+mt,Dt);else wt(j.__webglFramebuffer[mt],R,M,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+mt,0);m(M)&&d(i.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(Et){for(let mt=0,Dt=st.length;mt<Dt;mt++){const Pt=st[mt],gt=n.get(Pt);let bt=i.TEXTURE_2D;(R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(bt=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(bt,gt.__webglTexture),ct(bt,Pt),wt(j.__webglFramebuffer,R,Pt,i.COLOR_ATTACHMENT0+mt,bt,0),m(Pt)&&d(bt)}e.unbindTexture()}else{let mt=i.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(mt=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),e.bindTexture(mt,tt.__webglTexture),ct(mt,M),M.mipmaps&&M.mipmaps.length>0)for(let Dt=0;Dt<M.mipmaps.length;Dt++)wt(j.__webglFramebuffer[Dt],R,M,i.COLOR_ATTACHMENT0,mt,Dt);else wt(j.__webglFramebuffer,R,M,i.COLOR_ATTACHMENT0,mt,0);m(M)&&d(mt),e.unbindTexture()}R.depthBuffer&&K(R)}function F(R){const M=R.textures;for(let j=0,tt=M.length;j<tt;j++){const st=M[j];if(m(st)){const it=A(R),Et=n.get(st).__webglTexture;e.bindTexture(it,Et),d(it),e.unbindTexture()}}}const T=[],b=[];function z(R){if(R.samples>0){if(I(R)===!1){const M=R.textures,j=R.width,tt=R.height;let st=i.COLOR_BUFFER_BIT;const it=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Et=n.get(R),mt=M.length>1;if(mt)for(let Pt=0;Pt<M.length;Pt++)e.bindFramebuffer(i.FRAMEBUFFER,Et.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Pt,i.RENDERBUFFER,null),e.bindFramebuffer(i.FRAMEBUFFER,Et.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Pt,i.TEXTURE_2D,null,0);e.bindFramebuffer(i.READ_FRAMEBUFFER,Et.__webglMultisampledFramebuffer);const Dt=R.texture.mipmaps;Dt&&Dt.length>0?e.bindFramebuffer(i.DRAW_FRAMEBUFFER,Et.__webglFramebuffer[0]):e.bindFramebuffer(i.DRAW_FRAMEBUFFER,Et.__webglFramebuffer);for(let Pt=0;Pt<M.length;Pt++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(st|=i.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(st|=i.STENCIL_BUFFER_BIT)),mt){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,Et.__webglColorRenderbuffer[Pt]);const gt=n.get(M[Pt]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,gt,0)}i.blitFramebuffer(0,0,j,tt,0,0,j,tt,st,i.NEAREST),l===!0&&(T.length=0,b.length=0,T.push(i.COLOR_ATTACHMENT0+Pt),R.depthBuffer&&R.resolveDepthBuffer===!1&&(T.push(it),b.push(it),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,b)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,T))}if(e.bindFramebuffer(i.READ_FRAMEBUFFER,null),e.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),mt)for(let Pt=0;Pt<M.length;Pt++){e.bindFramebuffer(i.FRAMEBUFFER,Et.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Pt,i.RENDERBUFFER,Et.__webglColorRenderbuffer[Pt]);const gt=n.get(M[Pt]).__webglTexture;e.bindFramebuffer(i.FRAMEBUFFER,Et.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Pt,i.TEXTURE_2D,gt,0)}e.bindFramebuffer(i.DRAW_FRAMEBUFFER,Et.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.resolveDepthBuffer===!1&&l){const M=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[M])}}}function N(R){return Math.min(s.maxSamples,R.samples)}function I(R){const M=n.get(R);return R.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&M.__useRenderToTexture!==!1}function X(R){const M=o.render.frame;u.get(R)!==M&&(u.set(R,M),R.update())}function q(R,M){const j=R.colorSpace,tt=R.format,st=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||j!==zi&&j!==In&&(ne.getTransfer(j)===re?(tt!==en||st!==fn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",j)),M}function nt(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(c.width=R.naturalWidth||R.width,c.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(c.width=R.displayWidth,c.height=R.displayHeight):(c.width=R.width,c.height=R.height),c}this.allocateTextureUnit=H,this.resetTextureUnits=k,this.setTexture2D=V,this.setTexture2DArray=B,this.setTexture3D=$,this.setTextureCube=Z,this.rebindTextures=dt,this.setupRenderTarget=v,this.updateRenderTargetMipmap=F,this.updateMultisampleRenderTarget=z,this.setupDepthRenderbuffer=K,this.setupFrameBufferTexture=wt,this.useMultisampledRTT=I}function gg(i,t){function e(n,s=In){let r;const o=ne.getTransfer(s);if(n===fn)return i.UNSIGNED_BYTE;if(n===Xo)return i.UNSIGNED_SHORT_4_4_4_4;if(n===jo)return i.UNSIGNED_SHORT_5_5_5_1;if(n===Jl)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===Ql)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===Zl)return i.BYTE;if(n===Kl)return i.SHORT;if(n===ns)return i.UNSIGNED_SHORT;if(n===Wo)return i.INT;if(n===ei)return i.UNSIGNED_INT;if(n===bn)return i.FLOAT;if(n===as)return i.HALF_FLOAT;if(n===tc)return i.ALPHA;if(n===ec)return i.RGB;if(n===en)return i.RGBA;if(n===ss)return i.DEPTH_COMPONENT;if(n===rs)return i.DEPTH_STENCIL;if(n===nc)return i.RED;if(n===$o)return i.RED_INTEGER;if(n===ic)return i.RG;if(n===Yo)return i.RG_INTEGER;if(n===qo)return i.RGBA_INTEGER;if(n===zs||n===Bs||n===ks||n===Hs)if(o===re)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===zs)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Bs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===ks)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Hs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===zs)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Bs)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===ks)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Hs)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===ro||n===oo||n===ao||n===lo)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===ro)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===oo)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===ao)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===lo)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===co||n===uo||n===ho)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(n===co||n===uo)return o===re?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ho)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===fo||n===po||n===mo||n===go||n===_o||n===xo||n===vo||n===Mo||n===yo||n===So||n===bo||n===Eo||n===To||n===wo)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(n===fo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===po)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===mo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===go)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===_o)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===xo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===vo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Mo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===yo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===So)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===bo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Eo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===To)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===wo)return o===re?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ao||n===Ro||n===Co)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(n===Ao)return o===re?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ro)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Co)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Po||n===Lo||n===Do||n===Io)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(n===Po)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Lo)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Do)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Io)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===is?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:e}}const _g=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,xg=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class vg{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const n=new xc(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=n}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,n=new On({vertexShader:_g,fragmentShader:xg,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new We(new ki(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Mg extends ri{constructor(t,e){super();const n=this;let s=null,r=1,o=null,a="local-floor",l=1,c=null,u=null,h=null,f=null,p=null,_=null;const S=typeof XRWebGLBinding<"u",m=new vg,d={},A=e.getContextAttributes();let P=null,x=null;const w=[],E=[],C=new $t;let D=null;const g=new Ke;g.viewport=new pe;const y=new Ke;y.viewport=new pe;const U=[g,y],k=new zu;let H=null,O=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(ot){let ut=w[ot];return ut===void 0&&(ut=new Cr,w[ot]=ut),ut.getTargetRaySpace()},this.getControllerGrip=function(ot){let ut=w[ot];return ut===void 0&&(ut=new Cr,w[ot]=ut),ut.getGripSpace()},this.getHand=function(ot){let ut=w[ot];return ut===void 0&&(ut=new Cr,w[ot]=ut),ut.getHandSpace()};function V(ot){const ut=E.indexOf(ot.inputSource);if(ut===-1)return;const wt=w[ut];wt!==void 0&&(wt.update(ot.inputSource,ot.frame,c||o),wt.dispatchEvent({type:ot.type,data:ot.inputSource}))}function B(){s.removeEventListener("select",V),s.removeEventListener("selectstart",V),s.removeEventListener("selectend",V),s.removeEventListener("squeeze",V),s.removeEventListener("squeezestart",V),s.removeEventListener("squeezeend",V),s.removeEventListener("end",B),s.removeEventListener("inputsourceschange",$);for(let ot=0;ot<w.length;ot++){const ut=E[ot];ut!==null&&(E[ot]=null,w[ot].disconnect(ut))}H=null,O=null,m.reset();for(const ot in d)delete d[ot];t.setRenderTarget(P),p=null,f=null,h=null,s=null,x=null,zt.stop(),n.isPresenting=!1,t.setPixelRatio(D),t.setSize(C.width,C.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(ot){r=ot,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(ot){a=ot,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(ot){c=ot},this.getBaseLayer=function(){return f!==null?f:p},this.getBinding=function(){return h===null&&S&&(h=new XRWebGLBinding(s,e)),h},this.getFrame=function(){return _},this.getSession=function(){return s},this.setSession=async function(ot){if(s=ot,s!==null){if(P=t.getRenderTarget(),s.addEventListener("select",V),s.addEventListener("selectstart",V),s.addEventListener("selectend",V),s.addEventListener("squeeze",V),s.addEventListener("squeezestart",V),s.addEventListener("squeezeend",V),s.addEventListener("end",B),s.addEventListener("inputsourceschange",$),A.xrCompatible!==!0&&await e.makeXRCompatible(),D=t.getPixelRatio(),t.getSize(C),S&&"createProjectionLayer"in XRWebGLBinding.prototype){let wt=null,W=null,G=null;A.depth&&(G=A.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,wt=A.stencil?rs:ss,W=A.stencil?is:ei);const K={colorFormat:e.RGBA8,depthFormat:G,scaleFactor:r};h=this.getBinding(),f=h.createProjectionLayer(K),s.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),x=new ii(f.textureWidth,f.textureHeight,{format:en,type:fn,depthTexture:new _c(f.textureWidth,f.textureHeight,W,void 0,void 0,void 0,void 0,void 0,void 0,wt),stencilBuffer:A.stencil,colorSpace:t.outputColorSpace,samples:A.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}else{const wt={antialias:A.antialias,alpha:!0,depth:A.depth,stencil:A.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(s,e,wt),s.updateRenderState({baseLayer:p}),t.setPixelRatio(1),t.setSize(p.framebufferWidth,p.framebufferHeight,!1),x=new ii(p.framebufferWidth,p.framebufferHeight,{format:en,type:fn,colorSpace:t.outputColorSpace,stencilBuffer:A.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}x.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),zt.setContext(s),zt.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function $(ot){for(let ut=0;ut<ot.removed.length;ut++){const wt=ot.removed[ut],W=E.indexOf(wt);W>=0&&(E[W]=null,w[W].disconnect(wt))}for(let ut=0;ut<ot.added.length;ut++){const wt=ot.added[ut];let W=E.indexOf(wt);if(W===-1){for(let K=0;K<w.length;K++)if(K>=E.length){E.push(wt),W=K;break}else if(E[K]===null){E[K]=wt,W=K;break}if(W===-1)break}const G=w[W];G&&G.connect(wt)}}const Z=new J,rt=new J;function ft(ot,ut,wt){Z.setFromMatrixPosition(ut.matrixWorld),rt.setFromMatrixPosition(wt.matrixWorld);const W=Z.distanceTo(rt),G=ut.projectionMatrix.elements,K=wt.projectionMatrix.elements,dt=G[14]/(G[10]-1),v=G[14]/(G[10]+1),F=(G[9]+1)/G[5],T=(G[9]-1)/G[5],b=(G[8]-1)/G[0],z=(K[8]+1)/K[0],N=dt*b,I=dt*z,X=W/(-b+z),q=X*-b;if(ut.matrixWorld.decompose(ot.position,ot.quaternion,ot.scale),ot.translateX(q),ot.translateZ(X),ot.matrixWorld.compose(ot.position,ot.quaternion,ot.scale),ot.matrixWorldInverse.copy(ot.matrixWorld).invert(),G[10]===-1)ot.projectionMatrix.copy(ut.projectionMatrix),ot.projectionMatrixInverse.copy(ut.projectionMatrixInverse);else{const nt=dt+X,R=v+X,M=N-q,j=I+(W-q),tt=F*v/R*nt,st=T*v/R*nt;ot.projectionMatrix.makePerspective(M,j,tt,st,nt,R),ot.projectionMatrixInverse.copy(ot.projectionMatrix).invert()}}function yt(ot,ut){ut===null?ot.matrixWorld.copy(ot.matrix):ot.matrixWorld.multiplyMatrices(ut.matrixWorld,ot.matrix),ot.matrixWorldInverse.copy(ot.matrixWorld).invert()}this.updateCamera=function(ot){if(s===null)return;let ut=ot.near,wt=ot.far;m.texture!==null&&(m.depthNear>0&&(ut=m.depthNear),m.depthFar>0&&(wt=m.depthFar)),k.near=y.near=g.near=ut,k.far=y.far=g.far=wt,(H!==k.near||O!==k.far)&&(s.updateRenderState({depthNear:k.near,depthFar:k.far}),H=k.near,O=k.far),k.layers.mask=ot.layers.mask|6,g.layers.mask=k.layers.mask&3,y.layers.mask=k.layers.mask&5;const W=ot.parent,G=k.cameras;yt(k,W);for(let K=0;K<G.length;K++)yt(G[K],W);G.length===2?ft(k,g,y):k.projectionMatrix.copy(g.projectionMatrix),ct(ot,k,W)};function ct(ot,ut,wt){wt===null?ot.matrix.copy(ut.matrixWorld):(ot.matrix.copy(wt.matrixWorld),ot.matrix.invert(),ot.matrix.multiply(ut.matrixWorld)),ot.matrix.decompose(ot.position,ot.quaternion,ot.scale),ot.updateMatrixWorld(!0),ot.projectionMatrix.copy(ut.projectionMatrix),ot.projectionMatrixInverse.copy(ut.projectionMatrixInverse),ot.isPerspectiveCamera&&(ot.fov=Uo*2*Math.atan(1/ot.projectionMatrix.elements[5]),ot.zoom=1)}this.getCamera=function(){return k},this.getFoveation=function(){if(!(f===null&&p===null))return l},this.setFoveation=function(ot){l=ot,f!==null&&(f.fixedFoveation=ot),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=ot)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(k)},this.getCameraTexture=function(ot){return d[ot]};let pt=null;function Lt(ot,ut){if(u=ut.getViewerPose(c||o),_=ut,u!==null){const wt=u.views;p!==null&&(t.setRenderTargetFramebuffer(x,p.framebuffer),t.setRenderTarget(x));let W=!1;wt.length!==k.cameras.length&&(k.cameras.length=0,W=!0);for(let v=0;v<wt.length;v++){const F=wt[v];let T=null;if(p!==null)T=p.getViewport(F);else{const z=h.getViewSubImage(f,F);T=z.viewport,v===0&&(t.setRenderTargetTextures(x,z.colorTexture,z.depthStencilTexture),t.setRenderTarget(x))}let b=U[v];b===void 0&&(b=new Ke,b.layers.enable(v),b.viewport=new pe,U[v]=b),b.matrix.fromArray(F.transform.matrix),b.matrix.decompose(b.position,b.quaternion,b.scale),b.projectionMatrix.fromArray(F.projectionMatrix),b.projectionMatrixInverse.copy(b.projectionMatrix).invert(),b.viewport.set(T.x,T.y,T.width,T.height),v===0&&(k.matrix.copy(b.matrix),k.matrix.decompose(k.position,k.quaternion,k.scale)),W===!0&&k.cameras.push(b)}const G=s.enabledFeatures;if(G&&G.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&S){h=n.getBinding();const v=h.getDepthInformation(wt[0]);v&&v.isValid&&v.texture&&m.init(v,s.renderState)}if(G&&G.includes("camera-access")&&S){t.state.unbindTexture(),h=n.getBinding();for(let v=0;v<wt.length;v++){const F=wt[v].camera;if(F){let T=d[F];T||(T=new xc,d[F]=T);const b=h.getCameraImage(F);T.sourceTexture=b}}}}for(let wt=0;wt<w.length;wt++){const W=E[wt],G=w[wt];W!==null&&G!==void 0&&G.update(W,ut,c||o)}pt&&pt(ot,ut),ut.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ut}),_=null}const zt=new yc;zt.setAnimationLoop(Lt),this.setAnimationLoop=function(ot){pt=ot},this.dispose=function(){}}}const jn=new pn,yg=new me;function Sg(i,t){function e(m,d){m.matrixAutoUpdate===!0&&m.updateMatrix(),d.value.copy(m.matrix)}function n(m,d){d.color.getRGB(m.fogColor.value,fc(i)),d.isFog?(m.fogNear.value=d.near,m.fogFar.value=d.far):d.isFogExp2&&(m.fogDensity.value=d.density)}function s(m,d,A,P,x){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(m,d):d.isMeshToonMaterial?(r(m,d),h(m,d)):d.isMeshPhongMaterial?(r(m,d),u(m,d)):d.isMeshStandardMaterial?(r(m,d),f(m,d),d.isMeshPhysicalMaterial&&p(m,d,x)):d.isMeshMatcapMaterial?(r(m,d),_(m,d)):d.isMeshDepthMaterial?r(m,d):d.isMeshDistanceMaterial?(r(m,d),S(m,d)):d.isMeshNormalMaterial?r(m,d):d.isLineBasicMaterial?(o(m,d),d.isLineDashedMaterial&&a(m,d)):d.isPointsMaterial?l(m,d,A,P):d.isSpriteMaterial?c(m,d):d.isShadowMaterial?(m.color.value.copy(d.color),m.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(m,d){m.opacity.value=d.opacity,d.color&&m.diffuse.value.copy(d.color),d.emissive&&m.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(m.map.value=d.map,e(d.map,m.mapTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.bumpMap&&(m.bumpMap.value=d.bumpMap,e(d.bumpMap,m.bumpMapTransform),m.bumpScale.value=d.bumpScale,d.side===Fe&&(m.bumpScale.value*=-1)),d.normalMap&&(m.normalMap.value=d.normalMap,e(d.normalMap,m.normalMapTransform),m.normalScale.value.copy(d.normalScale),d.side===Fe&&m.normalScale.value.negate()),d.displacementMap&&(m.displacementMap.value=d.displacementMap,e(d.displacementMap,m.displacementMapTransform),m.displacementScale.value=d.displacementScale,m.displacementBias.value=d.displacementBias),d.emissiveMap&&(m.emissiveMap.value=d.emissiveMap,e(d.emissiveMap,m.emissiveMapTransform)),d.specularMap&&(m.specularMap.value=d.specularMap,e(d.specularMap,m.specularMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest);const A=t.get(d),P=A.envMap,x=A.envMapRotation;P&&(m.envMap.value=P,jn.copy(x),jn.x*=-1,jn.y*=-1,jn.z*=-1,P.isCubeTexture&&P.isRenderTargetTexture===!1&&(jn.y*=-1,jn.z*=-1),m.envMapRotation.value.setFromMatrix4(yg.makeRotationFromEuler(jn)),m.flipEnvMap.value=P.isCubeTexture&&P.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=d.reflectivity,m.ior.value=d.ior,m.refractionRatio.value=d.refractionRatio),d.lightMap&&(m.lightMap.value=d.lightMap,m.lightMapIntensity.value=d.lightMapIntensity,e(d.lightMap,m.lightMapTransform)),d.aoMap&&(m.aoMap.value=d.aoMap,m.aoMapIntensity.value=d.aoMapIntensity,e(d.aoMap,m.aoMapTransform))}function o(m,d){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,d.map&&(m.map.value=d.map,e(d.map,m.mapTransform))}function a(m,d){m.dashSize.value=d.dashSize,m.totalSize.value=d.dashSize+d.gapSize,m.scale.value=d.scale}function l(m,d,A,P){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,m.size.value=d.size*A,m.scale.value=P*.5,d.map&&(m.map.value=d.map,e(d.map,m.uvTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest)}function c(m,d){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,m.rotation.value=d.rotation,d.map&&(m.map.value=d.map,e(d.map,m.mapTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest)}function u(m,d){m.specular.value.copy(d.specular),m.shininess.value=Math.max(d.shininess,1e-4)}function h(m,d){d.gradientMap&&(m.gradientMap.value=d.gradientMap)}function f(m,d){m.metalness.value=d.metalness,d.metalnessMap&&(m.metalnessMap.value=d.metalnessMap,e(d.metalnessMap,m.metalnessMapTransform)),m.roughness.value=d.roughness,d.roughnessMap&&(m.roughnessMap.value=d.roughnessMap,e(d.roughnessMap,m.roughnessMapTransform)),d.envMap&&(m.envMapIntensity.value=d.envMapIntensity)}function p(m,d,A){m.ior.value=d.ior,d.sheen>0&&(m.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),m.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(m.sheenColorMap.value=d.sheenColorMap,e(d.sheenColorMap,m.sheenColorMapTransform)),d.sheenRoughnessMap&&(m.sheenRoughnessMap.value=d.sheenRoughnessMap,e(d.sheenRoughnessMap,m.sheenRoughnessMapTransform))),d.clearcoat>0&&(m.clearcoat.value=d.clearcoat,m.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(m.clearcoatMap.value=d.clearcoatMap,e(d.clearcoatMap,m.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,e(d.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(m.clearcoatNormalMap.value=d.clearcoatNormalMap,e(d.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===Fe&&m.clearcoatNormalScale.value.negate())),d.dispersion>0&&(m.dispersion.value=d.dispersion),d.iridescence>0&&(m.iridescence.value=d.iridescence,m.iridescenceIOR.value=d.iridescenceIOR,m.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(m.iridescenceMap.value=d.iridescenceMap,e(d.iridescenceMap,m.iridescenceMapTransform)),d.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=d.iridescenceThicknessMap,e(d.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),d.transmission>0&&(m.transmission.value=d.transmission,m.transmissionSamplerMap.value=A.texture,m.transmissionSamplerSize.value.set(A.width,A.height),d.transmissionMap&&(m.transmissionMap.value=d.transmissionMap,e(d.transmissionMap,m.transmissionMapTransform)),m.thickness.value=d.thickness,d.thicknessMap&&(m.thicknessMap.value=d.thicknessMap,e(d.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=d.attenuationDistance,m.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(m.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(m.anisotropyMap.value=d.anisotropyMap,e(d.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=d.specularIntensity,m.specularColor.value.copy(d.specularColor),d.specularColorMap&&(m.specularColorMap.value=d.specularColorMap,e(d.specularColorMap,m.specularColorMapTransform)),d.specularIntensityMap&&(m.specularIntensityMap.value=d.specularIntensityMap,e(d.specularIntensityMap,m.specularIntensityMapTransform))}function _(m,d){d.matcap&&(m.matcap.value=d.matcap)}function S(m,d){const A=t.get(d).light;m.referencePosition.value.setFromMatrixPosition(A.matrixWorld),m.nearDistance.value=A.shadow.camera.near,m.farDistance.value=A.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function bg(i,t,e,n){let s={},r={},o=[];const a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function l(A,P){const x=P.program;n.uniformBlockBinding(A,x)}function c(A,P){let x=s[A.id];x===void 0&&(_(A),x=u(A),s[A.id]=x,A.addEventListener("dispose",m));const w=P.program;n.updateUBOMapping(A,w);const E=t.render.frame;r[A.id]!==E&&(f(A),r[A.id]=E)}function u(A){const P=h();A.__bindingPointIndex=P;const x=i.createBuffer(),w=A.__size,E=A.usage;return i.bindBuffer(i.UNIFORM_BUFFER,x),i.bufferData(i.UNIFORM_BUFFER,w,E),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,P,x),x}function h(){for(let A=0;A<a;A++)if(o.indexOf(A)===-1)return o.push(A),A;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(A){const P=s[A.id],x=A.uniforms,w=A.__cache;i.bindBuffer(i.UNIFORM_BUFFER,P);for(let E=0,C=x.length;E<C;E++){const D=Array.isArray(x[E])?x[E]:[x[E]];for(let g=0,y=D.length;g<y;g++){const U=D[g];if(p(U,E,g,w)===!0){const k=U.__offset,H=Array.isArray(U.value)?U.value:[U.value];let O=0;for(let V=0;V<H.length;V++){const B=H[V],$=S(B);typeof B=="number"||typeof B=="boolean"?(U.__data[0]=B,i.bufferSubData(i.UNIFORM_BUFFER,k+O,U.__data)):B.isMatrix3?(U.__data[0]=B.elements[0],U.__data[1]=B.elements[1],U.__data[2]=B.elements[2],U.__data[3]=0,U.__data[4]=B.elements[3],U.__data[5]=B.elements[4],U.__data[6]=B.elements[5],U.__data[7]=0,U.__data[8]=B.elements[6],U.__data[9]=B.elements[7],U.__data[10]=B.elements[8],U.__data[11]=0):(B.toArray(U.__data,O),O+=$.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,k,U.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function p(A,P,x,w){const E=A.value,C=P+"_"+x;if(w[C]===void 0)return typeof E=="number"||typeof E=="boolean"?w[C]=E:w[C]=E.clone(),!0;{const D=w[C];if(typeof E=="number"||typeof E=="boolean"){if(D!==E)return w[C]=E,!0}else if(D.equals(E)===!1)return D.copy(E),!0}return!1}function _(A){const P=A.uniforms;let x=0;const w=16;for(let C=0,D=P.length;C<D;C++){const g=Array.isArray(P[C])?P[C]:[P[C]];for(let y=0,U=g.length;y<U;y++){const k=g[y],H=Array.isArray(k.value)?k.value:[k.value];for(let O=0,V=H.length;O<V;O++){const B=H[O],$=S(B),Z=x%w,rt=Z%$.boundary,ft=Z+rt;x+=rt,ft!==0&&w-ft<$.storage&&(x+=w-ft),k.__data=new Float32Array($.storage/Float32Array.BYTES_PER_ELEMENT),k.__offset=x,x+=$.storage}}}const E=x%w;return E>0&&(x+=w-E),A.__size=x,A.__cache={},this}function S(A){const P={boundary:0,storage:0};return typeof A=="number"||typeof A=="boolean"?(P.boundary=4,P.storage=4):A.isVector2?(P.boundary=8,P.storage=8):A.isVector3||A.isColor?(P.boundary=16,P.storage=12):A.isVector4?(P.boundary=16,P.storage=16):A.isMatrix3?(P.boundary=48,P.storage=48):A.isMatrix4?(P.boundary=64,P.storage=64):A.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",A),P}function m(A){const P=A.target;P.removeEventListener("dispose",m);const x=o.indexOf(P.__bindingPointIndex);o.splice(x,1),i.deleteBuffer(s[P.id]),delete s[P.id],delete r[P.id]}function d(){for(const A in s)i.deleteBuffer(s[A]);o=[],s={},r={}}return{bind:l,update:c,dispose:d}}class Eg{constructor(t={}){const{canvas:e=eu(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:h=!1,reversedDepthBuffer:f=!1}=t;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=o;const _=new Uint32Array(4),S=new Int32Array(4);let m=null,d=null;const A=[],P=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Nn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const x=this;let w=!1;this._outputColorSpace=Ze;let E=0,C=0,D=null,g=-1,y=null;const U=new pe,k=new pe;let H=null;const O=new Jt(0);let V=0,B=e.width,$=e.height,Z=1,rt=null,ft=null;const yt=new pe(0,0,B,$),ct=new pe(0,0,B,$);let pt=!1;const Lt=new Qo;let zt=!1,ot=!1;const ut=new me,wt=new J,W=new pe,G={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let K=!1;function dt(){return D===null?Z:1}let v=n;function F(L,Q){return e.getContext(L,Q)}try{const L={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:u,failIfMajorPerformanceCaveat:h};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${Go}`),e.addEventListener("webglcontextlost",St,!1),e.addEventListener("webglcontextrestored",Ut,!1),e.addEventListener("webglcontextcreationerror",_t,!1),v===null){const Q="webgl2";if(v=F(Q,L),v===null)throw F(Q)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(L){throw console.error("THREE.WebGLRenderer: "+L.message),L}let T,b,z,N,I,X,q,nt,R,M,j,tt,st,it,Et,mt,Dt,Pt,gt,bt,Xt,Bt,At,qt;function Y(){T=new Up(v),T.init(),Bt=new gg(v,T),b=new Ap(v,T,t,Bt),z=new pg(v,T),b.reversedDepthBuffer&&f&&z.buffers.depth.setReversed(!0),N=new Op(v),I=new eg,X=new mg(v,T,z,I,b,Bt,N),q=new Cp(x),nt=new Ip(x),R=new Vu(v),At=new Tp(v,R),M=new Np(v,R,N,At),j=new Bp(v,M,R,N),gt=new zp(v,b,X),mt=new Rp(I),tt=new tg(x,q,nt,T,b,At,mt),st=new Sg(x,I),it=new ig,Et=new cg(T),Pt=new Ep(x,q,nt,z,j,p,l),Dt=new hg(x,j,b),qt=new bg(v,N,b,z),bt=new wp(v,T,N),Xt=new Fp(v,T,N),N.programs=tt.programs,x.capabilities=b,x.extensions=T,x.properties=I,x.renderLists=it,x.shadowMap=Dt,x.state=z,x.info=N}Y();const vt=new Mg(x,v);this.xr=vt,this.getContext=function(){return v},this.getContextAttributes=function(){return v.getContextAttributes()},this.forceContextLoss=function(){const L=T.get("WEBGL_lose_context");L&&L.loseContext()},this.forceContextRestore=function(){const L=T.get("WEBGL_lose_context");L&&L.restoreContext()},this.getPixelRatio=function(){return Z},this.setPixelRatio=function(L){L!==void 0&&(Z=L,this.setSize(B,$,!1))},this.getSize=function(L){return L.set(B,$)},this.setSize=function(L,Q,at=!0){if(vt.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}B=L,$=Q,e.width=Math.floor(L*Z),e.height=Math.floor(Q*Z),at===!0&&(e.style.width=L+"px",e.style.height=Q+"px"),this.setViewport(0,0,L,Q)},this.getDrawingBufferSize=function(L){return L.set(B*Z,$*Z).floor()},this.setDrawingBufferSize=function(L,Q,at){B=L,$=Q,Z=at,e.width=Math.floor(L*at),e.height=Math.floor(Q*at),this.setViewport(0,0,L,Q)},this.getCurrentViewport=function(L){return L.copy(U)},this.getViewport=function(L){return L.copy(yt)},this.setViewport=function(L,Q,at,lt){L.isVector4?yt.set(L.x,L.y,L.z,L.w):yt.set(L,Q,at,lt),z.viewport(U.copy(yt).multiplyScalar(Z).round())},this.getScissor=function(L){return L.copy(ct)},this.setScissor=function(L,Q,at,lt){L.isVector4?ct.set(L.x,L.y,L.z,L.w):ct.set(L,Q,at,lt),z.scissor(k.copy(ct).multiplyScalar(Z).round())},this.getScissorTest=function(){return pt},this.setScissorTest=function(L){z.setScissorTest(pt=L)},this.setOpaqueSort=function(L){rt=L},this.setTransparentSort=function(L){ft=L},this.getClearColor=function(L){return L.copy(Pt.getClearColor())},this.setClearColor=function(){Pt.setClearColor(...arguments)},this.getClearAlpha=function(){return Pt.getClearAlpha()},this.setClearAlpha=function(){Pt.setClearAlpha(...arguments)},this.clear=function(L=!0,Q=!0,at=!0){let lt=0;if(L){let et=!1;if(D!==null){const xt=D.texture.format;et=xt===qo||xt===Yo||xt===$o}if(et){const xt=D.texture.type,Rt=xt===fn||xt===ei||xt===ns||xt===is||xt===Xo||xt===jo,Nt=Pt.getClearColor(),It=Pt.getClearAlpha(),Wt=Nt.r,jt=Nt.g,kt=Nt.b;Rt?(_[0]=Wt,_[1]=jt,_[2]=kt,_[3]=It,v.clearBufferuiv(v.COLOR,0,_)):(S[0]=Wt,S[1]=jt,S[2]=kt,S[3]=It,v.clearBufferiv(v.COLOR,0,S))}else lt|=v.COLOR_BUFFER_BIT}Q&&(lt|=v.DEPTH_BUFFER_BIT),at&&(lt|=v.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),v.clear(lt)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",St,!1),e.removeEventListener("webglcontextrestored",Ut,!1),e.removeEventListener("webglcontextcreationerror",_t,!1),Pt.dispose(),it.dispose(),Et.dispose(),I.dispose(),q.dispose(),nt.dispose(),j.dispose(),At.dispose(),qt.dispose(),tt.dispose(),vt.dispose(),vt.removeEventListener("sessionstart",rn),vt.removeEventListener("sessionend",sa),zn.stop()};function St(L){L.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),w=!0}function Ut(){console.log("THREE.WebGLRenderer: Context Restored."),w=!1;const L=N.autoReset,Q=Dt.enabled,at=Dt.autoUpdate,lt=Dt.needsUpdate,et=Dt.type;Y(),N.autoReset=L,Dt.enabled=Q,Dt.autoUpdate=at,Dt.needsUpdate=lt,Dt.type=et}function _t(L){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",L.statusMessage)}function ht(L){const Q=L.target;Q.removeEventListener("dispose",ht),Ot(Q)}function Ot(L){Yt(L),I.remove(L)}function Yt(L){const Q=I.get(L).programs;Q!==void 0&&(Q.forEach(function(at){tt.releaseProgram(at)}),L.isShaderMaterial&&tt.releaseShaderCache(L))}this.renderBufferDirect=function(L,Q,at,lt,et,xt){Q===null&&(Q=G);const Rt=et.isMesh&&et.matrixWorld.determinant()<0,Nt=Dc(L,Q,at,lt,et);z.setMaterial(lt,Rt);let It=at.index,Wt=1;if(lt.wireframe===!0){if(It=M.getWireframeAttribute(at),It===void 0)return;Wt=2}const jt=at.drawRange,kt=at.attributes.position;let te=jt.start*Wt,se=(jt.start+jt.count)*Wt;xt!==null&&(te=Math.max(te,xt.start*Wt),se=Math.min(se,(xt.start+xt.count)*Wt)),It!==null?(te=Math.max(te,0),se=Math.min(se,It.count)):kt!=null&&(te=Math.max(te,0),se=Math.min(se,kt.count));const fe=se-te;if(fe<0||fe===1/0)return;At.setup(et,lt,Nt,at,It);let ce,ae=bt;if(It!==null&&(ce=R.get(It),ae=Xt,ae.setIndex(ce)),et.isMesh)lt.wireframe===!0?(z.setLineWidth(lt.wireframeLinewidth*dt()),ae.setMode(v.LINES)):ae.setMode(v.TRIANGLES);else if(et.isLine){let Vt=lt.linewidth;Vt===void 0&&(Vt=1),z.setLineWidth(Vt*dt()),et.isLineSegments?ae.setMode(v.LINES):et.isLineLoop?ae.setMode(v.LINE_LOOP):ae.setMode(v.LINE_STRIP)}else et.isPoints?ae.setMode(v.POINTS):et.isSprite&&ae.setMode(v.TRIANGLES);if(et.isBatchedMesh)if(et._multiDrawInstances!==null)os("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),ae.renderMultiDrawInstances(et._multiDrawStarts,et._multiDrawCounts,et._multiDrawCount,et._multiDrawInstances);else if(T.get("WEBGL_multi_draw"))ae.renderMultiDraw(et._multiDrawStarts,et._multiDrawCounts,et._multiDrawCount);else{const Vt=et._multiDrawStarts,ue=et._multiDrawCounts,ee=et._multiDrawCount,Be=It?R.get(It).bytesPerElement:1,oi=I.get(lt).currentProgram.getUniforms();for(let ke=0;ke<ee;ke++)oi.setValue(v,"_gl_DrawID",ke),ae.render(Vt[ke]/Be,ue[ke])}else if(et.isInstancedMesh)ae.renderInstances(te,fe,et.count);else if(at.isInstancedBufferGeometry){const Vt=at._maxInstanceCount!==void 0?at._maxInstanceCount:1/0,ue=Math.min(at.instanceCount,Vt);ae.renderInstances(te,fe,ue)}else ae.render(te,fe)};function le(L,Q,at){L.transparent===!0&&L.side===ln&&L.forceSinglePass===!1?(L.side=Fe,L.needsUpdate=!0,us(L,Q,at),L.side=Fn,L.needsUpdate=!0,us(L,Q,at),L.side=ln):us(L,Q,at)}this.compile=function(L,Q,at=null){at===null&&(at=L),d=Et.get(at),d.init(Q),P.push(d),at.traverseVisible(function(et){et.isLight&&et.layers.test(Q.layers)&&(d.pushLight(et),et.castShadow&&d.pushShadow(et))}),L!==at&&L.traverseVisible(function(et){et.isLight&&et.layers.test(Q.layers)&&(d.pushLight(et),et.castShadow&&d.pushShadow(et))}),d.setupLights();const lt=new Set;return L.traverse(function(et){if(!(et.isMesh||et.isPoints||et.isLine||et.isSprite))return;const xt=et.material;if(xt)if(Array.isArray(xt))for(let Rt=0;Rt<xt.length;Rt++){const Nt=xt[Rt];le(Nt,at,et),lt.add(Nt)}else le(xt,at,et),lt.add(xt)}),d=P.pop(),lt},this.compileAsync=function(L,Q,at=null){const lt=this.compile(L,Q,at);return new Promise(et=>{function xt(){if(lt.forEach(function(Rt){I.get(Rt).currentProgram.isReady()&&lt.delete(Rt)}),lt.size===0){et(L);return}setTimeout(xt,10)}T.get("KHR_parallel_shader_compile")!==null?xt():setTimeout(xt,10)})};let ie=null;function mn(L){ie&&ie(L)}function rn(){zn.stop()}function sa(){zn.start()}const zn=new yc;zn.setAnimationLoop(mn),typeof self<"u"&&zn.setContext(self),this.setAnimationLoop=function(L){ie=L,vt.setAnimationLoop(L),L===null?zn.stop():zn.start()},vt.addEventListener("sessionstart",rn),vt.addEventListener("sessionend",sa),this.render=function(L,Q){if(Q!==void 0&&Q.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(w===!0)return;if(L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),Q.parent===null&&Q.matrixWorldAutoUpdate===!0&&Q.updateMatrixWorld(),vt.enabled===!0&&vt.isPresenting===!0&&(vt.cameraAutoUpdate===!0&&vt.updateCamera(Q),Q=vt.getCamera()),L.isScene===!0&&L.onBeforeRender(x,L,Q,D),d=Et.get(L,P.length),d.init(Q),P.push(d),ut.multiplyMatrices(Q.projectionMatrix,Q.matrixWorldInverse),Lt.setFromProjectionMatrix(ut,un,Q.reversedDepth),ot=this.localClippingEnabled,zt=mt.init(this.clippingPlanes,ot),m=it.get(L,A.length),m.init(),A.push(m),vt.enabled===!0&&vt.isPresenting===!0){const xt=x.xr.getDepthSensingMesh();xt!==null&&nr(xt,Q,-1/0,x.sortObjects)}nr(L,Q,0,x.sortObjects),m.finish(),x.sortObjects===!0&&m.sort(rt,ft),K=vt.enabled===!1||vt.isPresenting===!1||vt.hasDepthSensing()===!1,K&&Pt.addToRenderList(m,L),this.info.render.frame++,zt===!0&&mt.beginShadows();const at=d.state.shadowsArray;Dt.render(at,L,Q),zt===!0&&mt.endShadows(),this.info.autoReset===!0&&this.info.reset();const lt=m.opaque,et=m.transmissive;if(d.setupLights(),Q.isArrayCamera){const xt=Q.cameras;if(et.length>0)for(let Rt=0,Nt=xt.length;Rt<Nt;Rt++){const It=xt[Rt];oa(lt,et,L,It)}K&&Pt.render(L);for(let Rt=0,Nt=xt.length;Rt<Nt;Rt++){const It=xt[Rt];ra(m,L,It,It.viewport)}}else et.length>0&&oa(lt,et,L,Q),K&&Pt.render(L),ra(m,L,Q);D!==null&&C===0&&(X.updateMultisampleRenderTarget(D),X.updateRenderTargetMipmap(D)),L.isScene===!0&&L.onAfterRender(x,L,Q),At.resetDefaultState(),g=-1,y=null,P.pop(),P.length>0?(d=P[P.length-1],zt===!0&&mt.setGlobalState(x.clippingPlanes,d.state.camera)):d=null,A.pop(),A.length>0?m=A[A.length-1]:m=null};function nr(L,Q,at,lt){if(L.visible===!1)return;if(L.layers.test(Q.layers)){if(L.isGroup)at=L.renderOrder;else if(L.isLOD)L.autoUpdate===!0&&L.update(Q);else if(L.isLight)d.pushLight(L),L.castShadow&&d.pushShadow(L);else if(L.isSprite){if(!L.frustumCulled||Lt.intersectsSprite(L)){lt&&W.setFromMatrixPosition(L.matrixWorld).applyMatrix4(ut);const Rt=j.update(L),Nt=L.material;Nt.visible&&m.push(L,Rt,Nt,at,W.z,null)}}else if((L.isMesh||L.isLine||L.isPoints)&&(!L.frustumCulled||Lt.intersectsObject(L))){const Rt=j.update(L),Nt=L.material;if(lt&&(L.boundingSphere!==void 0?(L.boundingSphere===null&&L.computeBoundingSphere(),W.copy(L.boundingSphere.center)):(Rt.boundingSphere===null&&Rt.computeBoundingSphere(),W.copy(Rt.boundingSphere.center)),W.applyMatrix4(L.matrixWorld).applyMatrix4(ut)),Array.isArray(Nt)){const It=Rt.groups;for(let Wt=0,jt=It.length;Wt<jt;Wt++){const kt=It[Wt],te=Nt[kt.materialIndex];te&&te.visible&&m.push(L,Rt,te,at,W.z,kt)}}else Nt.visible&&m.push(L,Rt,Nt,at,W.z,null)}}const xt=L.children;for(let Rt=0,Nt=xt.length;Rt<Nt;Rt++)nr(xt[Rt],Q,at,lt)}function ra(L,Q,at,lt){const et=L.opaque,xt=L.transmissive,Rt=L.transparent;d.setupLightsView(at),zt===!0&&mt.setGlobalState(x.clippingPlanes,at),lt&&z.viewport(U.copy(lt)),et.length>0&&ds(et,Q,at),xt.length>0&&ds(xt,Q,at),Rt.length>0&&ds(Rt,Q,at),z.buffers.depth.setTest(!0),z.buffers.depth.setMask(!0),z.buffers.color.setMask(!0),z.setPolygonOffset(!1)}function oa(L,Q,at,lt){if((at.isScene===!0?at.overrideMaterial:null)!==null)return;d.state.transmissionRenderTarget[lt.id]===void 0&&(d.state.transmissionRenderTarget[lt.id]=new ii(1,1,{generateMipmaps:!0,type:T.has("EXT_color_buffer_half_float")||T.has("EXT_color_buffer_float")?as:fn,minFilter:Qn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:ne.workingColorSpace}));const xt=d.state.transmissionRenderTarget[lt.id],Rt=lt.viewport||U;xt.setSize(Rt.z*x.transmissionResolutionScale,Rt.w*x.transmissionResolutionScale);const Nt=x.getRenderTarget(),It=x.getActiveCubeFace(),Wt=x.getActiveMipmapLevel();x.setRenderTarget(xt),x.getClearColor(O),V=x.getClearAlpha(),V<1&&x.setClearColor(16777215,.5),x.clear(),K&&Pt.render(at);const jt=x.toneMapping;x.toneMapping=Nn;const kt=lt.viewport;if(lt.viewport!==void 0&&(lt.viewport=void 0),d.setupLightsView(lt),zt===!0&&mt.setGlobalState(x.clippingPlanes,lt),ds(L,at,lt),X.updateMultisampleRenderTarget(xt),X.updateRenderTargetMipmap(xt),T.has("WEBGL_multisampled_render_to_texture")===!1){let te=!1;for(let se=0,fe=Q.length;se<fe;se++){const ce=Q[se],ae=ce.object,Vt=ce.geometry,ue=ce.material,ee=ce.group;if(ue.side===ln&&ae.layers.test(lt.layers)){const Be=ue.side;ue.side=Fe,ue.needsUpdate=!0,aa(ae,at,lt,Vt,ue,ee),ue.side=Be,ue.needsUpdate=!0,te=!0}}te===!0&&(X.updateMultisampleRenderTarget(xt),X.updateRenderTargetMipmap(xt))}x.setRenderTarget(Nt,It,Wt),x.setClearColor(O,V),kt!==void 0&&(lt.viewport=kt),x.toneMapping=jt}function ds(L,Q,at){const lt=Q.isScene===!0?Q.overrideMaterial:null;for(let et=0,xt=L.length;et<xt;et++){const Rt=L[et],Nt=Rt.object,It=Rt.geometry,Wt=Rt.group;let jt=Rt.material;jt.allowOverride===!0&&lt!==null&&(jt=lt),Nt.layers.test(at.layers)&&aa(Nt,Q,at,It,jt,Wt)}}function aa(L,Q,at,lt,et,xt){L.onBeforeRender(x,Q,at,lt,et,xt),L.modelViewMatrix.multiplyMatrices(at.matrixWorldInverse,L.matrixWorld),L.normalMatrix.getNormalMatrix(L.modelViewMatrix),et.onBeforeRender(x,Q,at,lt,L,xt),et.transparent===!0&&et.side===ln&&et.forceSinglePass===!1?(et.side=Fe,et.needsUpdate=!0,x.renderBufferDirect(at,Q,lt,et,L,xt),et.side=Fn,et.needsUpdate=!0,x.renderBufferDirect(at,Q,lt,et,L,xt),et.side=ln):x.renderBufferDirect(at,Q,lt,et,L,xt),L.onAfterRender(x,Q,at,lt,et,xt)}function us(L,Q,at){Q.isScene!==!0&&(Q=G);const lt=I.get(L),et=d.state.lights,xt=d.state.shadowsArray,Rt=et.state.version,Nt=tt.getParameters(L,et.state,xt,Q,at),It=tt.getProgramCacheKey(Nt);let Wt=lt.programs;lt.environment=L.isMeshStandardMaterial?Q.environment:null,lt.fog=Q.fog,lt.envMap=(L.isMeshStandardMaterial?nt:q).get(L.envMap||lt.environment),lt.envMapRotation=lt.environment!==null&&L.envMap===null?Q.environmentRotation:L.envMapRotation,Wt===void 0&&(L.addEventListener("dispose",ht),Wt=new Map,lt.programs=Wt);let jt=Wt.get(It);if(jt!==void 0){if(lt.currentProgram===jt&&lt.lightsStateVersion===Rt)return ca(L,Nt),jt}else Nt.uniforms=tt.getUniforms(L),L.onBeforeCompile(Nt,x),jt=tt.acquireProgram(Nt,It),Wt.set(It,jt),lt.uniforms=Nt.uniforms;const kt=lt.uniforms;return(!L.isShaderMaterial&&!L.isRawShaderMaterial||L.clipping===!0)&&(kt.clippingPlanes=mt.uniform),ca(L,Nt),lt.needsLights=Uc(L),lt.lightsStateVersion=Rt,lt.needsLights&&(kt.ambientLightColor.value=et.state.ambient,kt.lightProbe.value=et.state.probe,kt.directionalLights.value=et.state.directional,kt.directionalLightShadows.value=et.state.directionalShadow,kt.spotLights.value=et.state.spot,kt.spotLightShadows.value=et.state.spotShadow,kt.rectAreaLights.value=et.state.rectArea,kt.ltc_1.value=et.state.rectAreaLTC1,kt.ltc_2.value=et.state.rectAreaLTC2,kt.pointLights.value=et.state.point,kt.pointLightShadows.value=et.state.pointShadow,kt.hemisphereLights.value=et.state.hemi,kt.directionalShadowMap.value=et.state.directionalShadowMap,kt.directionalShadowMatrix.value=et.state.directionalShadowMatrix,kt.spotShadowMap.value=et.state.spotShadowMap,kt.spotLightMatrix.value=et.state.spotLightMatrix,kt.spotLightMap.value=et.state.spotLightMap,kt.pointShadowMap.value=et.state.pointShadowMap,kt.pointShadowMatrix.value=et.state.pointShadowMatrix),lt.currentProgram=jt,lt.uniformsList=null,jt}function la(L){if(L.uniformsList===null){const Q=L.currentProgram.getUniforms();L.uniformsList=Gs.seqWithValue(Q.seq,L.uniforms)}return L.uniformsList}function ca(L,Q){const at=I.get(L);at.outputColorSpace=Q.outputColorSpace,at.batching=Q.batching,at.batchingColor=Q.batchingColor,at.instancing=Q.instancing,at.instancingColor=Q.instancingColor,at.instancingMorph=Q.instancingMorph,at.skinning=Q.skinning,at.morphTargets=Q.morphTargets,at.morphNormals=Q.morphNormals,at.morphColors=Q.morphColors,at.morphTargetsCount=Q.morphTargetsCount,at.numClippingPlanes=Q.numClippingPlanes,at.numIntersection=Q.numClipIntersection,at.vertexAlphas=Q.vertexAlphas,at.vertexTangents=Q.vertexTangents,at.toneMapping=Q.toneMapping}function Dc(L,Q,at,lt,et){Q.isScene!==!0&&(Q=G),X.resetTextureUnits();const xt=Q.fog,Rt=lt.isMeshStandardMaterial?Q.environment:null,Nt=D===null?x.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:zi,It=(lt.isMeshStandardMaterial?nt:q).get(lt.envMap||Rt),Wt=lt.vertexColors===!0&&!!at.attributes.color&&at.attributes.color.itemSize===4,jt=!!at.attributes.tangent&&(!!lt.normalMap||lt.anisotropy>0),kt=!!at.morphAttributes.position,te=!!at.morphAttributes.normal,se=!!at.morphAttributes.color;let fe=Nn;lt.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(fe=x.toneMapping);const ce=at.morphAttributes.position||at.morphAttributes.normal||at.morphAttributes.color,ae=ce!==void 0?ce.length:0,Vt=I.get(lt),ue=d.state.lights;if(zt===!0&&(ot===!0||L!==y)){const Ce=L===y&&lt.id===g;mt.setState(lt,L,Ce)}let ee=!1;lt.version===Vt.__version?(Vt.needsLights&&Vt.lightsStateVersion!==ue.state.version||Vt.outputColorSpace!==Nt||et.isBatchedMesh&&Vt.batching===!1||!et.isBatchedMesh&&Vt.batching===!0||et.isBatchedMesh&&Vt.batchingColor===!0&&et.colorTexture===null||et.isBatchedMesh&&Vt.batchingColor===!1&&et.colorTexture!==null||et.isInstancedMesh&&Vt.instancing===!1||!et.isInstancedMesh&&Vt.instancing===!0||et.isSkinnedMesh&&Vt.skinning===!1||!et.isSkinnedMesh&&Vt.skinning===!0||et.isInstancedMesh&&Vt.instancingColor===!0&&et.instanceColor===null||et.isInstancedMesh&&Vt.instancingColor===!1&&et.instanceColor!==null||et.isInstancedMesh&&Vt.instancingMorph===!0&&et.morphTexture===null||et.isInstancedMesh&&Vt.instancingMorph===!1&&et.morphTexture!==null||Vt.envMap!==It||lt.fog===!0&&Vt.fog!==xt||Vt.numClippingPlanes!==void 0&&(Vt.numClippingPlanes!==mt.numPlanes||Vt.numIntersection!==mt.numIntersection)||Vt.vertexAlphas!==Wt||Vt.vertexTangents!==jt||Vt.morphTargets!==kt||Vt.morphNormals!==te||Vt.morphColors!==se||Vt.toneMapping!==fe||Vt.morphTargetsCount!==ae)&&(ee=!0):(ee=!0,Vt.__version=lt.version);let Be=Vt.currentProgram;ee===!0&&(Be=us(lt,Q,et));let oi=!1,ke=!1,Wi=!1;const he=Be.getUniforms(),je=Vt.uniforms;if(z.useProgram(Be.program)&&(oi=!0,ke=!0,Wi=!0),lt.id!==g&&(g=lt.id,ke=!0),oi||y!==L){z.buffers.depth.getReversed()&&L.reversedDepth!==!0&&(L._reversedDepth=!0,L.updateProjectionMatrix()),he.setValue(v,"projectionMatrix",L.projectionMatrix),he.setValue(v,"viewMatrix",L.matrixWorldInverse);const Le=he.map.cameraPosition;Le!==void 0&&Le.setValue(v,wt.setFromMatrixPosition(L.matrixWorld)),b.logarithmicDepthBuffer&&he.setValue(v,"logDepthBufFC",2/(Math.log(L.far+1)/Math.LN2)),(lt.isMeshPhongMaterial||lt.isMeshToonMaterial||lt.isMeshLambertMaterial||lt.isMeshBasicMaterial||lt.isMeshStandardMaterial||lt.isShaderMaterial)&&he.setValue(v,"isOrthographic",L.isOrthographicCamera===!0),y!==L&&(y=L,ke=!0,Wi=!0)}if(et.isSkinnedMesh){he.setOptional(v,et,"bindMatrix"),he.setOptional(v,et,"bindMatrixInverse");const Ce=et.skeleton;Ce&&(Ce.boneTexture===null&&Ce.computeBoneTexture(),he.setValue(v,"boneTexture",Ce.boneTexture,X))}et.isBatchedMesh&&(he.setOptional(v,et,"batchingTexture"),he.setValue(v,"batchingTexture",et._matricesTexture,X),he.setOptional(v,et,"batchingIdTexture"),he.setValue(v,"batchingIdTexture",et._indirectTexture,X),he.setOptional(v,et,"batchingColorTexture"),et._colorsTexture!==null&&he.setValue(v,"batchingColorTexture",et._colorsTexture,X));const $e=at.morphAttributes;if(($e.position!==void 0||$e.normal!==void 0||$e.color!==void 0)&&gt.update(et,at,Be),(ke||Vt.receiveShadow!==et.receiveShadow)&&(Vt.receiveShadow=et.receiveShadow,he.setValue(v,"receiveShadow",et.receiveShadow)),lt.isMeshGouraudMaterial&&lt.envMap!==null&&(je.envMap.value=It,je.flipEnvMap.value=It.isCubeTexture&&It.isRenderTargetTexture===!1?-1:1),lt.isMeshStandardMaterial&&lt.envMap===null&&Q.environment!==null&&(je.envMapIntensity.value=Q.environmentIntensity),ke&&(he.setValue(v,"toneMappingExposure",x.toneMappingExposure),Vt.needsLights&&Ic(je,Wi),xt&&lt.fog===!0&&st.refreshFogUniforms(je,xt),st.refreshMaterialUniforms(je,lt,Z,$,d.state.transmissionRenderTarget[L.id]),Gs.upload(v,la(Vt),je,X)),lt.isShaderMaterial&&lt.uniformsNeedUpdate===!0&&(Gs.upload(v,la(Vt),je,X),lt.uniformsNeedUpdate=!1),lt.isSpriteMaterial&&he.setValue(v,"center",et.center),he.setValue(v,"modelViewMatrix",et.modelViewMatrix),he.setValue(v,"normalMatrix",et.normalMatrix),he.setValue(v,"modelMatrix",et.matrixWorld),lt.isShaderMaterial||lt.isRawShaderMaterial){const Ce=lt.uniformsGroups;for(let Le=0,ir=Ce.length;Le<ir;Le++){const Bn=Ce[Le];qt.update(Bn,Be),qt.bind(Bn,Be)}}return Be}function Ic(L,Q){L.ambientLightColor.needsUpdate=Q,L.lightProbe.needsUpdate=Q,L.directionalLights.needsUpdate=Q,L.directionalLightShadows.needsUpdate=Q,L.pointLights.needsUpdate=Q,L.pointLightShadows.needsUpdate=Q,L.spotLights.needsUpdate=Q,L.spotLightShadows.needsUpdate=Q,L.rectAreaLights.needsUpdate=Q,L.hemisphereLights.needsUpdate=Q}function Uc(L){return L.isMeshLambertMaterial||L.isMeshToonMaterial||L.isMeshPhongMaterial||L.isMeshStandardMaterial||L.isShadowMaterial||L.isShaderMaterial&&L.lights===!0}this.getActiveCubeFace=function(){return E},this.getActiveMipmapLevel=function(){return C},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(L,Q,at){const lt=I.get(L);lt.__autoAllocateDepthBuffer=L.resolveDepthBuffer===!1,lt.__autoAllocateDepthBuffer===!1&&(lt.__useRenderToTexture=!1),I.get(L.texture).__webglTexture=Q,I.get(L.depthTexture).__webglTexture=lt.__autoAllocateDepthBuffer?void 0:at,lt.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(L,Q){const at=I.get(L);at.__webglFramebuffer=Q,at.__useDefaultFramebuffer=Q===void 0};const Nc=v.createFramebuffer();this.setRenderTarget=function(L,Q=0,at=0){D=L,E=Q,C=at;let lt=!0,et=null,xt=!1,Rt=!1;if(L){const It=I.get(L);if(It.__useDefaultFramebuffer!==void 0)z.bindFramebuffer(v.FRAMEBUFFER,null),lt=!1;else if(It.__webglFramebuffer===void 0)X.setupRenderTarget(L);else if(It.__hasExternalTextures)X.rebindTextures(L,I.get(L.texture).__webglTexture,I.get(L.depthTexture).__webglTexture);else if(L.depthBuffer){const kt=L.depthTexture;if(It.__boundDepthTexture!==kt){if(kt!==null&&I.has(kt)&&(L.width!==kt.image.width||L.height!==kt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");X.setupDepthRenderbuffer(L)}}const Wt=L.texture;(Wt.isData3DTexture||Wt.isDataArrayTexture||Wt.isCompressedArrayTexture)&&(Rt=!0);const jt=I.get(L).__webglFramebuffer;L.isWebGLCubeRenderTarget?(Array.isArray(jt[Q])?et=jt[Q][at]:et=jt[Q],xt=!0):L.samples>0&&X.useMultisampledRTT(L)===!1?et=I.get(L).__webglMultisampledFramebuffer:Array.isArray(jt)?et=jt[at]:et=jt,U.copy(L.viewport),k.copy(L.scissor),H=L.scissorTest}else U.copy(yt).multiplyScalar(Z).floor(),k.copy(ct).multiplyScalar(Z).floor(),H=pt;if(at!==0&&(et=Nc),z.bindFramebuffer(v.FRAMEBUFFER,et)&&lt&&z.drawBuffers(L,et),z.viewport(U),z.scissor(k),z.setScissorTest(H),xt){const It=I.get(L.texture);v.framebufferTexture2D(v.FRAMEBUFFER,v.COLOR_ATTACHMENT0,v.TEXTURE_CUBE_MAP_POSITIVE_X+Q,It.__webglTexture,at)}else if(Rt){const It=Q;for(let Wt=0;Wt<L.textures.length;Wt++){const jt=I.get(L.textures[Wt]);v.framebufferTextureLayer(v.FRAMEBUFFER,v.COLOR_ATTACHMENT0+Wt,jt.__webglTexture,at,It)}}else if(L!==null&&at!==0){const It=I.get(L.texture);v.framebufferTexture2D(v.FRAMEBUFFER,v.COLOR_ATTACHMENT0,v.TEXTURE_2D,It.__webglTexture,at)}g=-1},this.readRenderTargetPixels=function(L,Q,at,lt,et,xt,Rt,Nt=0){if(!(L&&L.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let It=I.get(L).__webglFramebuffer;if(L.isWebGLCubeRenderTarget&&Rt!==void 0&&(It=It[Rt]),It){z.bindFramebuffer(v.FRAMEBUFFER,It);try{const Wt=L.textures[Nt],jt=Wt.format,kt=Wt.type;if(!b.textureFormatReadable(jt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!b.textureTypeReadable(kt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}Q>=0&&Q<=L.width-lt&&at>=0&&at<=L.height-et&&(L.textures.length>1&&v.readBuffer(v.COLOR_ATTACHMENT0+Nt),v.readPixels(Q,at,lt,et,Bt.convert(jt),Bt.convert(kt),xt))}finally{const Wt=D!==null?I.get(D).__webglFramebuffer:null;z.bindFramebuffer(v.FRAMEBUFFER,Wt)}}},this.readRenderTargetPixelsAsync=async function(L,Q,at,lt,et,xt,Rt,Nt=0){if(!(L&&L.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let It=I.get(L).__webglFramebuffer;if(L.isWebGLCubeRenderTarget&&Rt!==void 0&&(It=It[Rt]),It)if(Q>=0&&Q<=L.width-lt&&at>=0&&at<=L.height-et){z.bindFramebuffer(v.FRAMEBUFFER,It);const Wt=L.textures[Nt],jt=Wt.format,kt=Wt.type;if(!b.textureFormatReadable(jt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!b.textureTypeReadable(kt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const te=v.createBuffer();v.bindBuffer(v.PIXEL_PACK_BUFFER,te),v.bufferData(v.PIXEL_PACK_BUFFER,xt.byteLength,v.STREAM_READ),L.textures.length>1&&v.readBuffer(v.COLOR_ATTACHMENT0+Nt),v.readPixels(Q,at,lt,et,Bt.convert(jt),Bt.convert(kt),0);const se=D!==null?I.get(D).__webglFramebuffer:null;z.bindFramebuffer(v.FRAMEBUFFER,se);const fe=v.fenceSync(v.SYNC_GPU_COMMANDS_COMPLETE,0);return v.flush(),await nu(v,fe,4),v.bindBuffer(v.PIXEL_PACK_BUFFER,te),v.getBufferSubData(v.PIXEL_PACK_BUFFER,0,xt),v.deleteBuffer(te),v.deleteSync(fe),xt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(L,Q=null,at=0){const lt=Math.pow(2,-at),et=Math.floor(L.image.width*lt),xt=Math.floor(L.image.height*lt),Rt=Q!==null?Q.x:0,Nt=Q!==null?Q.y:0;X.setTexture2D(L,0),v.copyTexSubImage2D(v.TEXTURE_2D,at,0,0,Rt,Nt,et,xt),z.unbindTexture()};const Fc=v.createFramebuffer(),Oc=v.createFramebuffer();this.copyTextureToTexture=function(L,Q,at=null,lt=null,et=0,xt=null){xt===null&&(et!==0?(os("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),xt=et,et=0):xt=0);let Rt,Nt,It,Wt,jt,kt,te,se,fe;const ce=L.isCompressedTexture?L.mipmaps[xt]:L.image;if(at!==null)Rt=at.max.x-at.min.x,Nt=at.max.y-at.min.y,It=at.isBox3?at.max.z-at.min.z:1,Wt=at.min.x,jt=at.min.y,kt=at.isBox3?at.min.z:0;else{const $e=Math.pow(2,-et);Rt=Math.floor(ce.width*$e),Nt=Math.floor(ce.height*$e),L.isDataArrayTexture?It=ce.depth:L.isData3DTexture?It=Math.floor(ce.depth*$e):It=1,Wt=0,jt=0,kt=0}lt!==null?(te=lt.x,se=lt.y,fe=lt.z):(te=0,se=0,fe=0);const ae=Bt.convert(Q.format),Vt=Bt.convert(Q.type);let ue;Q.isData3DTexture?(X.setTexture3D(Q,0),ue=v.TEXTURE_3D):Q.isDataArrayTexture||Q.isCompressedArrayTexture?(X.setTexture2DArray(Q,0),ue=v.TEXTURE_2D_ARRAY):(X.setTexture2D(Q,0),ue=v.TEXTURE_2D),v.pixelStorei(v.UNPACK_FLIP_Y_WEBGL,Q.flipY),v.pixelStorei(v.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Q.premultiplyAlpha),v.pixelStorei(v.UNPACK_ALIGNMENT,Q.unpackAlignment);const ee=v.getParameter(v.UNPACK_ROW_LENGTH),Be=v.getParameter(v.UNPACK_IMAGE_HEIGHT),oi=v.getParameter(v.UNPACK_SKIP_PIXELS),ke=v.getParameter(v.UNPACK_SKIP_ROWS),Wi=v.getParameter(v.UNPACK_SKIP_IMAGES);v.pixelStorei(v.UNPACK_ROW_LENGTH,ce.width),v.pixelStorei(v.UNPACK_IMAGE_HEIGHT,ce.height),v.pixelStorei(v.UNPACK_SKIP_PIXELS,Wt),v.pixelStorei(v.UNPACK_SKIP_ROWS,jt),v.pixelStorei(v.UNPACK_SKIP_IMAGES,kt);const he=L.isDataArrayTexture||L.isData3DTexture,je=Q.isDataArrayTexture||Q.isData3DTexture;if(L.isDepthTexture){const $e=I.get(L),Ce=I.get(Q),Le=I.get($e.__renderTarget),ir=I.get(Ce.__renderTarget);z.bindFramebuffer(v.READ_FRAMEBUFFER,Le.__webglFramebuffer),z.bindFramebuffer(v.DRAW_FRAMEBUFFER,ir.__webglFramebuffer);for(let Bn=0;Bn<It;Bn++)he&&(v.framebufferTextureLayer(v.READ_FRAMEBUFFER,v.COLOR_ATTACHMENT0,I.get(L).__webglTexture,et,kt+Bn),v.framebufferTextureLayer(v.DRAW_FRAMEBUFFER,v.COLOR_ATTACHMENT0,I.get(Q).__webglTexture,xt,fe+Bn)),v.blitFramebuffer(Wt,jt,Rt,Nt,te,se,Rt,Nt,v.DEPTH_BUFFER_BIT,v.NEAREST);z.bindFramebuffer(v.READ_FRAMEBUFFER,null),z.bindFramebuffer(v.DRAW_FRAMEBUFFER,null)}else if(et!==0||L.isRenderTargetTexture||I.has(L)){const $e=I.get(L),Ce=I.get(Q);z.bindFramebuffer(v.READ_FRAMEBUFFER,Fc),z.bindFramebuffer(v.DRAW_FRAMEBUFFER,Oc);for(let Le=0;Le<It;Le++)he?v.framebufferTextureLayer(v.READ_FRAMEBUFFER,v.COLOR_ATTACHMENT0,$e.__webglTexture,et,kt+Le):v.framebufferTexture2D(v.READ_FRAMEBUFFER,v.COLOR_ATTACHMENT0,v.TEXTURE_2D,$e.__webglTexture,et),je?v.framebufferTextureLayer(v.DRAW_FRAMEBUFFER,v.COLOR_ATTACHMENT0,Ce.__webglTexture,xt,fe+Le):v.framebufferTexture2D(v.DRAW_FRAMEBUFFER,v.COLOR_ATTACHMENT0,v.TEXTURE_2D,Ce.__webglTexture,xt),et!==0?v.blitFramebuffer(Wt,jt,Rt,Nt,te,se,Rt,Nt,v.COLOR_BUFFER_BIT,v.NEAREST):je?v.copyTexSubImage3D(ue,xt,te,se,fe+Le,Wt,jt,Rt,Nt):v.copyTexSubImage2D(ue,xt,te,se,Wt,jt,Rt,Nt);z.bindFramebuffer(v.READ_FRAMEBUFFER,null),z.bindFramebuffer(v.DRAW_FRAMEBUFFER,null)}else je?L.isDataTexture||L.isData3DTexture?v.texSubImage3D(ue,xt,te,se,fe,Rt,Nt,It,ae,Vt,ce.data):Q.isCompressedArrayTexture?v.compressedTexSubImage3D(ue,xt,te,se,fe,Rt,Nt,It,ae,ce.data):v.texSubImage3D(ue,xt,te,se,fe,Rt,Nt,It,ae,Vt,ce):L.isDataTexture?v.texSubImage2D(v.TEXTURE_2D,xt,te,se,Rt,Nt,ae,Vt,ce.data):L.isCompressedTexture?v.compressedTexSubImage2D(v.TEXTURE_2D,xt,te,se,ce.width,ce.height,ae,ce.data):v.texSubImage2D(v.TEXTURE_2D,xt,te,se,Rt,Nt,ae,Vt,ce);v.pixelStorei(v.UNPACK_ROW_LENGTH,ee),v.pixelStorei(v.UNPACK_IMAGE_HEIGHT,Be),v.pixelStorei(v.UNPACK_SKIP_PIXELS,oi),v.pixelStorei(v.UNPACK_SKIP_ROWS,ke),v.pixelStorei(v.UNPACK_SKIP_IMAGES,Wi),xt===0&&Q.generateMipmaps&&v.generateMipmap(ue),z.unbindTexture()},this.initRenderTarget=function(L){I.get(L).__webglFramebuffer===void 0&&X.setupRenderTarget(L)},this.initTexture=function(L){L.isCubeTexture?X.setTextureCube(L,0):L.isData3DTexture?X.setTexture3D(L,0):L.isDataArrayTexture||L.isCompressedArrayTexture?X.setTexture2DArray(L,0):X.setTexture2D(L,0),z.unbindTexture()},this.resetState=function(){E=0,C=0,D=null,z.reset(),At.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return un}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=ne._getDrawingBufferColorSpace(t),e.unpackColorSpace=ne._getUnpackColorSpace()}}const El={type:"change"},ia={type:"start"},wc={type:"end"},Os=new Ko,Tl=new Dn,Tg=Math.cos(70*tu.DEG2RAD),_e=new J,Ie=2*Math.PI,oe={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Br=1e-6;class wg extends ku{constructor(t,e=null){super(t,e),this.state=oe.NONE,this.target=new J,this.cursor=new J,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:Li.ROTATE,MIDDLE:Li.DOLLY,RIGHT:Li.PAN},this.touches={ONE:wi.ROTATE,TWO:wi.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new J,this._lastQuaternion=new ni,this._lastTargetPosition=new J,this._quat=new ni().setFromUnitVectors(t.up,new J(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Ka,this._sphericalDelta=new Ka,this._scale=1,this._panOffset=new J,this._rotateStart=new $t,this._rotateEnd=new $t,this._rotateDelta=new $t,this._panStart=new $t,this._panEnd=new $t,this._panDelta=new $t,this._dollyStart=new $t,this._dollyEnd=new $t,this._dollyDelta=new $t,this._dollyDirection=new J,this._mouse=new $t,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Rg.bind(this),this._onPointerDown=Ag.bind(this),this._onPointerUp=Cg.bind(this),this._onContextMenu=Fg.bind(this),this._onMouseWheel=Dg.bind(this),this._onKeyDown=Ig.bind(this),this._onTouchStart=Ug.bind(this),this._onTouchMove=Ng.bind(this),this._onMouseDown=Pg.bind(this),this._onMouseMove=Lg.bind(this),this._interceptControlDown=Og.bind(this),this._interceptControlUp=zg.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}connect(t){super.connect(t),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(t){t.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=t}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(El),this.update(),this.state=oe.NONE}update(t=null){const e=this.object.position;_e.copy(e).sub(this.target),_e.applyQuaternion(this._quat),this._spherical.setFromVector3(_e),this.autoRotate&&this.state===oe.NONE&&this._rotateLeft(this._getAutoRotationAngle(t)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,s=this.maxAzimuthAngle;isFinite(n)&&isFinite(s)&&(n<-Math.PI?n+=Ie:n>Math.PI&&(n-=Ie),s<-Math.PI?s+=Ie:s>Math.PI&&(s-=Ie),n<=s?this._spherical.theta=Math.max(n,Math.min(s,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+s)/2?Math.max(n,this._spherical.theta):Math.min(s,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let r=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),r=o!=this._spherical.radius}if(_e.setFromSpherical(this._spherical),_e.applyQuaternion(this._quatInverse),e.copy(this.target).add(_e),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){const a=_e.length();o=this._clampDistance(a*this._scale);const l=a-o;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),r=!!l}else if(this.object.isOrthographicCamera){const a=new J(this._mouse.x,this._mouse.y,0);a.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),r=l!==this.object.zoom;const c=new J(this._mouse.x,this._mouse.y,0);c.unproject(this.object),this.object.position.sub(c).add(a),this.object.updateMatrixWorld(),o=_e.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(Os.origin.copy(this.object.position),Os.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(Os.direction))<Tg?this.object.lookAt(this.target):(Tl.setFromNormalAndCoplanarPoint(this.object.up,this.target),Os.intersectPlane(Tl,this.target))))}else if(this.object.isOrthographicCamera){const o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),r=!0)}return this._scale=1,this._performCursorZoom=!1,r||this._lastPosition.distanceToSquared(this.object.position)>Br||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Br||this._lastTargetPosition.distanceToSquared(this.target)>Br?(this.dispatchEvent(El),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(t){return t!==null?Ie/60*this.autoRotateSpeed*t:Ie/60/60*this.autoRotateSpeed}_getZoomScale(t){const e=Math.abs(t*.01);return Math.pow(.95,this.zoomSpeed*e)}_rotateLeft(t){this._sphericalDelta.theta-=t}_rotateUp(t){this._sphericalDelta.phi-=t}_panLeft(t,e){_e.setFromMatrixColumn(e,0),_e.multiplyScalar(-t),this._panOffset.add(_e)}_panUp(t,e){this.screenSpacePanning===!0?_e.setFromMatrixColumn(e,1):(_e.setFromMatrixColumn(e,0),_e.crossVectors(this.object.up,_e)),_e.multiplyScalar(t),this._panOffset.add(_e)}_pan(t,e){const n=this.domElement;if(this.object.isPerspectiveCamera){const s=this.object.position;_e.copy(s).sub(this.target);let r=_e.length();r*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*t*r/n.clientHeight,this.object.matrix),this._panUp(2*e*r/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(t*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(e*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(t,e){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const n=this.domElement.getBoundingClientRect(),s=t-n.left,r=e-n.top,o=n.width,a=n.height;this._mouse.x=s/o*2-1,this._mouse.y=-(r/a)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(t){return Math.max(this.minDistance,Math.min(this.maxDistance,t))}_handleMouseDownRotate(t){this._rotateStart.set(t.clientX,t.clientY)}_handleMouseDownDolly(t){this._updateZoomParameters(t.clientX,t.clientX),this._dollyStart.set(t.clientX,t.clientY)}_handleMouseDownPan(t){this._panStart.set(t.clientX,t.clientY)}_handleMouseMoveRotate(t){this._rotateEnd.set(t.clientX,t.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Ie*this._rotateDelta.x/e.clientHeight),this._rotateUp(Ie*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(t){this._dollyEnd.set(t.clientX,t.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(t){this._panEnd.set(t.clientX,t.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(t){this._updateZoomParameters(t.clientX,t.clientY),t.deltaY<0?this._dollyIn(this._getZoomScale(t.deltaY)):t.deltaY>0&&this._dollyOut(this._getZoomScale(t.deltaY)),this.update()}_handleKeyDown(t){let e=!1;switch(t.code){case this.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(Ie*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),e=!0;break;case this.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(-Ie*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),e=!0;break;case this.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(Ie*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),e=!0;break;case this.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(-Ie*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),e=!0;break}e&&(t.preventDefault(),this.update())}_handleTouchStartRotate(t){if(this._pointers.length===1)this._rotateStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),n=.5*(t.pageX+e.x),s=.5*(t.pageY+e.y);this._rotateStart.set(n,s)}}_handleTouchStartPan(t){if(this._pointers.length===1)this._panStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),n=.5*(t.pageX+e.x),s=.5*(t.pageY+e.y);this._panStart.set(n,s)}}_handleTouchStartDolly(t){const e=this._getSecondPointerPosition(t),n=t.pageX-e.x,s=t.pageY-e.y,r=Math.sqrt(n*n+s*s);this._dollyStart.set(0,r)}_handleTouchStartDollyPan(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enablePan&&this._handleTouchStartPan(t)}_handleTouchStartDollyRotate(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enableRotate&&this._handleTouchStartRotate(t)}_handleTouchMoveRotate(t){if(this._pointers.length==1)this._rotateEnd.set(t.pageX,t.pageY);else{const n=this._getSecondPointerPosition(t),s=.5*(t.pageX+n.x),r=.5*(t.pageY+n.y);this._rotateEnd.set(s,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Ie*this._rotateDelta.x/e.clientHeight),this._rotateUp(Ie*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(t){if(this._pointers.length===1)this._panEnd.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),n=.5*(t.pageX+e.x),s=.5*(t.pageY+e.y);this._panEnd.set(n,s)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(t){const e=this._getSecondPointerPosition(t),n=t.pageX-e.x,s=t.pageY-e.y,r=Math.sqrt(n*n+s*s);this._dollyEnd.set(0,r),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const o=(t.pageX+e.x)*.5,a=(t.pageY+e.y)*.5;this._updateZoomParameters(o,a)}_handleTouchMoveDollyPan(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enablePan&&this._handleTouchMovePan(t)}_handleTouchMoveDollyRotate(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enableRotate&&this._handleTouchMoveRotate(t)}_addPointer(t){this._pointers.push(t.pointerId)}_removePointer(t){delete this._pointerPositions[t.pointerId];for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId){this._pointers.splice(e,1);return}}_isTrackingPointer(t){for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId)return!0;return!1}_trackPointer(t){let e=this._pointerPositions[t.pointerId];e===void 0&&(e=new $t,this._pointerPositions[t.pointerId]=e),e.set(t.pageX,t.pageY)}_getSecondPointerPosition(t){const e=t.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[e]}_customWheelEvent(t){const e=t.deltaMode,n={clientX:t.clientX,clientY:t.clientY,deltaY:t.deltaY};switch(e){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100;break}return t.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}}function Ag(i){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(i.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(i)&&(this._addPointer(i),i.pointerType==="touch"?this._onTouchStart(i):this._onMouseDown(i)))}function Rg(i){this.enabled!==!1&&(i.pointerType==="touch"?this._onTouchMove(i):this._onMouseMove(i))}function Cg(i){switch(this._removePointer(i),this._pointers.length){case 0:this.domElement.releasePointerCapture(i.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(wc),this.state=oe.NONE;break;case 1:const t=this._pointers[0],e=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:e.x,pageY:e.y});break}}function Pg(i){let t;switch(i.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case Li.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(i),this.state=oe.DOLLY;break;case Li.ROTATE:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=oe.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=oe.ROTATE}break;case Li.PAN:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=oe.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=oe.PAN}break;default:this.state=oe.NONE}this.state!==oe.NONE&&this.dispatchEvent(ia)}function Lg(i){switch(this.state){case oe.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(i);break;case oe.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(i);break;case oe.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(i);break}}function Dg(i){this.enabled===!1||this.enableZoom===!1||this.state!==oe.NONE||(i.preventDefault(),this.dispatchEvent(ia),this._handleMouseWheel(this._customWheelEvent(i)),this.dispatchEvent(wc))}function Ig(i){this.enabled!==!1&&this._handleKeyDown(i)}function Ug(i){switch(this._trackPointer(i),this._pointers.length){case 1:switch(this.touches.ONE){case wi.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(i),this.state=oe.TOUCH_ROTATE;break;case wi.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(i),this.state=oe.TOUCH_PAN;break;default:this.state=oe.NONE}break;case 2:switch(this.touches.TWO){case wi.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(i),this.state=oe.TOUCH_DOLLY_PAN;break;case wi.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(i),this.state=oe.TOUCH_DOLLY_ROTATE;break;default:this.state=oe.NONE}break;default:this.state=oe.NONE}this.state!==oe.NONE&&this.dispatchEvent(ia)}function Ng(i){switch(this._trackPointer(i),this.state){case oe.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(i),this.update();break;case oe.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(i),this.update();break;case oe.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(i),this.update();break;case oe.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(i),this.update();break;default:this.state=oe.NONE}}function Fg(i){this.enabled!==!1&&i.preventDefault()}function Og(i){i.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function zg(i){i.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}const wl="#16191f";function Bg(i,t,e){const n=new Eg({antialias:!0,preserveDrawingBuffer:!0});n.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),n.shadowMap.enabled=!0,n.shadowMap.type=jl,n.toneMapping=Yl,n.toneMappingExposure=1.12,i.appendChild(n.domElement);const s=new Au;s.background=new Jt(wl),s.fog=new Jo(wl,.0011);const r=new Ke(46,1,.1,4e3),o=new wg(r,n.domElement);o.enableDamping=!0,o.dampingFactor=.08,o.maxDistance=1200,o.maxPolarAngle=Math.PI*.49,s.add(new Nu(15068143,3815986,1.05));const a=new Za(16773855,2.8);a.castShadow=!0,a.shadow.mapSize.set(2048,2048),a.shadow.normalBias=.1,a.shadow.bias=-2e-4,s.add(a),s.add(a.target);const l=new Za(13687779,.55);l.position.set(120,60,-140),s.add(l);let c=new Ai,u=null,h=null,f=new Ai;s.add(c,f);let p=-1,_=4;const S=()=>{_=6};o.addEventListener("change",S);let m=null;const d=new Bu;function A(O){O.traverse(V=>{V.geometry&&V.geometry.dispose(),V.material&&(Array.isArray(V.material)?V.material:[V.material]).forEach(B=>B.dispose())}),O.clear()}function P(){const O=e.getTerrain();return O?O.sample:null}function x(){A(c),A(f);const O=t.project,V=t.selection,B=P();let $;try{$=ko(O,e.getSampleMap(),e.getTopology(),B)}catch(ct){console.error("mesh build failed",ct);return}const Z=ct=>{const pt=new Is({vertexColors:!0,roughness:.93,metalness:0,side:ln});return ct&&V.roadId===ct&&(pt.emissive=new Jt("#4a90e2"),pt.emissiveIntensity=.22),t.ui.wireframe&&(pt.wireframe=!0),pt},rt=new Map,ft=ct=>{const pt=ct||"";return rt.has(pt)||rt.set(pt,Z(ct)),rt.get(pt)};for(const ct of $.parts){const pt=new sn;pt.setAttribute("position",new Re(ct.positions,3)),pt.setAttribute("normal",new Re(ct.normals,3)),pt.setAttribute("color",new Re(ct.colors,3)),pt.setAttribute("uv",new Re(ct.uvs,2)),pt.setIndex(new Re(ct.indices,1));const Lt=new We(pt,ft(ct.roadId));Lt.castShadow=!0,Lt.receiveShadow=!0,Lt.name=ct.junction?`junction__${ct.name}`:`${ct.roadId||"?"}__${ct.name}`,c.add(Lt)}const yt=new Is({color:16096779,roughness:.5,emissive:8014336,emissiveIntensity:.4});for(const ct of O.junctions||[]){const pt=new We(new ea(1.1),yt);pt.position.set(ct.x,ct.y+1.2,ct.z),pt.castShadow=!0,f.add(pt)}w(),S()}function w(){const O=new si().setFromObject(c);if(O.isEmpty()){const $=e.getTerrain(),Z=$?Math.max($.bounds.maxX-$.bounds.minX,$.bounds.maxZ-$.bounds.minZ)/2:200;O.set(new J(-Z,-5,-Z),new J(Z,30,Z))}const V=O.getCenter(new J),B=Math.max(60,O.getSize(new J).length()/2);a.position.set(V.x-B*.9,V.y+B*1.4,V.z+B*.7),a.target.position.copy(V),Object.assign(a.shadow.camera,{left:-B,right:B,top:B,bottom:-B,far:B*6,near:1}),a.shadow.camera.updateProjectionMatrix()}function E(){const O=e.getTerrain();if(!(O&&O.rev===p&&u)){if(u&&(s.remove(u),u.geometry.dispose(),u.material.dispose(),u=null),h&&(s.remove(h),h.geometry.dispose(),h.material.dispose(),h=null),p=O?O.rev:-1,O){const V=O.bounds.maxX-O.bounds.minX,B=O.bounds.maxZ-O.bounds.minZ,$=150,Z=new ki(V,B,$,$);Z.rotateX(-Math.PI/2);const rt=Z.attributes.position,ft=new Float32Array(rt.count*3),yt=Math.max(1e-6,O.maxY-O.minY);for(let pt=0;pt<rt.count;pt++){const Lt=rt.getX(pt)+(O.bounds.minX+O.bounds.maxX)/2,zt=rt.getZ(pt)+(O.bounds.minZ+O.bounds.maxZ)/2,ot=O.sample(Lt,zt)??O.minY;rt.setY(pt,ot-.06),rt.setX(pt,Lt),rt.setZ(pt,zt);const ut=(ot-O.minY)/yt;ft[pt*3]=.1+ut*.3,ft[pt*3+1]=.13+ut*.24,ft[pt*3+2]=.09+ut*.13}Z.setAttribute("color",new Re(ft,3)),Z.computeVertexNormals(),u=new We(Z,new Is({vertexColors:!0,roughness:1})),u.receiveShadow=!0,s.add(u);const ct=Math.max(V,B);h=new Ja(ct,Math.round(ct/10),9079438,3815998),h.position.set((O.bounds.minX+O.bounds.maxX)/2,O.minY+.05,(O.bounds.minZ+O.bounds.maxZ)/2)}else u=new We(new ki(1600,1600),new Is({color:1777947,roughness:1})),u.rotation.x=-Math.PI/2,u.position.y=-.08,u.receiveShadow=!0,s.add(u),h=new Ja(1200,120,4608571,3357230),h.position.y=-.04;h.material.transparent=!0,h.material.opacity=.5,s.add(h),S()}}function C(O=!1){y();const V=new si().setFromObject(c),B=e.getTerrain();let $,Z;V.isEmpty()?B?($=new J((B.bounds.minX+B.bounds.maxX)/2,(B.minY+B.maxY)/2,(B.bounds.minZ+B.bounds.maxZ)/2),Z=Math.max(B.bounds.maxX-B.bounds.minX,B.bounds.maxZ-B.bounds.minZ)/2):($=new J(0,0,0),Z=120):($=V.getCenter(new J),Z=Math.max(20,V.getSize(new J).length()/2)),o.target.copy($);const rt=O?new J(.001,1,.001):new J(1.1,.75,1.35).normalize();r.position.copy($).addScaledVector(rt,Z*(O?2.1:1.9)),r.near=Math.max(.05,Z/500),r.far=Math.max(2e3,Z*12),r.updateProjectionMatrix(),o.update(),S()}function D(O,V){const B=e.getSamples(O);if(!B||!B.count)return null;const $=B.samples;let Z=V;B.closed?Z=(V%B.length+B.length)%B.length:Z=Math.min(B.length-.001,Math.max(0,V));const rt=B.length/(B.closed?$.length:$.length-1),ft=Z/rt,yt=Math.floor(ft)%$.length,ct=(yt+1)%$.length,pt=ft-Math.floor(ft),Lt=$[yt],zt=B.closed||ct<$.length?$[ct]:Lt;return{x:Lt.x+(zt.x-Lt.x)*pt,y:Lt.y+(zt.y-Lt.y)*pt,z:Lt.z+(zt.z-Lt.z)*pt,tx:Lt.tx,tz:Lt.tz,length:B.length,closed:B.closed}}function g(O,V=16){const B=e.getSamples(O);return!B||!B.count?!1:(m={roadId:O,s:0,speed:V,playing:!0},o.enabled=!1,e.onDriveState?.(!0),!0)}function y(O=!1){m&&(m=null,o.enabled=!0,O||e.onDriveState?.(!1),S())}function U(O){if(!m?.playing)return;const V=e.getSamples(m.roadId);if(!V||!V.count){y();return}if(m.s+=m.speed*O,!V.closed&&m.s>=V.length){y(),e.toast("End of road — drive finished");return}const B=D(m.roadId,m.s),$=D(m.roadId,m.s+9);!B||!$||(r.position.set(B.x,B.y+2.5,B.z),r.lookAt($.x,$.y+1.1,$.z))}function k(){E(),x()}function H(){const O=i.getBoundingClientRect(),V=Math.max(50,O.width),B=Math.max(50,O.height);n.setSize(V,B),r.aspect=V/B,r.updateProjectionMatrix(),S()}return n.setAnimationLoop(()=>{const O=Math.min(.1,d.getDelta());if(m){U(O),n.render(s,r);return}o.update(),o.autoRotate=!!t.ui.autoRotate,o.autoRotateSpeed=.7,!(_<=0&&!o.autoRotate)&&(_--,n.render(s,r))}),t.subscribe(O=>{O==="selection"&&x(),O==="ui"&&(c.traverse(V=>{V.material&&(V.material.wireframe=!!t.ui.wireframe)}),S())}),new ResizeObserver(H).observe(i),{refresh:k,resize:H,resetCamera:C,screenshot(O){n.render(s,r),n.domElement.toBlob(V=>{if(!V)return;const B=URL.createObjectURL(V),$=document.createElement("a");$.href=B,$.download=O,document.body.appendChild($),$.click(),$.remove(),setTimeout(()=>URL.revokeObjectURL(B),8e3)},"image/png")},drive:g,stopDrive:y,setDriveSpeed(O){m&&(m.speed=O)},toggleDrivePlay(){return m?(m.playing=!m.playing,m.playing):!1},get driving(){return!!m},get drivePlaying(){return!!m?.playing},invalidate:S,dispose(){n.setAnimationLoop(null),A(c),A(f),n.dispose(),i.innerHTML=""}}}const Ac=(i,t,e=[])=>{const n=document.createElementNS("http://www.w3.org/2000/svg",i);return Object.keys(t).forEach(s=>{n.setAttribute(s,String(t[s]))}),e.length&&e.forEach(s=>{const r=Ac(...s);n.appendChild(r)}),n};var kg=([i,t,e])=>Ac(i,t,e);const Hg=i=>Array.from(i.attributes).reduce((t,e)=>(t[e.name]=e.value,t),{}),Vg=i=>typeof i=="string"?i:!i||!i.class?"":i.class&&typeof i.class=="string"?i.class.split(" "):i.class&&Array.isArray(i.class)?i.class:"",Gg=i=>i.flatMap(Vg).map(e=>e.trim()).filter(Boolean).filter((e,n,s)=>s.indexOf(e)===n).join(" "),Wg=i=>i.replace(/(\w)(\w*)(_|-|\s*)/g,(t,e,n)=>e.toUpperCase()+n.toLowerCase()),Al=(i,{nameAttr:t,icons:e,attrs:n})=>{const s=i.getAttribute(t);if(s==null)return;const r=Wg(s),o=e[r];if(!o)return console.warn(`${i.outerHTML} icon name was not found in the provided icons object.`);const a=Hg(i),[l,c,u]=o,h={...c,"data-lucide":s,...n,...a},f=Gg(["lucide",`lucide-${s}`,a,n]);f&&Object.assign(h,{class:f});const p=kg([l,h,u]);return i.parentNode?.replaceChild(p,i)};const Ft={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};const Xg=["svg",Ft,[["path",{d:"m21 16-4 4-4-4"}],["path",{d:"M17 20V4"}],["path",{d:"m3 8 4-4 4 4"}],["path",{d:"M7 4v16"}]]];const jg=["svg",Ft,[["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"}],["path",{d:"m3.3 7 8.7 5 8.7-5"}],["path",{d:"M12 22V12"}]]];const $g=["svg",Ft,[["path",{d:"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"}],["circle",{cx:"12",cy:"13",r:"3"}]]];const Yg=["svg",Ft,[["path",{d:"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"}],["circle",{cx:"7",cy:"17",r:"2"}],["path",{d:"M9 17h6"}],["circle",{cx:"17",cy:"17",r:"2"}]]];const qg=["svg",Ft,[["path",{d:"M20 6 9 17l-5-5"}]]];const Zg=["svg",Ft,[["path",{d:"m6 9 6 6 6-6"}]]];const Kg=["svg",Ft,[["circle",{cx:"12",cy:"12",r:"10"}],["circle",{cx:"12",cy:"12",r:"1"}]]];const Jg=["svg",Ft,[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}],["path",{d:"M12 3v18"}]]];const Qg=["svg",Ft,[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]]];const t0=["svg",Ft,[["circle",{cx:"12",cy:"12",r:"10"}],["line",{x1:"22",x2:"18",y1:"12",y2:"12"}],["line",{x1:"6",x2:"2",y1:"12",y2:"12"}],["line",{x1:"12",x2:"12",y1:"6",y2:"2"}],["line",{x1:"12",x2:"12",y1:"22",y2:"18"}]]];const e0=["svg",Ft,[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{points:"7 10 12 15 17 10"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3"}]]];const n0=["svg",Ft,[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{d:"m2 2 20 20"}]]];const i0=["svg",Ft,[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{cx:"12",cy:"12",r:"3"}]]];const s0=["svg",Ft,[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{d:"M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"}],["path",{d:"M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"}]]];const r0=["svg",Ft,[["path",{d:"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"}],["line",{x1:"4",x2:"4",y1:"22",y2:"15"}]]];const o0=["svg",Ft,[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]]];const a0=["svg",Ft,[["path",{d:"m12 14 4-4"}],["path",{d:"M3.34 19a10 10 0 1 1 17.32 0"}]]];const l0=["svg",Ft,[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}],["path",{d:"M3 9h18"}],["path",{d:"M3 15h18"}],["path",{d:"M9 3v18"}],["path",{d:"M15 3v18"}]]];const c0=["svg",Ft,[["path",{d:"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"}],["path",{d:"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"}],["path",{d:"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"}],["path",{d:"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"}]]];const d0=["svg",Ft,[["line",{x1:"4",x2:"20",y1:"9",y2:"9"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21"}]]];const u0=["svg",Ft,[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2"}],["circle",{cx:"9",cy:"9",r:"2"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]]];const h0=["svg",Ft,[["circle",{cx:"12",cy:"12",r:"10"}],["path",{d:"M12 16v-4"}],["path",{d:"M12 8h.01"}]]];const f0=["svg",Ft,[["path",{d:"M10 8h.01"}],["path",{d:"M12 12h.01"}],["path",{d:"M14 8h.01"}],["path",{d:"M16 12h.01"}],["path",{d:"M18 8h.01"}],["path",{d:"M6 8h.01"}],["path",{d:"M7 16h10"}],["path",{d:"M8 12h.01"}],["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2"}]]];const p0=["svg",Ft,[["path",{d:"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{d:"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{d:"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]]];const m0=["svg",Ft,[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12"}]]];const g0=["svg",Ft,[["line",{x1:"2",x2:"5",y1:"12",y2:"12"}],["line",{x1:"19",x2:"22",y1:"12",y2:"12"}],["line",{x1:"12",x2:"12",y1:"2",y2:"5"}],["line",{x1:"12",x2:"12",y1:"19",y2:"22"}],["circle",{cx:"12",cy:"12",r:"7"}],["circle",{cx:"12",cy:"12",r:"3"}]]];const _0=["svg",Ft,[["path",{d:"m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"}],["path",{d:"m5 8 4 4"}],["path",{d:"m12 15 4 4"}]]];const x0=["svg",Ft,[["path",{d:"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}],["path",{d:"M15 5.764v15"}],["path",{d:"M9 3.236v15"}]]];const v0=["svg",Ft,[["path",{d:"M8 3H5a2 2 0 0 0-2 2v3"}],["path",{d:"M21 8V5a2 2 0 0 0-2-2h-3"}],["path",{d:"M3 16v3a2 2 0 0 0 2 2h3"}],["path",{d:"M16 21h3a2 2 0 0 0 2-2v-3"}]]];const M0=["svg",Ft,[["path",{d:"M12 13v8"}],["path",{d:"M12 3v3"}],["path",{d:"M4 6a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h13a2 2 0 0 0 1.152-.365l3.424-2.317a1 1 0 0 0 0-1.635l-3.424-2.318A2 2 0 0 0 17 6z"}]]];const y0=["svg",Ft,[["path",{d:"m8 3 4 8 5-5 5 15H2L8 3z"}],["path",{d:"M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19"}]]];const S0=["svg",Ft,[["path",{d:"m8 3 4 8 5-5 5 15H2L8 3z"}]]];const b0=["svg",Ft,[["path",{d:"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"}]]];const E0=["svg",Ft,[["path",{d:"M12 2v20"}],["path",{d:"m15 19-3 3-3-3"}],["path",{d:"m19 9 3 3-3 3"}],["path",{d:"M2 12h20"}],["path",{d:"m5 9-3 3 3 3"}],["path",{d:"m9 5 3-3 3 3"}]]];const T0=["svg",Ft,[["path",{d:"m15 9-6 6"}],["path",{d:"M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"}],["path",{d:"m9 9 6 6"}]]];const w0=["svg",Ft,[["circle",{cx:"12",cy:"12",r:"3"}],["circle",{cx:"19",cy:"5",r:"2"}],["circle",{cx:"5",cy:"19",r:"2"}],["path",{d:"M10.4 21.9a10 10 0 0 0 9.941-15.416"}],["path",{d:"M13.5 2.1a10 10 0 0 0-9.841 15.416"}]]];const A0=["svg",Ft,[["circle",{cx:"13.5",cy:"6.5",r:".5",fill:"currentColor"}],["circle",{cx:"17.5",cy:"10.5",r:".5",fill:"currentColor"}],["circle",{cx:"8.5",cy:"7.5",r:".5",fill:"currentColor"}],["circle",{cx:"6.5",cy:"12.5",r:".5",fill:"currentColor"}],["path",{d:"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"}]]];const R0=["svg",Ft,[["rect",{x:"14",y:"4",width:"4",height:"16",rx:"1"}],["rect",{x:"6",y:"4",width:"4",height:"16",rx:"1"}]]];const C0=["svg",Ft,[["path",{d:"M12 20h9"}],["path",{d:"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"}]]];const P0=["svg",Ft,[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{d:"m15 5 4 4"}]]];const L0=["svg",Ft,[["polygon",{points:"6 3 20 12 6 21 6 3"}]]];const D0=["svg",Ft,[["path",{d:"M5 12h14"}],["path",{d:"M12 5v14"}]]];const I0=["svg",Ft,[["path",{d:"m15 14 5-5-5-5"}],["path",{d:"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"}]]];const U0=["svg",Ft,[["path",{d:"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{d:"M3 3v5h5"}],["path",{d:"M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"}],["path",{d:"M16 16h5v5"}]]];const N0=["svg",Ft,[["path",{d:"M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"}],["path",{d:"m15.194 13.707 3.814 1.86-1.86 3.814"}],["path",{d:"M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"}]]];const F0=["svg",Ft,[["circle",{cx:"6",cy:"19",r:"3"}],["path",{d:"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{cx:"18",cy:"5",r:"3"}]]];const O0=["svg",Ft,[["path",{d:"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"}],["path",{d:"m14.5 12.5 2-2"}],["path",{d:"m11.5 9.5 2-2"}],["path",{d:"m8.5 6.5 2-2"}],["path",{d:"m17.5 15.5 2-2"}]]];const z0=["svg",Ft,[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7"}]]];const B0=["svg",Ft,[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2"}]]];const k0=["svg",Ft,[["circle",{cx:"19",cy:"5",r:"2"}],["circle",{cx:"5",cy:"19",r:"2"}],["path",{d:"M5 17A12 12 0 0 1 17 5"}]]];const H0=["svg",Ft,[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}]]];const V0=["svg",Ft,[["path",{d:"M12 3v18"}],["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2"}],["path",{d:"M3 9h18"}],["path",{d:"M3 15h18"}]]];const G0=["svg",Ft,[["path",{d:"M3 6h18"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17"}]]];const W0=["svg",Ft,[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17"}],["polyline",{points:"16 7 22 7 22 13"}]]];const X0=["svg",Ft,[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{d:"M12 9v4"}],["path",{d:"M12 17h.01"}]]];const j0=["svg",Ft,[["path",{d:"M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"}]]];const $0=["svg",Ft,[["path",{d:"M9 14 4 9l5-5"}],["path",{d:"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"}]]];const Y0=["svg",Ft,[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16"}]]];const q0=["svg",Ft,[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{points:"17 8 12 3 7 8"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15"}]]];const Z0=["svg",Ft,[["circle",{cx:"12",cy:"4.5",r:"2.5"}],["path",{d:"m10.2 6.3-3.9 3.9"}],["circle",{cx:"4.5",cy:"12",r:"2.5"}],["path",{d:"M7 12h10"}],["circle",{cx:"19.5",cy:"12",r:"2.5"}],["path",{d:"m13.8 17.7 3.9-3.9"}],["circle",{cx:"12",cy:"19.5",r:"2.5"}]]];const K0=["svg",Ft,[["path",{d:"M18 6 6 18"}],["path",{d:"m6 6 12 12"}]]];const J0=({icons:i={},nameAttr:t="data-lucide",attrs:e={}}={})=>{if(!Object.values(i).length)throw new Error(`Please provide an icons object.
If you want to use all the icons you can import it like:
 \`import { createIcons, icons } from 'lucide';
lucide.createIcons({icons});\``);if(typeof document>"u")throw new Error("`createIcons()` only works in a browser environment.");const n=document.querySelectorAll(`[${t}]`);if(Array.from(n).forEach(s=>Al(s,{nameAttr:t,icons:i,attrs:e})),t==="data-lucide"){const s=document.querySelectorAll("[icon-name]");s.length>0&&(console.warn("[Lucide] Some icons were found with the now deprecated icon-name attribute. These will still be replaced for backwards compatibility, but will no longer be supported in v1.0 and you should switch to data-lucide"),Array.from(s).forEach(r=>Al(r,{nameAttr:"icon-name",icons:i,attrs:e})))}},Q0={Route:F0,Spline:k0,Waypoints:Z0,Milestone:M0,Ruler:O0,Gauge:a0,TrendingUp:W0,ArrowUpDown:Xg,Mountain:S0,MountainSnow:y0,Layers:p0,Link2:m0,Unlink:Y0,CircleDot:Kg,Eye:i0,EyeOff:n0,Plus:D0,Copy:Qg,Trash2:G0,Pencil:P0,Save:z0,FolderOpen:o0,Upload:q0,FileJson:s0,Image:u0,Table:V0,Camera:$g,Flag:r0,Move:E0,Hash:d0,Info:h0,TriangleAlert:X0,Check:qg,X:K0,ChevronDown:Zg,Crosshair:t0,Palette:A0,OctagonX:T0,RefreshCcw:U0,Map:x0,Box:jg,Columns2:Jg,Undo2:$0,Redo2:I0,Download:e0,Keyboard:f0,MousePointer2:b0,PenLine:C0,Hand:c0,Grid3x3:l0,Magnet:_0,Maximize:v0,Orbit:w0,Scan:B0,Triangle:j0,Rotate3d:N0,Car:Yg,LocateFixed:g0,Pause:R0,Play:L0,Square:H0},Ln=()=>{try{J0({icons:Q0})}catch(i){console.error(i)}},Ue=(i,t=1)=>Number.isFinite(i)?i.toFixed(t):"—",kr=i=>Number.isFinite(i)?i>=1e3?`${(i/1e3).toFixed(2)} km`:`${i.toFixed(i<100?1:0)} m`:"—";function Mt(i,t,e,n){const s=document.createElement(i);return t&&(s.className=t),n!=null&&(s.innerHTML=n),e&&e.appendChild(s),s}const t_=[{key:"diamond-interchange",name:"Diamond Interchange",sub:"Overpass · ramps · bridges"},{key:"mountain-pass",name:"Alpine Descent",sub:"Hairpins · guardrails · grades"},{key:"quarry-haul",name:"Quarry Haul Road",sub:"Wide gravel · switchbacks"},{key:"village-loop",name:"Village Loop",sub:"Closed loop · junctions"}];function e_(i,t){const e=v=>document.getElementById(v),n=e("left-panel"),s=e("inspector"),r=e("metrics"),o=e("statusbar"),a=new Map;let l=0,c=null;function u(v){const F=e("toast");F.textContent=v,F.hidden=!1,requestAnimationFrame(()=>F.classList.add("show")),clearTimeout(l),l=setTimeout(()=>{F.classList.remove("show"),setTimeout(()=>F.hidden=!0,220)},3200)}function h(){e("export-menu").hidden=!0,e("popup-menu").hidden=!0,document.querySelectorAll(".dropdown.open").forEach(v=>v.classList.remove("open")),c&&(c(),c=null)}function f(v,F,T){h(),v.innerHTML="",T(v),v.hidden=!1;const b=F.getBoundingClientRect(),z=v.offsetWidth,N=v.offsetHeight;let I=Math.min(window.innerWidth-z-10,Math.max(10,b.left)),X=b.bottom+8;X+N>window.innerHeight-10&&(X=Math.max(10,b.top-N-8)),v.style.left=`${I}px`,v.style.top=`${X}px`,Ln();const q=M=>{!v.contains(M.target)&&!F.contains(M.target)&&h()},nt=M=>{M.key==="Escape"&&h()},R=()=>h();setTimeout(()=>{document.addEventListener("mousedown",q),document.addEventListener("keydown",nt),window.addEventListener("resize",R)},0),c=()=>{document.removeEventListener("mousedown",q),document.removeEventListener("keydown",nt),window.removeEventListener("resize",R)}}const p=(v,{icon:F,label:T,sub:b,selected:z,fn:N})=>{const I=Mt("div","mi"+(z?" sel":""),v);return I.innerHTML=`${F?`<i data-lucide="${F}"></i>`:""}<span class="ml">${T}${b?`<small>${b}</small>`:""}</span>${z?'<span class="radio"></span>':""}`,I.onclick=X=>{X.stopPropagation(),h(),N?.()},I};function _({value:v,step:F=1,unit:T="",min:b,max:z,wide:N=!1,onchange:I,oninput:X,disabled:q=!1}){const nt=Mt("div","valuebox"+(N?" wide":"")),R=Mt("div","num",nt),M=Mt("input","",R);M.type="number",M.value=Number.isFinite(v)?+v.toFixed(4):0,F&&(M.step=F),b!=null&&(M.min=b),z!=null&&(M.max=z),M.disabled=q,T&&Mt("div","unitseg",nt,T);let j=!1;return M.addEventListener("focus",()=>{i.checkpoint("edit value"),j=!0,M.select()}),M.addEventListener("input",()=>{const tt=parseFloat(M.value);if(!Number.isFinite(tt))return;const st=b!=null&&z!=null?Math.min(z,Math.max(b,tt)):tt;i.transient(()=>X(st))}),M.addEventListener("change",()=>{j&&(j=!1,i.endGesture()),I?.()}),M.addEventListener("blur",()=>{j&&(j=!1,i.endGesture())}),M.addEventListener("keydown",tt=>{tt.key==="Enter"&&M.blur(),tt.key==="Escape"&&M.blur(),tt.stopPropagation()}),{box:nt,input:M,set(tt){document.activeElement!==M&&(M.value=+tt.toFixed(4))}}}function S({value:v,onchange:F,placeholder:T=""}){const b=Mt("div","valuebox wide"),z=Mt("div","num",b),N=Mt("input","",z);N.type="text",N.value=v,N.placeholder=T,N.style.textAlign="left";let I=!1;return N.addEventListener("focus",()=>{i.checkpoint("rename"),I=!0,N.select()}),N.addEventListener("input",()=>i.transient(()=>F(N.value))),N.addEventListener("change",()=>{I&&(I=!1,i.endGesture())}),N.addEventListener("blur",()=>{I&&(I=!1,i.endGesture())}),N.addEventListener("keydown",X=>{X.key==="Enter"&&N.blur(),X.stopPropagation()}),b}function m(v,F,{min:T,max:b,step:z,unit:N,value:I,fmt:X=nt=>nt,oninput:q}){const nt=Mt("div","slider-row",v);Mt("label","",nt,F);const R=_({value:I,step:z,unit:N,min:T,max:b,oninput:q});nt.appendChild(R.box);const M=Mt("div","slider",nt,'<div class="fill"></div><div class="knob"></div>'),j=M.querySelector(".fill"),tt=M.querySelector(".knob"),st=it=>{const Et=(it-T)/(b-T);j.style.width=`${Et*100}%`,tt.style.left=`${Et*100}%`,R.set(it)};return st(I),M.addEventListener("pointerdown",it=>{it.preventDefault(),M.setPointerCapture(it.pointerId),i.checkpoint("adjust "+F.toLowerCase());const Et=Pt=>{const gt=M.getBoundingClientRect();let bt=T+Math.min(1,Math.max(0,(Pt.clientX-gt.left)/gt.width))*(b-T);bt=Math.round(bt/z)*z,bt=Math.min(b,Math.max(T,+bt.toFixed(5))),i.transient(()=>q(bt)),st(bt)};Et(it);const mt=Pt=>Et(Pt),Dt=()=>{M.removeEventListener("pointermove",mt),M.removeEventListener("pointerup",Dt),i.endGesture()};M.addEventListener("pointermove",mt),M.addEventListener("pointerup",Dt)}),{paint:st}}function d(v,F,T,b,z){const N=Mt("div","ctl-row",v);Mt("label","",N,(z?`<i data-lucide="${z}" style="width:11px;height:11px;vertical-align:-1px"></i> `:"")+F);const I=Mt("div","grow",N);I.style.display="flex",I.style.justifyContent="flex-end";const X=Mt("div","switch"+(T?" on":""),I,'<div class="nub"></div>');X.onclick=()=>i.commit("toggle "+F.toLowerCase(),()=>b(!T))}function A(v,F,T,b,z){const N=Mt("div","ctl-row",v);Mt("label","",N,F);const I=Mt("div","dropdown",N),X=T.find(q=>q.value===b);I.innerHTML=`<div class="dd-head"><span class="cur">${X?X.label:"—"}</span><span class="caret"><i data-lucide="chevron-down"></i></span></div>`,I.querySelector(".dd-head").onclick=q=>{q.stopPropagation(),I.classList.add("open"),f(e("popup-menu"),I,nt=>{for(const R of T)p(nt,{icon:R.icon,label:R.label,sub:R.sub,selected:R.value===b,fn:()=>{R.value!==b&&i.commit("set "+F.toLowerCase(),()=>z(R.value))}})})}}function P(v,F,T,b){const z=Mt("div","ctl-row",v);Mt("label","",z,F);const N=Mt("div","colorbar",z);N.innerHTML=`<div class="swatchseg"><div class="circle" style="background:${T}"></div><div class="cname">${T}</div></div><div class="caret"><i data-lucide="chevron-down"></i></div>`;const I=Mt("input","",z);I.type="color",I.value=T,I.style.display="none";let X=!1;N.onclick=()=>{X=!1,I.click()},I.addEventListener("input",()=>{X||(i.checkpoint("set colour"),X=!0),i.transient(()=>b(I.value))}),I.addEventListener("change",()=>{X&&(X=!1,i.endGesture())})}function x(v,F,T,b,z=""){const N=Mt("button","btn "+z,v,`<i data-lucide="${T}"></i>${F}`);return N.onclick=b,N}function w(v,F,T,b,z,{collapsible:N=!0,startOpen:I=!0}={}){const X=Mt("div","prop-section",v),q=Mt("div","prop-title"+(N?" foldable":""),X,`${b?`<i data-lucide="${b}"></i>`:""}${T}${N?'<i data-lucide="chevron-down" class="chev"></i>':""}`),nt=Mt("div","prop-content",X);z(nt);const R=N&&(a.has(F)?a.get(F):!I),M=()=>{q.classList.toggle("collapsed",R),nt.style.maxHeight=R?"0":`${nt.scrollHeight+40}px`};return N&&(R&&q.classList.add("collapsed"),q.onclick=()=>{const j=!q.classList.contains("collapsed");q.classList.toggle("collapsed",j),a.set(F,j),nt.style.maxHeight=j?"0":`${nt.scrollHeight+40}px`},requestAnimationFrame(M)),{sec:X,content:nt}}const E=(v,F,T)=>Mt("div","kv",v,`<span class="k">${F}</span><span class="v">${T}</span>`);function C(v){v.junctions=(v.junctions||[]).filter(F=>(F.links||[]).length>=2)}function D(v){i.commit("delete road",F=>{F.roads=F.roads.filter(T=>T.id!==v);for(const T of F.junctions||[])T.links=(T.links||[]).filter(b=>b.road!==v);C(F)}),i.select({kind:null}),u("Road deleted — Ctrl+Z restores it")}function g(v){const F=Ct(i.project,v);if(!F)return;const T=Ws(i.project,"r");i.commit("duplicate road",b=>{const z=JSON.parse(JSON.stringify(F));z.id=T,z.name=`${F.name} copy`,z.points=z.points.map(N=>({...N,x:N.x+6,z:N.z+6})),b.roads.push(z)}),i.select({kind:"road",roadId:T})}function y(v,F){const T=Ct(i.project,v);if(!T||!T.points[F])return;i.commit("delete point",z=>{const N=Ct(z,v);N.points.splice(F,1),N.closed&&N.points.length<3&&(N.closed=!1);for(const I of z.junctions||[])I.links=(I.links||[]).filter(X=>X.road!==v);C(z)});const b=Ct(i.project,v)?.points.length||0;i.select(b?{kind:"road",roadId:v}:{kind:null})}function U(v,F){i.commit("unweld point",T=>{for(const b of T.junctions||[])b.links=(b.links||[]).filter(z=>z.road!==v);C(T)}),u("Endpoint unwelded from its junction")}function k(v,F){i.commit(F?"enable intersection":"disable intersection",T=>{T.intersectionOverrides=T.intersectionOverrides||{},T.intersectionOverrides[v]={enabled:F}})}function H(v){const F=i.selection;if(v&&F.roadId){D(F.roadId);return}F.kind==="point"?y(F.roadId,F.index):F.kind==="road"?D(F.roadId):F.kind==="junction"&&(i.commit("delete junction",T=>{T.junctions=(T.junctions||[]).filter(b=>b.id!==F.junctionId)}),i.select({kind:null}),u("Junction removed — endpoints keep their positions"))}function O(v){i.commit("smooth grades",F=>{const T=Ct(F,v.id),b=T.points.map(z=>z.y);for(let z=0;z<2;z++){const N=b.slice();for(let I=1;I<b.length-1;I++)N[I]=(b[I-1]+b[I]*2+b[I+1])/4;for(let I=0;I<b.length;I++)b[I]=N[I]}T.points.forEach((z,N)=>{z.y=+b[N].toFixed(2)});for(const z of F.junctions||[])for(const N of z.links||[]){if(N.road!==T.id)continue;const I=N.end==="start"?0:T.points.length-1;T.points[I]&&(z.y=T.points[I].y)}}),u("Grades smoothed")}function V(v){const F=t.getTerrain();if(!F){u("Import a heightmap or grow demo hills first");return}i.commit("drape to terrain",T=>{const b=Ct(T,v.id);let z=0;b.points.forEach((N,I)=>{const X=F.sample(N.x,N.z);if(X==null)return;const q=+(X+(b.drapeOffset||0)).toFixed(2);Ji(T,b.id,I,void 0,void 0,q),z++}),u(z?`Draped ${z} point${z===1?"":"s"} to terrain`:"No points inside the terrain bounds")})}function B(v){i.commit("reverse direction",F=>{const T=Ct(F,v.id);T.points.reverse();for(const b of F.junctions||[])for(const z of b.links||[])z.road===T.id&&(z.end=z.end==="start"?"end":"start")})}function $(){n.innerHTML="";const v=Mt("div","panel-scroll",n),F=i.project;w(v,"project","Project","folder-open",T=>{Mt("div","ctl-label",T,"Name"),T.appendChild(S({value:F.name,onchange:z=>{i.project.name=z}}));const b=Mt("div","btn-row",T);x(b,"New","plus",()=>t.newProject()),x(b,"Open","upload",()=>e("file-road").click()),x(b,"Save","save",()=>t.saveProjectFile()),E(T,"Format","frontier-road-network · v1"),E(T,"Units","metres · Y-up"),E(T,"Autosave",t.autosaveNote())}),w(v,"roads",`Roads · ${F.roads.length}`,"route",T=>{F.roads.length||Mt("div","empty-note",T,"No roads yet.<br>Draw one on the plan (D).");for(const b of F.roads){const z=t.getSamples(b.id),N=Mt("div","road-item"+(i.selection.roadId===b.id?" sel":""),T);N.innerHTML=`<span class="dot" style="background:${b.color}"></span>
          <span class="meta"><span class="name">${b.name}${b.closed?'<span class="loop-tag">LOOP</span>':""}</span>
          <span class="sub">${z?kr(z.length):"—"} · ${b.points.length} pts · ${b.lanes}×${Ue(b.laneWidth,1)} m</span></span>
          <span class="acts"></span>`,N.title="Click to select · double-click to rename",N.onclick=()=>i.select({kind:"road",roadId:b.id}),N.ondblclick=R=>{R.stopPropagation();const M=N.querySelector(".name"),j=b.name;M.innerHTML="";const tt=Mt("input","",M);tt.type="text",tt.value=j,tt.onclick=st=>st.stopPropagation(),tt.onkeydown=st=>{st.stopPropagation(),st.key==="Enter"&&tt.blur(),st.key==="Escape"&&(tt.value=j,tt.blur())},tt.onchange=()=>{const st=tt.value.trim()||j;st!==j?i.commit("rename road",it=>{Ct(it,b.id).name=st}):$()},tt.focus(),tt.select()};const I=N.querySelector(".acts"),X=Mt("button","mini-btn"+(b.visible===!1?" off":""),I,`<i data-lucide="${b.visible===!1?"eye-off":"eye"}"></i>`);X.title=b.visible===!1?"Show":"Hide",X.onclick=R=>{R.stopPropagation(),i.commit("toggle visibility",M=>{Ct(M,b.id).visible=b.visible===!1})};const q=Mt("button","mini-btn",I,'<i data-lucide="copy"></i>');q.title="Duplicate",q.onclick=R=>{R.stopPropagation(),g(b.id)};const nt=Mt("button","mini-btn",I,'<i data-lucide="trash-2"></i>');nt.title="Delete road",nt.onclick=R=>{R.stopPropagation(),D(b.id)}}x(T,"Draw a road","pen-line",()=>{const b=Ws(i.project,"r"),z=i.project.roads.length+1;i.commit("add road",N=>{N.roads.push(ts(b,z))}),i.select({kind:"road",roadId:b}),i.setTool("draw"),u("Click the plan to lay points · Enter finishes")},"primary")}),w(v,"intersections",`Intersections · ${t.getTopology().intersections.length}`,"network",T=>{const b=t.getTopology(),z=[...b.intersections,...b.disabled];!z.length&&!b.overpasses.length&&!b.bridges.length&&Mt("div","ctl-hint",T,"Cross roads at grade for a paved junction · separate heights for an overpass · flag points to span a bridge."),m(T,"Corner radius",{min:2,max:14,step:.5,unit:"m",value:F.settings?.cornerRadius??6,oninput:N=>{i.project.settings=i.project.settings||{},i.project.settings.cornerRadius=N}});for(const N of z){const I=b.disabled.includes(N),X=N.roads.map(R=>Ct(F,R)?.name||R).join(" × "),q=Mt("div","junc-item",T);I&&(q.style.opacity=".45"),q.innerHTML=`<span class="dia"></span><span class="meta"><span class="name">${Xc(N.kind)} <small>· ${N.legs.length} legs</small></span><span class="sub">${X}</span></span><span class="acts"></span>`,q.title="Click to zoom",q.onclick=()=>t.gotoPoint(N.x,N.z);const nt=Mt("button","mini-btn"+(I?" off":""),q.querySelector(".acts"),`<i data-lucide="${I?"eye-off":"eye"}"></i>`);nt.title=I?"Enable":"Disable (roads render uncut)",nt.onclick=R=>{R.stopPropagation(),k(N.id,I)}}for(const N of b.overpasses){const I=Ct(F,N.upper)?.name||N.upper,X=Ct(F,N.lower)?.name||N.lower,q=Mt("div","junc-item",T);q.innerHTML=`<span class="dia"></span><span class="meta"><span class="name">Overpass <small>· ${N.gap.toFixed(1)} m</small></span><span class="sub">${I} over ${X}</span></span>`,q.title="Click to zoom",q.onclick=()=>t.gotoPoint(N.x,N.z)}for(const N of b.bridges){const I=Ct(F,N.roadId),X=Mt("div","junc-item",T);X.innerHTML=`<span class="dia"></span><span class="meta"><span class="name">Bridge <small>· ${(N.s1-N.s0).toFixed(0)} m</small></span><span class="sub">${I?.name||N.roadId}</span></span>`,X.title="Click to zoom",X.onclick=()=>{const q=t.getSamples(N.roadId),nt=q&&Se(q.samples,(N.s0+N.s1)/2);nt&&t.gotoPoint(nt.x,nt.z)}}}),w(v,"terrain","Terrain","mountain",T=>{const b=t.getTerrain();if(!b)Mt("div","ctl-hint",T,"Flat world. Import a <b>heightmap PNG</b> (white = high) or grow <b>demo hills</b> to drape roads onto ground.");else if(E(T,"Source",b.name),E(T,"Grid",`${b.w} × ${b.h}`),E(T,"Height",`${Ue(b.minY,1)} … ${Ue(b.maxY,1)} m`),b.image){const N=Mt("img","hm-preview",T);N.src=b.image,N.alt="Heightmap preview"}const z=Mt("div","btn-row",T);x(z,"Import PNG","image",()=>e("file-height").click()),x(z,"Demo hills","mountain-snow",()=>t.makeDemoHills()),b&&x(T,"Remove terrain","trash-2",()=>t.clearTerrain())}),w(v,"junctions",`Junctions · ${(F.junctions||[]).length}`,"waypoints",T=>{(F.junctions||[]).length||Mt("div","ctl-hint",T,"Drag one road <b>endpoint</b> onto another — they weld into a shared junction node. <b>Both roads keep their own lanes and markings.</b>");for(const b of F.junctions||[]){const z=Mt("div","junc-item"+(i.selection.junctionId===b.id?" sel":""),T),N=(b.links||[]).map(I=>{const X=Ct(F,I.road);return X?`${X.name} ${I.end==="start"?"Ⓐ":"Ⓑ"}`:"?"}).join(" · ");z.innerHTML=`<span class="dia"></span><span class="meta"><span class="name">${b.name||b.id}</span><span class="sub">${N||"no links"}</span></span>`,z.onclick=()=>{i.select({kind:"junction",junctionId:b.id}),t.gotoPoint(b.x,b.z)}}}),w(v,"samples","Samples","flag",T=>{for(const b of t_){const z=Mt("button","sample-card",T,`<i data-lucide="milestone"></i><span><b>${b.name}</b><span>${b.sub}</span></span>`);z.onclick=()=>t.loadSample(b.key)}},{startOpen:!1}),w(v,"about","About","info",T=>{Mt("div","ctl-hint",T,"Spline centreline editor. Exports <b>.road.json</b> (reloadable), <b>.obj</b> mesh, <b>.csv</b> stations and <b>.png</b> captures. Engine loader lives in <b>integration/</b>.")},{startOpen:!1}),Ln()}function Z(v,F){const T=t.getSamples(F.id);if(!T||!T.count){Mt("div","empty-note",v,"Add at least 2 points to sample this road.");return}E(v,"Length",kr(T.length)),E(v,"Width",`${Ue(Vr(F),1)} m`),E(v,"Min radius",Number.isFinite(T.minRadius)?`${Ue(T.minRadius,1)} m`:"straight"),E(v,"Max grade",`${Ue((T.maxGrade||0)*100,1)}%`)}function rt(){s.innerHTML="";const v=Mt("div","panel-scroll",s),F=i.selection,T=i.project,b=F.roadId?Ct(T,F.roadId):null,z=t.getIssues();if(z.length){const N=z.filter(q=>q.severity==="error").length,I=z.filter(q=>q.severity==="warn").length;w(v,"issues",`Issues · ${N} errors ${I} warnings`,"triangle-alert",q=>{for(const nt of z.slice(0,30)){const R=Mt("div",`issue-row ${nt.severity}`,q,`<i data-lucide="${nt.severity==="error"?"octagon-x":nt.severity==="warn"?"triangle-alert":"info"}"></i><span><span class="msg">${nt.message}</span><br><span class="loc">${nt.x!=null?`(${Ue(nt.x,1)}, ${Ue(nt.z,1)})`:""}</span></span>`);R.onclick=()=>t.gotoIssue(nt)}z.length>30&&Mt("div","empty-note",q,`…and ${z.length-30} more`)}).sec.classList.add("alert")}if(!b){const N=F.kind==="junction"?(T.junctions||[]).find(I=>I.id===F.junctionId):null;N?w(v,"junc","Junction","waypoints",I=>{Mt("div","ctl-label",I,"Name"),I.appendChild(S({value:N.name||N.id,onchange:R=>{const M=i.project.junctions.find(j=>j.id===N.id);M&&(M.name=R)}}));const X=Mt("div","ctl-row",I);Mt("label","",X,"Position");const q=Mt("div","grow",X);q.style.cssText="display:flex;gap:6px;";for(const[R,M,j]of[["X","x","m"],["Z","z","m"],["Y","y","m"]]){const tt=Mt("div","valuebox",q);tt.style.flex="1",tt.innerHTML=`<div class="axisseg">${R}</div><div class="num"><input type="number" step="0.5"></div>`;const st=tt.querySelector("input");st.value=+N[M].toFixed(3);let it=!1;st.addEventListener("focus",()=>{i.checkpoint("move junction"),it=!0}),st.addEventListener("input",()=>{const Et=parseFloat(st.value);Number.isFinite(Et)&&i.transient(mt=>{const Dt=mt.junctions.find(Pt=>Pt.id===N.id);Dt&&(Dt[M]=Et)})}),st.addEventListener("change",()=>{it&&(it=!1,i.endGesture())}),st.addEventListener("blur",()=>{it&&(it=!1,i.endGesture())}),st.addEventListener("keydown",Et=>{Et.key==="Enter"&&st.blur(),Et.stopPropagation()})}Mt("div","ctl-label",I,`Links · ${N.links.length}`);for(const R of N.links||[]){const M=Ct(T,R.road);E(I,M?M.name:"(deleted)",R.end==="start"?"start Ⓐ":"end Ⓑ")}const nt=Mt("div","btn-row",I);x(nt,"Zoom to","crosshair",()=>t.gotoPoint(N.x,N.z)),x(nt,"Unweld all","unlink",()=>{i.commit("delete junction",R=>{R.junctions=R.junctions.filter(M=>M.id!==N.id)}),i.select({kind:null})},"danger")}):w(v,"none","Inspector","crosshair",I=>{Mt("div","empty-note",I,"Select a road, a control point, or a junction to edit it here."),Mt("div","ctl-hint",I,"<b>V</b> select · <b>D</b> draw · <b>Alt+click</b> insert point · <b>double-click</b> extend · <b>Del</b> remove.")}),Ln();return}if(w(v,"road","Road","route",N=>{Mt("div","ctl-label",N,"Name"),N.appendChild(S({value:b.name,onchange:I=>{Ct(i.project,b.id).name=I}})),P(N,"Colour",b.color,I=>{Ct(i.project,b.id).color=I}),d(N,"Visible",b.visible!==!1,I=>{Ct(i.project,b.id).visible=I},"eye"),d(N,"Closed loop",!!b.closed,I=>{const X=Ct(i.project,b.id);if(I&&X.points.length<3){u("A loop needs at least 3 points");return}if(X.closed=I,I){for(const q of i.project.junctions||[])q.links=(q.links||[]).filter(nt=>nt.road!==X.id);C(i.project)}},"refresh-ccw"),A(N,"Surface",Fl.map(I=>({value:I,label:Ui[I].label})),b.surface,I=>{Ct(i.project,b.id).surface=I}),Z(N,b)}),w(v,"xsec","Cross-section","spline",N=>{m(N,"Lanes",{min:1,max:6,step:1,unit:"",value:b.lanes,oninput:I=>{Ct(i.project,b.id).lanes=Math.round(I)}}),m(N,"Lane width",{min:2,max:6,step:.1,unit:"m",value:b.laneWidth,oninput:I=>{Ct(i.project,b.id).laneWidth=I}}),m(N,"Shoulder L",{min:0,max:6,step:.1,unit:"m",value:b.shoulderL,oninput:I=>{Ct(i.project,b.id).shoulderL=I}}),m(N,"Shoulder R",{min:0,max:6,step:.1,unit:"m",value:b.shoulderR,oninput:I=>{Ct(i.project,b.id).shoulderR=I}}),m(N,"Camber",{min:0,max:.3,step:.01,unit:"m",value:b.camber,oninput:I=>{Ct(i.project,b.id).camber=I}}),Mt("div","ctl-label",N,"Centre marking");{const I=Mt("div","ctl-row",N);Mt("label","",I,"Style");const X=Mt("div","segment",I);for(const[q,nt]of Object.entries(Zc)){const R=Mt("div","seg-opt"+(b.centerMarking===q?" sel":""),X,nt);R.onclick=()=>{b.centerMarking!==q&&i.commit("set marking",M=>{Ct(M,b.id).centerMarking=q})}}}d(N,"Edge lines",!!b.edgeMarking,I=>{Ct(i.project,b.id).edgeMarking=I}),d(N,"Kerb left",!!b.kerbL,I=>{Ct(i.project,b.id).kerbL=I}),d(N,"Kerb right",!!b.kerbR,I=>{Ct(i.project,b.id).kerbR=I}),d(N,"Rail left",!!b.guardrailL,I=>{Ct(i.project,b.id).guardrailL=I}),d(N,"Rail right",!!b.guardrailR,I=>{Ct(i.project,b.id).guardrailR=I}),A(N,"Conform",[{value:"design",label:"Design heights",sub:"Ribbon follows control-point Y"},{value:"drape",label:"Drape to terrain",sub:"Ribbon hugs the heightfield"}],b.conform,I=>{Ct(i.project,b.id).conform=I}),m(N,"Drape lift",{min:-2,max:5,step:.05,unit:"m",value:b.drapeOffset,oninput:I=>{Ct(i.project,b.id).drapeOffset=I}})}),w(v,"structure","Structure","landmark",N=>{const I=t.getTopology().bridges.filter(nt=>nt.roadId===b.id),X=I.reduce((nt,R)=>nt+(R.s1-R.s0),0);E(N,"Bridge spans",I.length?`${I.length} · ${X.toFixed(0)} m deck`:"None — flag 2+ adjacent points"),A(N,"Parapet",[{value:"rail",label:"Steel rail",sub:"W-beam on posts"},{value:"wall",label:"Concrete wall",sub:"Parapet + steel band"}],b.bridgeParapet||"rail",nt=>{Ct(i.project,b.id).bridgeParapet=nt}),m(N,"Pier spacing",{min:4,max:30,step:1,unit:"m",value:b.bridgeSpacing||12,oninput:nt=>{Ct(i.project,b.id).bridgeSpacing=nt}});const q=Mt("div","btn-row",N);x(q,"Flag all","flag",()=>{i.commit("flag bridge span",nt=>{Ct(nt,b.id).points.forEach(R=>{R.bridge=!0})})}),x(q,"Clear","eraser",()=>{i.commit("clear bridge span",nt=>{Ct(nt,b.id).points.forEach(R=>{delete R.bridge})})})}),F.kind==="point"&&b.points[F.index]){const N=F.index,I=b.points[N],X=Sn(T,b.id,N),q=X||I;w(v,"point",`Point #${N+1}`,"circle-dot",nt=>{X&&Mt("div","ctl-hint",nt,`Welded to junction <b>${X.name||X.id}</b> — moving it moves every road on that node.`);const R=(tt,st,it)=>{const Et=Mt("div","ctl-row tight",nt);Mt("label","",Et,tt);const mt=Mt("div","grow",Et),Dt=_({value:q[st],step:it,unit:"m",oninput:Pt=>Ji(i.project,b.id,N,st==="x"?Pt:void 0,st==="z"?Pt:void 0,st==="y"?Pt:void 0)});mt.appendChild(Dt.box)};R("X east","x",.5),R("Z south","z",.5),R("Y height","y",.25),m(nt,"Width ×",{min:.3,max:3,step:.05,unit:"×",value:I.w||1,oninput:tt=>{Ct(i.project,b.id).points[N].w=tt}}),d(nt,"Bridge deck",!!I.bridge,tt=>{const st=Ct(i.project,b.id).points[N];tt?st.bridge=!0:delete st.bridge});const M=Mt("div","btn-row",nt);x(M,"− Before","plus",()=>ft(b,N,-1)),x(M,"+ After","plus",()=>ft(b,N,1));const j=Mt("div","btn-row",nt);x(j,"Drape point","mountain",()=>{const tt=t.getTerrain();if(!tt){u("No terrain loaded");return}const st=tt.sample(q.x,q.z);if(st==null){u("Point is outside the terrain bounds");return}i.commit("drape point",it=>{Ji(it,b.id,N,void 0,void 0,+(st+(b.drapeOffset||0)).toFixed(2))})}),X?x(j,"Unweld","unlink",()=>U(b.id),"danger"):x(j,"Delete","trash-2",()=>y(b.id,N),"danger")})}w(v,"vertical","Vertical","trending-up",N=>{const I=b.points.map(j=>j.y);I.length&&E(N,"Height range",`${Ue(Math.min(...I),1)} … ${Ue(Math.max(...I),1)} m`);const X=Mt("div","btn-row",N);x(X,"Smooth","trending-up",()=>O(b)),x(X,"Drape all","mountain",()=>V(b));const q=Mt("div","ctl-row",N);Mt("label","",q,"Flatten to");const nt=Mt("div","grow",q);nt.style.display="flex",nt.style.gap="6px";const R=_({value:I.length?I[0]:0,step:.5,unit:"m",oninput:()=>{}});nt.appendChild(R.box);const M=Mt("button","btn",nt,"Apply");M.style.cssText="width:auto;margin:0;padding:8px 14px;flex-shrink:0;",M.onclick=()=>{const j=parseFloat(R.input.value);Number.isFinite(j)&&i.commit("flatten heights",tt=>{const st=Ct(tt,b.id);st.points.forEach((it,Et)=>Ji(tt,st.id,Et,void 0,void 0,j))})},x(N,"Reverse direction","arrow-up-down",()=>B(b))}),w(v,"actions","Road actions","flag",N=>{const I=Mt("div","btn-row",N);x(I,"Duplicate","copy",()=>g(b.id)),x(I,"Delete","trash-2",()=>D(b.id),"danger"),x(N,"Zoom to road","crosshair",()=>t.zoomRoad(b.id))},{startOpen:!1}),Ln()}function ft(v,F,T){const b=Ne(i.project,v),z=b.length,N=b[F];let I;if(T<0){if(I=F>0?b[F-1]:v.closed?b[z-1]:null,!I){u("Already at the start — double-click the plan to extend");return}}else if(I=F<z-1?b[F+1]:v.closed?b[0]:null,!I){u("Already at the end — double-click the plan to extend");return}const X=T<0?F:F+1;i.commit("insert point",q=>{Ct(q,v.id).points.splice(X,0,{x:+((N.x+I.x)/2).toFixed(3),z:+((N.z+I.z)/2).toFixed(3),y:+((N.y+I.y)/2).toFixed(2),w:1})}),i.select({kind:"point",roadId:v.id,index:X})}function yt(){const v=t.getTopology(),F={ix:v.intersections.length,over:v.overpasses.length,br:v.bridges.length},T=t.getSummary(),b=t.getIssues(),z=b.filter(q=>q.severity==="error").length,N=b.filter(q=>q.severity==="warn").length,I=Number.isFinite(T.minRadius)&&T.minRadius<7?"bad":Number.isFinite(T.minRadius)&&T.minRadius<15?"warnm":"",X=T.maxGrade>.12?"bad":T.maxGrade>.08?"warnm":"";r.innerHTML=`
      <div class="metric"><i data-lucide="ruler"></i><div><div class="mm-label">Total length</div><div class="mm-val">${kr(T.length)}</div></div></div>
      <div class="metric"><i data-lucide="route"></i><div><div class="mm-label">Roads · Points</div><div class="mm-val">${T.roads} <small>· ${T.points} pts</small></div></div></div>
      <div class="metric ${I}"><i data-lucide="spline"></i><div><div class="mm-label">Min radius</div><div class="mm-val">${Number.isFinite(T.minRadius)?`${Ue(T.minRadius,1)} <small>m</small>`:"—"}</div></div></div>
      <div class="metric ${X}"><i data-lucide="trending-up"></i><div><div class="mm-label">Max grade</div><div class="mm-val">${Ue(T.maxGrade*100,1)} <small>%</small></div></div></div>
      <div class="metric"><i data-lucide="network"></i><div><div class="mm-label">Junctions</div><div class="mm-val">${F.ix} <small>· ${F.over} over · ${F.br} br</small></div></div></div>
      <div class="metric ${z?"bad":N?"warnm":""}"><i data-lucide="triangle-alert"></i><div><div class="mm-label">Validation</div><div class="mm-val">${z?`${z} <small>errors</small>`:N?`${N} <small>warnings</small>`:"<small>clean</small>"}</div></div></div>`,Ln()}const ct={select:"Drag points · Alt+click inserts · double-click extends · Del removes",draw:"Click to append · click first point to close · Enter finishes · Esc cancels",pan:"Drag to pan · wheel to zoom · F fits all"};function pt(v){const F=t.getIssues(),T=F.filter(N=>N.severity==="error").length,b=i.ui,z=[b.snapGrid?`GRID ${b.gridSize}m`:null,b.snapNode?"NODE":null].filter(Boolean).join(" · ")||"OFF";o.innerHTML=`
      <span class="stat"><i data-lucide="${i.tool==="draw"?"pen-line":i.tool==="pan"?"hand":"mouse-pointer-2"}"></i><b>${i.tool.toUpperCase()}</b></span>
      <div class="vf-sep"></div>
      <span class="hint">${ct[i.tool]}</span>
      <div class="vf-sep"></div>
      <span class="stat"><i data-lucide="crosshair"></i>${v?`<b>X ${Ue(v.x,1)}</b> · <b>Z ${Ue(v.z,1)}</b>`:"<b>—</b>"}</span>
      <div class="vf-sep"></div>
      <span class="stat"><i data-lucide="magnet"></i><b>${z}</b></span>
      <span class="spacer"></span>
      <span class="stat"><i data-lucide="triangle-alert"></i><b>${T?`${T} err`:`${F.length} issues`}</b></span>
      <div class="vf-sep"></div>
      <span class="stat">${i.dirty?"<b>● unsaved</b>":"<b>saved</b>"}</span>
      <span class="live"><span class="pulse"></span>Live</span>`,Ln()}function Lt(){e("project-name").textContent=i.project.name||"Untitled route",e("dirty-dot").hidden=!i.dirty,e("btn-undo").disabled=!i.canUndo(),e("btn-redo").disabled=!i.canRedo(),e("btn-undo").title=i.canUndo()?`Undo: ${i.undoLabel()} (Ctrl+Z)`:"Nothing to undo"}function zt(){const v=i.view;e("stage").className=`stage view-${v}`,document.querySelectorAll("#view-seg button").forEach(F=>F.classList.toggle("sel",F.dataset.view===v)),e("view3d-wrap").hidden=v==="plan",requestAnimationFrame(()=>{t.plan.redraw(),t.preview.resize()})}function ot(){document.querySelectorAll("#plan-toolbar [data-tool]").forEach(F=>F.classList.toggle("sel",F.dataset.tool===i.tool));const v=i.ui;document.querySelectorAll("#plan-toolbar [data-snap]").forEach(F=>{const T=F.dataset.snap,b=T==="grid"?v.snapGrid:T==="node"?v.snapNode:v.showIssues;F.classList.toggle("sel",!!b)}),document.querySelectorAll("#td-toolbar [data-act]").forEach(F=>{const T=F.dataset.act;T==="wire"&&F.classList.toggle("sel",!!v.wireframe),T==="spin"&&F.classList.toggle("sel",!!v.autoRotate),T==="drive"&&F.classList.toggle("sel",t.preview.driving)})}function ut(v,F,T){e("drive-capsule").hidden=!v,v&&(e("drive-road").textContent=F||"—",wt(T!==!1))}function wt(v){const F=document.querySelector('#drive-capsule [data-d="play"]');F.innerHTML=`<i data-lucide="${v?"pause":"play"}"></i>`,F.title=v?"Pause (Space)":"Resume (Space)",Ln()}function W(){const v=(i.project.name||"route").replace(/[^\w-]+/g,"-").toLowerCase();or(`${v}.road.json`,ad(i.project),"application/json"),i.markSaved(),u("Project JSON downloaded")}function G(){const v=t.getTerrain()?.sample||null,F=t.getSampleMap(),T=t.getTopology(),b=Qc(i.project,{terrain:v,samples:F,topo:T}),z=(i.project.name||"route").replace(/[^\w-]+/g,"-").toLowerCase(),N=td(i.project,{terrain:v,samples:F,topo:T});or(`${z}.obj`,N,"text/plain"),u(`OBJ exported · ${b.toLocaleString()} triangles · Y-up metres`)}function K(){const v=(i.project.name||"route").replace(/[^\w-]+/g,"-").toLowerCase();or(`${v}-centerlines.csv`,ld(i.project),"text/csv"),u("Centreline stations exported")}function dt(){document.querySelectorAll("#view-seg button").forEach(F=>F.onclick=()=>i.setView(F.dataset.view));const v=()=>t.plan?.drawing?(u("Finish the draw first — Enter keeps it, Esc cancels"),!0):!1;e("btn-undo").onclick=()=>{if(v())return;const F=i.undo();F&&u(`Undid ${F}`)},e("btn-redo").onclick=()=>{v()||i.redo()&&u("Redone")},e("btn-help").onclick=()=>{e("help").hidden=!1},e("help-close").onclick=()=>{e("help").hidden=!0},e("help").addEventListener("mousedown",F=>{F.target===e("help")&&(e("help").hidden=!0)}),e("btn-export").onclick=F=>{F.stopPropagation(),f(e("export-menu"),e("btn-export"),T=>{Mt("div","menu-cap",T,"Project"),p(T,{icon:"file-json",label:"Road project (.json)",sub:"Reloadable here + engine-readable",fn:W}),Mt("div","menu-sep",T),Mt("div","menu-cap",T,"Mesh + data"),p(T,{icon:"box",label:"Mesh (.obj)",sub:"Y-up metres, Terrain Lab convention",fn:G}),p(T,{icon:"table",label:"Centrelines (.csv)",sub:"Stations, headings, grades, radii",fn:K}),Mt("div","menu-sep",T),Mt("div","menu-cap",T,"Captures"),p(T,{icon:"map",label:"Plan capture (.png)",fn:()=>t.plan.exportPNG("road-plan.png")}),p(T,{icon:"camera",label:"3D capture (.png)",fn:()=>t.preview.screenshot("road-3d.png")})})},document.querySelectorAll("#plan-toolbar [data-tool]").forEach(F=>F.onclick=()=>i.setTool(F.dataset.tool)),document.querySelectorAll("#plan-toolbar [data-snap]").forEach(F=>F.onclick=()=>{const T=F.dataset.snap;T==="grid"?i.setUI({snapGrid:!i.ui.snapGrid}):T==="node"?i.setUI({snapNode:!i.ui.snapNode}):i.setUI({showIssues:!i.ui.showIssues})}),document.querySelector('#plan-toolbar [data-act="fit"]').onclick=()=>t.plan.fitAll(),document.querySelectorAll("#td-toolbar [data-act]").forEach(F=>F.onclick=()=>{const T=F.dataset.act;T==="orbit"||T==="top"?(document.querySelector('#td-toolbar [data-act="orbit"]').classList.toggle("sel",T==="orbit"),document.querySelector('#td-toolbar [data-act="top"]').classList.toggle("sel",T==="top"),t.preview.resetCamera(T==="top")):T==="wire"?i.setUI({wireframe:!i.ui.wireframe}):T==="spin"?i.setUI({autoRotate:!i.ui.autoRotate}):T==="drive"?t.startDrive():T==="shot"?t.preview.screenshot("road-3d.png"):T==="reset"&&t.preview.resetCamera(!1)}),document.querySelectorAll("#drive-capsule [data-d]").forEach(F=>F.onclick=()=>{const T=F.dataset.d;T==="play"?wt(t.preview.toggleDrivePlay()):T==="stop"?t.preview.stopDrive():(document.querySelectorAll("#drive-capsule [data-d]").forEach(b=>{["slow","cruise","fast"].includes(b.dataset.d)&&b.classList.toggle("sel",b===F)}),t.preview.setDriveSpeed(T==="slow"?8:T==="fast"?30:16))})}return dt(),Ln(),{renderLeft:$,renderInspector:rt,renderMetrics:yt,renderStatus:pt,refreshHeader:Lt,refreshView:zt,refreshToolbars:ot,showDrive:ut,syncDrivePlay:wt,toast:u,closeMenu:h,exportJSON:W,exportOBJ:G,exportCSV:K,deleteSelection:H,deleteRoad:D,deletePoint:y}}const cn=new Map;let Rc=[],Cc={length:0,minRadius:1/0,maxGrade:0,points:0,roads:0},Fo={intersections:[],disabled:[],overpasses:[],runs:new Map,bridges:[]},ti=null,Rl=0,Ci=null,Oo=null;function Pc(i=!1){cn.clear();let t=0;for(const e of Gt.project.roads){const n=Hi(Ne(Gt.project,e),{closed:e.closed,step:1});cn.set(e.id,n),t+=n.count}Fo=Bo(Gt.project,cn),(!i||t<8e3)&&(Rc=Yc(Gt.project,Fo)),Cc=qc(Gt.project,cn)}const Hr=Bc();let Ks=hd(),zo="";if(Hr)try{const{project:i,warnings:t}=Xr(Hr.project);Ks=i,zo=`Restored autosave from ${new Date(Hr.at).toLocaleTimeString()}${t.length?` (${t.length} repaired)`:""}`}catch{}const Gt=zc(Ks),Xe={plan:null,preview:null,getSamples:i=>cn.get(i)||null,getSampleMap:()=>cn,getTopology:()=>Fo,getIssues:()=>Rc,getSummary:()=>Cc,getTerrain:()=>ti,autosaveNote:()=>Oo?`saved ${new Date(Oo).toLocaleTimeString()}`:"pending first edit",toast:i=>Ht.toast(i),newProject(){Gt.dirty&&!window.confirm("Discard unsaved changes and start a new project?")||(we.drawing&&we.finishDraw(!0),ti=null,Gt.loadProject(Ho("Untitled route")),we.fitAll(),Ht.toast("New project — draw roads with D"))},async openProjectFile(i){try{const t=await i.text(),{project:e,warnings:n}=Xr(t);if(Gt.dirty&&!window.confirm(`Open “${i.name}”? Unsaved changes will be lost.`))return;we.drawing&&we.finishDraw(!0),await Pl(e),we.fitAll(),Ht.toast(n.length?`Opened with ${n.length} repair${n.length===1?"":"s"} — first: ${n[0]}`:`Opened ${e.name}`)}catch(t){Ht.toast(`Open failed: ${t.message}`)}},saveProjectFile(){Ht.exportJSON()},async loadSample(i){if(!(Gt.dirty&&!window.confirm("Load a sample? Unsaved changes will be lost."))){we.drawing&&we.finishDraw(!0);try{const t=await fetch(`./samples/${i}.road.json`);if(!t.ok)throw new Error(`HTTP ${t.status}`);const{project:e,warnings:n}=Xr(await t.text());await Pl(e),we.fitAll(),Ht.toast(n.length?`Sample loaded (${n.length} repairs)`:`Sample loaded: ${e.name}`)}catch(t){Ht.toast(`Sample failed: ${t.message}`)}}},async importHeightFile(i){try{const t=await dd(i),e=await new Promise((h,f)=>{const p=new Image;p.onload=()=>h(p),p.onerror=()=>f(new Error("could not decode image")),p.src=t}),n=Cl()||{minX:-160,maxX:160,minZ:-160,maxZ:160},s=e.naturalHeight/Math.max(1,e.naturalWidth),r=(n.minX+n.maxX)/2,o=(n.minZ+n.maxZ)/2,a=Math.max(60,n.maxX-n.minX+80),l={minX:r-a/2,maxX:r+a/2,minZ:o-a*s/2,maxZ:o+a*s/2},c=await Wl(t,{bounds:l,base:0,scale:30}),u={name:i.name.replace(/\.[^.]+$/,""),kind:"image",width:c.gridW,height:c.gridH,...l,base:0,scale:30,image:t};Gt.commit("import heightmap",h=>{h.heightmap=u}),es(c,u.name,"image",t),Ht.toast(`Heightmap on ${(l.maxX-l.minX).toFixed(0)}×${(l.maxZ-l.minZ).toFixed(0)} m · white = +30 m`),t.length>3e6&&Ht.toast("Note: embedded image is large — project JSON will be heavy")}catch(t){Ht.toast(`Heightmap failed: ${t.message}`)}},makeDemoHills(){const i=Cl()||{minX:-160,maxX:160,minZ:-160,maxZ:160},t=60,e={minX:i.minX-t,maxX:i.maxX+t,minZ:i.minZ-t,maxZ:i.maxZ+t},{grid:n,w:s,h:r}=Gl(e,128),o=Xs(n,s,r,e,1);Gt.commit("grow demo hills",a=>{a.heightmap={name:"Demo hills",kind:"demo",width:s,height:r,...e,base:0,scale:1,image:null}}),es(o,"Demo hills","demo",null),Ht.toast("Demo hills grown — try Drape all on a road")},clearTerrain(){ti=null,Gt.commit("remove terrain",i=>{i.heightmap=null})},gotoIssue(i){i.roadId&&Ct(Gt.project,i.roadId)&&Gt.select({kind:"road",roadId:i.roadId}),i.x!=null&&(Gt.view==="td"&&Gt.setView("split"),we.centerOn(i.x,i.z,10),Gt.ping(i.x,i.z))},gotoPoint(i,t){Gt.view==="td"&&Gt.setView("split"),we.centerOn(i,t,10),Gt.ping(i,t)},zoomRoad(i){const t=cn.get(i);if(!t||!t.count)return;let e=1/0,n=-1/0,s=1/0,r=-1/0;for(const l of t.samples)l.x<e&&(e=l.x),l.x>n&&(n=l.x),l.z<s&&(s=l.z),l.z>r&&(r=l.z);const o=document.getElementById("plan").getBoundingClientRect(),a=Math.min((o.width-120)/Math.max(10,n-e),(o.height-120)/Math.max(10,r-s));Gt.view==="td"&&Gt.setView("split"),we.centerOn((e+n)/2,(s+r)/2,Math.min(60,Math.max(.5,a)))},startDrive(){const i=Gt.project;let t=Gt.selection.roadId&&Ct(i,Gt.selection.roadId)&&cn.get(Gt.selection.roadId)?.count?Gt.selection.roadId:null;if(!t){let e=0;for(const[n,s]of cn)s.length>e&&Ct(i,n)?.visible!==!1&&(e=s.length,t=n)}if(!t){Ht.toast("Draw a road first — nothing to drive");return}Gt.view==="plan"&&Gt.setView("td"),requestAnimationFrame(()=>{const e=Ct(Gt.project,t);hn.drive(t,16)&&(Ht.showDrive(!0,e?.name||t,!0),Ht.toast(`Driving ${e?.name||""} — Esc exits`))})}};function Cl(){let i=1/0,t=-1/0,e=1/0,n=-1/0,s=!1;for(const r of cn.values())for(const o of r.samples||[])s=!0,o.x<i&&(i=o.x),o.x>t&&(t=o.x),o.z<e&&(e=o.z),o.z>n&&(n=o.z);return s?{minX:i,maxX:t,minZ:e,maxZ:n}:null}function es(i,t,e,n){Rl++,ti={sample:i.sample,bounds:i.bounds,minY:i.minY,maxY:i.maxY,w:i.gridW,h:i.gridH,rev:Rl,name:t,kind:e,image:n||null},Gt.notify("project")}async function Lc(i){if(!i){ti=null;return}try{if(i.kind==="demo"){const{grid:t,w:e,h:n}=Gl({minX:i.minX,maxX:i.maxX,minZ:i.minZ,maxZ:i.maxZ},128);es(Xs(t,e,n,{minX:i.minX,maxX:i.maxX,minZ:i.minZ,maxZ:i.maxZ},1),i.name||"Demo hills","demo",null)}else if(i.image){const t=await Wl(i.image,{bounds:{minX:i.minX,maxX:i.maxX,minZ:i.minZ,maxZ:i.maxZ},base:i.base||0,scale:i.scale||30});es(t,i.name||"heightmap","image",i.image)}else if(i.grid){const t=Float32Array.from(i.grid);es(Xs(t,i.width,i.height,{minX:i.minX,maxX:i.maxX,minZ:i.minZ,maxZ:i.maxZ},1),i.name||"heightmap","image",null)}else ti=null}catch(t){console.error(t),Ht.toast("Embedded heightmap could not be decoded — starting flat"),ti=null}}async function Pl(i){Gt.loadProject(i),await Lc(i.heightmap),Gt.notify("project")}const we=fd(document.getElementById("plan"),Gt,{getSamples:Xe.getSamples,getIssues:Xe.getIssues,getTerrain:Xe.getTerrain,getTopology:Xe.getTopology,toast:i=>Ht.toast(i),onCursor:(i,t)=>{Ci=i==null?null:{x:i,z:t},Ht.renderStatus(Ci)}});Xe.plan=we;const hn=Bg(document.getElementById("view3d"),Gt,{getSamples:Xe.getSamples,getSampleMap:Xe.getSampleMap,getTopology:Xe.getTopology,getTerrain:Xe.getTerrain,toast:i=>Ht.toast(i),onDriveState:i=>{Ht.showDrive(i),Ht.refreshToolbars()}});Xe.preview=hn;const Ht=e_(Gt,Xe);let Ll=0,Dl=0;const Il=()=>{clearTimeout(Ll),Ll=setTimeout(()=>hn.refresh(),140)},n_=()=>{clearTimeout(Dl),Dl=setTimeout(()=>{Gt.autosave()&&(Oo=Date.now(),Ht.renderLeft())},900)};Gt.subscribe(i=>{i==="project"||i==="project-live"?(Pc(i==="project-live"),Ht.renderMetrics(),Ht.renderStatus(Ci),Il(),i==="project"&&(Ht.renderLeft(),Ht.renderInspector(),Ht.refreshHeader(),n_())):i==="selection"?(Ht.renderLeft(),Ht.renderInspector(),Ht.renderStatus(Ci)):i==="tool"?(Ht.refreshToolbars(),Ht.renderStatus(Ci)):i==="view"?(Ht.refreshView(),Ht.refreshToolbars(),Gt.view==="plan"&&hn.driving&&hn.stopDrive(),Gt.view!=="plan"&&Il()):i==="ui"?(Ht.refreshToolbars(),Ht.renderStatus(Ci)):i==="saved"&&Ht.refreshHeader()});document.getElementById("file-road").addEventListener("change",i=>{const t=i.target.files[0];i.target.value="",t&&Xe.openProjectFile(t)});document.getElementById("file-height").addEventListener("change",i=>{const t=i.target.files[0];i.target.value="",t&&Xe.importHeightFile(t)});window.addEventListener("keydown",i=>{const t=/^(input|textarea|select)$/i.test(i.target?.tagName||"")||i.target?.isContentEditable;if(hn.driving&&(i.code==="Space"||i.key==="Escape")){i.preventDefault(),i.code==="Space"?Ht.syncDrivePlay(hn.toggleDrivePlay()):hn.stopDrive();return}if(we.drawing&&((i.ctrlKey||i.metaKey)&&["z","y"].includes(i.key.toLowerCase())||!i.ctrlKey&&!i.metaKey&&(i.key==="Delete"||i.key==="Backspace"))){i.preventDefault(),Ht.toast("Finish the draw first — Enter keeps it, Esc cancels");return}if((i.ctrlKey||i.metaKey)&&i.key.toLowerCase()==="z"){if(i.preventDefault(),t&&i.target.blur(),i.shiftKey)Gt.redo()&&Ht.toast("Redone");else{const e=Gt.undo();e?Ht.toast(`Undid ${e}`):Ht.toast("Nothing to undo")}return}if((i.ctrlKey||i.metaKey)&&i.key.toLowerCase()==="y"){i.preventDefault(),Gt.redo()&&Ht.toast("Redone");return}if((i.ctrlKey||i.metaKey)&&i.key.toLowerCase()==="s"){i.preventDefault(),Ht.exportJSON();return}if(!t){if(i.key==="Escape"){Ht.closeMenu(),document.getElementById("help").hidden=!0;return}switch(i.key.toLowerCase()){case"v":Gt.setTool("select");break;case"d":Gt.setTool("draw");break;case"h":Gt.setTool("pan");break;case"f":we.fitAll();break;case"1":Gt.setView("plan");break;case"2":Gt.setView("split");break;case"3":Gt.setView("td");break;case"?":document.getElementById("help").hidden=!1;break;case"delete":case"backspace":i.preventDefault(),Ht.deleteSelection?.(i.shiftKey);break}}});window.addEventListener("beforeunload",i=>{Gt.dirty&&i.preventDefault()});Pc();Ht.renderLeft();Ht.renderInspector();Ht.renderMetrics();Ht.renderStatus(null);Ht.refreshHeader();Ht.refreshView();Ht.refreshToolbars();requestAnimationFrame(()=>{we.fitAll(),hn.refresh(),hn.resetCamera(!1)});(async()=>(Ks.heightmap&&await Lc(Ks.heightmap),zo&&Ht.toast(zo)))();
