import { dot, fromLatLon, normalize, type V3 } from './planet';

/** Sun, moon and day/night as a pure function of simulation seconds. Planet-fixed frame:
 * the sun and moon wheel about the +Y axis. No wall clock; the same seconds give the same sky.
 * Presentation reads this to place its directional lights; it never writes time. */
export const DAY_SECONDS = 1440;
export const YEAR_DAYS = 32;
export const LUNAR_DAYS = 8;
export const AXIAL_TILT = 23.4;
/** Simulation starts at 08:00 at the home meridian (longitude 0). */
export const START_HOUR = 8;
export interface SkyState {
  seconds: number; day: number; hour: number;
  sun: V3; moon: V3; moonIllumination: number;
}
export function skyAt(seconds: number): SkyState {
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('Sky time must be finite and non-negative');
  const t = seconds / DAY_SECONDS + START_HOUR / 24, day = Math.floor(t), hour = (t - day) * 24;
  // Hour angle at longitude 0: noon puts the sun over +Z (the home meridian).
  const h = (t - .5) * Math.PI * 2, decl = AXIAL_TILT * Math.sin(t / YEAR_DAYS * Math.PI * 2);
  const sun = fromLatLon(decl, -h * 180 / Math.PI);
  // The moon lags the sun by a synodic cycle; full moon opposes it. Small orbital inclination.
  const lag = (t / LUNAR_DAYS) * Math.PI * 2, mdecl = -decl * Math.cos(lag) + 5 * Math.sin(t / LUNAR_DAYS * Math.PI * 2 + 1);
  const moon = fromLatLon(mdecl, (-h + lag + Math.PI) * 180 / Math.PI);
  const moonIllumination = (1 - dot(sun, moon)) / 2;
  return { seconds, day, hour, sun, moon, moonIllumination };
}
const smooth = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];
export interface LocalLight {
  sunElevation: number; moonElevation: number; daylight: number;
  sunIntensity: number; moonIntensity: number; ambient: number;
  sunColor: [number, number, number]; moonColor: [number, number, number];
  zenith: [number, number, number]; horizon: [number, number, number]; ground: [number, number, number];
  stars: number;
}
/** Lighting as seen by an observer whose local vertical is `up`. Sine elevations in [-1, 1]. */
export function lightAt(sky: SkyState, up: V3): LocalLight {
  const u = normalize(up), sunElevation = dot(sky.sun, u), moonElevation = dot(sky.moon, u);
  const daylight = smooth(-.12, .18, sunElevation), twilight = smooth(-.18, 0, sunElevation) * (1 - smooth(.05, .3, sunElevation));
  const sunIntensity = smooth(-.03, .12, sunElevation) * (1.15 + .45 * smooth(.1, .7, sunElevation));
  const moonIntensity = smooth(-.03, .1, moonElevation) * (.12 + .38 * sky.moonIllumination) * (1 - daylight);
  const warm = 1 - smooth(.04, .4, sunElevation);
  const night = [.015, .025, .07] as const, dayZenith = [.24, .46, .82] as const, dusk = [.42, .28, .36] as const;
  let zenith = mix(night, dayZenith, daylight); zenith = mix(zenith, dusk, twilight * .45);
  let horizon = mix([.03, .05, .1], [.66, .78, .9], daylight); horizon = mix(horizon, [.96, .55, .3], twilight * .8);
  const moonLift = moonIntensity * 1.4;
  zenith = mix(zenith, [.08, .12, .22], moonLift * .5); horizon = mix(horizon, [.12, .16, .26], moonLift * .5);
  return { sunElevation, moonElevation, daylight, sunIntensity, moonIntensity,
    ambient: .06 + .5 * daylight + .5 * moonIntensity,
    sunColor: mix([1, .99, .95], [1, .58, .3], warm), moonColor: [.62, .72, 1],
    zenith, horizon, ground: mix([.02, .025, .03], [.32, .3, .25], daylight), stars: 1 - smooth(-.2, .02, sunElevation) };
}
/** Local solar hour at a longitude, for presentation clocks. */
export function localHour(sky: SkyState, lon: number) { return ((sky.hour + lon / 15) % 24 + 24) % 24; }
