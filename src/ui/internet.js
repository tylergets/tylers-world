/** Mutable controller for the internet terminal overlay. */
export class InternetBrowser {
  constructor({
    flightInfo = () => null,
    purchaseTicket = () => ({ ok: false, message: 'Booking is unavailable.' }),
    catalogueInfo = () => null,
    purchaseCatalogueItem = () => ({ ok: false, message: 'Shopping is unavailable.' }),
    marketplaceInfo = () => null,
    reserveListing = () => ({ ok: false, message: 'Classifieds are unavailable.' }),
    cancelListing = () => ({ ok: false, message: 'Classifieds are unavailable.' }),
    museumInfo = () => null,
  } = {}) {
    this.open = false;
    this.mode = 'home';
    this.flightInfo = flightInfo;
    this.purchaseTicket = purchaseTicket;
    this.catalogueInfo = catalogueInfo;
    this.purchaseCatalogueItem = purchaseCatalogueItem;
    this.marketplaceInfo = marketplaceInfo;
    this.reserveListing = reserveListing;
    this.cancelListing = cancelListing;
    this.museumInfo = museumInfo;
    this.version = 0;
  }

  changed() { this.version++; }
  show(mode = 'home') { this.mode = mode; this.open = true; this.changed(); }
  close() { if (this.open) { this.open = false; this.changed(); } }
}
