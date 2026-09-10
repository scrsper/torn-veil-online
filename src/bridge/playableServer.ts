process.env.TORN_VEIL_WORLD = 'playable';
process.env.TORN_VEIL_SAVE ??= '.debug/playable-world.save.json';
await import('./server');
export {};
