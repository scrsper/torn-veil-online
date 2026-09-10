import type { GameSim } from '../../sim/runtime/gameSim';

/** Normal inspection presents avatar beliefs. Developer Inspector remains a separate tool. */
export class KnowledgePanel {
  private readonly el = document.createElement('aside');
  constructor(private readonly game: GameSim) {
    this.el.id = 'person-knowledge';
    Object.assign(this.el.style, { display: 'none', position: 'fixed', right: '24px', top: '90px', width: '360px', maxHeight: '70vh', overflow: 'auto', padding: '20px', background: '#171c24', color: '#ede8dd', border: '1px solid #67717f', borderRadius: '8px', zIndex: '70' });
    document.body.append(this.el);
    window.addEventListener('keydown', e => { if (e.code === 'Escape') this.el.style.display = 'none'; });
  }
  show(subject: string): void {
    const view = this.game.beliefs('local', subject); if (!view) return;
    this.el.replaceChildren(); this.el.style.display = 'block';
    const heading = document.createElement('h3'); heading.textContent = view.name; this.el.append(heading);
    const identity = document.createElement('p'); identity.textContent = view.knownName ? 'A name learned through your history.' : 'Your avatar has not learned this person’s name.'; this.el.append(identity);
    const list = document.createElement('ul');
    for (const belief of view.beliefs) { const row = document.createElement('li'); row.textContent = `${belief.interpretation} (${Math.round(belief.confidence * 100)}% confidence; ${belief.evidence.length} pieces of evidence)`; list.append(row); }
    if (!view.beliefs.length) { const row = document.createElement('li'); row.textContent = 'No established impressions yet.'; list.append(row); }
    this.el.append(list);
    for (const observation of view.observations.slice(-5)) { const row = document.createElement('p'); row.textContent = `${observation.source.type}: ${observation.action.replaceAll('_', ' ')}`; this.el.append(row); }
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => { this.el.style.display = 'none'; }; this.el.append(close);
  }
}
