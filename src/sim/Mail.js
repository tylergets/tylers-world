/** Player-owned letters, carried across places and persisted with the save. */
import { itemType } from '../world/itemTypes.js';

function attachmentsOf(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const typeId = entry?.typeId;
    const count = Math.floor(entry?.count ?? 0);
    if (typeof typeId !== 'string' || count < 1) continue;
    try { itemType(typeId); } catch { continue; }
    counts.set(typeId, (counts.get(typeId) ?? 0) + count);
  }
  return [...counts].map(([typeId, count]) => ({ typeId, count }));
}

export class Mail {
  constructor() {
    this.letters = [];
    this.pending = [];
    this.version = 0;
  }

  get unread() { return this.letters.filter((letter) => !letter.read).length; }

  receive(letter) {
    if (!letter?.id || this.letters.some((entry) => entry.id === letter.id)) return false;
    this.letters.unshift({
      id: String(letter.id),
      from: String(letter.from ?? 'Unknown sender'),
      subject: String(letter.subject ?? 'A letter'),
      body: String(letter.body ?? ''),
      read: false,
      attachments: attachmentsOf(letter.attachments),
      claimed: false,
    });
    this.version++;
    return true;
  }

  /** Queue any uniquely identified letter for a future morning. */
  queue(letter, dueDay) {
    if (!letter?.id || this.letters.some((entry) => entry.id === letter.id)
      || this.pending.some((entry) => entry.id === letter.id)) return false;
    this.pending.push({
      id: String(letter.id),
      dueDay: Math.max(1, Math.floor(dueDay)),
      from: String(letter.from ?? 'Unknown sender'),
      subject: String(letter.subject ?? 'A letter'),
      body: String(letter.body ?? ''),
      attachments: attachmentsOf(letter.attachments),
    });
    this.version++;
    return true;
  }

  /** Queue the one letter this person will ever send about being shot. */
  queueHurt(npc, playerName, dueDay) {
    if (!npc?.id) return false;
    return this.queue({
      id: `hurt:${npc.id}`,
      from: String(npc.name ?? 'A neighbour'),
      subject: 'I am still hurting',
      body: `Dear ${playerName},\n\nI am still hurting from being shot. I hope you understand that what you did caused real pain, and it is not something I can simply forget.\n\n${npc.name}`,
    }, dueDay);
  }

  /** Deliver everything due this morning. Returns how many letters arrived. */
  deliver(day) {
    const due = this.pending.filter((letter) => letter.dueDay <= day);
    if (!due.length) return 0;
    this.pending = this.pending.filter((letter) => letter.dueDay > day);
    for (const letter of due) this.receive(letter);
    return due.length;
  }

  read(id) {
    const letter = this.letters.find((entry) => entry.id === id);
    if (!letter || letter.read) return letter ?? null;
    letter.read = true;
    this.version++;
    return letter;
  }

  /** Move a letter's whole parcel into the bag, or leave all of it attached. */
  claim(id, inventory) {
    const letter = this.letters.find((entry) => entry.id === id);
    if (!letter || letter.claimed || !letter.attachments.length) {
      return { ok: false, message: 'There is nothing to collect.' };
    }
    const emptySlots = inventory.slots.filter((slot) => !slot).length;
    let slotsNeeded = 0;
    for (const attachment of letter.attachments) {
      const max = itemType(attachment.typeId).stack;
      const existingRoom = inventory.slots.reduce((room, slot) => (
        room + (slot?.typeId === attachment.typeId ? max - slot.count : 0)
      ), 0);
      slotsNeeded += Math.ceil(Math.max(0, attachment.count - existingRoom) / max);
      if (slotsNeeded > emptySlots) {
        return { ok: false, message: 'Make room in your pockets first.' };
      }
    }
    for (const attachment of letter.attachments) inventory.add(attachment.typeId, attachment.count);
    letter.claimed = true;
    this.version++;
    return { ok: true, message: 'Parcel collected.' };
  }

  welcome(name, worldName) {
    return this.receive({
      id: 'welcome',
      from: 'Town Hall',
      subject: `Welcome to ${worldName}`,
      body: `Dear ${name},\n\nWelcome to ${worldName}! Your new home is ready for you. We hope you will take some time to meet your neighbours, explore the countryside, and make this place your own.\n\nWe will leave any future letters here in your mailbox.\n\nWarmly,\nTown Hall`,
      attachments: [{ typeId: 'item.apple', count: 1 }],
    });
  }

  snapshot() {
    return {
      letters: this.letters.map((letter) => ({
        ...letter,
        attachments: letter.attachments.map((attachment) => ({ ...attachment })),
      })),
      pending: this.pending.map((letter) => ({
        ...letter,
        attachments: letter.attachments.map((attachment) => ({ ...attachment })),
      })),
    };
  }

  restore(data) {
    this.letters = [];
    this.pending = [];
    const savedLetters = Array.isArray(data) ? data : data?.letters;
    for (const letter of Array.isArray(savedLetters) ? savedLetters : []) {
      if (!letter || typeof letter.id !== 'string' || typeof letter.body !== 'string') continue;
      if (this.letters.some((entry) => entry.id === letter.id)) continue;
      this.letters.push({
        id: letter.id,
        from: String(letter.from ?? 'Unknown sender'),
        subject: String(letter.subject ?? 'A letter'),
        body: letter.body,
        read: letter.read === true,
        attachments: attachmentsOf(letter.attachments),
        claimed: letter.claimed === true,
      });
    }
    for (const letter of Array.isArray(data?.pending) ? data.pending : []) {
      if (!letter || typeof letter.id !== 'string') continue;
      if (!Number.isInteger(letter.dueDay) || typeof letter.body !== 'string') continue;
      if (this.letters.some((entry) => entry.id === letter.id)
        || this.pending.some((entry) => entry.id === letter.id)) continue;
      this.pending.push({
        id: letter.id,
        dueDay: letter.dueDay,
        from: String(letter.from ?? 'A neighbour'),
        subject: String(letter.subject ?? 'A letter'),
        body: letter.body,
        attachments: attachmentsOf(letter.attachments),
      });
    }
    this.version++;
  }
}
