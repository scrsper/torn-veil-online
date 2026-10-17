import { Vector3 } from '@babylonjs/core';
import { DAY_SECONDS, HOME_ANCHOR, START_HOUR, dot, skyAt, tangentFrame, type V3 } from '../../sim/world/planet';
import type { Celestial } from '../world/atmosphere';

/** The canonical sun and moon for a flat realm view, from its own clock hours (day index
 * included, so the moon keeps its phase), expressed in the realm frame of the home chart
 * (x = west, y = up, z = north; see sim/world/planet/chart.ts). */
const frame = tangentFrame(HOME_ANCHOR);
const local = (d: V3) => new Vector3(-dot(d, frame.east), dot(d, frame.up), dot(d, frame.north));
export function realmCelestial(realmHours: number): Celestial {
  const hours = Math.max(0, realmHours) + 24 - START_HOUR, sky = skyAt(hours / 24 * DAY_SECONDS);
  return { sun: local(sky.sun), moon: local(sky.moon), illumination: sky.moonIllumination };
}
