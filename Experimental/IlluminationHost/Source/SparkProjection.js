// Metal fragments inherit part of the sliding material's velocity. They trail a moving chassis in
// its frame, but a stationary spinning rim still sprays in its tread-slip direction.
export function ProjectSparkEmitter(Spark)
{
    const Source = Spark.Normal || [0,0,1];
    const Length = Math.hypot(...Source) || 1;
    const N = Source.map(C=>C/Length);
    const V = Spark.Velocity;
    const Approach = V[0]*N[0]+V[1]*N[1]+V[2]*N[2];
    const Tangent = V.map((C,I)=>C-Approach*N[I]);
    const Speed = Math.hypot(...Tangent);
    const Throw = Math.min(5,0.12*Speed);
    const Lift = 0.6+Math.min(2,0.04*Speed);
    return {Position:Spark.Point.map((C,I)=>C+0.03*N[I]),Normal:N,
        Velocity:Tangent.map((C,I)=>0.3*C+C/Math.max(.3,Speed)*Throw+Lift*N[I]),
        Rate:300*Spark.Strength,Temperature:2150,Spread:0.7+Math.min(2,.05*Speed),
        Lift:0,Gravity:1,Life:.6};
}

// Local tangent fan and OUTWARD normal jitter, for road and wall contacts alike.
export function SampleScrapeFan(Normal, A, B, Outward)
{
    let T=[Normal[2],0,-Normal[0]];
    const L=Math.hypot(...T);
    T=L>1e-6?T.map(C=>C/L):[1,0,0];
    const N=Normal;
    const U=[N[1]*T[2]-N[2]*T[1],N[2]*T[0]-N[0]*T[2],N[0]*T[1]-N[1]*T[0]];
    return T.map((C,I)=>C*A+U[I]*B+N[I]*Math.abs(Outward));
}
