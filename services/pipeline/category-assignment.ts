/**
 * Category assignment service — maps provider category strings to internal categories.
 *
 * Attempts to match the provider's category string to an existing category in
 * the database. If no match is found, creates a new category hierarchy.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

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
    name: parentId !== null ? leafName : null,
  };
}
