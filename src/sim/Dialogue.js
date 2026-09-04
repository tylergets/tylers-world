/**
 * A conversation in progress.
 *
 * The runtime half of world/dialog.js, which owns the format. This class knows
 * which node we are on, which page of it, which choices are currently offered,
 * and what picking one does to the world. It is a state machine over a script,
 * and it is deliberately headless: no DOM, no three.js, no keys. ui/dialogue.js
 * DRAWS one of these and calls two methods on it, which is what makes a
 * conversation something `npm run checkworld` can walk end to end.
 *
 * THE CONTEXT IS THE ONLY WAY IT TOUCHES THE WORLD
 * ------------------------------------------------
 * Effects need to give you a flower and take your coins, so the machine is
 * handed a narrow context and reaches nothing else. Most effects touch pockets
 * or relationships; `travel` can only request a destination from Game, which
 * owns the actual place swap and return address. A script still cannot mutate a
 * place directly, so "what can a line of dialog do" remains a closed list.
 *
 * `friends` is ALMOST read-only, and the exception is worth stating because it
 * is the only one. A script may ask whether you are welcome (the `friend`
 * condition) and no effect grants it: being welcome is earned by turning up
 * where somebody lives, not voted for by a line of their own dialog. But
 * `peace` does write, because ending a feud is not the same act -- it is paid
 * for in the same breath by `gift`, with a real item leaving the bag, and the
 * thing it buys is being strangers again rather than being friends. An effect
 * that can only ever cost you something is not a script awarding itself a
 * prize. See sim/Friends.js and world/grudge.js.
 *
 * WHY THE SHOP SUSPENDS THE CONVERSATION
 * --------------------------------------
 * `{ "shop": true }` does not end the dialog and it does not run alongside it:
 * it PARKS it. The trade interface takes over, and closing it resumes at the
 * choice's `to`. So a shopkeeper can say something after you are done browsing
 * -- which is the entire difference between a shop and a vending machine -- and
 * the script stays a straight line rather than sprouting a re-entry node.
 *
 * MEMORY BELONGS TO THE NPC, not to this object: a Dialogue lasts one
 * conversation, and "we have met" has to outlive it. See sim/Npc.js.
 */

import { END, endsConversation } from '../world/dialog.js';

/** How many branch hops before we call it a loop. Generous; scripts are small. */
const MAX_HOPS = 32;

export class Dialogue {
  /**
   * @param {Npc} npc  the person talking; supplies the memory and the shop
   * @param {{inventory: Inventory, purse: Purse, friends?: Friends,
   *   houseStories?: function(): number, setHouseStories?: function(number): void,
   *   shops24?: function(): boolean, setShops24?: function(boolean): void,
   *   townBankBalance?: function(): number,
   *   atHome?: boolean, travel?: function(string): void,
   *   returnHome?: function(): void}} ctx
   * @param {object} [script]  what he says, defaulting to his own dialog. The
   *   one caller that passes something else is the one talking to somebody who
   *   is angry, who gets a grudge script instead -- see world/grudge.js. It is
   *   a parameter and not a field on the Npc because WHICH script is running is
   *   a fact about this conversation, and the next one may be a different one.
   */
  constructor(npc, ctx, script = npc.dialog) {
    this.npc = npc;
    this.ctx = ctx;
    this.script = script;
    this.node = null;
    this.page = 0;
    this.done = false;
    /** The shop, while it is open. Null the rest of the time. */
    this.shop = null;
    /** Where to resume once the shop closes. */
    this._after = null;
    /** Choice effects waiting for the player to select an apology gift. */
    this.gift = null;
    /** Bumped whenever what is on screen changes, so the UI can redraw on it. */
    this.version = 0;

    npc.memory.visits++;
    this.#goto(this.script.start);
  }

  get speaker() { return this.npc.name; }

  /** The line currently being said, or null once the conversation is over. */
  get text() { return this.node ? this.#say(this.node.text[this.page]) : null; }

  /**
   * A line with its tokens filled in from the narrow game context.
   *
   * Done HERE and not at parse time, deliberately -- these two getters are the
   * one gate every rendered word passes through (the typewriter, the skip, the
   * redraw and the choice menu all read them), so a token expanded here is
   * expanded everywhere, including in the greeting, grudge, closed-shop and
   * theft scripts that never went near a world file. The fallback is for
   * callers with no player at all, like tools/checkworld.mjs: absent means the
   * caller is not asking, and "friend" is what a villager says in that case.
   */
  #say(text) {
    if (typeof text !== 'string' || !text.includes('{')) return text;
    const thefts = this.ctx.friends?.crimes?.thefts ?? 0;
    const killings = this.ctx.friends?.crimes?.killings ?? 0;
    return text
      .replaceAll('{player}', this.ctx.playerName ?? 'friend')
      .replaceAll('{townBankBalance}', String(this.ctx.townBankBalance?.() ?? 0))
      .replaceAll('{townReputation}', String(this.ctx.friends?.townReputation ?? 0))
      .replaceAll('{theftRecord}', `${thefts} theft${thefts === 1 ? '' : 's'}`)
      .replaceAll('{killingRecord}', `${killings} killing${killings === 1 ? '' : 's'}`);
  }

  /** True while the shop has the screen. */
  get trading() { return this.shop !== null; }
  get gifting() { return this.gift !== null; }
  get suspended() { return this.trading || this.gifting; }

  /**
   * The choices on offer right now: only on the LAST page of a node, and only
   * the ones whose `when` holds. Offering them on page one would mean answering
   * a question the NPC has not finished asking.
   *
   * Each carries `ends`: whether taking it closes the conversation. The UI
   * draws those apart, so "I'll let you get on" never looks like one more
   * question -- the player should be able to tell the way out at a glance.
   */
  get choices() {
    if (!this.node || this.suspended || !this.#onLastPage) return [];
    return this.node.choices
      .map((choice, index) => ({
        ...choice, text: this.#say(choice.text), index, ends: endsConversation(this.script.nodes, choice.to),
      }))
      .filter((choice) => this.#test(choice.when));
  }

  get #onLastPage() { return this.node !== null && this.page >= this.node.text.length - 1; }

  /**
   * Advance the text: next page, then `then`, then end.
   *
   * Does nothing while choices are showing. A press that dismissed a question
   * by picking nothing would make every conditional line a coin flip against
   * how fast the player is mashing the key.
   */
  advance() {
    if (this.done || this.suspended) return;
    if (!this.#onLastPage) { this.page++; this.version++; return; }
    if (this.choices.length) return;
    this.#goto(this.node.then ?? END);
  }

  /** Take one of the offered choices, by its `index` from `choices`. */
  choose(index) {
    if (this.done || this.suspended) return;
    const choice = this.node?.choices[index];
    if (!choice || !this.#test(choice.when)) return;   // a stale click on a line that just stopped applying

    if (choice.do.some((effect) => effect.gift === true)) {
      this.gift = {
        effects: choice.do.filter((effect) => effect.gift !== true),
        to: choice.to,
      };
      this.version++;
      return;
    }
    this.#apply(choice.do);
    if (this.shop) { this._after = choice.to; this.version++; return; }
    this.#goto(choice.to);
  }

  /** Close the trade interface and pick the conversation back up. */
  closeShop() {
    if (!this.shop) return;
    this.shop = null;
    const to = this._after ?? END;
    this._after = null;
    this.#goto(to);
  }

  selectGift(slotIndex) {
    if (!this.gift || !Number.isInteger(slotIndex)) return false;
    if (this.ctx.friends && !this.ctx.friends.hates(this.npc.id)) {
      this.end();
      return false;
    }
    const stack = this.ctx.inventory.slot(slotIndex);
    if (!stack || !this.ctx.inventory.removeFrom(slotIndex, 1)) return false;
    const pending = this.gift;
    this.gift = null;
    this.#apply(pending.effects);
    this.#goto(pending.to);
    return true;
  }

  cancelGift() {
    if (!this.gift) return false;
    this.gift = null;
    this.version++;
    return true;
  }

  /** Abandon the conversation wherever it is. */
  end() {
    this.node = null;
    this.shop = null;
    this.gift = null;
    this.done = true;
    this.version++;
  }

  // ------------------------------------------------------------- internals --

  /**
   * Enter a node, running its effects and following any branch.
   *
   * Branches resolve in a loop rather than by recursion, with a hop budget: a
   * script whose branches point in a circle is a hang, and a hang inside a
   * conversation looks exactly like the game crashing.
   */
  #goto(id) {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (id === END || id == null) { this.end(); return; }
      const node = this.script.nodes[id];
      if (!node) { this.end(); return; }   // unreachable: parseDialog resolved every `to`

      this.#apply(node.do);

      if (!node.branch) {
        this.node = node;
        this.page = 0;
        this.version++;
        return;
      }
      // The format guarantees a final unconditional rule, so `rule` is always
      // found -- but a script hand-edited past the validator should stop the
      // conversation, not throw in the middle of it.
      const rule = node.branch.find((r) => this.#test(r.when));
      if (!rule) { this.end(); return; }
      id = rule.to;
    }
    console.warn(`dialog "${this.npc.id}": branches looped, giving up`);
    this.end();
  }

  #apply(effects) {
    for (const effect of effects ?? []) {
      const [key] = Object.keys(effect);
      const v = effect[key];
      switch (key) {
        case 'set': this.npc.memory.flags.add(v); break;
        case 'clear': this.npc.memory.flags.delete(v); break;
        case 'give': this.ctx.inventory.add(v.type, v.count); break;
        case 'take': this.#take(v.type, v.count); break;
        // Effects are authored, not clicked: a script that spends more than the
        // player has is a bug in the file, and clamping at zero keeps it from
        // becoming a debt the game has no way to express.
        case 'coins': v >= 0 ? this.ctx.purse.earn(v) : this.ctx.purse.pay(Math.min(-v, this.ctx.purse.coins)); break;
        case 'heal': if (v) this.ctx.health?.restore(); break;
        // The Game owns progression and the consequences of changing it. An
        // absent callback is a headless format walker, where effects are inert.
        case 'houseStories': this.ctx.setHouseStories?.(v); break;
        case 'shops24': this.ctx.setShops24?.(v); break;
        case 'officeBuilt': if (v) this.ctx.buildWorkerOffice?.(); break;
        case 'travel': this.ctx.travel?.(v); break;
        case 'returnHome': if (v) this.ctx.returnHome?.(); break;
        case 'office': if (v) this.ctx.openOffice?.(); break;
        case 'shop': if (v) this.shop = this.npc.shop; break;
        case 'poker': if (v) this.ctx.openPoker?.(this.npc); break;
        case 'gift': break; // Choice handling suspends for explicit item selection.
        // Absent friends is a caller who is not asking -- checkworld drives
        // these scripts with no player in the world -- and the sensible thing
        // to do with a feud nobody is keeping track of is nothing.
        case 'peace': if (v) this.ctx.friends?.forgive(this.npc.id); break;
        // Settling up over stolen goods, which the Game owns for the reason it
        // owns `houseStories`: paying takes the coins here, but handing the
        // goods back and being shot at are both things that happen to the
        // WORLD. An absent callback is a headless format walker, where -- as
        // with every other effect -- the script still runs and does nothing.
        case 'theft': this.ctx.settleTheft?.(this.npc, v); break;
        case 'errand':
          if (v.action === 'accept') this.ctx.errands?.accept(this.npc.id, v.id);
          else if (v.action === 'complete') this.ctx.errands?.complete(this.npc, v.id, this.ctx);
          break;
        case 'work': this.ctx.setWorker?.(this.npc, v); break;
        case 'logistics': this.ctx.setLogistics?.(this.npc, v); break;
      }
    }
    this.version++;
  }

  /** Remove `count` of a type from wherever it is in the bag. */
  #take(typeId, count) {
    const inv = this.ctx.inventory;
    let left = count;
    for (let i = 0; i < inv.size && left > 0; i++) {
      if (inv.slot(i)?.typeId !== typeId) continue;
      left -= inv.removeFrom(i, left).count;
    }
  }

  /** Evaluate a condition. A null condition is "always". */
  #test(cond) {
    if (!cond) return true;
    const { inventory, purse } = this.ctx;
    const mem = this.npc.memory;

    for (const [key, v] of Object.entries(cond)) {
      switch (key) {
        case 'flag': if (!mem.flags.has(v)) return false; break;
        // No `friends` in the context is not "no friends" -- it is a caller
        // who is not asking, and the answer is then "either", so BOTH sides of
        // the condition stay walkable. That is what lets checkworld cover the
        // lines an author wrote for people you have met and the ones for people
        // you have not, in a run with no player in it. Treating absent as false
        // would quietly hide half of every script from the only check we have.
        case 'friend': if (this.ctx.friends && this.ctx.friends.has(this.npc.id) !== v) return false; break;
        case 'relationship':
          if (this.ctx.friends && !this.ctx.friends.atLeast(this.npc.id, v.atLeast)) return false;
          break;
        case 'errand':
          if (this.ctx.errands && (this.ctx.errands.status(this.npc.id, v.id) !== v.status
            || (v.status === 'ready' && !this.ctx.errands.canComplete(this.npc.id, v.id, inventory)))) return false;
          break;
        case 'time': {
          if (!this.ctx.clock) break;
          const hour = this.ctx.clock.t * 24;
          const inside = v.from < v.to ? hour >= v.from && hour < v.to : hour >= v.from || hour < v.to;
          if (!inside) return false;
          break;
        }
        case 'shopOpen': if (this.npc.shopAvailable !== v) return false; break;
        case 'holding': if (!!inventory.held !== v) return false; break;
        case 'carrying': if (inventory.slots.some(Boolean) !== v) return false; break;
        case 'visits': if (mem.visits < v) return false; break;
        case 'coins': if (purse.coins < v) return false; break;
        case 'hurt': if (this.ctx.health && (!this.ctx.health.full) !== v) return false; break;
        case 'atHome': if (this.ctx.atHome !== undefined && this.ctx.atHome !== v) return false; break;
        // As with `friend`, absence means the caller is not asking. This keeps
        // every authored tier alternative walkable under checkworld.
        case 'houseStories': if (this.ctx.houseStories && this.ctx.houseStories() !== v) return false; break;
        case 'shops24': if (this.ctx.shops24 && this.ctx.shops24() !== v) return false; break;
        case 'hasHiredWorker': if (this.ctx.hasHiredWorker && this.ctx.hasHiredWorker() !== v) return false; break;
        case 'officeBuilt': if (this.ctx.officeBuilt && this.ctx.officeBuilt() !== v) return false; break;
        case 'thefts': if (this.ctx.friends && this.ctx.friends.crimes.thefts < v) return false; break;
        case 'killings': if (this.ctx.friends && this.ctx.friends.crimes.killings < v) return false; break;
        case 'has': if (inventory.count(v.type) < v.count) return false; break;
        case 'room': if (inventory.room(v.type) < v.count) return false; break;
        case 'not': if (this.#test(v)) return false; break;
        case 'all': if (!v.every((c) => this.#test(c))) return false; break;
        case 'any': if (!v.some((c) => this.#test(c))) return false; break;
      }
    }
    return true;
  }
}
