// Geometric design targets, not a jurisdiction-specific standard or load rating.
export const DEFAULT_BRIDGE_GRADE = 0.083;
export const DEFAULT_BRIDGE_BLEND = 3;

// Integrate a trapezoidal gradient: parabolic toe and crest transitions,
// constant gradient between them. Height and first derivative are continuous.
export function approachProfile(
  height,
  run,
  requestedBlend = DEFAULT_BRIDGE_BLEND,
) {
  if (
    ![height, run, requestedBlend].every(Number.isFinite) ||
    height < 0 ||
    run <= 0 ||
    requestedBlend <= 0
  )
    throw Error("Invalid bridge approach");
  const blend = Math.min(requestedBlend, run / 2),
    grade = height / (run - blend);
  return {
    run,
    blend,
    grade,
    heightAt(x) {
      if (x <= 0) return 0;
      if (x >= run) return height;
      if (x < blend) return (grade * x * x) / (2 * blend);
      if (x > run - blend)
        return height - (grade * (run - x) ** 2) / (2 * blend);
      return grade * (x - blend / 2);
    },
    slopeAt(x) {
      if (x <= 0 || x >= run) return 0;
      return grade * Math.min(1, x / blend, (run - x) / blend);
    },
  };
}

export function requiredApproachRun(
  height,
  targetGrade,
  requestedBlend = DEFAULT_BRIDGE_BLEND,
) {
  if (
    ![height, targetGrade, requestedBlend].every(Number.isFinite) ||
    height < 0 ||
    targetGrade <= 0 ||
    requestedBlend <= 0
  )
    throw Error("Invalid bridge design target");
  const basic = height / targetGrade;
  return basic + Math.min(basic, requestedBlend);
}
