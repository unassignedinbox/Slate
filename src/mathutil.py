"""Minimal vector / quaternion / geometry math (no third-party deps)."""
import math

# ---------------------------------------------------------------- vectors
def vadd(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def vsub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def vmul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def vdot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])
def vlen(a): return math.sqrt(vdot(a, a))
def vnorm(a):
    l = vlen(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)
def vlerp(a, b, t): return (a[0] + (b[0] - a[0]) * t,
                            a[1] + (b[1] - a[1]) * t,
                            a[2] + (b[2] - a[2]) * t)

# ------------------------------------------------------------ quaternions
# quaternions stored as (x, y, z, w)  -- glTF order
def q_id(): return (0.0, 0.0, 0.0, 1.0)

def q_axis(axis, ang):
    ax = vnorm(axis)
    s = math.sin(ang * 0.5)
    return (ax[0] * s, ax[1] * s, ax[2] * s, math.cos(ang * 0.5))

def qx(a): return q_axis((1, 0, 0), a)
def qy(a): return q_axis((0, 1, 0), a)
def qz(a): return q_axis((0, 0, 1), a)

def q_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)

def q_rot(q, v):
    x, y, z, w = q
    u = (x, y, z)
    return vadd(vadd(vmul(u, 2.0 * vdot(u, v)),
                     vmul(v, w * w - vdot(u, u))),
                vmul(vcross(u, v), 2.0 * w))

def q_from_to(a, b):
    """shortest-arc rotation taking unit vector a to unit vector b"""
    a, b = vnorm(a), vnorm(b)
    d = vdot(a, b)
    if d > 0.999999:
        return q_id()
    if d < -0.999999:
        axis = vcross((0, 0, 1), a)
        if vlen(axis) < 1e-6:
            axis = vcross((0, 1, 0), a)
        return q_axis(axis, math.pi)
    c = vcross(a, b)
    q = (c[0], c[1], c[2], 1.0 + d)
    l = math.sqrt(sum(k * k for k in q))
    return tuple(k / l for k in q)

# ---------------------------------------------------------------- easing
def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

def ease_in_out(t):
    return smoothstep(t)

def lerp(a, b, t): return a + (b - a) * t

def hash01(i, j=0):
    """deterministic pseudo-random in [0,1)"""
    n = (i * 374761393 + j * 668265263) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFF) / float(0x1000000)
