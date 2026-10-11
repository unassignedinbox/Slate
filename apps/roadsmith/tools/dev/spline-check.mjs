import { Curve } from '../../src/core/spline.js';
// straight line through 4 colinear points must measure exactly its chord length
const c = new Curve([{x:0,y:0,z:0},{x:40,y:0,z:0},{x:80,y:0,z:0},{x:120,y:0,z:0}]);
console.log('straight length (expect 120):', c.length.toFixed(4));
const p = c.pointAt(60); console.log('midpoint (expect 60,0,0):', p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3));
// quarter circle radius 50 -> length ~78.54
const pts=[]; for(let i=0;i<=4;i++){const a=i/4*Math.PI/2;pts.push({x:Math.cos(a)*50,y:0,z:Math.sin(a)*50});}
const c2 = new Curve(pts);
console.log('arc length (expect ~78.5):', c2.length.toFixed(3));
const k = c2.curvatureAt(39, 2); console.log('curvature (expect ~0.02):', Math.abs(k).toFixed(4));
const f = c2.frameAt(0); console.log('frame tangent at 0:', f.t.x.toFixed(2), f.t.z.toFixed(2), 'right:', f.right.x.toFixed(2), f.right.z.toFixed(2));
