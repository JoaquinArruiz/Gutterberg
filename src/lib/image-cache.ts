// A small least-recently-used cache for card images (blob URLs), so a card shown in the library
// and again on a sheet is rendered once, and old images are released.

export class ImageCache {
  private entries = new Map<string, Promise<string>>();

  constructor(
    private limit: number,
    private release: (url: string) => void,
  ) {}

  /** The image for `key`, rendering it with `make` the first time. A failed render is not kept. */
  get(key: string, make: () => Promise<string>): Promise<string> {
    const hit = this.entries.get(key);
    if (hit) {
      // Most recently used goes last.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const made = make();
    this.entries.set(key, made);
    made.catch(() => {
      if (this.entries.get(key) === made) this.entries.delete(key);
    });
    this.evict();
    return made;
  }

  private evict() {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      const url = this.entries.get(oldest);
      this.entries.delete(oldest);
      // The URL may still be on screen for a moment; release it after the next frame settles.
      url?.then((u) => setTimeout(() => this.release(u), 2000)).catch(() => {});
    }
  }

  /** Forget everything (a new document), releasing every image. */
  clear() {
    for (const url of this.entries.values()) url.then(this.release).catch(() => {});
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
