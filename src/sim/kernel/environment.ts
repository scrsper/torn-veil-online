import type { World } from '../core/world';

/** Advect real weather through each geographically exposed collection boundary. Uncollected
 * wind leaves the site; it cannot accumulate through years of disuse or survive calm air.
 * The two-second parcel is an explicit bounded numerical buffer, not a battery. */
export function stepEnvironmentalEnergy(world: World, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  for (const source of world.kernel.energy) {
    const wind = source.wind; if (!wind) continue;
    const speed = Math.max(0, world.weather.wind) * 12 * wind.exposure;
    const watts = 0.5 * wind.airDensity * wind.areaM2 * speed ** 3;
    const incoming = watts * seconds;
    wind.importedJ += incoming;
    const available = source.remainingJ + incoming;
    source.remainingJ = Math.min(available, watts * 2);
    wind.escapedJ += available - source.remainingJ;
    source.maxPowerW = watts;
    if (wind.lastPowerW !== watts) {
      const weather = [...world.events].reverse().find(e => e.type === 'weather' && e.data.wind === world.weather.wind);
      const ev = world.emit('environment_energy_changed', { pos: source.pos, visibility: 12, significance: 0.2,
        causes: weather ? [weather.id] : [], data: { energyId: source.id, watts, windSpeed: speed, exposure: wind.exposure },
        summary: `Local wind now supplies ${watts.toFixed(1)} W through an exposed boundary` });
      source.lastEvent = ev.id; wind.lastPowerW = watts;
    }
  }
}

export function energyBalanceError(world: World): number {
  return Math.max(0, ...world.kernel.energy.map(e => Math.abs(e.initialJ + (e.wind?.importedJ ?? 0) - e.remainingJ
    - (e.wind?.escapedJ ?? 0) - world.kernel.assemblies.filter(a => a.bindings.energyId === e.id).reduce((n, a) => n + a.inputJ, 0))));
}
