/**
 * Zero-waste & upcycling blueprint ideas (Option 10, Feature 1).
 *
 * TEMPLATE-BASED IDEAS ONLY, derived from the product's REAL category.
 * Nothing here was tested, verified, or endorsed by SmartBuy, and no
 * blueprint is ever presented as a safe step-by-step guide: every idea
 * carries the "Idea — not a tested/verified guide" label plus the safety
 * disclaimers rendered by the component, including a lithium-battery
 * warning for battery-containing categories. When reuse is not suitable,
 * responsible e-waste recycling is the stated default.
 */

export interface UpcycleIdea {
  title: string;
  description: string;
  /** Easy | Moderate | Advanced — a rough effort hint, not a safety rating. */
  difficulty: 'Easy' | 'Moderate' | 'Advanced';
}

export interface UpcycleBlueprintSet {
  category: string;
  /** True when products in this category typically contain a lithium battery. */
  batteryRisk: boolean;
  ideas: UpcycleIdea[];
}

const BATTERY_CATEGORIES = new Set(['Laptops', 'Phones', 'Wearables', 'Headphones']);

const IDEAS: Record<string, UpcycleIdea[]> = {
  Laptops: [
    {
      title: 'Home media server',
      description:
        'An old but working laptop can serve films, music, and photos to the home network instead of being discarded.',
      difficulty: 'Moderate',
    },
    {
      title: 'Digital photo frame / info display',
      description:
        'With the lid open on a desk or wall mount, an old laptop can show photos, a calendar, or a dashboard.',
      difficulty: 'Easy',
    },
    {
      title: 'Secondary monitor / terminal',
      description:
        'A working screen and keyboard can become a second display or a dedicated terminal for one task.',
      difficulty: 'Moderate',
    },
    {
      title: 'Parts donor for an identical model',
      description:
        'Working parts (screen, keyboard, RAM, storage) can extend the life of the same model — never mix incompatible parts.',
      difficulty: 'Advanced',
    },
  ],
  Phones: [
    {
      title: 'Home security / baby monitor camera',
      description:
        'A working phone camera can serve as a fixed indoor camera for one room, on a charger, with a camera app.',
      difficulty: 'Easy',
    },
    {
      title: 'Dedicated music / podcast player',
      description:
        'An old phone with a speaker or headphone jack can become a kitchen or car music player, offline.',
      difficulty: 'Easy',
    },
    {
      title: 'E-reader / recipe tablet',
      description:
        'A phone with a readable screen can live in the kitchen or by the bed as a single-purpose reader.',
      difficulty: 'Easy',
    },
  ],
  Headphones: [
    {
      title: 'Wired desk speakers (driver reuse)',
      description:
        'Working headphone drivers can be mounted in a simple enclosure as small desk speakers by someone experienced with audio wiring.',
      difficulty: 'Advanced',
    },
    {
      title: 'Spare parts for the same model',
      description:
        'Ear cushions, cables, and headbands can repair an identical pair instead of replacing it.',
      difficulty: 'Easy',
    },
  ],
  Cameras: [
    {
      title: 'Dedicated time-lapse camera',
      description:
        'An older camera can be left in one spot for time-lapse or wildlife shots instead of buying a new one.',
      difficulty: 'Moderate',
    },
    {
      title: 'Webcam for video calls',
      description:
        'A camera with a clean video output can serve as a desk webcam for calls and streaming.',
      difficulty: 'Moderate',
    },
  ],
  Wearables: [
    {
      title: 'Dedicated sleep / activity tracker',
      description:
        'An older wearable can stay on the bedside table as a sleep tracker, keeping the newer device for daytime.',
      difficulty: 'Easy',
    },
    {
      title: 'Spare parts for the same model',
      description:
        'Straps, chargers, and cases can extend the life of an identical device.',
      difficulty: 'Easy',
    },
  ],
  Accessories: [
    {
      title: 'Repurpose as a desk organiser',
      description:
        'Sturdy accessory cases and mounts can be reused as desk or cable organisers instead of being thrown away.',
      difficulty: 'Easy',
    },
  ],
};

/**
 * Returns the blueprint set for a category, or null when the category has
 * no template ideas — in that case the UI shows the recycling note only
 * and never invents a blueprint.
 */
export function blueprintsForCategory(category: string | null): UpcycleBlueprintSet | null {
  if (!category) return null;
  const ideas = IDEAS[category];
  if (!ideas || ideas.length === 0) return null;
  return { category, batteryRisk: BATTERY_CATEGORIES.has(category), ideas };
}
