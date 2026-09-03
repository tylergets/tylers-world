/** Mutable controller for the internet terminal overlay. */
export class InternetBrowser {
  constructor() {
    this.open = false;
    this.url = 'https://example.com';
    this.version = 0;
  }

  changed() { this.version++; }
  show() { this.open = true; this.changed(); }
  close() { if (this.open) { this.open = false; this.changed(); } }

  navigate(input) {
    let value = String(input ?? '').trim();
    if (!value) return false;
    if (/\s/.test(value)) value = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
    else if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      this.url = url.href;
      this.changed();
      return true;
    } catch {
      return false;
    }
  }

  openExternal() { window.open(this.url, '_blank', 'noopener,noreferrer'); }
}
