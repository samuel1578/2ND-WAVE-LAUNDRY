export type Rgba = { r: number; g: number; b: number; a: number };

export type DotGrid = {
  count: number;
  positions: Float32Array;
  phases: Float32Array;
  speeds: Float32Array;
};

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX4 = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FN = /^rgba?\(([^)]+)\)$/i;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const hexByte = (value: string) => parseInt(value, 16);

const channel = (value: string): number => {
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percent) ? clamp((percent / 100) * 255, 0, 255) : NaN;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? clamp(number, 0, 255) : NaN;
};

const alphaChannel = (value: string): number => {
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : NaN;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : NaN;
};

export function parseColor(value: string): Rgba | null {
  const input = value.trim().toLowerCase();

  const hex8 = HEX8.exec(input);
  if (hex8)
    return {
      r: hexByte(hex8[1]),
      g: hexByte(hex8[2]),
      b: hexByte(hex8[3]),
      a: hexByte(hex8[4]) / 255,
    };

  const hex6 = HEX6.exec(input);
  if (hex6)
    return {
      r: hexByte(hex6[1]),
      g: hexByte(hex6[2]),
      b: hexByte(hex6[3]),
      a: 1,
    };

  const hex4 = HEX4.exec(input);
  if (hex4)
    return {
      r: hexByte(hex4[1] + hex4[1]),
      g: hexByte(hex4[2] + hex4[2]),
      b: hexByte(hex4[3] + hex4[3]),
      a: hexByte(hex4[4] + hex4[4]) / 255,
    };

  const hex3 = HEX3.exec(input);
  if (hex3)
    return {
      r: hexByte(hex3[1] + hex3[1]),
      g: hexByte(hex3[2] + hex3[2]),
      b: hexByte(hex3[3] + hex3[3]),
      a: 1,
    };

  const fn = RGB_FN.exec(input);
  if (fn) {
    const parts = fn[1]
      .replace(/\//g, " ")
      .replace(/,/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length < 3) return null;
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    const a = parts.length > 3 ? alphaChannel(parts[3]) : 1;
    if ([r, g, b, a].some((component) => Number.isNaN(component))) return null;
    return { r, g, b, a };
  }

  return null;
}

export function buildDotGrid(
  width: number,
  height: number,
  gap: number,
  speedMin: number,
  speedMax: number,
): DotGrid {
  const cols = Math.ceil(width / gap) + 2;
  const rows = Math.ceil(height / gap) + 2;
  const min = Math.min(speedMin, speedMax);
  const max = Math.max(speedMin, speedMax);
  const span = Math.max(max - min, 0);
  const xCount = cols + 1;
  const yCount = rows + 1;
  const count = xCount * yCount;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  let index = 0;
  for (let i = -1; i < cols; i++) {
    for (let j = -1; j < rows; j++) {
      const offset = j % 2 === 0 ? 0 : gap * 0.5;
      positions[index * 3] = i * gap + offset;
      positions[index * 3 + 1] = j * gap;
      positions[index * 3 + 2] = 0;
      phases[index] = Math.random() * Math.PI * 2;
      speeds[index] = min + Math.random() * span;
      index++;
    }
  }

  return { count, positions, phases, speeds };
}

export function pulse(time: number, phase: number, speed: number) {
  const mod = (time * speed + phase) % 2;
  const lin = mod < 1 ? mod : 2 - mod;
  const alpha = 0.25 + 0.55 * lin;
  const glow = clamp((alpha - 0.6) / 0.4, 0, 1);
  return { alpha, glow };
}
