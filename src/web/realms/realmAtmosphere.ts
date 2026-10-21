export interface WeatherView { kind: string; intensity: number; wind: number }
/** Read the host projection only. Missing weather uses neutral render parameters,
 * never a client clock/seed schedule or a canonical weather mutation. */
export function realmWeather(state: { weather?: WeatherView }): WeatherView;
export function realmWeather(state: object): WeatherView;
export function realmWeather(state: object): WeatherView {
 const weather = (state as { weather?: WeatherView }).weather;
 return weather ? { ...weather } : { kind: 'clear', intensity: 0, wind: 0 };
}
/** Streaming veil is a rendering aid only; it has no simulation visibility effect. */
export function streamingFog(base:number,pending:number){return Math.max(base,pending>0?.008:.0055);}
