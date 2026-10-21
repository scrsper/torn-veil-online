import { startTown } from '../src/web/town/main';

startTown().catch(e => {
  console.error(e);
  const el = document.getElementById('loading'); if (el) el.textContent = `The town failed to start: ${String((e as Error)?.message ?? e)}`;
});
