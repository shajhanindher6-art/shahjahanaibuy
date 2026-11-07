import { ImageResponse } from 'next/server';
import { appConfig } from '@/lib/config/app';

/**
 * Homepage Open Graph image (1200×630), generated at runtime.
 *
 * Replaces the old static /og-image.png reference in the root layout
 * metadata — that file never existed in public/, so shared links had
 * no preview image. Next auto-discovers this route and uses it for
 * the og:image / twitter:image meta tags.
 */
export const alt = 'SmartBuy AI — AI-Powered Shopping Intelligence';
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
          <div>AI-Powered Shopping</div>
          <div>Intelligence</div>
        </div>
        <div style={{ fontSize: 30, color: '#dbeafe', marginTop: 24 }}>
          Compare prices · Track drops · Find deals
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
