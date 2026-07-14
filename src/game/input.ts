export class Input {
  private keys = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key.startsWith("Arrow")) e.preventDefault();
    this.keys.add(e.key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key);
  };

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.keys.clear();
  }

  get accelerate() {
    return this.keys.has("ArrowUp") || this.keys.has("w");
  }
  get brake() {
    return this.keys.has("ArrowDown") || this.keys.has("s");
  }
  get left() {
    return this.keys.has("ArrowLeft") || this.keys.has("a");
  }
  get right() {
    return this.keys.has("ArrowRight") || this.keys.has("d");
  }
}
