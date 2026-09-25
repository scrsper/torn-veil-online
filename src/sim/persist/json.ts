/** Encode plain checkpoint fields separately so a dictionary-shaped subsystem does not
 * force the slower engine JSON path for the whole world. Same bytes and schema, synchronous
 * snapshot boundary, no caching or mutable state escaping into asynchronous work. */
export function stringifySnapshot(snapshot: Record<string, unknown>): string {
  const fields: string[] = [];
  for (const [key, value] of Object.entries(snapshot)) {
    // Smaller homogeneous array segments also contain slow-path fallbacks and temporary
    // encoder buffers. Joining their JSON interiors is lossless for these plain arrays.
    let encoded: string | undefined;
    if (Array.isArray(value) && value.length > 512) {
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += 512) chunks.push(JSON.stringify(value.slice(i, i + 512)).slice(1, -1));
      encoded = '[' + chunks.join(',') + ']';
    } else encoded = JSON.stringify(value);
    if (encoded !== undefined) fields.push(JSON.stringify(key) + ':' + encoded);
  }
  return '{' + fields.join(',') + '}';
}
