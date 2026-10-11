"""Garments for the browser client, fitted to this kit's own body.

Written in the vocabulary of art/tools/ashford_garments (lofts, ribbons, frames along a bone chain,
weights sampled from the body at a bind copy of the garment), but measured against the analytic
body in body.py instead of a vendor mesh, so a garment is a function of `Dims` and works for the
female, male and child builds without per-build tuning.

Material slots (the browser maps a costume palette onto these): Cloth (primary), Under (the
lower/inner layer and collars), Accent (sash, trim, cord), Metal (gold, iron), Leather, Fur, Hem (worn cloth).
"""
import math

import bmesh
import bpy
from mathutils import Vector

from ashford_lib import (TAU, Build, bind_pose_object, frames_along, loft, normalise_weights, ribbon, ring_points, smooth_and_finish,
                          transfer_weights, tube_along)
from body import layout, torso_rings, arm_rings, mirror

SLOTS = ['Cloth', 'Under', 'Accent', 'Metal', 'Leather', 'Fur', 'Hem']
# Regions as (accent, under, wear) triples for the loft helpers; extra kinds ride in `wear` >= 2.
CLOTH = (0.0, 0.0, 0.25)
HEM = (0.0, 0.0, 1.0)
ACCENT = (1.0, 0.0, 0.15)
UNDER = (0.0, 1.0, 0.1)
METAL = (0.0, 0.0, 2.0)
LEATHER = (0.0, 0.0, 3.0)
FUR = (0.0, 0.0, 4.0)


def slot_of(region):
    accent, under, wear = region
    if accent > 0.5:
        return SLOTS.index('Accent')
    if under > 0.5:
        return SLOTS.index('Under')
    if wear >= 3.5:
        return SLOTS.index('Fur')
    if wear >= 2.5:
        return SLOTS.index('Leather')
    if wear >= 1.5:
        return SLOTS.index('Metal')
    return SLOTS.index('Hem') if wear >= 0.7 else SLOTS.index('Cloth')


def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * max(0.0, min(1.0, t))


class Fit:
    """Body measurements a garment needs, sampled from the same analytic figure the body was built from."""

    def __init__(self, d):
        self.d = d
        self.H = d.height
        self.j = layout(d)
        self.rings = torso_rings(d)
        self.zs = [c.z for c, _, _ in self.rings]
        self.c = d.sex == 'c'
        self.floor = 0.0
        self.waist_z = d.waist
        self.neck_z = d.neck_base
        self.shoulder_z = d.shoulder_z
        self.ankle_z = d.ankle
        self.hip_z = d.hip
        self.knee_z = d.knee

    def torso(self, z):
        cy, rx, ry = self._torso(z)
        H = self.H
        # The child body is intentionally rounder through the hips than the
        # adult torso rings.  Give every child garment a small, continuous
        # side clearance so the lower kosode cannot reveal bare wedges while
        # still following the same canonical body measurements.
        if self.c:
            rx += 0.012 * H
            ry += 0.010 * H
        if self.d.sex == 'f':
            # The body's bust and glute bumps stand proud of the base rings; give the cloth the same room, front and back.
            front = 0.028 * H * math.exp(-((z - 0.706 * H) ** 2) / (2 * (0.032 * H) ** 2))
            back = 0.018 * H * math.exp(-((z - 0.530 * H) ** 2) / (2 * (0.036 * H) ** 2))
            cy = cy - front / 2 + back / 2
            ry = ry + front / 2 + back / 2
        else:
            front = 0.012 * H * math.exp(-((z - 0.72 * H) ** 2) / (2 * (0.05 * H) ** 2))
            cy -= front / 2
            ry += front / 2
        return cy, rx, ry

    def _torso(self, z):
        """(cy, rx, ry) of the body's trunk at height z; below the crotch it stays at the hip width."""
        zs = self.zs
        if z <= zs[0]:
            c, rx, ry = self.rings[0]
            return c.y, rx / 0.72, ry / 0.78 if z >= zs[0] - 0.15 else ry
        if z >= zs[-1]:
            c, rx, ry = self.rings[-1]
            return c.y, rx, ry
        for (c0, rx0, ry0), (c1, rx1, ry1) in zip(self.rings, self.rings[1:]):
            if c0.z <= z <= c1.z:
                t = (z - c0.z) / (c1.z - c0.z)
                return lerp(c0.y, c1.y, t), lerp(rx0, rx1, t), lerp(ry0, ry1, t)
        return 0.0, 0.12, 0.08

    def arm(self, side='l'):
        m = (lambda v: v) if side == 'l' else mirror
        j = self.j
        return [m(j['shoulder']), m(j['elbow']), m(j['wrist'])]

    def arm_radius(self, s):
        H = self.H
        # radius of the arm at fraction s along shoulder->wrist (matches arm_rings)
        if s < 0.5:
            return lerp(0.033 * H, 0.025 * H, s / 0.5)
        return lerp(0.025 * H, 0.0165 * H, (s - 0.5) / 0.5)


def ring(fit, z, ease, segs=28, power=2.4, kx=1.0, ky=1.0, dy=0.0, modulate=None):
    cy, rx, ry = fit.torso(z)
    return ring_points(0.0, cy + dy, z, (rx + ease) * kx, (ry + ease) * ky, segs, power=power, modulate=modulate)


def bind_ring(fit, z, segs=28):
    cy, rx, ry = fit.torso(z)
    return ring_points(0.0, cy, z, rx * 0.96, ry * 0.96, segs, power=2.4)


def torso_wrap(fit, b, z_top, z_hem, ease=0.020, hem_flare=0.0, hem_taper=0.0, region_hem=HEM, segs=28, steps=None, extra_ease=None, dy_hem=0.0, kx_hem=1.0):
    """The body of a kosode: follows the trunk to the hip, then falls straight (with optional flare/taper) to the hem."""
    z_hip = fit.d.hip - 0.02 * fit.H
    n = steps or 12
    fine = [z_top - k * 0.014 * fit.H for k in range(7)]      # dense at the yoke, where the silhouette matters most
    zs = fine + [lerp(fine[-1], z_hem, (i + 1) / n) for i in range(n)]
    rings, binds, regions = [], [], []
    for z in zs:
        below = max(0.0, (z_hip - z) / max(0.05, (z_hip - z_hem)))
        e = ease + (extra_ease(z) if extra_ease else 0.0)
        cy, rx, ry = fit.torso(max(z, z_hip))
        # From the hip down, hold the hip width and let flare/taper act.
        width = rx + e + hem_flare * below - hem_taper * below
        # The yoke: follow the rounded top of the shoulder (the arm's own first ring), then slope in to the collar.
        H = fit.H
        zc_arm, r_arm, sx = fit.shoulder_z - 0.020 * H, 0.034 * H + 0.5 * e, fit.d.shoulder_x
        neck_w, z_neck = 0.038 * H + e, fit.neck_z + 0.010 * H
        if z > fit.d.chest:
            dz = z - zc_arm
            cover = sx + math.sqrt(max(0.0, r_arm * r_arm - dz * dz)) if abs(dz) < r_arm else 0.0
            top = zc_arm + r_arm
            if z > top:
                slope = lerp(sx + 0.01 * H, neck_w, smooth01((z - top) / max(1e-4, z_neck - top)))
                width = max(neck_w, slope) if z < z_neck else neck_w
            else:
                width = max(width, cover)
        depth = ry + e + hem_flare * below * 0.8 - hem_taper * below * 0.6
        rings.append(ring_points(0.0, cy + dy_hem * below, z, width * (1 + (kx_hem - 1) * below), depth, segs, power=2.4))
        binds.append(bind_ring(fit, max(z, z_hip - 0.0), segs) if z >= z_hip else [Vector((p.x * 0.55, p.y, z)) for p in bind_ring(fit, z_hip, segs)])
        regions.append(region_hem if z < z_hem + 0.10 * fit.H else CLOTH)
    return loft(b, rings, binds, regions, close_top=False, close_bottom=False, flip=True)


def sleeve(fit, b, side, wide=0.0, length=1.0, ease=0.012, hang_k=0.0, cuff=False, region=CLOTH, segs=12, samples=9, hang_len=0.0):
    pts = fit.arm(side)
    if length < 1.0:
        # shorten by moving the last point back along the chain
        wr = pts[2]
        pts = [pts[0], pts[1], pts[1].lerp(wr, length if length > 0.5 else 0.0)] if length > 0.5 else [pts[0], pts[0].lerp(pts[1], max(0.3, length * 2))]
    frames = frames_along(pts, samples)
    def radius(s):
        return fit.arm_radius(min(1.0, s)) + ease + wide * (s ** 1.5)
    def hang(s):
        return 1.0 + hang_k * (s ** 2.0)
    def bind_radius(s):
        return min(0.055 * fit.H, fit.arm_radius(min(1.0, s)) * 0.95)
    regions = lambda s: region
    # Cap the shoulder start so the sleeve cannot expose a dark triangular hole
    # where it meets the torso shell during posed motion.
    return tube_along(b, frames, radius, regions_of=regions, hang=hang, bind_radius_of=bind_radius, segments=segs, close_start=True, close_end=False)


def collar(fit, b, z_neck, z_waist, ease, region=ACCENT, under=True, width=0.030, lift=0.006):
    """The crossed front: two bands from the throat to the waist, left over right, plus a pale under-collar."""
    def surface(z, angle):
        cy, rx, ry = fit.torso(z)
        rxx, ryy = rx + ease, ry + ease
        s, c = math.sin(angle), math.cos(angle)
        sx = math.copysign(abs(s) ** (2 / 2.4), s) if s else 0.0
        sy = math.copysign(abs(c) ** (2 / 2.4), c) if c else 0.0
        p = Vector((rxx * sx, cy - ryy * sy, z))
        n = Vector((sx / max(rxx, 1e-4), -sy / max(ryy, 1e-4), 0.0))
        return p, (n.normalized() if n.length > 1e-6 else Vector((0, -1, 0)))
    N = 10
    def path(t0, t1, dz=0.0):
        pts, nrm = [], []
        for i in range(N):
            s = i / (N - 1)
            z = lerp(z_neck, z_waist, s)
            # the V: from a narrow angle at the throat to the centre-line at the waist
            angle = lerp(t0, t1, s ** 0.9)
            p, n = surface(z, angle)
            pts.append(p); nrm.append(n)
        return pts, nrm
    A, An = path(-0.30, 0.10)     # over-panel edge, running from the figure's right neck to the left waist
    B, Bn = path(0.30, -0.08)     # inner edge
    if under:
        Ub, Ubn = path(0.22, -0.16)
        ribbon(b, Ub, lambda s: 0.010 + 0.006 * (1 - s), lambda s: lift * 0.4, lambda i: Ubn[i], UNDER)
    ribbon(b, B, lambda s: width * 0.75, lambda s: lift, lambda i: Bn[i], region)
    ribbon(b, A, lambda s: width, lambda s: lift * 1.6, lambda i: An[i], region)


def obi(fit, b, z_c, height, ease=0.018, region=ACCENT, segs=28):
    cy, rx, ry = fit.torso(z_c)
    rings, binds, regs = [], [], []
    for k, dz in enumerate((-0.5, -0.5, 0.5, 0.5)):
        z = z_c + dz * height
        cy, rx, ry = fit.torso(z)
        e = ease + (0.006 if k in (1, 2) else 0.0)
        rings.append(ring_points(0.0, cy, z, rx + e, ry + e, segs))
        binds.append(bind_ring(fit, z, segs))
        regs.append(region)
    # The band is lofted as a thick closed tube so both faces are solid.
    loft(b, rings, binds, regs, close_bottom=False, close_top=False, flip=True)


def bow(fit, b, z_c, size=1.0, region=ACCENT, tails=True, loops=2):
    """A back bow: two flattened loops, a knot, and hanging tails, all standing off the sash."""
    H = fit.H
    cy, rx, ry = fit.torso(z_c)
    back = cy + ry + 0.035
    def blob(cx, cz, w, h, d, rot=0.0, reg=region):
        rings, binds = [], []
        for k in range(5):
            u = (k / 4) * 2 - 1
            wr = w * math.sqrt(max(0.0, 1 - u * u)) + 0.002
            pts, bp = [], []
            for i in range(12):
                t = TAU * i / 12
                x = cx + u * h * math.sin(rot) + math.cos(t) * wr * math.cos(rot) * 0.5
                z = cz + u * h * math.cos(rot) - math.cos(t) * wr * math.sin(rot) * 0.5
                y = back + math.sin(t) * d * (0.4 + 0.6 * (1 - abs(u)))
                pts.append(Vector((x, y, z)))
                bp.append(Vector((x * 0.3, cy + ry * 0.9, z)))
            rings.append(pts); binds.append(bp)
        loft(b, rings, binds, [reg] * 5, close_bottom=True, close_top=True, flip=False)
    s = size
    if loops >= 1:
        blob(0.055 * s, z_c + 0.01 * H, 0.05 * s, 0.06 * s, 0.02 * s, rot=0.5)
        blob(-0.055 * s, z_c + 0.01 * H, 0.05 * s, 0.06 * s, 0.02 * s, rot=-0.5)
    if loops >= 2:
        blob(0.045 * s, z_c - 0.02 * H, 0.035 * s, 0.075 * s, 0.018 * s, rot=1.15)
        blob(-0.045 * s, z_c - 0.02 * H, 0.035 * s, 0.075 * s, 0.018 * s, rot=-1.15)
    blob(0, z_c, 0.03 * s, 0.03 * s, 0.028 * s)
    if tails:
        for sg, dx in ((1, 0.02), (-1, -0.02)):
            path = [Vector((dx * s + sg * 0.01 * k, back + 0.012 + 0.002 * k, z_c - 0.02 * H - k * 0.06 * s)) for k in range(6)]
            ribbon(b, path, lambda t: 0.028 * s * (1 + 0.5 * t), lambda t: 0.0, lambda i: Vector((0, 1, 0)), region, across_of=lambda i: Vector((1, 0, 0)))


def skirt_panel(fit, b, z_top, z_bot, ease, region=CLOTH, kx=1.0, segs=28, flare=0.0, pleat=0.0, dy=0.0):
    n = 12
    rings, binds, regs = [], [], []
    for i in range(n + 1):
        z = lerp(z_top, z_bot, i / n)
        cy, rx, ry = fit.torso(max(z, fit.d.hip - 0.02 * fit.H))
        u = i / n
        rr = rx + ease + flare * u
        mod = (lambda t, u=u: 1.0 + pleat * u * math.sin(t * 14)) if pleat else None
        rings.append(ring_points(0.0, cy + dy * u, z, rr * kx, ry + ease + flare * u * 0.8, segs, power=2.4, modulate=mod))
        binds.append(bind_ring(fit, max(z, fit.d.hip - 0.02 * fit.H), segs) if z >= fit.d.hip else [Vector((p.x * 0.55, p.y, z)) for p in bind_ring(fit, fit.d.hip, segs)])
        regs.append(HEM if u > 0.9 else region)
    loft(b, rings, binds, regs, close_top=False, close_bottom=False, flip=True)


def leg_tubes(fit, b, z_top, z_bot, side_ease=0.012, hem_r=None, region=UNDER, taper=True, segs=16):
    """Trouser legs: a tube down each leg from the waist, following the leg's own axis."""
    H = fit.H
    j = fit.j
    for s in ('l', 'r'):
        m = (lambda v: v) if s == 'l' else mirror
        hp, kn, an = m(j['hip']), m(j['knee']), m(j['ankle'])
        def axis(z):
            if z >= kn.z:
                t = (z - kn.z) / max(1e-4, hp.z - kn.z)
                return kn.lerp(hp, t)
            t = (z - an.z) / max(1e-4, kn.z - an.z)
            return an.lerp(kn, t)
        def rad(z):
            if z >= kn.z:
                t = (z - kn.z) / max(1e-4, hp.z - kn.z)
                return lerp(0.036 * H, 0.055 * H, t)
            t = (z - an.z) / max(1e-4, kn.z - an.z)
            return lerp(0.021 * H, 0.038 * H, t)
        n = 11
        rings, binds, regs = [], [], []
        for i in range(n + 1):
            z = lerp(z_top, z_bot, i / n)
            c = axis(z)
            r = rad(z) + side_ease + ((hem_r - rad(z_bot)) * (i / n) ** 2 if hem_r else 0.0)
            rings.append(ring_points(c.x, c.y, z, r, r * 1.02, segs))
            binds.append(ring_points(c.x, c.y, z, rad(z) * 0.95, rad(z) * 0.95, segs))
            regs.append(HEM if i > n - 2 else region)
        loft(b, rings, binds, regs, close_top=False, close_bottom=False, flip=True)


def cuff_band(fit, b, side, s_at, width, region=ACCENT, ease=0.014):
    pts = fit.arm(side)
    frames = frames_along(pts, 12)
    sel = [f for f in frames if abs(f[4] - s_at) <= width]
    if len(sel) < 2:
        return
    tube_along(b, sel, lambda s: fit.arm_radius(s) + ease, regions_of=lambda s: region, bind_radius_of=lambda s: min(0.05 * fit.H, fit.arm_radius(s) * 0.95), segments=12)


# ------------------------------------------------------------------------------------------------
# Garments (each returns a Build)
# ------------------------------------------------------------------------------------------------

def g_kosode(fit, sleeve_kind='narrow', hem=None, region=CLOTH, obi_h=0.075, collar_on=True, layered=False, bow_size=1.0, loops=2):
    H = fit.H
    b = Build()
    hem_z = hem if hem is not None else fit.ankle_z + 0.02 * H
    top = fit.neck_z + 0.005 * H
    torso_wrap(fit, b, top, hem_z, ease=0.020 + (0.006 if layered else 0.0), hem_flare=0.012, region_hem=HEM, extra_ease=lambda z: 0.0)
    if layered:
        # An under-layer showing at the hem and cuffs.
        torso_wrap(fit, b, fit.d.hip - 0.02 * H, hem_z - 0.02 * H, ease=0.012, hem_flare=0.010, region_hem=UNDER)
    collar(fit, b, fit.neck_z + 0.004 * H, fit.waist_z - 0.03 * H, 0.020 + (0.006 if layered else 0.0))
    for s in ('l', 'r'):
        if sleeve_kind == 'narrow':
            sleeve(fit, b, s, wide=0.0, ease=0.012, region=region)
        elif sleeve_kind == 'wide':
            sleeve(fit, b, s, wide=0.045 * H / 1.66, ease=0.014, hang_k=3.5 * H / 1.66, region=region)
        elif sleeve_kind == 'furisode':
            sleeve(fit, b, s, wide=0.06 * H / 1.66, ease=0.014, hang_k=7.0 * H / 1.66, region=region, hang_len=0.5)
        cuff_band(fit, b, s, 0.96, 0.05, region=UNDER if layered else ACCENT)
    obi(fit, b, fit.waist_z + 0.005 * H, obi_h * H / 1.66, region=ACCENT, ease=0.034 + (0.006 if layered else 0.0))
    bow(fit, b, fit.waist_z + 0.005 * H, size=bow_size * H / 1.66, loops=loops)
    return b


def g_hakama(fit, upper_region=CLOTH, sleeve_kind='narrow', obi_h=0.06):
    H = fit.H
    b = Build()
    # Short kosode to the hip, then a wide pleated hakama from the waist.
    torso_wrap(fit, b, fit.neck_z + 0.005 * H, fit.d.hip - 0.05 * H, ease=0.018, region_hem=HEM)
    collar(fit, b, fit.neck_z + 0.004 * H, fit.waist_z - 0.03 * H, 0.018)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.0 if sleeve_kind == 'narrow' else 0.03 * H / 1.66, ease=0.012, hang_k=0.0 if sleeve_kind == 'narrow' else 2.0, region=upper_region)
        cuff_band(fit, b, s, 0.96, 0.05, region=ACCENT)
    skirt_panel(fit, b, fit.waist_z + 0.03 * H, fit.ankle_z + 0.015 * H, 0.030, region=UNDER, flare=0.055 * H / 1.66, pleat=0.05)
    obi(fit, b, fit.waist_z + 0.03 * H, obi_h * H / 1.66, region=ACCENT)
    return b


def g_tunic_trousers(fit, apron=False, long_tunic=True):
    H = fit.H
    b = Build()
    hem = fit.d.hip - (0.055 if long_tunic else 0.02) * H
    torso_wrap(fit, b, fit.neck_z + 0.005 * H, hem, ease=0.020, hem_flare=0.006, region_hem=HEM)
    collar(fit, b, fit.neck_z + 0.004 * H, fit.waist_z - 0.02 * H, 0.020, region=UNDER, under=False, width=0.014)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.0, ease=0.012)
        cuff_band(fit, b, s, 0.97, 0.04, region=LEATHER)
    leg_tubes(fit, b, fit.hip_z + 0.02 * H, fit.ankle_z + 0.05 * H, side_ease=0.012, region=UNDER)
    # Belt.
    cy, rx, ry = fit.torso(fit.waist_z)
    loft(b, [ring_points(0, cy, fit.waist_z + dz, rx + 0.024, ry + 0.024, 24) for dz in (-0.018 * H, 0.018 * H)],
         [bind_ring(fit, fit.waist_z + dz, 24) for dz in (-0.018 * H, 0.018 * H)], [LEATHER, LEATHER], flip=True)
    if apron:
        # A bib apron: a panel hanging from a neck strap over the chest to the knee, tied at the waist.
        cy, rx, ry = fit.torso(fit.waist_z)
        top = fit.d.chest - 0.02 * H
        bot = fit.knee_z + 0.05 * H
        rings, binds = [], []
        n = 10
        for i in range(n + 1):
            z = lerp(top, bot, i / n)
            cyz, rxz, ryz = fit.torso(max(z, fit.d.hip - 0.02 * H))
            half = (0.055 + 0.05 * (i / n)) * H / 1.66 if z > fit.d.hip else (0.09 * H / 1.66)
            row = [Vector((x, cyz - ryz - 0.024 - 0.004 * math.sin(k * 0.6), z)) for k, x in enumerate([-half + 2 * half * kk / 8 for kk in range(9)])]
            rings.append(row)
            binds.append([Vector((p.x * 0.5, cyz - ryz * 0.9, z)) for p in row])
        # a flat panel built as quads
        base = []
        for r_i, (row, brow) in enumerate(zip(rings, binds)):
            base.append([b.add(p, bp, HEM if r_i == n else (UNDER if False else (0.0, 0.0, 0.1))) for p, bp in zip(row, brow)])
        for r_i in range(n):
            for k in range(8):
                b.quad(base[r_i][k], base[r_i][k + 1], base[r_i + 1][k + 1], base[r_i + 1][k], uv=[(k / 8, r_i / n), ((k + 1) / 8, r_i / n), ((k + 1) / 8, (r_i + 1) / n), (k / 8, (r_i + 1) / n)])
        # neck strap and waist tie
        strap_path = [Vector((sg * 0.05 * H / 1.66 * (1 - 0.3 * s), fit.torso(top + s * (fit.neck_z - top))[0] - fit.torso(top + s * (fit.neck_z - top))[2] - 0.02 - 0.0, top + s * (fit.neck_z - top))) for s in [i / 6 for i in range(7)] for sg in (1,)]
        ribbon(b, strap_path, lambda t: 0.012, lambda t: 0.0, lambda i: Vector((0, -1, 0)), LEATHER, across_of=lambda i: Vector((1, 0, 0)))
    return b


def g_coat(fit, length='knee'):
    H = fit.H
    b = Build()
    hem = fit.knee_z - 0.02 * H if length == 'knee' else fit.ankle_z + 0.1 * H
    torso_wrap(fit, b, fit.neck_z + 0.012 * H, hem, ease=0.026, hem_flare=0.04, region_hem=HEM)
    # High standing collar.
    cy, rx, ry = fit.torso(fit.neck_z)
    loft(b, [ring_points(0, cy, fit.neck_z + z, 0.052 * H / 1.66 + 0.012, 0.055 * H / 1.66 + 0.012, 20) for z in (-0.005 * H, 0.030 * H)],
         [ring_points(0, cy, fit.neck_z + z, 0.04 * H / 1.66, 0.04 * H / 1.66, 20) for z in (-0.005 * H, 0.030 * H)], [ACCENT, ACCENT], flip=True)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.006, ease=0.016)
        cuff_band(fit, b, s, 0.96, 0.06, region=LEATHER)
    leg_tubes(fit, b, fit.hip_z + 0.02 * H, fit.ankle_z + 0.04 * H, side_ease=0.010, region=UNDER)
    # Belt with a buckle plate.
    cy, rx, ry = fit.torso(fit.waist_z)
    loft(b, [ring_points(0, cy, fit.waist_z + dz, rx + 0.036, ry + 0.036, 24) for dz in (-0.022 * H, 0.022 * H)],
         [bind_ring(fit, fit.waist_z + dz, 24) for dz in (-0.022 * H, 0.022 * H)], [LEATHER, LEATHER], flip=True)
    return b


def g_ragged(fit):
    H = fit.H
    b = Build()
    # Several overlapping wraps of uneven length with torn hems.
    for k, (drop, ease) in enumerate(((0.05, 0.030), (0.14, 0.022), (0.22, 0.016))):
        n = 12
        rings, binds, regs = [], [], []
        z_top = fit.neck_z + 0.005 * H if k == 0 else fit.chest_z if hasattr(fit, 'chest_z') else fit.d.chest
        z_hem = fit.knee_z - drop * H + 0.08 * H
        for i in range(n + 1):
            z = lerp(z_top, z_hem, i / n)
            cy, rx, ry = fit.torso(max(z, fit.d.hip - 0.02 * H))
            mod = (lambda t, i=i, k=k: 1.0 + (0.10 * math.sin(t * 7 + k * 2) + 0.06 * math.sin(t * 13)) * (i / n) ** 2)
            rr = rx + ease + 0.02 * (i / n)
            rings.append(ring_points(0, cy, z - 0.03 * H * (i / n) * (0.5 + 0.5 * math.sin(k)), rr, ry + ease, 26, modulate=mod))
            binds.append(bind_ring(fit, max(z, fit.d.hip - 0.02 * H), 26) if z >= fit.d.hip else [Vector((p.x * 0.55, p.y, z)) for p in bind_ring(fit, fit.d.hip, 26)])
            regs.append(HEM if i > n - 3 else CLOTH)
        loft(b, rings, binds, regs, flip=True)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.01, ease=0.014, region=HEM, length=0.6)
    leg_tubes(fit, b, fit.hip_z + 0.02 * H, fit.knee_z - 0.06 * H, side_ease=0.012, region=HEM)
    return b


def g_fur_mantle(fit, thickness=0.05):
    """A fur shoulder mantle: a thick collar-cape with a tufted hem."""
    H = fit.H
    b = Build()
    n = 7
    rings, binds, regs = [], [], []
    z_top = fit.neck_z + 0.012 * H
    z_bot = fit.d.chest - 0.02 * H
    for i in range(n + 1):
        u = i / n
        z = lerp(z_top, z_bot, u)
        cy, rx, ry = fit.torso(z)
        wide = (rx + 0.04 + 0.10 * H / 1.66 * math.sin(min(1, u * 1.4) * 1.4)) * (1.0 + 0.0)
        mod = lambda t, u=u: 1.0 + 0.05 * u * math.sin(t * 20)
        rings.append(ring_points(0, cy, z, wide, ry + 0.030 + 0.05 * u * H / 1.66 * 0.6, 32, power=2.0, modulate=mod))
        binds.append(bind_ring(fit, z, 32))
        regs.append(FUR)
    loft(b, rings, binds, regs, close_top=False, flip=True)
    return b


def g_ascetic(fit):
    H = fit.H
    b = Build()
    # Diagonal wrap across the chest, bare arms, a long lower wrap.
    torso_wrap(fit, b, fit.d.chest + 0.05 * H, fit.d.hip - 0.02 * H, ease=0.016, region_hem=HEM)
    skirt_panel(fit, b, fit.waist_z + 0.02 * H, fit.ankle_z + 0.03 * H, 0.020, region=UNDER, flare=0.02 * H / 1.66, pleat=0.02)
    obi(fit, b, fit.waist_z + 0.005 * H, 0.05 * H / 1.66, region=ACCENT)
    # A shoulder cloth on one side.
    sleeve(fit, b, 'l', wide=0.03, ease=0.014, length=0.5, region=CLOTH)
    return b


def g_ceremonial(fit):
    H = fit.H
    b = Build()
    torso_wrap(fit, b, fit.neck_z + 0.008 * H, fit.floor + 0.004, ease=0.034, hem_flare=0.10 * H / 1.66, region_hem=HEM)
    torso_wrap(fit, b, fit.d.chest, fit.floor + 0.004, ease=0.024, hem_flare=0.07 * H / 1.66, region_hem=UNDER) if False else None
    collar(fit, b, fit.neck_z + 0.004 * H, fit.waist_z - 0.03 * H, 0.034, width=0.028)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.06 * H / 1.66, ease=0.018, hang_k=5.0 * H / 1.66)
        cuff_band(fit, b, s, 0.96, 0.05, region=ACCENT)
    obi(fit, b, fit.waist_z + 0.02 * H, 0.10 * H / 1.66, region=ACCENT, ease=0.030)
    return b


def g_lamellar(fit):
    H = fit.H
    b = Build()
    # Under-kimono, then a stepped lamellar cuirass and skirt of lacquered plates over it.
    torso_wrap(fit, b, fit.neck_z + 0.005 * H, fit.d.hip - 0.02 * H, ease=0.016, region_hem=CLOTH)
    for s in ('l', 'r'):
        sleeve(fit, b, s, wide=0.0, ease=0.012)
    skirt_panel(fit, b, fit.waist_z + 0.02 * H, fit.ankle_z + 0.02 * H, 0.024, region=UNDER, flare=0.05 * H / 1.66, pleat=0.04)
    # Cuirass plates: stacked stepped rings.
    z0, z1 = fit.waist_z - 0.04 * H, fit.d.chest + 0.07 * H
    n = 9
    for i in range(n):
        za = lerp(z1, z0, i / n)
        zb = lerp(z1, z0, (i + 1) / n)
        cy, rxa, rya = fit.torso(za)
        cy2, rxb, ryb = fit.torso(zb)
        rings = [ring_points(0, cy, za, rxa + 0.030, rya + 0.030, 28), ring_points(0, cy2, zb + 0.004, rxb + 0.036, ryb + 0.036, 28)]
        binds = [bind_ring(fit, za, 28), bind_ring(fit, zb, 28)]
        loft(b, rings, binds, [METAL if i % 3 == 0 else (0.0, 0.0, 3.0), METAL if i % 3 == 0 else (0.0, 0.0, 3.0)], flip=True)
    # Shoulder guards: layered curved plates hung along the upper arm.
    for s in ('l', 'r'):
        pts = fit.arm(s)
        frames = frames_along([pts[0], pts[0].lerp(pts[1], 0.55)], 4)
        for k in range(3):
            sub = frames[max(0, k):k + 2] if k < 3 else frames[-2:]
            tube_along(b, sub, lambda t, k=k: 0.06 * H / 1.66 + 0.010 * k, regions_of=lambda t: (0.0, 0.0, 3.0), hang=lambda t: 1.0, bind_radius_of=lambda t: 0.04 * H / 1.66, segments=12)
    return b


REGISTRY = {
    'work_kimono': lambda f: g_kosode(f, 'narrow', hem=f.knee_z - 0.03 * f.H),
    'layered_kimono': lambda f: g_kosode(f, 'wide', layered=True, loops=2),
    'formal_kimono': lambda f: g_kosode(f, 'wide', layered=True, loops=2, obi_h=0.09, bow_size=1.15),
    'hakama_set': lambda f: g_hakama(f),
    'dancer_wrap': lambda f: g_kosode(f, 'wide', layered=False, hem=f.knee_z + 0.02 * f.H, loops=1),
    'travel_coat': lambda f: g_coat(f),
    'lamellar_armour': lambda f: g_lamellar(f),
    'ceremonial_robe': lambda f: g_ceremonial(f),
    'apron_over_tunic': lambda f: g_tunic_trousers(f, apron=True),
    'tunic_trousers': lambda f: g_tunic_trousers(f),
    'ragged_layers': lambda f: g_ragged(f),
    'fur_mantle': lambda f: g_tunic_trousers(f),
    'ascetic_wrap': lambda f: g_ascetic(f),
    'fur_mantle_piece': lambda f: g_fur_mantle(f),
    'furisode_hero': lambda f: g_kosode(f, 'furisode', layered=True, loops=2, obi_h=0.10, bow_size=1.5),
}


# ------------------------------------------------------------------------------------------------
# Objects
# ------------------------------------------------------------------------------------------------

def to_object(build, name):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in build.verts], [], [tuple(f) for f in build.faces])
    mesh.validate(verbose=False)
    mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    loop = 0
    for face, coords in zip(build.faces, build.uvs):
        for k in range(len(face)):
            if loop < len(uv.data):
                uv.data[loop].uv = coords[k] if k < len(coords) else (0.0, 0.0)
            loop += 1
    for slot in SLOTS:
        m = bpy.data.materials.get('TV_' + slot) or bpy.data.materials.new('TV_' + slot)
        mesh.materials.append(m)
    if len(mesh.polygons) == len(build.faces):
        for i, face in enumerate(build.faces):
            mesh.polygons[i].material_index = slot_of(build.regions[face[0]])
    else:
        print('TV_WARN', name, len(build.faces), '->', len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def orient_outward(obj, body):
    """Make every face point away from the body: a garment is a shell around the figure, and an open shell has no inside to infer from,
    so ask the body itself (nearest surface point) which way is out. Backface-culled engines show a wrongly wound face as a hole."""
    from mathutils.bvhtree import BVHTree
    bm_body = bmesh.new()
    bm_body.from_mesh(body.data)
    bm_body.transform(body.matrix_world)
    tree = BVHTree.FromBMesh(bm_body)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    flip = []
    for f in bm.faces:
        c = f.calc_center_median()
        loc, nrm, idx, dist = tree.find_nearest(c)
        if loc is None:
            continue
        away = c - loc
        if away.length < 1e-6:
            continue
        if f.normal.dot(away) < 0:
            flip.append(f)
    bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(obj.data)
    bm.free()
    bm_body.free()
    return len(flip)


def finish(obj):
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0008)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def make_garment(kind, fit, body, arm, name=None):
    build = REGISTRY[kind](fit)
    obj = to_object(build, name or f'G_{kind}')
    proxy = bind_pose_object(build, 'proxy')
    transfer_weights(obj, proxy, [body])
    normalise_weights(obj, limit=4)
    finish(obj)
    orient_outward(obj, body)
    obj.parent = arm
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    mod.use_vertex_groups = True
    obj['tv_part'] = 'garment'
    obj['tv_garment'] = kind
    return obj
