/** Reusable temporary hostility for guards reacting to a prohibited display. */
export class Security {
  constructor({
    isGuard = (npc) => npc.props.armedSecurity === true,
    pursuitSpeed = 1.35,
  } = {}) {
    this.isGuard = isGuard;
    this.pursuitSpeed = pursuitSpeed;
    /** NPC -> state that existed before this alert. */
    this.alerts = new Map();
  }

  /**
   * Keep this place's guards alert while `threat` is visible.
   *
   * Returns the first guard who went on alert THIS frame, or null when nobody
   * new did -- the caller uses him to word the warning, because a TSA officer
   * and a pit fighter react to the same gun with very different sentences.
   */
  update(people, threat) {
    const guards = new Set((people?.npcs ?? []).filter(this.isGuard));
    for (const [npc, previous] of this.alerts) {
      if (threat && guards.has(npc)) continue;
      npc.calm();
      npc.hostileSpeedMultiplier = previous.speed;
      if (previous.hostile > 0) npc.enrage(previous.hostile);
      this.alerts.delete(npc);
    }

    if (!threat) return null;
    let started = null;
    for (const npc of guards) {
      if (!this.alerts.has(npc)) {
        this.alerts.set(npc, {
          hostile: npc.hostile,
          speed: npc.hostileSpeedMultiplier,
        });
        started ??= npc;
        npc.enrage();
      } else {
        npc.sustainHostility();
      }
      npc.hostileSpeedMultiplier = this.pursuitSpeed;
    }
    return started;
  }
}
