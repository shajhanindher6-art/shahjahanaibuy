import { ImageResponse } from 'next/server';

/**
 * Categories section Open Graph image (1200×630), generated at runtime.
 * Same pattern as the root opengraph-image.tsx (app/opengraph-image.tsx):
 * Next auto-discovers this route and uses it for the og:image /
 * twitter:image meta tags of /categories.
 */
export const alt = 'SmartBuy AI categories — browse the catalog by category';
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
          <div>Browse by</div>
          <div>Category</div>
        </div>
        <div style={{ fontSize: 30, color: '#dbeafe', marginTop: 24 }}>
          Laptops · Phones · TVs · Appliances and more
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
