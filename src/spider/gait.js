// Alternating-tetrapod gait bookkeeping.
//
// Spiders coordinate their eight legs into two diagonal groups of four
// that alternate stance/swing — "two walking quadrupeds in series"
// (Biancardi et al. 2011, J. Exp. Biol.). Group membership below follows
// that literature: {L1, L3, R2, R4} vs {R1, R3, L2, L4}.
export function legGroup(pairIndex, side) {
  const s = side > 0 ? 1 : 0;
  return (pairIndex + s) % 2; // 0 or 1
}

export const GAIT = {
  dutyFactor: 0.58,      // fraction of the cycle each leg spends planted
  strideLenFactor: 0.85, // ideal foot reach as a fraction of total leg length
  liftHeight: 0.028,     // peak foot lift during swing, in meters (scaled by leg size)
  cycleLenMeters: 0.16,  // ground distance covered per full gait cycle at reference speed
};
