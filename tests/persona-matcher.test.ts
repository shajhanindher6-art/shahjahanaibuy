import { describe, expect, it } from 'vitest';
import {
  PERSONAS,
  getPersona,
  matchVerdict,
  scorePersona,
  type Persona,
  type PersonaAttributeInput,
} from '@/services/persona-matcher';

function attr(partial: Partial<PersonaAttributeInput> & { key: string; value: string }): PersonaAttributeInput {
  return { unit: null, ...partial };
}

function ids(list: { requirement: { id: string } }[]): string[] {
  return list.map((e) => e.requirement.id);
}

describe('PERSONAS', () => {
  it('exports the four personas in order', () => {
    expect(PERSONAS.map((p) => p.id)).toEqual(['work', 'gaming', 'student', 'content']);
    expect(PERSONAS.map((p) => p.label)).toEqual(['Work', 'Gaming', 'Student', 'Content Creation']);
  });

  it('getPersona falls back to the first persona for an unknown id', () => {
    expect(getPersona('nope' as never).id).toBe('work');
  });
});

describe('scorePersona — work persona', () => {
  const work = getPersona('work');
  // Work total weight: RAM 3 + Storage 2 + Battery 2 + Category 1 = 8.

  it('all matched → 100 + Great fit', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '512', unit: 'GB' }),
        attr({ key: 'Battery', value: '100', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(r.scorePct).toBe(100);
    expect(matchVerdict(r.scorePct)).toBe('Great fit');
    expect(r.categoryMatch).toBe(true);
    expect(ids(r.matched)).toEqual(['ram', 'storage', 'battery', 'category']);
    expect(r.below).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it('all unknown → 0 + Not ideal', () => {
    const r = scorePersona(work, [], null);
    expect(r.scorePct).toBe(0);
    expect(matchVerdict(r.scorePct)).toBe('Not ideal');
    expect(r.categoryMatch).toBe(false);
    expect(ids(r.unknown)).toEqual(['ram', 'storage', 'battery', 'category']);
  });

  it('mixed matched/below/unknown arithmetic: 4/8 = 50 → Good fit', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '256', unit: 'GB' }),
      ],
      'Laptops'
    );
    // RAM matched (3) + Storage below (0) + Battery unknown (0) + Category matched (1) = 4/8.
    expect(r.scorePct).toBe(50);
    expect(matchVerdict(r.scorePct)).toBe('Good fit');
    expect(ids(r.matched)).toEqual(['ram', 'category']);
    expect(ids(r.below)).toEqual(['storage']);
    expect(ids(r.unknown)).toEqual(['battery']);
  });

  it('empty attributes → score from category only: 1/8 = 13 → Not ideal', () => {
    const r = scorePersona(work, [], 'Laptops');
    expect(r.scorePct).toBe(13); // Math.round(100 * 1 / 8) = 13
    expect(matchVerdict(r.scorePct)).toBe('Not ideal');
    expect(ids(r.matched)).toEqual(['category']);
    expect(ids(r.unknown)).toEqual(['ram', 'storage', 'battery']);
  });
});

describe('scorePersona — unit rules', () => {
  const work = getPersona('work');

  it('Wh vs mAh never compared: a 5000 mAh battery is unknown, not below', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '512', unit: 'GB' }),
        attr({ key: 'Battery', value: '5000', unit: 'mAh' }),
      ],
      'Laptops'
    );
    expect(ids(r.unknown)).toEqual(['battery']);
    expect(ids(r.below)).toEqual([]);
    // RAM 3 + Storage 2 + Category 1 = 6/8 = 75 → Good fit.
    expect(r.scorePct).toBe(75);
    expect(matchVerdict(r.scorePct)).toBe('Good fit');
  });

  it('"1,000" parses to 1000', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '1,000', unit: 'GB' }),
        attr({ key: 'Battery', value: '50', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(r.scorePct).toBe(100);
    expect(ids(r.matched)).toContain('storage');
  });

  it('units match case-insensitively: "gb" satisfies a GB requirement', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16', unit: 'gb' }),
        attr({ key: 'Storage', value: '512', unit: 'GB' }),
        attr({ key: 'Battery', value: '50', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(r.scorePct).toBe(100);
  });

  it('unit trailing the value is used when no stored unit exists', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: '16 GB', unit: null }),
        attr({ key: 'Storage', value: '512 GB', unit: null }),
        attr({ key: 'Battery', value: '50 Wh', unit: null }),
      ],
      'Laptops'
    );
    expect(r.scorePct).toBe(100);
  });

  it('an unparseable value is unknown, never a failure', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'RAM', value: 'Plenty', unit: 'GB' }),
        attr({ key: 'Storage', value: '512', unit: 'GB' }),
        attr({ key: 'Battery', value: '50', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(ids(r.unknown)).toEqual(['ram']);
    expect(ids(r.below)).toEqual([]);
    // Storage 2 + Battery 2 + Category 1 = 5/8 = 63 (rounded).
    expect(r.scorePct).toBe(63);
  });
});

describe('scorePersona — category and boundaries', () => {
  const work = getPersona('work');

  it('category match is case-insensitive; mismatch lands in below', () => {
    const match = scorePersona(work, [], 'laptops');
    expect(match.categoryMatch).toBe(true);
    expect(ids(match.matched)).toEqual(['category']);

    const mismatch = scorePersona(work, [], 'Cameras');
    expect(mismatch.categoryMatch).toBe(false);
    expect(ids(mismatch.below)).toEqual(['category']);
    expect(mismatch.below[0].actual).toBe('Cameras');
  });

  it('a "Memory" key matches the RAM requirement', () => {
    const r = scorePersona(
      work,
      [
        attr({ key: 'Memory', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '512', unit: 'GB' }),
        attr({ key: 'Battery', value: '50', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(r.scorePct).toBe(100);
  });

  it('exactly the minimum matches; just below fails', () => {
    const atMin = scorePersona(work, [attr({ key: 'RAM', value: '16', unit: 'GB' })], null);
    expect(ids(atMin.matched)).toContain('ram');

    const belowMin = scorePersona(work, [attr({ key: 'RAM', value: '15.9', unit: 'GB' })], null);
    expect(ids(belowMin.below)).toContain('ram');
    expect(ids(belowMin.matched)).not.toContain('ram');
  });

  it('gaming wants more RAM: 16 GB is below for gaming', () => {
    const gaming = getPersona('gaming');
    const r = scorePersona(
      gaming,
      [
        attr({ key: 'RAM', value: '16', unit: 'GB' }),
        attr({ key: 'Storage', value: '1000', unit: 'GB' }),
        attr({ key: 'Battery', value: '70', unit: 'Wh' }),
      ],
      'Laptops'
    );
    expect(ids(r.below)).toEqual(['ram']);
    // Storage 2 + Battery 1 + Category 1 = 4/7 = 57 → Good fit.
    expect(r.scorePct).toBe(57);
    expect(matchVerdict(r.scorePct)).toBe('Good fit');
  });

  it('scorePct is null when nothing is judgeable', () => {
    const emptyPersona: Persona = {
      id: 'work',
      label: 'Work',
      description: '',
      suitableCategories: [],
      requirements: [],
    };
    const r = scorePersona(emptyPersona, [], null);
    expect(r.scorePct).toBeNull();
    expect(matchVerdict(r.scorePct)).toBeNull();

    // Same persona with a category has something to judge.
    const withCategory = scorePersona(emptyPersona, [], 'Laptops');
    expect(withCategory.scorePct).toBe(0); // no suitable categories → below
    expect(matchVerdict(withCategory.scorePct)).toBe('Not ideal');
  });
});

describe('matchVerdict thresholds', () => {
  it('80+ Great, 50–79 Good, below 50 Not ideal', () => {
    expect(matchVerdict(100)).toBe('Great fit');
    expect(matchVerdict(80)).toBe('Great fit');
    expect(matchVerdict(79)).toBe('Good fit');
    expect(matchVerdict(50)).toBe('Good fit');
    expect(matchVerdict(49)).toBe('Not ideal');
    expect(matchVerdict(0)).toBe('Not ideal');
    expect(matchVerdict(null)).toBeNull();
  });
});
