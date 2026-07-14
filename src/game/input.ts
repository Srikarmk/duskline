export class Input {
  private down = new Set<string>();
  private justPressed = new Set<string>();

  private normalize(key: string) {
    return key.length === 1 ? key.toLowerCase() : key;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
    const key = this.normalize(e.key);
    if (!e.repeat) this.justPressed.add(key);
    this.down.add(key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(this.normalize(e.key));
  };

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.down.clear();
    this.justPressed.clear();
  }

  /** True once per key press; consumed on read. */
  consumePress(key: string) {
    const had = this.justPressed.has(key);
    this.justPressed.delete(key);
    return had;
  }

  get accelerate() {
    return this.down.has("ArrowUp") || this.down.has("w");
  }
  get brake() {
    return this.down.has("ArrowDown") || this.down.has("s");
  }
  get left() {
    return this.down.has("ArrowLeft") || this.down.has("a");
  }
  get right() {
    return this.down.has("ArrowRight") || this.down.has("d");
  }
  get fly() {
    return this.down.has("Shift");
  }
  get nitroPressed() {
    return this.consumePress(" ");
  }
  get cameraCycle() {
    return this.consumePress("c");
  }
}
