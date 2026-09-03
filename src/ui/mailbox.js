/** Keyboard-and-pointer view of the player's saved letters. */
import { itemType } from '../world/itemTypes.js';

export class MailboxView {
  constructor(root, onClaim) {
    this.onClaim = onClaim;
    this.mail = null;
    this.at = 0;
    this.message = '';
    this.document = false;
    const el = this.el = document.createElement('div');
    el.className = 'mailbox-screen';
    el.hidden = true;
    el.innerHTML = `
      <section class="mailbox-card" role="dialog" aria-modal="false" aria-labelledby="mailbox-title">
        <header class="mailbox-head">
          <span class="mailbox-mark" aria-hidden="true">&#9993;</span>
          <h2 id="mailbox-title">Mailbox</h2>
          <span class="mailbox-hint">Esc to close</span>
          <button class="modal-x" type="button" aria-label="Close mailbox">&#215;</button>
        </header>
        <div class="mailbox-layout">
          <nav class="mailbox-list" aria-label="Letters"></nav>
          <article class="letter"></article>
        </div>
      </section>`;
    root.append(el);
    this.list = el.querySelector('.mailbox-list');
    this.letter = el.querySelector('.letter');
    this.layout = el.querySelector('.mailbox-layout');
    this.title = el.querySelector('#mailbox-title');
    this.mark = el.querySelector('.mailbox-mark');
    el.querySelector('.modal-x').addEventListener('click', () => this.close());
    this.list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-letter]');
      if (!row) return;
      this.at = Number(row.dataset.letter);
      this.draw();
    });
    this.letter.addEventListener('click', (event) => {
      if (event.target.closest('[data-claim]')) this.claim();
    });
    el.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  get open() { return !this.el.hidden; }

  show(mail) {
    this.document = false;
    this.mail = mail;
    this.title.textContent = 'Mailbox';
    this.mark.innerHTML = '&#9993;';
    this.layout.classList.remove('single');
    const unread = mail.letters.findIndex((letter) => !letter.read);
    this.at = unread < 0 ? 0 : unread;
    this.message = '';
    this.el.hidden = false;
    this.draw();
  }

  /** Show one civic notice in the letter presentation, without a mailbox list. */
  showDocument(document) {
    this.document = true;
    this.mail = {
      letters: [{
        id: 'document', subject: document.subject, from: document.from, body: document.body,
        read: true, attachments: [], claimed: true,
      }],
      read: () => {},
    };
    this.at = 0;
    this.message = '';
    this.title.textContent = document.title;
    this.mark.textContent = '\u00a7';
    this.layout.classList.add('single');
    this.el.hidden = false;
    this.draw();
  }

  close() {
    this.el.hidden = true;
    this.mail = null;
  }

  move(step) {
    if (!this.mail?.letters.length) return;
    this.at = (this.at + step + this.mail.letters.length) % this.mail.letters.length;
    this.draw();
  }

  claim() {
    if (this.document) return;
    const letter = this.mail?.letters[this.at];
    if (!letter) return;
    const result = this.onClaim?.(letter.id);
    this.message = result?.message ?? '';
    this.draw();
  }

  draw() {
    const letters = this.mail?.letters ?? [];
    if (!letters.length) {
      this.list.replaceChildren();
      this.letter.textContent = 'No letters today.';
      return;
    }

    this.at = Math.min(this.at, letters.length - 1);
    const selected = letters[this.at];
    this.mail.read(selected.id);
    this.list.replaceChildren(...letters.map((letter, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.letter = index;
      button.className = `mailbox-row${index === this.at ? ' on' : ''}${letter.read ? '' : ' unread'}`;
      const subject = document.createElement('strong');
      subject.textContent = letter.subject;
      const from = document.createElement('span');
      from.textContent = letter.from;
      button.append(subject, from);
      return button;
    }));

    const heading = document.createElement('h3');
    heading.textContent = selected.subject;
    const from = document.createElement('div');
    from.className = 'letter-from';
    from.textContent = `From ${selected.from}`;
    const body = document.createElement('div');
    body.className = 'letter-body';
    body.textContent = selected.body;
    const parcel = document.createElement('div');
    parcel.className = `letter-parcel${selected.claimed ? ' claimed' : ''}`;
    if (selected.attachments.length) {
      const contents = selected.attachments
        .map(({ typeId, count }) => `${itemType(typeId).label}${count > 1 ? ` x${count}` : ''}`)
        .join(', ');
      const label = document.createElement('span');
      label.textContent = selected.claimed ? `Collected: ${contents}` : `Enclosed: ${contents}`;
      parcel.append(label);
      if (!selected.claimed) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.claim = '';
        button.textContent = 'Collect items';
        parcel.append(button);
      }
    }
    const message = document.createElement('div');
    message.className = 'letter-message';
    message.textContent = this.message;
    this.letter.replaceChildren(heading, from, body, parcel, message);
  }
}
