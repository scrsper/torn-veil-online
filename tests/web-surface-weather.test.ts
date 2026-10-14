import { NullEngine, Scene } from '@babylonjs/core';
import { describe, expect, it } from 'vitest';
import { MaterialLibrary } from '../src/web/render/materials';

describe('surface weather response', () => {
  it('smoothly wets exposed surfaces and recovers the dry profile', () => {
    const scene = new Scene(new NullEngine()), mats = new MaterialLibrary(scene);
    const terrain = mats.get('terrain'), plaster = mats.get('plaster');
    const dryRoughness = terrain.roughness!, dryColor = terrain.albedoColor.clone(), plasterRoughness = plaster.roughness!, plasterColor = plaster.albedoColor.clone();
    mats.updateWeather('rain', 1, 10);
    expect(terrain.roughness).toBeCloseTo(.65, 2); expect(terrain.albedoColor.r).toBeLessThan(dryColor.r);
    expect(plaster.roughness).toBe(plasterRoughness); expect(plaster.albedoColor.equals(plasterColor)).toBe(true);
    mats.updateWeather('clear', 0, 40);
    expect(terrain.roughness).toBeCloseTo(dryRoughness, 2); expect(terrain.albedoColor.r).toBeCloseTo(dryColor.r, 3);
    mats.dispose(); scene.getEngine().dispose();
  });

  it('registers clones so rain applies consistently and disposal unregisters them', () => {
    const scene = new Scene(new NullEngine()), mats = new MaterialLibrary(scene);
    const path = mats.clone('path', 'path-weather-test');
    mats.updateWeather('storm', 1, 10);
    expect(path.roughness).toBeCloseTo(.45, 2);
    const wetClone = mats.clone('path', 'streamed-during-rain');
    expect(wetClone.roughness).toBeCloseTo(path.roughness!, 6);
    expect(wetClone.albedoColor.equals(path.albedoColor)).toBe(true);
    path.dispose(); mats.updateWeather('clear', 0, 40);
    expect(mats.wetness).toBeCloseTo(0, 2);
    expect(wetClone.roughness).toBeCloseTo(.97, 6);
    expect(wetClone.albedoColor.r).toBeCloseTo(1, 6);
    mats.dispose(); scene.getEngine().dispose();
  });

  it('accumulates light drizzle equally at low and high frame rates', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const slow = new MaterialLibrary(scene), fast = new MaterialLibrary(scene);
    for (let i = 0; i < 30; i++) slow.updateWeather('rain', .05, 1 / 30);
    for (let i = 0; i < 144; i++) fast.updateWeather('rain', .05, 1 / 144);
    expect(fast.wetness).toBeGreaterThan(.03);
    expect(fast.wetness).toBeCloseTo(slow.wetness, 6);
    slow.dispose(); fast.dispose(); scene.dispose(); engine.dispose();
  });
});
