'use client';

import { useEffect, useState, createElement } from 'react';
import { Box, Cuboid, Ruler } from 'lucide-react';

/**
 * Universal Web-AR / 3D Product Visualizer.
 *
 * HONESTY RULES (do not weaken them):
 * - Dimensions are rendered ONLY when real spec dimensions exist for
 *   the product. Today no catalog product carries dimensions, so the
 *   honest default is the "no dimensions recorded" note — never a
 *   guessed size.
 * - A generic bounding box is labeled "dimension diagram, not the
 *   product's exact shape". It shows proportions only.
 * - The <model-viewer> AR/3D slot activates ONLY when a real model URL
 *   exists for the product. With no model (the expected state for all
 *   catalog products today), the component renders the dimensions
 *   section + the honest "No 3D model available" note and NOTHING that
 *   looks like a 3D model. The model-viewer script is loaded lazily
 *   only in the model case, so the no-model case stays lightweight.
 * - No dimension and no 3D model is ever invented or generated here.
 */

export interface ProductDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export function ProductVisualizer({
  productName,
  dimensions,
  modelUrl,
}: {
  productName: string;
  dimensions: ProductDimensions | null;
  modelUrl: string | null;
}) {
  const [modelViewerReady, setModelViewerReady] = useState(false);

  useEffect(() => {
    if (!modelUrl) return;
    if (typeof document === 'undefined') return;
    if (document.querySelector('script[data-model-viewer]')) {
      setModelViewerReady(true);
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.dataset.modelViewer = 'true';
    script.src = 'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
    script.onload = () => setModelViewerReady(true);
    document.head.appendChild(script);
  }, [modelUrl]);

  // Scaled box: longest edge maps to 220px, others proportionally.
  let boxStyle: { width: number; height: number; depth: number } | null = null;
  if (dimensions) {
    const max = Math.max(dimensions.lengthCm, dimensions.widthCm, dimensions.heightCm, 1);
    boxStyle = {
      width: Math.max(24, Math.round((dimensions.lengthCm / max) * 220)),
      height: Math.max(24, Math.round((dimensions.heightCm / max) * 220)),
      depth: Math.max(12, Math.round((dimensions.widthCm / max) * 90)),
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Box className="h-5 w-5 text-blue-500" />
        <h4 className="font-semibold">Size &amp; 3D view</h4>
      </div>

      {modelUrl ? (
        <div>
          {modelViewerReady ? (
            createElement('model-viewer', {
              src: modelUrl,
              alt: `3D model of ${productName}`,
              ar: true,
              'camera-controls': true,
              'auto-rotate': true,
              style: { width: '100%', height: '320px', background: '#f8fafc' },
            })
          ) : (
            <p className="text-sm text-muted-foreground">Loading 3D viewer…</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            AR view uses the product&apos;s real 3D model file. Tap the AR button on a
            supported phone to place it in your room.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No 3D model available for this product — AR view requires a 3D model file.
        </p>
      )}

      {dimensions && boxStyle ? (
        <div>
          <div
            className="relative rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900"
            aria-label={`Dimension diagram for ${productName}`}
          >
            <div
              className="rounded border-2 border-blue-400 bg-blue-100/70 dark:bg-blue-900/40"
              style={{
                width: boxStyle.width,
                height: boxStyle.height,
                boxShadow: `${boxStyle.depth}px ${boxStyle.depth}px 0 rgba(59, 130, 246, 0.15)`,
              }}
            />
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <Ruler className="h-3 w-3" />
              {dimensions.lengthCm} × {dimensions.widthCm} × {dimensions.heightCm} cm
              (L × W × H)
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Dimension diagram — shows relative proportions only, not the product&apos;s
            exact shape. The 10 cm scale bar below is drawn to the same scale as the box.
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <div
              className="h-2 bg-slate-400"
              style={{
                width: Math.max(
                  8,
                  Math.round(
                    (10 /
                      Math.max(
                        dimensions.lengthCm,
                        dimensions.widthCm,
                        dimensions.heightCm,
                        1
                      )) *
                      220
                  )
                ),
              }}
            />
            <span>10 cm</span>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Cuboid className="mt-0.5 h-4 w-4 flex-shrink-0" />
          No dimensions recorded for this product, so no size diagram is shown. Dimensions
          are never estimated here.
        </p>
      )}
    </div>
  );
}
