/**
 * API v1 health check endpoint.
 * GET /api/v1/health — returns service status.
 */

import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';

import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'health' });

  return apiSuccess({
    status: 'healthy',
    service: 'SmartBuy AI API',
    version: 'v1',
    timestamp: new Date().toISOString(),
  });
}
