import { ImageResponse } from 'next/server';

/**
 * Deals section Open Graph image (1200×630), generated at runtime.
 * Same pattern as the root opengraph-image.tsx (app/opengraph-image.tsx):
 * Next auto-discovers this route and uses it for the og:image /
 * twitter:image meta tags of /deals.
 */
export const alt = 'SmartBuy AI deals — AI-ranked deals and coupons';
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #6d28d9 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 6,
            color: '#93c5fd',
            marginBottom: 16,
          }}
        >
          SMARTBUY AI
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
          }}
        >
          <div>AI-Ranked</div>
          <div>Deals</div>
        </div>
        <div style={{ fontSize: 30, color: '#dbeafe', marginTop: 24 }}>
          Flash sales · Coupons · Hidden discounts
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
