import { makeRng } from '../core/rng.js';
import { ITEM_TYPES, itemType } from '../world/itemTypes.js';

const eligibleItems = () => Object.entries(ITEM_TYPES)
  .filter(([typeId, type]) => !typeId.startsWith('item.ticket.')
    && Number.isFinite(type.value) && type.value > 0)
  .map(([typeId, type]) => ({ typeId, type }));

export class Marketplace {
  constructor() {
    this.reservations = new Map();
    this.sold = new Set();
    this.version = 0;
  }

  listings(day, townId, sellers) {
    const items = eligibleItems();
    const current = sellers.map((seller) => {
      const rng = makeRng(`classifieds:${townId}:${seller.id}:${day}`);
      const { typeId, type } = items[Math.floor(rng() * items.length)];
      const quantity = type.stack > 1 ? 1 + Math.floor(rng() * Math.min(3, type.stack)) : 1;
      const price = Math.max(1, Math.round(type.value * quantity * (0.45 + rng() * 0.3)));
      const id = `classified:${townId}:${day}:${seller.id}`;
      return { id, day, townId, npcId: seller.id, seller: seller.name, typeId, quantity, price };
    }).filter((listing) => !this.sold.has(listing.id));

    const currentIds = new Set(current.map((listing) => listing.id));
    for (const reservation of this.reservations.values()) {
      if (!currentIds.has(reservation.id)) current.push({ ...reservation });
    }
    return current;
  }

  reserve(listing) {
    if (!listing?.id || this.sold.has(listing.id)) return { ok: false, message: 'That listing is no longer available.' };
    if ([...this.reservations.values()].some((entry) => entry.npcId === listing.npcId && entry.id !== listing.id)) {
      return { ok: false, message: `You already arranged another pickup with ${listing.seller}.` };
    }
    if (this.reservations.has(listing.id)) return { ok: false, message: 'You already reserved that item.' };
    try { itemType(listing.typeId); } catch { return { ok: false, message: 'That item is no longer available.' }; }
    this.reservations.set(listing.id, {
      id: listing.id,
      day: listing.day,
      townId: listing.townId,
      npcId: listing.npcId,
      seller: listing.seller,
      typeId: listing.typeId,
      quantity: listing.quantity,
      price: listing.price,
    });
    this.version++;
    return { ok: true, message: `${listing.seller} will hold it. Pay and collect it when you talk to them.` };
  }

  cancel(id) {
    const reservation = this.reservations.get(id);
    if (!reservation) return { ok: false, message: 'That reservation is no longer active.' };
    this.reservations.delete(id);
    this.version++;
    return { ok: true, message: `Reservation with ${reservation.seller} cancelled.` };
  }

  reservationForNpc(npcId) {
    return [...this.reservations.values()].find((entry) => entry.npcId === npcId) ?? null;
  }

  complete(npcId, inventory, purse) {
    const reservation = this.reservationForNpc(npcId);
    if (!reservation) return null;
    const type = itemType(reservation.typeId);
    if (inventory.room(reservation.typeId) < reservation.quantity) {
      return { ok: false, message: `You need room for ${reservation.quantity} ${type.label}${reservation.quantity === 1 ? '' : 's'} first.` };
    }
    if (!purse.canAfford(reservation.price)) {
      return { ok: false, message: `You still need ${reservation.price} coins for the ${type.label}.` };
    }
    const chargedCoins = !purse.unlimited;
    if (!purse.pay(reservation.price)) return { ok: false, message: 'The payment could not be completed.' };
    if (inventory.add(reservation.typeId, reservation.quantity) !== reservation.quantity) {
      if (chargedCoins) purse.earn(reservation.price);
      return { ok: false, message: 'The item would not fit, so no coins were taken.' };
    }
    this.reservations.delete(reservation.id);
    this.sold.add(reservation.id);
    this.version++;
    return {
      ok: true,
      message: `${reservation.seller} hands over ${reservation.quantity === 1 ? 'the' : reservation.quantity} ${type.label}${reservation.quantity === 1 ? '' : 's'} for ${reservation.price} coins.`,
    };
  }

  prune(day) {
    const keepFrom = day - 2;
    const kept = new Set([...this.sold].filter((id) => Number(id.split(':')[2]) >= keepFrom));
    if (kept.size === this.sold.size) return;
    this.sold = kept;
    this.version++;
  }

  snapshot() {
    return { reservations: [...this.reservations.values()].map((entry) => ({ ...entry })), sold: [...this.sold] };
  }

  restore(data) {
    this.reservations.clear();
    this.sold = new Set((data?.sold ?? []).filter((id) => typeof id === 'string'));
    for (const entry of data?.reservations ?? []) {
      if (!entry?.id || !entry.npcId || !entry.typeId || !Number.isSafeInteger(entry.price) || entry.price < 1) continue;
      try { itemType(entry.typeId); } catch { continue; }
      this.reservations.set(entry.id, {
        ...entry,
        quantity: Math.max(1, Math.floor(entry.quantity ?? 1)),
        seller: String(entry.seller ?? 'A neighbor'),
      });
    }
    this.version++;
  }
}
