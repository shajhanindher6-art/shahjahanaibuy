/**
 * API response helpers.
 * All API route handlers return responses using these helpers to ensure
 * a consistent response format across the entire API.
 */

import { NextResponse } from 'next/server';
import type { ApiSuccess, ApiError, ApiErrorCode } from '@/types/api';

export function apiSuccess<T>(data: T, status = 200, meta?: ApiSuccess<T>['meta']): NextResponse {
  const body: ApiSuccess<T> = { success: true, data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>
): NextResponse {
  const body: ApiError = {
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  };
  return NextResponse.json(body, { status });
}

export function badRequest(message = 'Bad request', details?: Record<string, unknown>) {
  return apiError('BAD_REQUEST', message, 400, details);
}

export function unauthorized(message = 'Unauthorized') {
  return apiError('UNAUTHORIZED', message, 401);
}

export function forbidden(message = 'Forbidden') {
  return apiError('FORBIDDEN', message, 403);
}

export function notFound(message = 'Not found') {
  return apiError('NOT_FOUND', message, 404);
}

export function conflict(message = 'Conflict') {
  return apiError('CONFLICT', message, 409);
}

export function rateLimited(message = 'Too many requests', details?: Record<string, unknown>) {
  return apiError('RATE_LIMITED', message, 429, details);
}

export function validationError(message = 'Validation failed', details?: Record<string, unknown>) {
  return apiError('VALIDATION_ERROR', message, 422, details);
}

export function internalError(message = 'Internal server error') {
  return apiError('INTERNAL_ERROR', message, 500);
}

export function serviceUnavailable(message = 'Service unavailable') {
  return apiError('SERVICE_UNAVAILABLE', message, 503);
}
