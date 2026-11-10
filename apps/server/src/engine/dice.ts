export interface DiceRoll {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

// "d20", "2d6", "3d8+2", "1d100-5"
const NOTATION = /^(\d{1,2})?d(\d{1,4})([+-]\d{1,4})?$/;

/** Rolls standard dice notation. Returns null when the notation is not understood. */
export function rollDice(notation: string, random: () => number = Math.random): DiceRoll | null {
  const normalized = notation.replace(/\s+/g, '').toLowerCase();
  const match = NOTATION.exec(normalized);
  if (!match) return null;

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > 20 || sides < 2) return null;

  const rolls = Array.from({ length: count }, () => Math.floor(random() * sides) + 1);
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { notation: normalized, rolls, modifier, total };
}
