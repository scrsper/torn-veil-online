import type { SpeciesSpec } from './types';

/** Deliberately small Ashford temperate-biome catalogue. These are explicit simulation
 * calibration values, not claims of zoological precision. All three use the same need loop.
 * Boar's plant omnivory is represented by mast/browse; live prey requires future combat. */
export const WILDLIFE_SPECIES: Record<string, SpeciesSpec> = {
  field_hare: {
    id: 'field_hare', name: 'field hare', role: 'small_herbivore',
    bodyPlan: { id: 'quadruped', shape: 'quadruped', massKg: 3.5, heightM: 0.55, radiusM: 0.18 },
    locomotion: { walk: { speedMps: 1.8 } }, cognition: { controller: 'reactive_wildlife' },
    diet: { grass: 2400, browse: 1800 }, habitats: { grassland: 1, woodland: 0.65 }, senses: { localRadiusM: 20 },
    metabolism: {
    foodKgPerDay: 0.35, energyReserveKJ: 4200, waterLitresPerDay: 0.22, waterReserveLitres: 0.75,
    sleepHoursPerDay: 8, exposureTolerance: 0.55,
    starvationHours: 72, dehydrationHours: 30 },
    lifecycle: { maturityDays: 150, lifespanDays: 4 * 365 },
    reproduction: { mode: 'gestation', gestationDays: 42, weaningDays: 28,
    litter: [1, 3], birthMassFraction: 0.12, breedingIntervalDays: 65, conceptionChancePerDay: 0.12, minCondition: 0.6,
    mateRadiusM: 8 },
    spacing: { densityRadiusM: 16, comfortableNeighbours: 8 },
  },
  roe_deer: {
    id: 'roe_deer', name: 'roe deer', role: 'large_herbivore',
    bodyPlan: { id: 'quadruped', shape: 'quadruped', massKg: 28, heightM: 1.5, radiusM: 0.3 },
    locomotion: { walk: { speedMps: 1.6 } }, cognition: { controller: 'reactive_wildlife' },
    diet: { browse: 2300, grass: 1600 }, habitats: { woodland: 1, grassland: 0.7 }, senses: { localRadiusM: 28 },
    metabolism: {
    foodKgPerDay: 2.4, energyReserveKJ: 27600, waterLitresPerDay: 2, waterReserveLitres: 7,
    sleepHoursPerDay: 7, exposureTolerance: 0.6,
    starvationHours: 120, dehydrationHours: 40 },
    lifecycle: { maturityDays: 420, lifespanDays: 10 * 365 },
    reproduction: { mode: 'gestation', gestationDays: 230, weaningDays: 90,
    litter: [1, 2], birthMassFraction: 0.12, breedingIntervalDays: 365, conceptionChancePerDay: 0.035, minCondition: 0.65,
    mateRadiusM: 12 },
    spacing: { densityRadiusM: 24, comfortableNeighbours: 5 },
  },
  woodland_boar: {
    id: 'woodland_boar', name: 'woodland boar', role: 'omnivore',
    bodyPlan: { id: 'quadruped', shape: 'quadruped', massKg: 70, heightM: 1.1, radiusM: 0.38 },
    locomotion: { walk: { speedMps: 1.4 } }, cognition: { controller: 'reactive_wildlife' },
    diet: { mast: 6000, browse: 1500, grass: 900 }, habitats: { woodland: 1, grassland: 0.35 }, senses: { localRadiusM: 24 },
    metabolism: {
    foodKgPerDay: 2.8, energyReserveKJ: 84000, waterLitresPerDay: 5, waterReserveLitres: 18,
    sleepHoursPerDay: 10, exposureTolerance: 0.4,
    starvationHours: 144, dehydrationHours: 36 },
    lifecycle: { maturityDays: 300, lifespanDays: 9 * 365 },
    reproduction: { mode: 'gestation', gestationDays: 115, weaningDays: 70,
    litter: [3, 6], birthMassFraction: 0.035, breedingIntervalDays: 240, conceptionChancePerDay: 0.045, minCondition: 0.7,
    mateRadiusM: 10 },
    spacing: { densityRadiusM: 20, comfortableNeighbours: 7 },
  },
};
