# API DOCUMENTATION — SmartBuy AI

**Base URL:** `https://yourdomain.com`  
**Version:** v1  
**Date:** 2026-07-12

---

## Authentication

All authenticated endpoints require a valid Supabase session cookie. The middleware automatically refreshes the session on every request.

### Auth Endpoints (Supabase Auth)
- **Sign Up**: `POST /sign-up` (page form → Supabase Auth)
- **Sign In**: `POST /sign-in` (page form → Supabase Auth)
- **Sign Out**: Handled client-side via `supabase.auth.signOut()`
- **Password Reset**: `POST /forgot-password` (Supabase Auth)
- **OAuth Callback**: `GET /auth/callback`

---

## Response Format

All API routes return a consistent JSON envelope:

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

### Error Codes
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_REQUEST` | 400 | Invalid request |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 422 | Input validation failed |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service down |

---

## Public Endpoints

### Health
#### `GET /api/v1/health`
Returns service health with component checks.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "SmartBuy AI API",
    "version": "v1",
    "timestamp": "2026-07-12T...",
    "checks": {
      "database": { "status": "up", "latencyMs": 12 },
      "auth": { "status": "up" },
      "stripe": { "status": "not_configured" }
    }
  }
}
```

### Products
#### `GET /api/v1/products`
Query products with filtering and pagination.

**Query Params:** `page`, `pageSize`, `category`, `brand`, `minPrice`, `maxPrice`, `sort`

#### `GET /api/v1/products/[slug]`
Get a single product with full details.

#### `GET /api/v1/products/[slug]/deals`
Get active deals for a product.

#### `GET /api/v1/products/[slug]/merchants`
Get merchant offers for a product.

#### `GET /api/v1/products/[slug]/prices`
Get price history for a product.

#### `GET /api/v1/products/[slug]/reviews`
Get reviews for a product.

### Catalog
#### `GET /api/v1/brands`
List all brands.

#### `GET /api/v1/brands/[slug]`
Get brand detail.

#### `GET /api/v1/categories`
List all categories.

#### `GET /api/v1/categories/[slug]`
Get category detail.

#### `GET /api/v1/merchants`
List all merchants.

#### `GET /api/v1/merchants/[slug]`
Get merchant detail.

#### `GET /api/v1/retailers`
List all retailers.

### Deals & Offers
#### `GET /api/v1/deals`
List active deals.

#### `GET /api/v1/deals/ranked`
Get AI-ranked deals.

#### `GET /api/v1/coupons`
List active coupons.

#### `GET /api/v1/cashback`
List cashback offers.

### System
#### `GET /api/v1/feature-flags`
Get feature flag states.

#### `GET /api/v1/monitoring`
Get system monitoring data.

#### `GET /api/v1/monitoring/providers`
Get provider health status.

#### `GET /api/v1/push/vapid`
Get VAPID public key for push subscriptions.

---

## Authenticated Endpoints

### Alerts
#### `GET /api/v1/alerts`
Get user's price alerts.

#### `POST /api/v1/alerts`
Create a price alert.
**Body:** `{ "productId": "uuid", "targetPrice": number, "channel": "email"|"push" }`

#### `GET /api/v1/alerts/[id]`
Get alert detail.

#### `PUT /api/v1/alerts/[id]`
Update alert.

#### `DELETE /api/v1/alerts/[id]`
Delete alert.

#### `GET /api/v1/alerts/history`
Get alert trigger history.

### AI Features
#### `POST /api/v1/ai-search`
Natural language product search.
**Body:** `{ "query": "string", "pageSize": 10 }`

#### `GET /api/v1/ai-summary/[productId]`
Get AI-generated product summary.

#### `GET /api/v1/predictions/[productId]`
Get AI price predictions.

#### `GET /api/v1/recommendations`
Get personalized recommendations.

#### `POST /api/v1/comparison`
Compare products with AI.
**Body:** `{ "productIds": ["uuid", "uuid"] }`

### Wishlists
#### `GET /api/v1/wishlists`
List user's wishlists.

#### `POST /api/v1/wishlists`
Create wishlist.
**Body:** `{ "name": "string", "description": "string?" }`

#### `GET /api/v1/wishlists/[id]`
Get wishlist detail.

#### `PUT /api/v1/wishlists/[id]`
Update wishlist.

#### `DELETE /api/v1/wishlists/[id]`
Delete wishlist.

#### `POST /api/v1/wishlists/[id]/items`
Add item to wishlist.
**Body:** `{ "productId": "uuid" }`

#### `GET /api/v1/wishlists/[id]/items`
List wishlist items.

#### `DELETE /api/v1/wishlists/[id]/items/[itemId]`
Remove item from wishlist.

### Notifications
#### `GET /api/v1/notifications`
Get user's notification queue.

#### `POST /api/v1/notifications/process`
Process pending notifications (cron).
**Headers:** `Authorization: Bearer <CRON_SECRET>`

#### `POST /api/v1/notifications/digest`
Generate weekly digest for Pro users (cron).
**Headers:** `Authorization: Bearer <CRON_SECRET>`

### Subscriptions & Billing
#### `GET /api/v1/subscriptions`
Get user's subscription.

#### `POST /api/v1/subscriptions`
Update subscription (cancel to free plan).

#### `POST /api/v1/subscriptions/checkout`
Create Stripe Checkout Session.
**Body:** `{ "plan": "pro" }`
**Response:** `{ "url": "https://checkout.stripe.com/..." }`

#### `POST /api/v1/subscriptions/portal`
Create Stripe Customer Portal session.
**Response:** `{ "url": "https://billing.stripe.com/..." }`

#### `GET /api/v1/subscriptions/history`
Get billing history (invoices).

### Push Notifications
#### `POST /api/v1/push/subscribe`
Register browser push subscription.
**Body:** `{ "endpoint": "string", "keys": { "p256dh": "string", "auth": "string" }, "expirationTime": number? }`

#### `DELETE /api/v1/push/subscribe`
Unregister push subscription.
**Query:** `?endpoint=<url-encoded-endpoint>`

### Chat
#### `GET /api/v1/chat/conversations`
List chat conversations.

#### `POST /api/v1/chat/conversations`
Create conversation.

#### `POST /api/v1/chat/messages`
Send message and get AI response.
**Body:** `{ "conversationId": "uuid", "message": "string" }`

### User Data
#### `GET /api/v1/search-history`
Get user's search history.

#### `POST /api/v1/search-history`
Record a search.

#### `GET /api/v1/product-views`
Get user's product views.

#### `POST /api/v1/product-views`
Record a product view.

#### `GET /api/v1/analytics`
Get analytics dashboard data.

#### `POST /api/v1/analytics/events`
Track an analytics event.

#### `GET /api/v1/preferences`
Get user preferences.

#### `POST /api/v1/preferences`
Update user preferences.

#### `GET /api/v1/preferences`
Update notification preferences.

---

## Admin Endpoints

#### `GET /api/v1/admin/analytics`
Get admin analytics (total users, products, alerts, etc.).

#### `GET /api/v1/admin/users`
List all users.

#### `GET /api/v1/admin/audit-logs`
Get admin audit logs.

---

## Webhook Endpoints

#### `POST /api/webhooks/stripe`
Stripe webhook handler. Verifies signature and processes:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`

**Headers:** `stripe-signature: <signature>`
**Body:** Raw Stripe event payload

---

## Rate Limiting

All API endpoints are rate-limited to 100 requests per 60 seconds per IP address. Exceeding the limit returns `429 RATE_LIMITED`.

---

## Pagination

List endpoints support:
- `page` — Page number (default: 1)
- `pageSize` — Items per page (default: 20, max: 100)

**Response includes:**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 150
  }
}
```
