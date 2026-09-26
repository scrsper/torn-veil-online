import { parentPort } from 'node:worker_threads';
import { stringifyEventTable } from '../sim/persist/eventTable';
import { stringifySnapshot } from '../sim/persist/json';

// This worker receives owned bytes, never references into the running canonical world.
parentPort!.on('message', (bytes: Uint8Array) => {
  try {
    const start = performance.now();
    const snapshot = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'));
    if (snapshot.eventEncoding !== undefined || !Array.isArray(snapshot.events)) throw new Error('Expected an unpacked canonical snapshot');
    const table = stringifyEventTable(snapshot.events);
    snapshot.eventEncoding = { format: table.format, appearances: table.appearances };
    const result = new TextEncoder().encode(stringifySnapshot(snapshot, { events: table.rows }));
    parentPort!.postMessage({ bytes: result, encodeMs: performance.now() - start }, [result.buffer]);
  } catch (error) { parentPort!.postMessage({ error: String(error) }); }
});
