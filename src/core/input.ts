// Keyboard + mouse-drag camera + mobile virtual joystick / look pad.

class Input {
  keys = new Set<string>();
  /** Movement vector from keys/joystick, x = right, y = forward. */
  move = { x: 0, y: 0 };
  /** Accumulated camera-look delta (pixels) since last consume. */
  look = { x: 0, y: 0 };
  zoom = 0;
  private pressed = new Set<string>();
  private joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  private dragging = false;
  isTouch = matchMedia('(pointer: coarse)').matches;
  enabled = true;

  init(canvas: HTMLElement, joyEl: HTMLElement, knobEl: HTMLElement) {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 2) this.dragging = true; });
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (this.dragging) { this.look.x += e.movementX; this.look.y += e.movementY; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); }, { passive: true });

    // Touch: left half = joystick, right half = look.
    canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < innerWidth * 0.45 && !this.joy.active) {
          this.joy = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
          joyEl.style.display = 'block';
          joyEl.style.left = `${t.clientX - 60}px`;
          joyEl.style.top = `${t.clientY - 60}px`;
          knobEl.style.transform = 'translate(0px,0px)';
        } else if (this.lookTouch.id < 0) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) {
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const len = Math.hypot(dx, dy), max = 50;
          if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
          this.joy.x = dx / max; this.joy.y = -dy / max;
          knobEl.style.transform = `translate(${dx}px,${dy}px)`;
        } else if (t.identifier === this.lookTouch.id) {
          this.look.x += (t.clientX - this.lookTouch.x) * 1.4;
          this.look.y += (t.clientY - this.lookTouch.y) * 1.4;
          this.lookTouch.x = t.clientX; this.lookTouch.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joy.id) { this.joy.active = false; this.joy.id = -1; this.joy.x = this.joy.y = 0; joyEl.style.display = 'none'; }
        if (t.identifier === this.lookTouch.id) this.lookTouch.id = -1;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
      if (this.joy.active) { x += this.joy.x; y += this.joy.y; }
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x; this.move.y = y;
  }

  /** True once per physical key press. */
  hit(...keys: string[]) {
    for (const k of keys) if (this.pressed.has(k)) { this.pressed.delete(k); return true; }
    return false;
  }
  /** Simulate a key press (from on-screen buttons). */
  press(k: string) { this.pressed.add(k); }
  endFrame() { this.pressed.clear(); }
  consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
  get sprint() { return this.keys.has('shift'); }
}

export const input = new Input();
