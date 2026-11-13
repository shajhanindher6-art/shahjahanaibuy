/**
 * Category assignment service — maps provider category strings to internal categories.
 *
 * Attempts to match the provider's category string to an existing category in
 * the database. If no match is found, creates a new category hierarchy.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { nearMissSimilarity, NEAR_MISS_THRESHOLD } from '@/lib/fuzzy-match';

export interface CategoryAssignmentResult {
  categoryId: string | null;
  assigned: boolean;
  created: boolean;
  /**
   * Section 18, item 23: the resolved (leaf) category's canonical
   * name — the text `products.category` value that keeps
   * text-based reads working. Non-null exactly when categoryId is
   * non-null.
   */
  name: string | null;
  /**
   * Section 21–25, Stage C (B6): present only when the category
   * was resolved by the fuzzy leg — the incoming part was a
   * near-miss of an existing category (similarity ≥ 0.75) and was
   * matched to it instead of creating a duplicate category row.
   */
  matchedBy?: 'exact' | 'fuzzy';
}

function parseCategoryPath(category: string): string[] {
  return category
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export async function assignCategory(
  supabase: AnySupabaseClient,
  categoryString: string | null
): Promise<CategoryAssignmentResult> {
  if (!categoryString) {
    return { categoryId: null, assigned: false, created: false, name: null };
  }

  const parts = parseCategoryPath(categoryString);
  if (parts.length === 0) {
    return { categoryId: null, assigned: false, created: false, name: null };
  }

  let parentId: string | null = null;
  let created = false;
  let fuzzyMatched = false;
  /** Canonical name of the leaf row when it was fuzzy-matched. */
  let fuzzyLeafName: string | null = null;

  for (const part of parts) {
    const slug = slugify(part);
    const { data } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (data?.id) {
      parentId = data.id;
    } else {
      // Section 21–25, Stage C (B6) — fuzzy leg: a near-miss
      // category part ("Headphone", "Smart Phone") used to
      // silently create a duplicate category row. Before creating,
      // scan the existing categories and match the closest one at
      // similarity ≥ 0.75. A failed list read degrades to "no
      // match" (create as before) rather than blocking ingestion.
      let fuzzyId: string | null = null;
      try {
        const { data: allCategories, error } = await supabase
          .from('categories')
          .select('id, name, slug')
          .limit(200);
        if (!error && allCategories) {
          let best: { id: string; name: string; similarity: number } | null = null;
          for (const row of allCategories as Array<{ id: string; name?: string; slug?: string }>) {
            const similarity = Math.max(
              nearMissSimilarity(part, row.name ?? ''),
              nearMissSimilarity(slug, row.slug ?? '')
            );
            if (similarity >= NEAR_MISS_THRESHOLD && (!best || similarity > best.similarity)) {
              best = { id: row.id, name: row.name ?? part, similarity };
            }
          }
          fuzzyId = best?.id ?? null;
          if (fuzzyId) {
            fuzzyMatched = true;
            // The text column must carry the RESOLVED row's
            // canonical name ("Headphones"), not the near-miss
            // part the feed sent ("Headphone").
            fuzzyLeafName = best?.name ?? null;
            logger.debug('Category: fuzzy-matched near-miss category instead of creating', {
              part,
              similarity: best?.similarity,
            });
          }
        }
      } catch (err) {
        logger.warn('Category: fuzzy match failed, continuing to create', {
          error: String(err),
        });
      }
      if (fuzzyId) {
        parentId = fuzzyId;
        continue;
      }
      const insertData: Record<string, unknown> = {
        name: part,
        slug,
        parent_id: parentId,
        active: true,
      };
      const { data: newCat, error } = await supabase
        .from('categories')
        .insert(insertData)
        .select('id')
        .single();

      if (newCat?.id) {
        parentId = newCat.id;
        created = true;
        logger.debug('Category: created new', { name: part, slug, parentId });
      } else if (error) {
        logger.warn('Category: insert failed', { error: error.message });
      }
    }
  }

  // The resolved leaf category's name is the last path part: the
  // row is matched by that part's slug (or created with that part
  // as its name), so the text column value is the canonical name
  // of the resolved row, not the raw provider path.
  const leafName = parts[parts.length - 1];
  return {
    categoryId: parentId,
    assigned: parentId !== null,
    created,
    name: parentId !== null ? (fuzzyLeafName ?? leafName) : null,
    ...(fuzzyMatched && !created ? { matchedBy: 'fuzzy' as const } : {}),
  };
}
