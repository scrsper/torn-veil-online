/** Close only the owned journal, preserving a failed tail for its matching engine. */
export async function checkpointForShutdown(io: {
  disconnect(): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}, priorError = ''): Promise<{ saved: true } | { saved: false; error: string }> {
  let error = priorError;
  if (!error) {
    try {
      io.disconnect();
      await io.flush();
      await io.close();
      return { saved: true };
    } catch (cause) { error = String(cause); }
  }
  try { await io.abort(); }
  catch (cause) { error += '; journal recovery close: ' + String(cause); }
  return { saved: false, error };
}
