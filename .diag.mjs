import { renderSteady } from './tools/offline.js';
import { magnitudeSpectrum, peakIn, refinePeak } from './tools/fft.js';

const CASES=[['gtr-nismo',[2000,4000,6500],6],['p918',[3000,6000,8500],8],['laferrari',[3000,6000,9000],12],['spyder-718',[2500,5000,7500],6]];
const analyse=(b)=>{const d=b.getChannelData(0);const s=d.subarray(d.length>>1);return{mags:magnitudeSpectrum(s),sr:b.sampleRate};};
const peaksIn=(mags,sr,lo,hi,minR)=>{const bin=sr/(mags.length*2);const a=Math.max(2,Math.floor(lo/bin)),b=Math.min(mags.length-2,Math.ceil(hi/bin));
 let mx=0;for(let i=a;i<=b;i++)mx=Math.max(mx,mags[i]);const out=[];
 for(let i=a+1;i<b;i++)if(mags[i]>mags[i-1]&&mags[i]>=mags[i+1]&&mags[i]>mx*minR){const p=mags[i-1],q=mags[i],r=mags[i+1],dn=p-2*q+r,sh=dn?0.5*(p-r)/dn:0;out.push({f:(i+sh)*bin,m:q});}
 return out.sort((x,y)=>y.m-x.m);};

console.log('dry renders: peak-based on-series fraction at two detection thresholds');
console.log('case                          f0err    5%-thr  12%-thr  subFund');
for(const [id,rpms,cyl] of CASES) for(const rpm of rpms){
  const {buffer}=await renderSteady({carId:id,rpm,throttle:1,seconds:2.5,reverb:0});
  const {mags,sr}=analyse(buffer); const fFire=rpm*cyl/120;
  const frac=(minR)=>{const pk=peaksIn(mags,sr,40,8000,minR).slice(0,10);
    const on=pk.filter(p=>{const n=p.f/fFire;return Math.abs(n-Math.round(n))/Math.max(1,Math.round(n))<0.035;});
    return pk.length? on.length/pk.length : 1;};
  const fund=refinePeak(mags,sr,fFire,8);
  const mx=peakIn(mags,sr,40,8000).mag, sub=peakIn(mags,sr,40,fFire*0.85).mag;
  console.log(`${id.padEnd(12)}@${String(rpm).padStart(4)} ${fFire.toFixed(0).padStart(5)}Hz  ${(100*Math.abs(fund.freq-fFire)/fFire).toFixed(2)}%   ${(frac(0.05)*100).toFixed(0).padStart(4)}%   ${(frac(0.12)*100).toFixed(0).padStart(4)}%   ${(100*sub/mx).toFixed(1).padStart(5)}%`);
}
