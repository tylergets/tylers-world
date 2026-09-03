export class UiStore {
  constructor() {
    this.listeners = new Set();
    this.snapshot = 0;
    this.stamp = '';
    this.hudTick = 0;
  }
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  tickHud() { this.hudTick++; }
  commit(game) {
    const player = game.player;
    const stamp = [
      this.hudTick,
      game.hud?.version, game.chat?.version, game.worlds?.version,
      game.mapScreen?.version, game.photos?.version, game.wardrobe?.version, game.townOffice?.version,
      game.townOffice?.context?.fauna?.version, game.townOffice?.context?.edits?.version,
      game.contextVersion,
      player?.inventory?.version, player?.purse?.version, player?.health?.version,
      game.chat?.dialogue?.version ?? -1, game.chat?.dialogue?.shop?.version ?? -1,
    ].join('|');
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.snapshot++;
    for (const listener of this.listeners) listener();
  }
}
