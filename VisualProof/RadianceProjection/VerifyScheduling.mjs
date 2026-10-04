//============================================================================================================================================
//                                                         VERIFYSCHEDULING.MJS
//============================================================================================================================================
// 📦 Verifies refresh ordering, equal-budget response, idle reuse and off-screen aging without a graphics device.

import Assert from 'node:assert/strict';
import { ProbeScheduler } from '../../Frontier/Experimental/RadianceProjection/ProbeScheduler.js';
const Weights = Array.from({length:48}, (_, Index) => Index >= 20 && Index < 28 ? 180 : 10);
function Resolve(Prioritized)
{
    const Schedule = new ProbeScheduler(48), Arrival = new Map();
    Schedule.Invalidate(0,4);
    let Commands = 0;
    for (let Frame = 1; Frame <= 60; ++Frame)
    {
        const Selection = Schedule.Select(4,Frame,Weights,Prioritized);
        Assert.equal(new Set(Selection).size,Selection.length);
        Assert(Selection.length<=4);
        Selection.forEach(Index=>
        {
            if (!Arrival.has(Index)) Arrival.set(Index,Frame);
            Schedule.Complete(Index,Frame); ++Commands;
        });
    }
    Assert.equal(Arrival.size,48,'Distant probes must not be omitted');
    if (Prioritized)
    {
        Assert.equal(Commands,192,'Exactly four captures per probe after settling');
        Assert.equal(Schedule.QueryPending(),0);
        Assert.deepEqual(Schedule.Select(4,61,Weights),[],'Static cache must stop capturing');
        Schedule.Request(47,62);
        Assert.deepEqual(Schedule.Select(4,63,Weights),[47],'Inspector can refresh an idle distant probe');
        Schedule.Complete(47,63);
        Schedule.Invalidate(64,1);
        Assert.equal(Schedule.QueryPending(),48,'Lighting changes invalidate the whole field');
    }
    return {hotLast:Math.max(...Array.from({length:8},(_, Index)=>Arrival.get(Index+20))),Commands};
}
const Priority=Resolve(true), Baseline=Resolve(false);
Assert(Priority.hotLast<Baseline.hotLast);
const Continuous = new ProbeScheduler(48), Last = new Array(48).fill(0), Gaps = [];
for(let Frame=1;Frame<=240;++Frame)
{
    Continuous.Invalidate(Frame,4);
    Continuous.Select(4,Frame,Weights).forEach(Index=>
    {Gaps.push(Frame-Last[Index]);Last[Index]=Frame;Continuous.Complete(Index,Frame);});
}
Assert(Last.every(Frame=>Frame>210),'Continuous nearby motion starved distant probes');
Assert(Math.max(...Gaps)<=38,'Aging deadline exceeded');
console.log(JSON.stringify({Priority,Baseline,maximumContinuousGap:Math.max(...Gaps),result:'PASS'},null,2));
