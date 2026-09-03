/** Owns one open storage interaction and all cross-model transfer invariants. */
export class ContainerPanel {
  constructor() {
    this.open = false;
    this.context = null;
    this.version = 0;
    this.generation = 0;
    this.nameDraft = '';
  }

  show({ inventory, edits, containerId, label }) {
    this.context = { inventory, edits, containerId, label };
    this.nameDraft = edits.containerConfig(containerId)?.name ?? '';
    this.open = true;
    this.generation++;
    this.version++;
  }

  close() {
    if (!this.open && !this.context) return;
    this.commitName();
    this.open = false;
    this.context = null;
    this.generation++;
    this.version++;
  }

  slots(side) {
    if (!this.context) return [];
    return side === 'bag'
      ? this.context.inventory.slots
      : this.context.edits.storedSlots(this.context.containerId);
  }

  config() {
    return this.context?.edits.containerConfig(this.context.containerId) ?? { name: null, allow: null };
  }

  setNameDraft(name) {
    this.nameDraft = String(name).slice(0, 40);
    this.version++;
  }

  commitName() {
    if (!this.context) return false;
    const changed = this.context.edits.setContainerName(this.context.containerId, this.nameDraft);
    this.nameDraft = this.context.edits.containerConfig(this.context.containerId)?.name ?? '';
    if (!changed) return false;
    this.version++;
    return true;
  }

  representedTypes() {
    return this.context?.edits.representedStoredTypes(this.context.containerId) ?? [];
  }

  setUnfiltered(enabled) {
    if (!this.context) return false;
    const allow = enabled ? null : this.representedTypes();
    if (!this.context.edits.setContainerAllowList(this.context.containerId, allow)) return false;
    this.version++;
    return true;
  }

  toggleType(typeId, enabled) {
    if (!this.context) return false;
    const current = this.config().allow;
    if (current === null) return false;
    const allow = new Set(current);
    if (enabled) allow.add(typeId); else allow.delete(typeId);
    if (!this.context.edits.setContainerAllowList(this.context.containerId, [...allow])) return false;
    this.version++;
    return true;
  }

  /** Move one whole visible stack to one exact slot, atomically. */
  transfer(from, fromIndex, to, toIndex) {
    if (!this.open || !this.context || from === to
      || !['bag', 'container'].includes(from) || !['bag', 'container'].includes(to)) return false;
    const { inventory, edits, containerId } = this.context;
    const stack = from === 'bag' ? inventory.slot(fromIndex) : edits.storedSlot(containerId, fromIndex);
    if (!stack) return false;

    const fits = to === 'bag'
      ? inventory.canAddTo(toIndex, stack.typeId, stack.count)
      : edits.canAddStoredTo(containerId, toIndex, stack.typeId, stack.count);
    if (!fits) return false;

    const removed = from === 'bag'
      ? inventory.removeFrom(fromIndex, stack.count)
      : edits.removeStoredFrom(containerId, fromIndex, stack.count);
    if (!removed) return false;
    const added = to === 'bag'
      ? inventory.addTo(toIndex, removed.typeId, removed.count)
      : edits.addStoredTo(containerId, toIndex, removed.typeId, removed.count);
    if (!added) {
      // Defensive rollback. The synchronous capacity check above makes this
      // unreachable unless a model contract changes underneath this module.
      if (from === 'bag') inventory.addTo(fromIndex, removed.typeId, removed.count);
      else edits.addStoredTo(containerId, fromIndex, removed.typeId, removed.count);
      return false;
    }
    this.version++;
    return true;
  }

  /** Click/tap fallback: choose the first exact destination that fits. */
  transferFirst(from, fromIndex) {
    const to = from === 'bag' ? 'container' : 'bag';
    const stack = this.slots(from)[fromIndex];
    if (!stack) return false;
    const destination = this.slots(to).findIndex((_, index) => to === 'bag'
      ? this.context.inventory.canAddTo(index, stack.typeId, stack.count)
      : this.context.edits.canAddStoredTo(this.context.containerId, index, stack.typeId, stack.count));
    return destination >= 0 && this.transfer(from, fromIndex, to, destination);
  }
}
