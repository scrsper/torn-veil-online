import { projectAppearanceDescription } from '../../sim/core/appearance';
import type { ProjectedAppearanceDescription } from '../../sim/core/appearance';
import type { Person } from '../../sim/core/types';
import type { World } from '../../sim/core/world';

/**
 * A reviewable contact sheet of a world's actual population.
 *
 * This is evidence tooling, not a renderer. It draws exactly what the bridge would send — the
 * realized colours and the projected trait tokens — so a human can check the character pipeline
 * without an Unreal editor in the loop. Anything it shows that PIE does not is a projection bug,
 * which is the point of having it.
 */

export interface AppearanceRow {
  name: string;
  slug: string | null;
  age: number;
  gender: 'm' | 'f';
  occupation: string;
  colours: { skin: number; hair: number; shirt: number; pants: number; apron?: number; hat?: number };
  height: number;
  build: number;
  traits: ProjectedAppearanceDescription;
}

export function appearanceRows(world: World, limit = 48): AppearanceRow[] {
  return world.persons().filter((p: Person) => p.alive && p.appearance.description).slice(0, limit).map((p: Person) => ({
    name: p.name, slug: p.slug ?? null, age: p.age, gender: p.gender, occupation: p.occupation,
    colours: {
      skin: p.appearance.skin, hair: p.appearance.hair, shirt: p.appearance.shirt, pants: p.appearance.pants,
      ...(p.appearance.apron !== undefined ? { apron: p.appearance.apron } : {}),
      ...(p.appearance.hat !== undefined ? { hat: p.appearance.hat } : {}),
    },
    height: p.appearance.height, build: p.appearance.build,
    traits: projectAppearanceDescription(p.appearance.description!, p.age, p.occupation),
  }));
}

export interface AppearanceSummary {
  people: number;
  archetypes: Record<string, number>;
  palettes: Record<string, number>;
  silhouettes: Record<string, number>;
  distinctGarmentColours: number;
  distinctTraitSignatures: number;
}

const tally = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
};

export function summarize(rows: AppearanceRow[]): AppearanceSummary {
  const signature = (row: AppearanceRow) => [row.traits.archetype, row.traits.skinTone, row.traits.hairColor, row.traits.hairStyle,
    row.traits.garmentPalette, row.traits.garmentSilhouette, row.traits.frame, row.traits.stature, [...row.traits.accessories].sort().join('+')].join('|');
  return {
    people: rows.length,
    archetypes: tally(rows.map(r => r.traits.archetype)),
    palettes: tally(rows.map(r => r.traits.garmentPalette)),
    silhouettes: tally(rows.map(r => r.traits.garmentSilhouette)),
    distinctGarmentColours: new Set(rows.map(r => r.colours.shirt)).size,
    distinctTraitSignatures: new Set(rows.map(signature)).size,
  };
}

const hex = (colour: number) => `#${(colour >>> 0).toString(16).padStart(6, '0')}`;
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * One column per person: a stacked colour swatch (hair, skin, garment, under-layer, trim) scaled
 * by their canonical height and build, captioned with the tokens that produced it.
 */
export function appearanceSheetSvg(rows: AppearanceRow[], title: string): string {
  const columns = Math.min(8, rows.length || 1);
  const cellW = 168, cellW2 = cellW / 2, cellH = 260, pad = 24, headerH = 64;
  const width = pad * 2 + columns * cellW;
  const height = headerH + pad + Math.ceil(rows.length / columns) * cellH;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, monospace">`,
    `<rect width="${width}" height="${height}" fill="#14110f"/>`,
    `<text x="${pad}" y="32" fill="#e8dcc0" font-size="18">${escape(title)}</text>`,
    `<text x="${pad}" y="50" fill="#9a8f7a" font-size="11">canonical appearance as the bridge projects it — colours are realized, labels are the structured description</text>`,
  ];
  rows.forEach((row, index) => {
    const x = pad + (index % columns) * cellW, y = headerH + Math.floor(index / columns) * cellH;
    // Figure proportions come from the person's own canonical height/build, not from the layout.
    const figureH = 120 * Math.max(0.3, Math.min(1.2, row.height));
    const figureW = 52 * Math.max(0.6, Math.min(1.3, row.build));
    const fx = x + cellW2 - figureW / 2, base = y + 16;
    const hairH = figureH * 0.22, headH = figureH * 0.2, torsoH = figureH * 0.34, legH = figureH - hairH - headH - torsoH;
    parts.push(
      `<rect x="${x + 6}" y="${y + 4}" width="${cellW - 12}" height="${cellH - 14}" fill="#1c1815" stroke="#2e2822"/>`,
      `<rect x="${fx}" y="${base}" width="${figureW}" height="${hairH}" fill="${hex(row.colours.hat ?? row.colours.hair)}"/>`,
      `<rect x="${fx + figureW * 0.15}" y="${base + hairH}" width="${figureW * 0.7}" height="${headH}" fill="${hex(row.colours.skin)}"/>`,
      `<rect x="${fx}" y="${base + hairH + headH}" width="${figureW}" height="${torsoH}" fill="${hex(row.colours.shirt)}"/>`,
      row.colours.apron !== undefined
        ? `<rect x="${fx + figureW * 0.25}" y="${base + hairH + headH + torsoH * 0.25}" width="${figureW * 0.5}" height="${torsoH * 0.85}" fill="${hex(row.colours.apron)}"/>`
        : '',
      `<rect x="${fx + figureW * 0.1}" y="${base + hairH + headH + torsoH}" width="${figureW * 0.8}" height="${legH}" fill="${hex(row.colours.pants)}"/>`,
    );
    const caption = [
      `${row.name}`,
      `${row.age} · ${row.gender} · ${row.occupation}`,
      `${row.traits.archetype} / ${row.traits.agePresentation}`,
      `${row.traits.garmentSilhouette}`,
      `${row.traits.garmentPalette} · ${row.traits.status}`,
      `${row.traits.hairColor} ${row.traits.hairStyle}`,
      `${row.traits.skinTone} · ${row.traits.frame}/${row.traits.stature}`,
      `wear ${row.traits.wear.toFixed(2)} groom ${row.traits.grooming.toFixed(2)}`,
      row.traits.accessories.join(' ') || '—',
      row.traits.roleCues.join(' ') || '—',
    ];
    const fit = (line: string) => (line.length > 30 ? `${line.slice(0, 29)}\u2026` : line);
    caption.map(fit).forEach((line, lineIndex) => parts.push(
      `<text x="${x + cellW2}" y="${base + 132 + lineIndex * 12}" fill="${lineIndex === 0 ? '#e8dcc0' : '#9a8f7a'}" font-size="${lineIndex === 0 ? 11 : 9}" text-anchor="middle">${escape(line)}</text>`));
  });
  parts.push('</svg>');
  return parts.filter(Boolean).join('\n');
}
