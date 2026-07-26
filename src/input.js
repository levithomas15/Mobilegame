// Eingabe für Touch und Desktop hinter einer gemeinsamen Schnittstelle.
// Der Rest des Spiels fragt nur noch `input.move`, `input.look` und
// `input.isDown(...)` ab und muss nicht wissen, woher die Werte kommen.

const JOY_RADIUS = 62;      // Pixel bis Vollausschlag
const SPRINT_THRESHOLD = 0.92; // Joystick am Anschlag = Sprint
const TOUCH_LOOK_SENS = 0.0042;
const MOUSE_LOOK_SENS = 0.0022;

/**
 * Pointer Capture ist nur eine Bequemlichkeit: es hält den Finger auch dann
 * beim Element, wenn er darüber hinausrutscht. Manche Browser werfen dabei
 * (z.B. wenn der Pointer bereits wieder weg ist) — das darf niemals die
 * Eingabe selbst verschlucken.
 */
function captureSafely(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch { /* nicht kritisch */ }
}

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.sprintStick = false;
    this.touchActive = false;

    this.held = new Set();
    this.pressed = new Set();
    this.weaponRequest = null;

    this.joyPointer = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };
    this.buttonPointers = new Map();

    this.joyEl = root.querySelector('#joystick');
    this.joyKnobEl = root.querySelector('#joystick-knob');

    this._bindTouch();
    this._bindButtons();
    this._bindKeyboard();
    this._bindMouse();
  }

  /** Taste/Button ist gerade gedrückt. */
  isDown(action) { return this.held.has(action); }

  /** Wurde seit dem letzten Aufruf gedrückt? Verbraucht das Ereignis. */
  consume(action) {
    if (this.pressed.has(action)) { this.pressed.delete(action); return true; }
    return false;
  }

  takeWeaponRequest() {
    const w = this.weaponRequest;
    this.weaponRequest = null;
    return w;
  }

  /** Blickdelta abholen und zurücksetzen — einmal pro Frame. */
  takeLook() {
    const dx = this.look.dx, dy = this.look.dy;
    this.look.dx = 0; this.look.dy = 0;
    return { dx, dy };
  }

  /** Nach einem Rundenende alles loslassen, sonst laufen Figuren weiter. */
  reset() {
    this.held.clear();
    this.pressed.clear();
    this.move.x = 0; this.move.y = 0;
    this.look.dx = 0; this.look.dy = 0;
    this.joyPointer = null;
    this.lookPointer = null;
    this.sprintStick = false;
    this.buttonPointers.clear();
    this._updateKnob(0, 0);
  }

  _press(action) { this.held.add(action); this.pressed.add(action); }
  _release(action) { this.held.delete(action); }

  _bindTouch() {
    const surface = this.root.querySelector('#touch-layer');

    surface.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-action]')) return; // Buttons behandeln sich selbst
      this.touchActive = e.pointerType === 'touch' || this.touchActive;
      captureSafely(surface, e.pointerId);

      const half = window.innerWidth * 0.45;
      if (e.clientX < half && this.joyPointer === null) {
        this.joyPointer = e.pointerId;
        this.joyOrigin.x = e.clientX;
        this.joyOrigin.y = e.clientY;
        this.joyEl.style.left = `${e.clientX}px`;
        this.joyEl.style.top = `${e.clientY}px`;
        this.joyEl.classList.add('active');
      } else if (this.lookPointer === null) {
        this.lookPointer = e.pointerId;
        this.lookLast.x = e.clientX;
        this.lookLast.y = e.clientY;
      }
      e.preventDefault();
    }, { passive: false });

    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyPointer) {
        let dx = e.clientX - this.joyOrigin.x;
        let dy = e.clientY - this.joyOrigin.y;
        const len = Math.hypot(dx, dy);
        const clamped = Math.min(len, JOY_RADIUS);
        const nx = len > 0 ? (dx / len) * clamped : 0;
        const ny = len > 0 ? (dy / len) * clamped : 0;
        this.move.x = nx / JOY_RADIUS;
        this.move.y = -ny / JOY_RADIUS; // Bildschirm-Y ist invertiert
        this.sprintStick = (clamped / JOY_RADIUS) > SPRINT_THRESHOLD && this.move.y > 0.4;
        this._updateKnob(nx, ny);
      } else if (e.pointerId === this.lookPointer) {
        this.look.dx += (e.clientX - this.lookLast.x) * TOUCH_LOOK_SENS;
        this.look.dy += (e.clientY - this.lookLast.y) * TOUCH_LOOK_SENS;
        this.lookLast.x = e.clientX;
        this.lookLast.y = e.clientY;
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e) => {
      if (e.pointerId === this.joyPointer) {
        this.joyPointer = null;
        this.move.x = 0; this.move.y = 0;
        this.sprintStick = false;
        this.joyEl.classList.remove('active');
        this._updateKnob(0, 0);
      } else if (e.pointerId === this.lookPointer) {
        this.lookPointer = null;
      }
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  _updateKnob(x, y) {
    this.joyKnobEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  _bindButtons() {
    for (const el of this.root.querySelectorAll('[data-action]')) {
      const action = el.dataset.action;

      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.touchActive = e.pointerType === 'touch' || this.touchActive;
        captureSafely(el, e.pointerId);
        this.buttonPointers.set(e.pointerId, action);
        el.classList.add('pressed');

        if (action.startsWith('weapon:')) {
          this.weaponRequest = Number(action.split(':')[1]);
        } else {
          this._press(action);
        }
      }, { passive: false });

      const release = (e) => {
        const held = this.buttonPointers.get(e.pointerId);
        if (held === undefined) return;
        this.buttonPointers.delete(e.pointerId);
        el.classList.remove('pressed');
        this._release(held);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    }
  }

  _bindKeyboard() {
    const map = {
      KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right',
      ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
      Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
      KeyR: 'reload', KeyQ: 'wall', KeyE: 'ramp', KeyF: 'toggleBuild',
      KeyC: 'fire',
    };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
        this.weaponRequest = Number(e.code.slice(-1)) - 1;
        return;
      }
      const action = map[e.code];
      if (!action) return;
      if (e.code === 'Space') e.preventDefault();
      this._press(action);
      this._syncKeyboardMove();
    });

    window.addEventListener('keyup', (e) => {
      const action = map[e.code];
      if (!action) return;
      this._release(action);
      this._syncKeyboardMove();
    });

    window.addEventListener('blur', () => this.reset());
  }

  _syncKeyboardMove() {
    if (this.joyPointer !== null) return; // Touch hat Vorrang
    const x = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    const y = (this.held.has('fwd') ? 1 : 0) - (this.held.has('back') ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    this.move.x = x / len;
    this.move.y = y / len;
  }

  _bindMouse() {
    const canvas = this.root.querySelector('#game-canvas');

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._press('fire');
      if (e.button === 2) this._press('ads');
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._release('fire');
      if (e.button === 2) this._release('ads');
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.dx += e.movementX * MOUSE_LOOK_SENS;
        this.look.dy += e.movementY * MOUSE_LOOK_SENS;
      }
    });
  }

  /** Sprint gilt, wenn Taste ODER Joystick am Anschlag. */
  get sprinting() { return this.sprintStick || this.held.has('sprint'); }
}
