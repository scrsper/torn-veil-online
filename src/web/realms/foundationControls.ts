/** Foundation-only lifecycle UI. The server grants availability and owns saving. */
export class FoundationControls {
  private enabled = false;
  private requested = false;
  private saved = false;
  private button: HTMLButtonElement | null = null;
  private panel: HTMLElement | null = null;
  constructor(private ui: HTMLElement, private release: () => void, private send: (value: object) => void) {}

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    const heading = this.ui.querySelector('.rv-heading');
    const kicker = this.ui.querySelector('.rv-kicker span');
    if (kicker) kicker.textContent = 'TOWN FOUNDATION';
    for (const id of ['rv-portal', 'rv-tower', 'rv-universe', 'rv-ascend']) {
      const node = this.ui.querySelector<HTMLElement>('#' + id);
      if (node) node.hidden = true;
    }
    const note = this.ui.querySelector('.rv-journal .rv-note');
    if (note) note.textContent = 'This foundation has its own saved character, injuries and belongings. Save and quit checkpoints the world and stops its host. Run the Foundation launcher again to Continue.';
    const destination = this.ui.querySelector('#rv-destination');
    if (destination) destination.textContent = 'Town and forest trail';
    this.button = document.createElement('button');
    this.button.id = 'foundation-quit';
    this.button.textContent = 'Save and quit';
    this.button.style.pointerEvents = 'auto';
    this.button.addEventListener('click', () => {
      if (this.requested) return;
      this.requested = true;
      this.release();
      this.button!.disabled = true;
      this.show('Saving your foundation…', 'Waiting for the host to checkpoint. Keep this tab open.');
      this.send({ type: 'foundation_quit' });
    });
    heading?.append(this.button);
  }

  update(message: { status?: string; error?: string }): void {
    if (!this.enabled) return;
    this.requested = true;
    this.release();
    if (message.status === 'saved') {
      this.saved = true;
      this.show('World saved', 'The checkpoint is complete. Closing the host…');
    } else if (message.status === 'failed') {
      this.saved = false;
      this.show('Save did not complete', 'The host is stopping with a persistence error. Keep the save and journal intact; inspect the launcher log before continuing.');
    } else this.show('Saving your foundation…', 'Waiting for the host to checkpoint. Keep this tab open.');
  }

  closed(event: CloseEvent): boolean {
    if (!this.enabled || !this.requested) return false;
    this.show(this.saved && event.code === 1000 ? 'Foundation saved and closed' : 'Shutdown needs review',
      this.saved && event.code === 1000
        ? 'Run Play Torn Veil Foundation.cmd again to Continue with this character.'
        : 'A successful final checkpoint was not confirmed. Keep the save and journal intact and inspect the launcher log.');
    return true;
  }

  private show(title: string, detail: string): void {
    if (!this.panel) {
      this.panel = document.createElement('section');
      this.panel.className = 'rv-modal';
      this.panel.id = 'foundation-shutdown';
      this.panel.setAttribute('role', 'status');
      this.panel.setAttribute('aria-live', 'polite');
      this.ui.append(this.panel);
    }
    this.panel.replaceChildren();
    const h = document.createElement('h2'), p = document.createElement('p');
    h.textContent = title; p.textContent = detail;
    this.panel.append(h, p);
    const loading = this.ui.querySelector<HTMLElement>('#rv-loading');
    if (loading) loading.hidden = true;
  }
}
