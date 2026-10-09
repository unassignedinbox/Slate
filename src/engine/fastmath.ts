// Math.pow with a runtime exponent is surprisingly slow on hot paths (a full
// C++ call per sample). Erosion passes raise millions of numbers to a fixed
// power, so the curve is tabulated once and interpolated instead.

export class PowLut {
  private readonly table: Float32Array;
  private readonly scale: number;
  private readonly last: number;

  constructor(
    private readonly exponent: number,
    max: number,
    size = 2048,
  ) {
    this.table = new Float32Array(size + 2);
    this.scale = size / Math.max(1e-6, max);
    this.last = size;
    for (let i = 0; i <= size + 1; i++) {
      const x = i / this.scale;
      this.table[i] = Math.pow(x, exponent);
    }
  }

  at(x: number): number {
    if (x <= 0) return 0;
    const t = x * this.scale;
    if (t >= this.last) return Math.pow(x, this.exponent);
    const i = t | 0;
    const f = t - i;
    const a = this.table[i];
    return a + (this.table[i + 1] - a) * f;
  }
}
