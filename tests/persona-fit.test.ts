import { describe, expect, it } from 'vitest';
import {
  enginePersonaFor,
  getUiPersona,
  parsePersonaFitParams,
  rankPersonaMatches,
  PERSONA_FIT_SCORING_NOTE,
  UI_PERSONAS,
  UI_TO_ENGINE_PERSONA,
  type PersonaFitProductInput,
} from '@/lib/persona-fit';
import { getPersona } from '@/services/persona-matcher';

function product(
  partial: Partial<PersonaFitProductInput> & { slug: string }
): PersonaFitProductInput {
  return {
    id: partial.slug,
    name: partial.name ?? 'Product',
    brand: partial.brand ?? null,
    category: partial.category ?? null,
    priceUsd: partial.priceUsd ?? 500,
    dataFreshness: '2026-11-02',
    attributes: partial.attributes ?? [],
    ...partial,
  };
}

describe('UI_PERSONAS — the 6-to-4 mapping', () => {
  it('offers exactly the six audit personas', () => {
    expect(UI_PERSONAS.map((p) => p.id)).toEqual([
      'student',
      'creator',
      'gamer',
      'traveler',
      'home-office',
      'fitness',
    ]);
  });

  it('maps the three direct personas onto their engine personas', () => {
    expect(getUiPersona('student')?.enginePersonaId).toBe('student');
    expect(getUiPersona('creator')?.enginePersonaId).toBe('content');
    expect(getUiPersona('gamer')?.enginePersonaId).toBe('gaming');
  });

  it('maps Traveler, Home Office and Fitness onto Work — and says so', () => {
    for (const id of ['traveler', 'home-office', 'fitness'] as const) {
      const ui = getUiPersona(id);
      expect(ui?.enginePersonaId).toBe('work');
      // The mapping is labelled, never hidden.
      expect(ui?.mappingNote).toMatch(/no .* persona/i);
      expect(ui?.mappingNote).toMatch(/Work persona/);
    }
  });

  it('every mapped engine persona exists in the engine', () => {
    for (const ui of UI_PERSONAS) {
      expect(enginePersonaFor(ui)).toEqual(getPersona(ui.enginePersonaId));
    }
  });

  it('UI_TO_ENGINE_PERSONA is the single mapping table the entries derive from', () => {
    // Stage 2, S2-3: one table, six UI personas, four engine ids.
    expect(UI_TO_ENGINE_PERSONA).toEqual({
      student: 'student',
      creator: 'content',
      gamer: 'gaming',
      traveler: 'work',
      'home-office': 'work',
      fitness: 'work',
    });
    expect(new Set(Object.values(UI_TO_ENGINE_PERSONA)).size).toBe(4);
    for (const ui of UI_PERSONAS) {
      expect(ui.enginePersonaId).toBe(UI_TO_ENGINE_PERSONA[ui.id]);
    }
  });

  it('returns null for an unknown persona id', () => {
    expect(getUiPersona('astronaut')).toBeNull();
    expect(getUiPersona(null)).toBeNull();
  });
});

describe('parsePersonaFitParams', () => {
  it('parses a normal ?persona=&budget= pair', () => {
    expect(parsePersonaFitParams({ persona: 'student', budget: '1000' })).toEqual({
      persona: expect.objectContaining({ id: 'student' }),
      personaError: null,
      budgetUsd: 1000,
      budgetError: null,
      hasQuery: true,
    });
  });

  it('accepts a persona without a budget and a budget without a persona', () => {
    const onlyPersona = parsePersonaFitParams({ persona: 'gamer' });
    expect(onlyPersona.persona?.id).toBe('gamer');
    expect(onlyPersona.budgetUsd).toBeNull();
    expect(onlyPersona.budgetError).toBeNull();

    const onlyBudget = parsePersonaFitParams({ budget: '250' });
    expect(onlyBudget.persona).toBeNull();
    expect(onlyBudget.budgetUsd).toBe(250);
  });

  it('returns nulls when nothing is given (form state, not an error)', () => {
    expect(parsePersonaFitParams({})).toEqual({
      persona: null,
      personaError: null,
      budgetUsd: null,
      budgetError: null,
      hasQuery: false,
    });
  });

  it('rejects an unknown persona instead of silently defaulting', () => {
    const parsed = parsePersonaFitParams({ persona: 'astronaut', budget: '1000' });
    expect(parsed.persona).toBeNull();
    expect(parsed.personaError).toMatch(/Unknown persona/);
  });

  it('rejects a non-positive or non-numeric budget', () => {
    expect(parsePersonaFitParams({ budget: 'free' }).budgetError).toMatch(/positive number/);
    expect(parsePersonaFitParams({ budget: '-5' }).budgetError).toMatch(/positive number/);
    expect(parsePersonaFitParams({ budget: '0' }).budgetError).toMatch(/positive number/);
  });

  it('strips $ and commas from the budget', () => {
    expect(parsePersonaFitParams({ budget: '$1,250' }).budgetUsd).toBe(1250);
  });
});

describe('rankPersonaMatches — honesty rules', () => {
  const student = getPersona('student');

  it('matches on category fit only while no specs are recorded', () => {
    const matches = rankPersonaMatches(
      student,
      [
        product({ slug: 'macbook-air-13', name: 'MacBook Air 13', category: 'Laptops' }),
        product({ slug: 'canon-eos-r10', name: 'Canon EOS R10', category: 'Cameras' }),
      ],
      null
    );
    // Laptops fits Student; Cameras does not.
    expect(matches.map((m) => m.slug)).toEqual(['macbook-air-13']);
    const match = matches[0];
    // The only judged requirement is the category — every spec is unknown.
    expect(match.score.categoryMatch).toBe(true);
    expect(match.score.matched.map((m) => m.requirement.id)).toEqual(['category']);
    expect(match.score.unknown.map((u) => u.requirement.id)).toEqual([
      'ram',
      'storage',
      'battery',
    ]);
    // Engine score is the raw category-only fraction (1 of 8 weight) —
    // shown, never dressed up as a fit percentage.
    expect(match.score.scorePct).toBe(13);
    // …and the engine verdict is NOT shown while no spec was judged.
    expect(match.specsJudged).toBe(false);
    expect(match.verdict).toBeNull();
  });

  it('returns an honest empty list when nothing fits — never a forced pick', () => {
    expect(
      rankPersonaMatches(
        student,
        [product({ slug: 'canon-eos-r10', category: 'Cameras' })],
        null
      )
    ).toEqual([]);
  });

  it('treats the budget as a hard filter and drops unpriced products', () => {
    const matches = rankPersonaMatches(
      student,
      [
        product({ slug: 'cheap-laptop', category: 'Laptops', priceUsd: 800 }),
        product({ slug: 'pricey-laptop', category: 'Laptops', priceUsd: 2000 }),
        product({ slug: 'unpriced-laptop', category: 'Laptops', priceUsd: null }),
      ],
      1000
    );
    expect(matches.map((m) => m.slug)).toEqual(['cheap-laptop']);
  });

  it('ranks by engine score, then lowest price', () => {
    const matches = rankPersonaMatches(
      student,
      [
        product({ slug: 'pricey-phone', name: 'Pricey Phone', category: 'Smartphones', priceUsd: 900 }),
        product({ slug: 'cheap-laptop', name: 'Cheap Laptop', category: 'Laptops', priceUsd: 400 }),
      ],
      null
    );
    // Same category-only score (13) — cheaper first.
    expect(matches.map((m) => m.slug)).toEqual(['cheap-laptop', 'pricey-phone']);
  });

  it('shows the engine verdict once a spec requirement is judged', () => {
    const matches = rankPersonaMatches(
      student,
      [
        product({
          slug: 'specced-laptop',
          category: 'Laptops',
          attributes: [
            { key: 'RAM', value: '16 GB', unit: null },
            { key: 'Storage', value: '512 GB', unit: null },
            { key: 'Battery', value: '60 Wh', unit: null },
          ],
        }),
      ],
      null
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].specsJudged).toBe(true);
    // All three specs met + category fit = 8/8 → Great fit.
    expect(matches[0].score.scorePct).toBe(100);
    expect(matches[0].verdict).toBe('Great fit');
  });

  it('carries the scoring note on every result', () => {
    expect(PERSONA_FIT_SCORING_NOTE).toBe(
      'Scored on category and price only — no specs recorded yet.'
    );
  });
});
