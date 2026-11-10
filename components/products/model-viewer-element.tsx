'use client';

import { createElement } from 'react';
// Bundled @google/model-viewer (npm dependency, NOT the unpkg CDN
// script): importing it registers the <model-viewer> custom element.
// This module is only ever loaded through next/dynamic with ssr:false
// from product-visualizer.tsx, and only when a real model URL exists,
// so it stays out of the product page's First Load JS (350 kB budget).
import '@google/model-viewer';

/**
 * Thin wrapper around the <model-viewer> custom element.
 * AR uses the OS viewer (scene-viewer / Quick Look) — no in-page
 * camera, so no CSP / Permissions-Policy change is needed.
 */
export default function ModelViewerElement({
  modelUrl,
  productName,
}: {
  modelUrl: string;
  productName: string;
}) {
  return createElement('model-viewer', {
    src: modelUrl,
    alt: `3D model of ${productName}`,
    ar: true,
    'camera-controls': true,
    'auto-rotate': true,
    style: { width: '100%', height: '320px', background: '#f8fafc' },
  });
}
