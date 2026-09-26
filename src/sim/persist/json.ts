/** Encode plain checkpoint fields separately so a dictionary-shaped subsystem does not
 * force the slower engine JSON path for the whole world. Same bytes and schema, synchronous
 * snapshot boundary, no caching or mutable state escaping into asynchronous work. */
export function stringifySnapshot(snapshot: Record<string, unknown>, encodedFields: Readonly<Record<string, string>> = {}): string {
  return [...snapshotParts(snapshot, encodedFields)].join('');
}

/** Materialize all parts synchronously before allowing the world to mutate. Callers may then
 * transfer each small immutable part without flattening/copying one giant UTF-16 string. */
export function* snapshotParts(snapshot: Record<string, unknown>, encodedFields: Readonly<Record<string, string>> = {}): Generator<string> {
  yield '{';
  let first = true;
  for (const [key, value] of Object.entries(snapshot)) {
    // Smaller homogeneous array segments also contain slow-path fallbacks and temporary
    // encoder buffers. Joining their JSON interiors is lossless for these plain arrays.
    const size = key === 'persons' ? 8 : 512;
    const supplied = Object.hasOwn(encodedFields, key);
    const segmented = !supplied && Array.isArray(value) && value.length > size;
    const encoded = supplied ? encodedFields[key] : segmented ? null : JSON.stringify(value);
    if (encoded === undefined) continue;
    yield (first ? '' : ',') + JSON.stringify(key) + ':';
    first = false;
    if (segmented) {
      yield '[';
      for (let i = 0; i < value.length; i += size) {
        if (i) yield ',';
        yield JSON.stringify(value.slice(i, i + size)).slice(1, -1);
      }
      yield ']';
    } else yield encoded!;
  }
  yield '}';
}
