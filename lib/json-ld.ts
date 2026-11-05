/**
 * JSON-LD serialization for inline <script type="application/ld+json">.
 *
 * Plain JSON.stringify does NOT escape `<`, so a `</script>` sequence
 * inside the data (a product name or description) would close the
 * script element and let the rest of the string parse as HTML — a
 * stored-XSS vector if that data ever becomes user-influenced.
 * Escaping `<` as \u003c keeps the JSON valid (JSON parsers decode
 * the escape) while making breakout impossible.
 */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
