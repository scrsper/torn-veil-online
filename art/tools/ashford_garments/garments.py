"""The Ashford garment vocabulary.

Each function here is one piece of the culture's clothing, written as the shape a tailor would
describe rather than as a mesh. They compose: a resident is a body plus a kosode plus a lower
garment plus an obi plus footwear, and any of those can be swapped without touching the others.

## What was read off the reference sheets

`art/reference/cultures/ashford/characters/` -- hana, yuki, kaito, shogun, and the ren / ayami /
shiro / ascetic sheet. Eight characters, five sheets, and what they share is more useful than what
makes each distinct:

* **Silhouette.** A crossed-front wrapped upper garment, left over right, with a deep V at the
  throat and a soft collar band framing it. Below it, volume: either a divided pleated trouser
  that reads almost as a skirt (kaito, the ronin, the monk) or a long wrapped lower layer that
  falls straight to the ankle (hana, yuki, the kitsune).
* **Waist.** Always emphasised and always a separate colour. Every single figure has a broad
  sash at the waist, and on every single figure it is the brightest thing they are wearing.
* **Sleeves.** Two registers, and they track status rather than sex. Workers and fighters wear a
  narrow tube sleeve to the wrist; the high-status and ceremonial figures wear a wide sleeve that
  hangs well below the arm.
* **Layering.** An under-layer shows as a thin pale line inside the collar on every figure --
  even the monk, whose outer layer is itself bone-white.
* **Footwear.** Thonged sandals on a raised wooden sole, or flat straw ones. Never a closed shoe.
  Split-toe foot coverings appear under both.
* **Palette.** Deep charcoal ground, one saturated accent (crimson, vermilion, gold, or in the
  kitsune's case pale blue), and a warm metal note. Workers substitute indigo, hemp and ochre for
  the crimson and keep everything else.
* **Wear.** The fighters and the monk are visibly dirty at the hem and the knee, clean at the
  shoulder -- which is where gravity and work actually put dirt.

None of that is a copy of any one sheet. It is the grammar the eight of them share, which is what
a settlement of 127 people needs.

## What was deliberately not taken

The off-shoulder necklines (hana, yuki, the dancer) are not in this set. They are the strongest
single read on those two sheets and they are wrong for v0.1: an open neckline is relying on the
MetaHuman face mesh to supply chest skin, and the vendor's own open necklines stop at z=1.405 --
about the collarbone. Every kosode here closes at the throat, which is also what an ordinary
resident of a cold farming settlement would actually wear. The dramatic necklines belong to a
bespoke named-character pass, not to the wardrobe that dresses everybody.

Armour is not here either. Kaito's lamellar and the ronin's cuirass are a separate slot the
resolver already asks for, and building them would double this slice without dressing one extra
resident.
"""
import math

from mathutils import Vector

from ashford_lib import (TAU, Build, frames_along, loft, ribbon, ring_points, tube_along)

# Which cloth each part of a garment is made of, as (accent, under, wear). `ashford_lib.region_slot`
# turns these into one of four material slots -- Cloth, Hem, Accent, Under -- which is how the
# engine finally receives them. They are written as vertex colours too, and that encoding is the
# one that reads best here: a hem is not a different cloth from a body panel, it is the same cloth
# with more dirt on it, and `wear` says so as a matter of degree.
#
#   accent  the palette's accent colour: collar band, obi, sandal thong
#   under   the pale under-layer showing inside the collar; never the garment colour
#   wear    how far wear is allowed to dirty this area -- high at a hem and a knee, low at a
#           shoulder, because that is where dirt actually collects
CLOTH = (0.0, 0.0, 0.25)
ACCENT = (1.0, 0.0, 0.15)
UNDER = (0.0, 1.0, 0.1)
HEM = (0.0, 0.0, 1.0)
KNEE = (0.0, 0.0, 0.8)


def _lerp(a, b, t):
    return a + (b - a) * max(0.0, min(1.0, t))


# The cross-section every piece shares. Body tubes are lofted from `ring_points`, which is a
# superellipse; bands laid on top of them have to be evaluated on the *same* curve. They were not,
# and a plain ellipse is up to 6 mm narrower than a 2.4-power superellipse at 20-45 degrees off
# axis -- enough for a collar with a 17 mm lift to sink inside the cloth it sits on over part of
# its run and surface again over the rest, which is why the collar rendered as broken shards.
def _on_surface(rx, ry, angle, z, cy=-0.02, power=2.4):
    s, c = math.sin(angle), math.cos(angle)
    sx = math.copysign(abs(s) ** (2.0 / power), s) if s else 0.0
    sy = math.copysign(abs(c) ** (2.0 / power), c) if c else 0.0
    point = Vector((rx * sx, cy - ry * sy, z))
    normal = Vector((sx / max(rx, 1e-4), -sy / max(ry, 1e-4), 0.0))
    return point, (normal.normalized() if normal.length > 1e-6 else Vector((0, -1, 0)))


class Fit:
    """Everything a garment needs to know about one build, read from its own bind pose."""

    def __init__(self, armature, surface, sex):
        self.sex = sex
        self.surface = surface
        self.bone = {b.name: (armature.matrix_world @ b.head_local) for b in armature.data.bones}
        self.tail = {b.name: (armature.matrix_world @ b.tail_local) for b in armature.data.bones}
        self.pelvis_z = self.bone['pelvis'].z
        self.neck_z = self.bone['neck_01'].z
        self.chest_z = self.bone['spine_04'].z
        self.waist_z = self.bone['spine_03'].z        # the natural waist on this rig
        self.ankle_z = self.bone['foot_l'].z
        # Where every lower garment is tied, and therefore where the kosode has to stop being
        # loose and start being tucked. Sharing one line between the pieces is what stops a
        # kosode hem from pushing through a hakama that was authored independently of it.
        self.tuck_z = self.waist_z + 0.035
        self.floor = 0.0

        lo, hi = surface.span.get('torso', (self.pelvis_z, self.neck_z))
        # The torso surface stops at the vendor top's own hem and collar. Below and above it there
        # is nothing to hit, and a ray that misses would silently fall back to a default, so the
        # query height is clamped into the range that exists and the garment extrapolates from
        # the last real reading instead of from a guess.
        self.torso_lo, self.torso_hi = lo + 0.01, hi - 0.02
        self._sections = {}
        # The neck itself, not the vendor top's neckline. The vendor section is clamped at that
        # top's upper edge, which on these rigs is a wide collar: a kosode read from it stood
        # 5-8 cm off the neck and its collar band rendered as a stiff brace. Half-axes are an
        # ordinary adult neck; the depth is measured from the rings' shared centre (y = -0.02)
        # to the rig's actual neck bone, which sits further back than the chest.
        half_width, half_depth = (0.050, 0.055) if sex == 'female' else (0.058, 0.062)
        self.neck_half = (half_width, half_depth + abs(self.bone['neck_01'].y - (-0.02)))

    def neck(self, ease):
        """Half-axes of a ring around the neck at the rings' shared centre, plus `ease`."""
        return self.neck_half[0] + ease, self.neck_half[1] + ease

    def torso(self, z, ease_x, ease_y, cy=-0.02):
        """Half-axes for a torso ring at height z: the vendor surface plus the ease a wrapped
        robe hangs with."""
        key = round(min(max(z, self.torso_lo), self.torso_hi), 3)
        if key not in self._sections:
            section = self.surface.section(key, 0.0, cy, samples=24, limb='torso', default=0.11)
            # Index 0 is the front, 6 the figure's left, 12 the back, 18 the right.
            side = max(section[5:8] + section[17:20])
            depth = max(section[0:2] + section[23:24] + section[11:14])
            self._sections[key] = (side, depth)
        side, depth = self._sections[key]
        return side + ease_x, depth + ease_y

    def arm_chain(self, side='l'):
        return [self.bone['upperarm_%s' % side], self.bone['lowerarm_%s' % side],
                self.bone['hand_%s' % side]]

    def leg_chain(self, side='l'):
        return [self.bone['thigh_%s' % side], self.bone['calf_%s' % side],
                self.bone['foot_%s' % side]]


# ------------------------------------------------------------------------------------------
# Kosode -- the garment everybody wears
# ------------------------------------------------------------------------------------------

def kosode(fit, wide_sleeve=False, segments=24):
    """The wrapped upper garment. Hip length on everyone.

    Length is a deliberate constraint rather than a shortcut: making every kosode end at the hip
    means the lower garment always supplies the silhouette below the waist, so a kosode and a
    hakama, or a kosode and a long wrapped skirt, can be combined freely without one passing
    through the other. Status is carried by the sleeve and the cloth, not by the hem.
    """
    build = Build()
    hem_z = fit.pelvis_z - 0.095
    collar_z = fit.neck_z - 0.012

    def ease_at(z):
        """How far off the body the cloth sits at height z.

        Two regimes with a short blend between them. Above the tuck line the kosode is a loose
        wrapped robe and hangs 2-4 cm clear. Below it the garment is inside the hakama or the
        wrapped skirt, so it is pulled in tight -- which is what tucking a garment in physically
        does, and is the only reason a kosode hem authored on its own does not burst through a
        hakama waist authored on its own.
        """
        above = max(0.0, min(1.0, (z - fit.tuck_z + 0.06) / 0.10))
        loose_x = _lerp(0.030, 0.011, max(0.0, min(1.0, (z - fit.tuck_z) / (collar_z - fit.tuck_z))))
        loose_y = _lerp(0.027, 0.010, max(0.0, min(1.0, (z - fit.tuck_z) / (collar_z - fit.tuck_z))))
        return _lerp(0.007, loose_x, above), _lerp(0.006, loose_y, above)

    def surface_at(z, lift=0.0):
        ex, ey = ease_at(z)
        rx, ry = fit.torso(z, ex + lift, ey + lift)
        # Over the last 6 cm the cloth closes in on the neck itself (smoothstep), so the neckline
        # and the collar band on it lie against the throat instead of the vendor's wide collar.
        t = max(0.0, min(1.0, (z - (collar_z - 0.06)) / 0.06))
        t = t * t * (3.0 - 2.0 * t)
        if t > 0.0:
            nx, ny = fit.neck(0.014 + lift)
            rx, ry = max(nx, _lerp(rx, nx, t)), max(ny, _lerp(ry, ny, t))
        return rx, ry

    heights, rings, binds, regions, profile = [], [], [], [], []
    steps = 17
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(hem_z, collar_z, t)
        rx, ry = surface_at(z)
        bx, by = fit.torso(z, 0.004, 0.004)
        rings.append(ring_points(0.0, -0.02, z, rx, ry, segments))
        binds.append(ring_points(0.0, -0.02, z, bx, by, segments))
        regions.append(HEM if t < 0.10 else CLOTH)
        heights.append(z)
        profile.append((z, rx, ry))
    loft(build, rings, binds, regions, v_scale=3.0, close_top=False)

    def tube_at(z, lift=0.0):
        """The radius of the tube *as lofted*, not as the continuous function it was sampled
        from. Between two rings the mesh is a straight chord, and where the torso narrows fast --
        6 cm over the last 4 cm below the jaw -- that chord bulges well outside the curve. A
        collar placed on the curve therefore dips in and out of its own garment, which rendered
        as a run of disconnected tabs down the chest. Interpolating the same way the loft does
        keeps every band exactly `lift` proud of the cloth it sits on.
        """
        if z <= profile[0][0]:
            rx, ry = profile[0][1], profile[0][2]
        elif z >= profile[-1][0]:
            rx, ry = profile[-1][1], profile[-1][2]
        else:
            rx, ry = profile[-1][1], profile[-1][2]
            for (z0, x0, y0), (z1, x1, y1) in zip(profile, profile[1:]):
                if z0 <= z <= z1:
                    k = (z - z0) / max(1e-6, z1 - z0)
                    rx, ry = x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
                    break
        return rx + lift, ry + lift

    # A rolled hem, so the bottom edge has thickness and does not show a hole from below.
    hx, hy = surface_at(heights[0])
    inner = ring_points(0.0, -0.02, heights[0] + 0.012, hx - 0.010, hy - 0.010, segments)
    loft(build, [rings[0], inner], [binds[0], binds[0]], [HEM, HEM], v_scale=1.0, flip=True)
    # Closed at the neck, against the collar: the top ring pinches in to the neck rather than
    # leaving an open cylinder for the camera to look down.
    nx, ny = fit.neck(0.008)
    neck = ring_points(0.0, -0.02, collar_z + 0.012, nx, ny, segments)
    loft(build, [rings[-1], neck], [binds[-1], binds[-1]], [CLOTH, UNDER], v_scale=1.0)

    _collar(fit, build, collar_z, tube_at)
    _front_overlap(fit, build, hem_z, collar_z, tube_at)
    for side in ('l', 'r'):
        _sleeve(fit, build, side, wide=wide_sleeve)
    return build


def _collar(fit, build, collar_z, surface_at):
    """The eri: a band running from the back of the neck, over each shoulder, and down across the
    chest to the waist, left crossing over right.

    Plus a pale under-collar a centimetre inside it. That second band is worth its 60 triangles:
    a thin light line inside the collar is the detail that reads as *layers of cloth* rather than
    as a dress with a stripe on it, and it is present on all eight reference figures including
    the two whose outer layer is itself pale.
    """
    # Stops above the waist, not at it. Everyone in this culture wears a sash, the sash is always
    # wider than the collar is deep, and a collar that ran to the tuck line would simply be
    # swallowed by it -- which is exactly what the first version did.
    bottom_z = fit.tuck_z + 0.075
    start_z = collar_z - 0.042

    # Two pieces, not one continuous band, and that is a modelling decision rather than a
    # simplification. Carried over the shoulder as one path, the band's width direction has to
    # rotate from vertical (round the neck) to horizontal (down the chest) across a body that is
    # modelled as a vertical tube with no shoulder slope in it. There is no orientation that is
    # right for both, and every attempt produced a flat flap standing off the shoulder. Splitting
    # it lets each half be right, and the 2 cm of kosode between them reads as the collar
    # disappearing under itself, which is what it does on a real garment.
    for lift, width, region, inset in ((0.026, 0.021, ACCENT, 0.0), (0.015, 0.015, UNDER, 0.013)):
        # No separate band round the back of the neck. Laid on a neckline that closes onto the
        # neck, it rendered as a flat plank across the nape -- the view a third-person camera
        # shows most. The closure ring (UNDER) already reads as the collar at the back.
        if BACK_NECK_BAND:
            _back_neck_band(build, collar_z, surface_at, lift, width, region, inset)
        _front_bands(fit, build, collar_z, start_z, bottom_z, surface_at, lift, width, region, inset)


BACK_NECK_BAND = False


def _back_neck_band(build, collar_z, surface_at, lift, width, region, inset):
    if True:
        # The band round the back of the neck: width measured up the neck, so it lies flat.
        neck_path, neck_normals = [], []
        steps = 21
        for i in range(steps):
            angle = _lerp(0.70, TAU - 0.70, i / (steps - 1))
            z = collar_z - 0.012 - inset * 0.5
            rx, ry = surface_at(z, lift)
            point, normal = _on_surface(rx, ry, angle, z)
            neck_path.append(point)
            neck_normals.append(normal)
        ribbon(build, neck_path, width_of=lambda t: width * 0.92, lift_of=lambda t: 0.001,
               across_of=lambda i: Vector((0.0, 0.0, 1.0)),
               normal_of=lambda i: neck_normals[i], region=region, v_scale=2.0)


def _front_bands(fit, build, collar_z, start_z, bottom_z, surface_at, lift, width, region, inset):
    if True:
        # The front V: from the front of each shoulder, down and across the chest.
        for direction in (1.0, -1.0):
            path, normals, angles = [], [], []
            steps = 14
            for i in range(steps):
                t = i / (steps - 1)
                angle = direction * _lerp(0.82, -0.26, t)
                z = _lerp(start_z, bottom_z, t ** 1.05) - inset * 0.5
                rx, ry = surface_at(z, lift)
                point, normal = _on_surface(rx, ry, angle, z)
                path.append(point)
                normals.append(normal + Vector((0.0, 0.0, 0.06)))
                angles.append(angle)

            def across(i, angles=angles, path=path):
                """Width measured on the body's surface, in the plane spanned by 'round the body'
                and 'up'. Built from the angle/height parameters rather than from the world-space
                tangent, which is what keeps it stable where the torso is flaring."""
                nxt, prv = min(i + 1, len(path) - 1), max(i - 1, 0)
                circumferential = Vector((math.cos(angles[i]), math.sin(angles[i]), 0.0))
                d_angle = angles[nxt] - angles[prv]
                d_z = path[nxt].z - path[prv].z
                along = circumferential * (d_angle * 0.16) + Vector((0.0, 0.0, d_z))
                along = along.normalized() if along.length > 1e-6 else Vector((0, 0, 1))
                return along.cross(Vector((math.sin(angles[i]), -math.cos(angles[i]), 0.0)))

            ribbon(build, path,
                   width_of=lambda t: width * _lerp(0.90, 1.05, t),
                   lift_of=lambda t: 0.001, across_of=across,
                   normal_of=lambda i: normals[i], region=region)


def _front_overlap(fit, build, hem_z, collar_z, surface_at):
    """The diagonal seam where the left panel lies over the right. One strip of cloth standing a
    few millimetres off the body tube, which is enough to catch a highlight and read as a wrap."""
    path, normals = [], []
    steps = 8
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(fit.tuck_z - 0.02, hem_z + 0.03, t)
        angle = _lerp(-0.30, -0.10, t)
        rx, ry = surface_at(z, 0.004)
        point, normal = _on_surface(rx, ry, angle, z)
        path.append(point)
        normals.append(normal)
    ribbon(build, path, width_of=lambda t: 0.009, lift_of=lambda t: 0.002,
           normal_of=lambda i: normals[i], region=CLOTH)


def _sleeve(fit, build, side, wide):
    """A kimono sleeve is a rectangle of cloth folded over the arm, not a tube cut to the arm.

    Both registers are the same construction; the wide one simply lets the lower half of each
    ring fall further. Narrow is the working sleeve -- a farmer with a hanging sleeve cannot
    farm -- and wide is what the reference sheets put on anyone who does not work with their
    hands.
    """
    chain = fit.arm_chain(side)
    shoulder = chain[0]
    # The root goes *horizontally* inward, not back along the arm. Following the bone direction
    # inboard also travels steeply upward -- this is an A-pose, so 17 cm along the arm axis is
    # 13 cm of height -- and the sleeve's end cap surfaced above the shoulder as a flat flap.
    # Straight in toward the spine puts the cap inside the kosode's own body tube, where it is
    # both invisible and watertight.
    inboard = Vector((shoulder.x * 0.32, shoulder.y, shoulder.z - 0.025))
    frames = frames_along([inboard] + chain, 13 if wide else 11)
    reach = 1.0 if wide else 0.96

    def radius(s):
        # Narrow at the root so the cap clears the body tube, opening out within the first tenth.
        root = _lerp(0.042, 1.0, min(1.0, s / 0.10))
        if wide:
            return _lerp(0.088, 0.080, s) * root if s < 0.10 else _lerp(0.088, 0.080, s)
        return (_lerp(0.078, 0.044, min(1.0, s / reach))
                * (root if s < 0.10 else 1.0))

    def hang(s):
        if not wide:
            return 1.0 + 0.55 * math.sin(math.pi * min(1.0, s / 0.9)) * 0.35
        # The hanging panel: nothing at the shoulder, deepest just past the elbow, still long at
        # the wrist. This is the furisode profile off the hana and yuki sheets.
        return 1.0 + 3.1 * math.sin(math.pi * min(1.0, s ** 0.8)) ** 1.4

    def region(s):
        return HEM if s > 0.86 else CLOTH

    rings = tube_along(build, frames, radius_of=radius, hang=hang, regions_of=region,
                       bind_radius_of=lambda s: _lerp(0.085, 0.045, s),
                       segments=14, close_start=True, close_end=False)
    # A rolled cuff instead of a cap. A capped sleeve end is a disc across the wrist, and the
    # hand -- which is a separate mesh, because City Sample keeps the hands in the body -- would
    # push straight through it.
    origin, tangent, down, sideways, _ = frames[-1]
    r = radius(1.0)
    h = hang(1.0)
    cuff, bound = [], []
    for i in range(14):
        t = TAU * i / 14
        scale = 1.0 + (h - 1.0) * max(0.0, math.cos(t))
        cuff.append(origin - tangent * 0.014
                    + down * (math.cos(t) * (r - 0.008) * scale)
                    + sideways * (math.sin(t) * (r - 0.008)))
        bound.append(origin + (down * math.cos(t) + sideways * math.sin(t)) * 0.045)
    last = [build.verts[i] for i in rings[-1]]
    loft(build, [last, cuff], [bound, bound], [HEM, HEM], v_scale=1.0, flip=True)


# ------------------------------------------------------------------------------------------
# Lower garments
# ------------------------------------------------------------------------------------------

def hakama(fit, segments=18, short=False):
    """Divided pleated trousers. The working and fighting silhouette.

    Wide enough that it reads as a skirt standing still and as trousers in motion, which is the
    whole point of the garment and the thing that makes kaito's and the ronin's sheets read as
    this culture rather than as generic fantasy. The pleats are geometry rather than texture --
    seven at the front, and they are what the eye actually reads at settlement distance.
    """
    build = Build()
    top_z = fit.tuck_z + 0.020
    split_z = fit.pelvis_z - 0.035
    hem_z = fit.ankle_z + (0.22 if short else 0.055)

    def pleat(t):
        # Front pleats only; the back of a hakama is flat above the koshiita.
        return 1.0 + 0.030 * math.cos(7.0 * t) * max(0.0, math.cos(t)) ** 0.5

    # A hakama's waist is not level: the back rides well above the front, and the stiffened
    # koshiita sits on that raised back edge. On a masculine bind pose the sash is narrow enough
    # that the koshiita shows above it, which is the clearest single read that this is a hakama
    # and not a wide skirt; on a feminine one the broad obi covers it, which is equally correct.
    back_rise = 0.10

    def rise(angle):
        return back_rise * max(0.0, -math.cos(angle)) ** 0.7

    rings, binds, regions = [], [], []
    steps = 5
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(top_z, split_z, t)
        rx, ry = fit.torso(z, _lerp(0.020, 0.048, t), _lerp(0.018, 0.044, t))
        bx, by = fit.torso(z, 0.006, 0.006)
        ring = ring_points(0.0, -0.02, z, rx, ry, segments, modulate=pleat)
        if i == 0:
            for k, p in enumerate(ring):
                p.z += rise(TAU * k / segments)
        rings.append(ring)
        binds.append(ring_points(0.0, -0.02, z, bx, by, segments))
        regions.append(CLOTH)
    loft(build, rings, binds, regions, v_scale=3.0, close_top=True, close_bottom=True)

    for side in ('l', 'r'):
        _hakama_leg(fit, build, side, split_z, hem_z, segments, pleat, short)
    _koshiita(fit, build, top_z + back_rise)
    return build


def _hakama_leg(fit, build, side, split_z, hem_z, segments, pleat, short):
    thigh = fit.bone['thigh_%s' % side]
    ankle = fit.bone['foot_%s' % side]
    # Starts *above* the split, inside the body section, rather than at it. Butting the two
    # sections together left an open seam ringing the hip: the body section ends at one radius
    # and the two legs begin at another, and no amount of matching numbers closes a join between
    # one tube and two. Overlapping by 9 cm hides it inside cloth that is already there.
    top_z = split_z + 0.09
    rings, binds, regions = [], [], []
    steps = 9
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(top_z, hem_z, t)
        # Centre follows the leg, but only partly: a hakama's inner edge stays near the midline,
        # which is why it reads as one volume rather than as two separate trouser legs.
        cx = _lerp(thigh.x * 0.18, ankle.x * 0.80, t)
        cy = _lerp(-0.02, ankle.y - 0.01, t)
        # Barely tapered. The width at the ankle is most of the width at the hip.
        r = _lerp(0.178, 0.120 if not short else 0.134, t)
        rings.append(ring_points(cx, cy, z, r, r * 0.86, segments, modulate=pleat))
        # The bind proxy hugs the actual leg, so the cloth follows the knee instead of
        # spraying outward when the character runs.
        bt = fit.leg_chain(side)
        leg_x = _lerp(bt[0].x, bt[2].x, t)
        binds.append(ring_points(leg_x, cy, z, 0.075, 0.075, segments))
        regions.append(HEM if t > 0.84 else (KNEE if 0.4 < t < 0.75 else CLOTH))
    loft(build, rings, binds, regions, v_scale=2.4)
    # Rolled hem at the ankle.
    last = rings[-1]
    inner = ring_points(_lerp(thigh.x * 0.18, ankle.x * 0.80, 1.0), ankle.y - 0.01,
                        hem_z + 0.014, 0.105, 0.090, segments)
    loft(build, [last, inner], [binds[-1], binds[-1]], [HEM, HEM], flip=True)


def _koshiita(fit, build, top_z):
    """The stiffened back plate that sits above the hakama's rear waist. Small, and the single
    clearest signal that this is a hakama and not a wide skirt."""
    rx, ry = fit.torso(top_z, 0.024, 0.022)
    path, normals = [], []
    steps = 7
    for i in range(steps):
        angle = _lerp(math.pi - 0.95, math.pi + 0.95, i / (steps - 1))
        point, normal = _on_surface(rx, ry, angle, top_z - 0.028)
        path.append(point)
        normals.append(normal)
    ribbon(build, path, width_of=lambda t: 0.042 * _lerp(0.8, 1.0, math.sin(math.pi * t)),
           lift_of=lambda t: 0.007, normal_of=lambda i: normals[i], region=ACCENT, v_scale=1.0)


def wrapped_skirt(fit, segments=20):
    """The long wrapped lower layer -- hana, yuki, the kitsune, and the monk's lower half.

    Undivided and close, so it falls straight from the hip to the ankle with a single overlapping
    front seam. This is the other half of the grammar: the same kosode over this instead of over a
    hakama is the difference between a farmer and a figure at a festival.
    """
    build = Build()
    top_z = fit.tuck_z + 0.015
    hem_z = fit.ankle_z + 0.035
    rings, binds, regions = [], [], []
    steps = 10
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(top_z, hem_z, t)
        ease = _lerp(0.018, 0.060, t ** 0.7)
        if z > fit.pelvis_z:
            rx, ry = fit.torso(z, ease, ease * 0.92)
        else:
            # Below the hip there is no torso to measure; the skirt becomes its own shape and
            # narrows slightly toward the ankle the way a wrapped layer does.
            rx = _lerp(0.205, 0.150, (fit.pelvis_z - z) / max(0.01, fit.pelvis_z - hem_z))
            ry = rx * 0.88
        bx = min(rx, 0.105)
        rings.append(ring_points(0.0, -0.02, z, rx, ry, segments))
        binds.append(ring_points(0.0, -0.02, z, bx, bx * 0.9, segments))
        regions.append(HEM if t > 0.88 else CLOTH)
    loft(build, rings, binds, regions, v_scale=2.2, close_top=True)
    inner = ring_points(0.0, -0.02, hem_z + 0.014, 0.135, 0.120, segments)
    loft(build, [rings[-1], inner], [binds[-1], binds[-1]], [HEM, HEM], flip=True)

    # The front overlap seam, running the full length.
    path, normals = [], []
    for i in range(8):
        t = i / 7
        z = _lerp(top_z - 0.01, hem_z + 0.02, t)
        angle = _lerp(-0.30, -0.12, t)
        idx = int(angle % TAU / TAU * segments)
        r = (rings[min(int(t * (steps - 1)), steps - 1)][idx] - Vector((0, -0.02, z))).length
        point, normal = _on_surface(r + 0.004, r * 0.9 + 0.004, angle, z)
        path.append(point)
        normals.append(normal)
    ribbon(build, path, width_of=lambda t: 0.011, lift_of=lambda t: 0.007,
           normal_of=lambda i: normals[i], region=CLOTH)
    return build


# ------------------------------------------------------------------------------------------
# Obi -- the waist
# ------------------------------------------------------------------------------------------

def obi(fit, segments=20):
    """The sash. Broad and high on a feminine bind pose, narrower and lower on a masculine one,
    which is the real historical distinction and also what the sheets show.

    It is a separate piece rather than part of the kosode because it is the one thing in the
    costume that changes colour independently of everything else: on every reference figure the
    waist is the accent. Carrying it in the accessory slot is what lets the resolver give a
    resident a muted indigo kosode and a vermilion waist without authoring that combination.
    """
    build = Build()
    # Always straddling the tuck line, so the obi covers whatever lower garment is tied there
    # and a kosode/hakama/obi trio authored independently still meets cleanly at the waist.
    if fit.sex == 'female':
        low, high = fit.tuck_z - 0.035, fit.tuck_z + 0.135
    else:
        low, high = fit.tuck_z - 0.065, fit.tuck_z + 0.020
    rings, binds, regions = [], [], []
    steps = 5
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(low, high, t)
        # Pinched very slightly at top and bottom, so it reads as wrapped cloth under tension.
        pinch = 1.0 - 0.10 * abs(t - 0.5) * 2 * 0.5
        rx, ry = fit.torso(z, 0.045 * pinch, 0.042 * pinch)
        rings.append(ring_points(0.0, -0.02, z, rx, ry, segments))
        binds.append(ring_points(0.0, -0.02, z, *fit.torso(z, 0.006, 0.006), segments))
        regions.append(ACCENT)
    loft(build, rings, binds, regions, v_scale=2.0)
    loft(build, [rings[0], ring_points(0.0, -0.02, low + 0.006,
                                       *fit.torso(low, 0.012, 0.011), segments)],
         [binds[0], binds[0]], [ACCENT, ACCENT], flip=True)
    loft(build, [ring_points(0.0, -0.02, high - 0.006,
                             *fit.torso(high, 0.012, 0.011), segments), rings[-1]],
         [binds[-1], binds[-1]], [ACCENT, ACCENT], flip=True)
    _obi_knot(fit, build, (low + high) / 2, high - low)
    return build


def _obi_knot(fit, build, centre_z, height):
    """The knot at the back: a folded bundle of cloth standing off the spine.

    Built as slices stacked *backwards* along Y rather than upwards along Z, because that is the
    direction the knot actually projects, and a stack of Z rings produced a fan of flat shards.
    Feminine bind poses get the broad taiko bundle the reference sheets show; masculine ones get
    a small tied knot, which is the real distinction between how the two wear a sash.
    """
    rx, ry = fit.torso(centre_z, 0.030, 0.028)
    back_y = -0.02 + ry - 0.005
    wide = height * (1.05 if fit.sex == 'female' else 0.62)
    tall = height * (0.92 if fit.sex == 'female' else 0.66)
    depth = 0.062 if fit.sex == 'female' else 0.042

    rings, binds, regions = [], [], []
    steps = 6
    for i in range(steps):
        t = i / (steps - 1)
        # Swells away from the back and tapers to a soft edge, so it reads as folded cloth.
        swell = math.sin(math.pi * _lerp(0.12, 0.88, t)) ** 0.65
        y = back_y + depth * t
        ring, bound = [], []
        for k in range(14):
            a = TAU * k / 14
            s, c = math.sin(a), math.cos(a)
            sx = math.copysign(abs(s) ** 0.55, s) if s else 0.0
            sz = math.copysign(abs(c) ** 0.55, c) if c else 0.0
            ring.append(Vector((sx * wide * 0.5 * swell, y, centre_z + sz * tall * 0.5 * swell)))
            bound.append(Vector((sx * 0.04, -0.02 + ry * 0.35, centre_z + sz * 0.04)))
        rings.append(ring)
        binds.append(bound)
        regions.append(ACCENT)
    loft(build, rings, binds, regions, close_bottom=True, close_top=True, v_scale=1.0)


# ------------------------------------------------------------------------------------------
# Footwear -- and the feet themselves
# ------------------------------------------------------------------------------------------

def _tabi(fit, build, side, height=0.055, region=UNDER):
    """A split-toe foot covering.

    This is load-bearing rather than decorative. City Sample puts the bare feet inside the
    *trouser* mesh, so a hakama that replaces the trousers leaves a resident with no feet at all.
    Copying the vendor's feet is not an option -- that geometry is licensed and stays on this
    machine. A tabi solves both problems honestly: it is the correct thing to wear under geta, it
    is original geometry, and it means every Ashford lower garment is complete on its own.
    """
    foot = fit.bone['foot_%s' % side]
    ball = fit.bone['ball_%s' % side]
    # The installed City body is a fragment: it supplies hands, not a lower leg.
    # Every footwear variant needs a calf wrap overlapping the short hakama's hem
    # (ankle + .22 m), or sandals and trousers visibly float apart by ~16 cm.
    height = max(height, fit.ankle_z + 0.25 - foot.z)
    toe = ball + (ball - foot).normalized() * 0.055
    toe.z = max(0.012, ball.z)
    heel = Vector((foot.x, foot.y + 0.055, foot.z * 0.35))

    path = [heel, Vector((foot.x, foot.y, foot.z)), ball, toe]
    frames = frames_along(path, 9)
    rings, binds, regions = [], [], []
    for origin, tangent, down, sideways, s in frames:
        # Foot cross-section: wide and flat, flatter toward the toe.
        w = _lerp(0.042, 0.047, math.sin(math.pi * s)) * _lerp(1.0, 0.82, max(0.0, s - 0.7) / 0.3)
        h = _lerp(0.050, 0.022, s ** 0.8)
        ring, bound = [], []
        for k in range(12):
            a = TAU * k / 12
            up = max(0.0, math.cos(a))
            ring.append(origin + sideways * (math.sin(a) * w)
                        - down * (math.cos(a) * (h if math.cos(a) > 0 else h * 0.45)))
            bound.append(origin + (sideways * math.sin(a) - down * math.cos(a)) * 0.05)
        rings.append(ring)
        binds.append(bound)
        regions.append(region)
    # An ankle cuff, so the tabi meets the hakama hem instead of ending in mid-air.
    cuff = Vector((foot.x, foot.y + 0.01, foot.z + height))
    ring, bound = [], []
    for k in range(12):
        a = TAU * k / 12
        ring.append(cuff + Vector((math.sin(a) * 0.046, math.cos(a) * 0.050, 0.0)))
        bound.append(cuff + Vector((math.sin(a) * 0.045, math.cos(a) * 0.045, 0.0)))
    loft(build, [ring] + rings, [bound] + binds, [region] + regions,
         close_bottom=True, close_top=True, v_scale=4.0)


def geta(fit):
    """Raised wooden sandals: a board, two supporting teeth, and a thong. Worn over tabi.

    The teeth are why these are worth modelling rather than faking with a flat sole -- they lift
    the figure two centimetres off the ground and put a hard shadow under the foot, which is the
    silhouette cue that reads at settlement distance.
    """
    build = Build()
    for side in ('l', 'r'):
        _tabi(fit, build, side)
        _geta_sole(fit, build, side, raised=True)
    return build


def waraji(fit):
    """Flat woven sandals. The same construction with the teeth removed and the sole thinned --
    the working and the destitute register, and the one the monk wears."""
    build = Build()
    for side in ('l', 'r'):
        _tabi(fit, build, side, region=(0.0, 0.85, 0.6))
        _geta_sole(fit, build, side, raised=False)
    return build


def tabi_boot(fit):
    """A tall split-toe boot. This exists to close a hole rather than to be interesting: the
    Foundry asks for `boots` for the travelling and armoured silhouettes, and without something
    here those residents resolve to City Sample oxfords and the whole settlement's footwear
    reverts to modern. The reference sheets put exactly this on kaito and the ronin."""
    build = Build()
    for side in ('l', 'r'):
        _tabi(fit, build, side, height=0.135, region=CLOTH)
        _geta_sole(fit, build, side, raised=False)
    return build


def _geta_sole(fit, build, side, raised):
    foot = fit.bone['foot_%s' % side]
    ball = fit.bone['ball_%s' % side]
    axis = (ball - foot)
    axis.z = 0
    axis = axis.normalized() if axis.length > 1e-4 else Vector((0, -1, 0))
    across = Vector((-axis.y, axis.x, 0))
    base = min(foot.z, ball.z) - 0.004
    thickness = 0.018 if raised else 0.011
    centre = Vector((foot.x, (foot.y + ball.y) / 2, base))
    half_long, half_wide = 0.115, 0.050

    def board(z):
        return [centre + axis * (half_long * a) + across * (half_wide * b) + Vector((0, 0, z))
                for a, b in ((1, -1), (1, 1), (-1, 1), (-1, -1))]

    top, bottom = board(0.0), board(-thickness)
    bind = [Vector((foot.x, foot.y, foot.z)) for _ in range(4)]
    loft(build, [top, bottom], [bind, bind], [CLOTH, CLOTH], close_bottom=True, close_top=True)

    if raised:
        for offset in (0.055, -0.052):
            tooth_top = [p + axis * offset + Vector((0, 0, -thickness)) for p in board(0.0)]
            tooth_top = [centre + axis * (offset + 0.011 * a) + across * (half_wide * 0.92 * b)
                         + Vector((0, 0, -thickness)) for a, b in ((1, -1), (1, 1), (-1, 1), (-1, -1))]
            tooth_low = [p - Vector((0, 0, 0.030)) for p in tooth_top]
            loft(build, [tooth_top, tooth_low], [bind, bind], [CLOTH, CLOTH],
                 close_bottom=True, close_top=True)

    # The thong: two straps from between the toes back to each side of the heel.
    toe_gap = centre + axis * (half_long * 0.62) + Vector((0, 0, 0.012))
    for direction in (1, -1):
        anchor = centre + across * (half_wide * 0.85 * direction) - axis * (half_long * 0.35) \
            + Vector((0, 0, 0.010))
        path = [toe_gap, toe_gap.lerp(anchor, 0.5) + Vector((0, 0, 0.030)), anchor]
        normals = [Vector((0, 0, 1)), Vector((0, 0, 1)), Vector((0, 0, 1))]
        ribbon(build, path, width_of=lambda t: 0.008, lift_of=lambda t: 0.0,
               normal_of=lambda i: normals[i], region=ACCENT, v_scale=1.0)


# ------------------------------------------------------------------------------------------
# Overlayers -- occupation and weather
# ------------------------------------------------------------------------------------------

def maekake(fit, segments=16):
    """A worker's waist apron: one panel hung from a cord at the waist, front only.

    This is the cheapest occupational signal in the whole set. The same kosode and hakama with
    this over it is a baker or a smith; without it, a resident going about their day. Nothing
    about it needs a new body fit or a new material.
    """
    build = Build()
    top_z = fit.tuck_z - 0.025
    hem_z = fit.pelvis_z - 0.32
    rings, binds, regions = [], [], []
    steps = 6
    arc = 1.15
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(top_z, hem_z, t)
        # Enough ease to clear a kosode and an obi, and no more. At 85 mm it cleared everything on
        # a slim build and stood off a heavy one like a hooped skirt -- the ease is a constant but
        # the body under it is not, so the widest build wore the error.
        rx, ry = fit.torso(max(z, fit.pelvis_z - 0.05), 0.034, 0.030)
        ring, bound = [], []
        for k in range(segments):
            angle = _lerp(-arc, arc, k / (segments - 1))
            ring.append(_on_surface(rx, ry, angle, z)[0])
            bound.append(_on_surface(rx * 0.55, ry * 0.55, angle,
                                     max(z, fit.pelvis_z - 0.06))[0])
        rings.append(ring)
        binds.append(bound)
        regions.append(HEM if t > 0.8 else (0.0, 0.0, 0.9))
    # An open panel, not a tube: lofted without wrapping the last column back to the first.
    _loft_open(build, rings, binds, regions)
    # The waist cord, continuing round the back so it reads as tied rather than glued on.
    path, normals = [], []
    for i in range(13):
        angle = _lerp(-math.pi * 0.92, math.pi * 0.92, i / 12)
        rx, ry = fit.torso(top_z, 0.040, 0.036)
        point, normal = _on_surface(rx, ry, angle, top_z + 0.012)
        path.append(point)
        normals.append(normal)
    ribbon(build, path, width_of=lambda t: 0.009, lift_of=lambda t: 0.0,
           normal_of=lambda i: normals[i], region=ACCENT, v_scale=2.0)
    return build


def haori(fit, segments=20):
    """An open-fronted hip-length coat with wide sleeves, worn over the kosode.

    Two jobs. It is the travelling and cold-weather layer the Foundry asks for by the tag `coat`,
    which would otherwise resolve to a City Sample blazer; and it is the cheapest way to make a
    higher-status resident read as higher status without a second body fit.
    """
    build = Build()
    hem_z = fit.pelvis_z - 0.16
    collar_z = min(fit.neck_z - 0.02, fit.chest_z + 0.22)
    arc = math.pi * 0.86        # open at the front
    rings, binds, regions = [], [], []
    steps = 8
    for i in range(steps):
        t = i / (steps - 1)
        z = _lerp(hem_z, collar_z, t)
        rx, ry = fit.torso(z, _lerp(0.090, 0.046, t), _lerp(0.085, 0.042, t))
        ring, bound = [], []
        for k in range(segments):
            angle = _lerp(-arc, arc, k / (segments - 1))
            ring.append(_on_surface(rx, ry, angle, z)[0])
            bound.append(_on_surface(rx * 0.5, ry * 0.5, angle, z)[0])
        rings.append(ring)
        binds.append(bound)
        regions.append(HEM if t < 0.15 else CLOTH)
    _loft_open(build, rings, binds, regions)
    for side in ('l', 'r'):
        _sleeve(fit, build, side, wide=True)
    return build


def _loft_open(build, rings, binds, regions, thickness=0.006):
    """Loft a panel that does not close into a tube -- an open-fronted coat, a hung apron.

    Built as a shell with an inner face offset inward, not as one surface with a second face on
    the same four vertices. The duplicate-face version rendered as z-fighting shards, and
    Blender's `validate()` then deleted exactly those duplicates, which desynchronised the face
    list from the region list and lost the material regions on every haori and apron in the set.
    """
    centre = Vector((0.0, -0.02, 0.0))

    def inward(point):
        radial = Vector((point.x - centre.x, point.y - centre.y, 0.0))
        if radial.length < 1e-5:
            return point.copy()
        return point - radial.normalized() * thickness

    outer, inner = [], []
    for real, bound, region in zip(rings, binds, regions):
        outer.append([build.add(p, b, region) for p, b in zip(real, bound)])
        inner.append([build.add(inward(p), b, region) for p, b in zip(real, bound)])
    cols = len(rings[0])
    for r in range(len(rings) - 1):
        for s in range(cols - 1):
            u0, u1 = s / (cols - 1), (s + 1) / (cols - 1)
            v0, v1 = r / (len(rings) - 1), (r + 1) / (len(rings) - 1)
            uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            build.quad(outer[r][s], outer[r][s + 1], outer[r + 1][s + 1], outer[r + 1][s], uv=uv)
            build.quad(inner[r + 1][s], inner[r + 1][s + 1], inner[r][s + 1], inner[r][s], uv=uv)
        # Close the two vertical edges, so the open front reads as cloth with a thickness.
        for s in (0, cols - 1):
            a, b = outer[r][s], outer[r + 1][s]
            c, d = inner[r + 1][s], inner[r][s]
            uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
            build.quad(*((a, b, c, d) if s == 0 else (d, c, b, a)), uv=uv)
    # And the hem and the collar edge.
    for row, flip in ((0, False), (len(rings) - 1, True)):
        for s in range(cols - 1):
            a, b = outer[row][s], outer[row][s + 1]
            c, d = inner[row][s + 1], inner[row][s]
            uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
            build.quad(*((d, c, b, a) if flip else (a, b, c, d)), uv=uv)
