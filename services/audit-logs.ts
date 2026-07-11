/**
 * Audit log service.
 * Records security-relevant actions for compliance and monitoring.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';

export interface AuditLogInput {
  action: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export async function createAuditLog(
  supabase: AnySupabaseClient,
  userId: string | null,
  input: AuditLogInput
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    action: input.action,
    resource: input.resource ?? null,
    resource_id: input.resourceId ?? null,
    metadata: input.metadata ?? null,
    ip_address: input.ipAddress ?? null,
  });

  if (error) {
    // Audit log failures should not crash the request, but should be logged
    console.error('Failed to create audit log:', error.message);
  }
}
