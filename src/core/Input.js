// Keyboard / mouse / gamepad input with named actions grouped in contexts.
// Contexts: 'global' (always active), 'flight' (spacecraft hand controllers), 'walk' (first-person
// walking in the MOCR / EVA). Views enable the context they need: input.setContext('walk', true).
//
// Usage per frame: input.axis('pitch') → -1..1, input.pressed('warpUp') (edge), input.down('run').
// input.endFrame() is called by the Game after each frame.
// Keyboard events are ignored while an <input>/<textarea> has focus, or while input.captureKeys
// is set by a widget (e.g. the DSKY keyboard mode); widgets can read input.lastKeyEvents.

const DEFAULT_BINDINGS = {
  global: {
    pause: ['Escape'],
    warpUp: ['Period', 'NumpadAdd'],
    warpDown: ['Comma', 'NumpadSubtract'],
    warpReset: ['Slash'],
    toggleHud: ['KeyH'],
    toggleMap: ['KeyM'],
    toggleChecklist: ['Tab'],
    help: ['F1'],
    screenshot: ['F2'],
    toggleView: ['KeyT'], // controller mode: MOCR ↔ spacecraft TV view
    skip: ['F8'], // skip to next scripted event (when the mission allows it)
  },
  flight: {
    pitchDown: ['KeyW', 'Numpad8'],
    pitchUp: ['KeyS', 'Numpad2'],
    yawLeft: ['KeyA', 'Numpad4'],
    yawRight: ['KeyD', 'Numpad6'],
    rollLeft: ['KeyQ', 'Numpad7'],
    rollRight: ['KeyE', 'Numpad9'],
    transFwd: ['KeyI'],
    transBack: ['KeyK'],
    transLeft: ['KeyJ'],
    transRight: ['KeyL'],
    transUp: ['KeyU'],
    transDown: ['KeyO'],
    throttleUp: ['PageUp'],
    throttleDown: ['PageDown'],
    rodUp: ['Home'], // LM P66 rate-of-descent switch: +1 ft/s per click
    rodDown: ['End'],
    lpdLeft: ['ArrowLeft'], // LM P64 landing point redesignation
    lpdRight: ['ArrowRight'],
    lpdFwd: ['ArrowUp'],
    lpdBack: ['ArrowDown'],
    camera: ['KeyC'], // cockpit ↔ exterior
    cameraNext: ['KeyV'],
    seatNext: ['KeyX'], // next seat / station view
    panelFocus: ['KeyF'], // zoom to the panel under the cursor / flat panel view
    freeLook: ['KeyZ'],
  },
  walk: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    interact: ['KeyE'],
    crouch: ['KeyC', 'ControlLeft'],
  },
};

const AXES = {
  pitch: ['pitchUp', 'pitchDown'],
  yaw: ['yawRight', 'yawLeft'],
  roll: ['rollRight', 'rollLeft'],
  transX: ['transFwd', 'transBack'],
  transY: ['transRight', 'transLeft'],
  transZ: ['transDown', 'transUp'],
  walkX: ['right', 'left'],
  walkZ: ['forward', 'back'],
};

export class Input {
  constructor(target = window) {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.contexts = new Set(['global']);
    this.keysDown = new Set();
    this.keysPressed = new Set();
    this.lastKeyEvents = [];
    this.captureKeys = false; // when true, keys are routed only to lastKeyEvents (widgets)
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, buttons: 0, locked: false };
    this.gamepad = null;
    // Touch / on-screen controls (mobile). TouchControls (ui) writes virtual axes −1..1 and
    // virtual action buttons; axis()/down()/pressed() merge them with the keyboard.
    this.isTouch = matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.virtualAxes = Object.create(null); // { pitch, yaw, roll, transX, transY, transZ, walkX, walkZ, lookX, lookY }
    this.virtualDown = new Set();
    this.virtualPressed = new Set();
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onMouseMove = (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    };
    this._onWheel = (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
    };
    this._onDown = (e) => (this.mouse.buttons = e.buttons);
    this._onUp = (e) => (this.mouse.buttons = e.buttons);
    this._onLock = () => (this.mouse.locked = !!document.pointerLockElement);
    this._onBlur = () => this.keysDown.clear();
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('mousemove', this._onMouseMove);
    target.addEventListener('wheel', this._onWheel, { passive: true });
    target.addEventListener('mousedown', this._onDown);
    target.addEventListener('mouseup', this._onUp);
    target.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  _key(e, down) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (down) {
      this.lastKeyEvents.push(e);
      if (this.captureKeys && e.code !== 'Escape') {
        e.preventDefault();
        return;
      }
      if (!this.keysDown.has(e.code)) this.keysPressed.add(e.code);
      this.keysDown.add(e.code);
      if (['Tab', 'F1', 'F2', 'F8', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    } else {
      this.keysDown.delete(e.code);
    }
  }

  setContext(name, on) {
    if (on) this.contexts.add(name);
    else this.contexts.delete(name);
  }

  bind(context, action, codes) {
    (this.bindings[context] ??= {})[action] = codes;
  }

  _codes(action) {
    for (const ctx of this.contexts) {
      const c = this.bindings[ctx]?.[action];
      if (c) return c;
    }
    return null;
  }

  down(action) {
    if (this.virtualDown.has(action)) return true;
    const codes = this._codes(action);
    return !!codes && codes.some((c) => this.keysDown.has(c));
  }

  pressed(action) {
    if (this.virtualPressed.has(action)) return true;
    const codes = this._codes(action);
    return !!codes && codes.some((c) => this.keysPressed.has(c));
  }

  /** On-screen button support: press(action) for a tap, hold(action, true/false) for held buttons. */
  virtualPress(action) {
    this.virtualPressed.add(action);
  }

  virtualHold(action, on) {
    if (on) {
      if (!this.virtualDown.has(action)) this.virtualPressed.add(action);
      this.virtualDown.add(action);
    } else this.virtualDown.delete(action);
  }

  setVirtualAxis(name, value) {
    this.virtualAxes[name] = Math.max(-1, Math.min(1, value || 0));
  }

  /** -1..1 from the axis' positive/negative actions (plus touch joysticks and gamepad). */
  axis(name) {
    const pair = AXES[name];
    let v = pair ? (this.down(pair[0]) ? 1 : 0) - (this.down(pair[1]) ? 1 : 0) : 0;
    const va = this.virtualAxes[name];
    if (va) v = Math.max(-1, Math.min(1, v + va));
    if (!pair) return v;
    const gp = this.gamepad;
    if (gp) {
      const map = { pitch: [1, -1], yaw: [0, 1], roll: [2, 1], walkX: [0, 1], walkZ: [1, -1], transY: [2, 1], transZ: [3, 1] }[name];
      if (map && gp.axes[map[0]] !== undefined) {
        const a = gp.axes[map[0]] * map[1];
        if (Math.abs(a) > 0.15) v = Math.max(-1, Math.min(1, v + a));
      }
    }
    return v;
  }

  requestPointerLock(el) {
    el?.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = [...pads].find((p) => p && p.connected) ?? null;
  }

  endFrame() {
    this.keysPressed.clear();
    this.virtualPressed.clear();
    this.lastKeyEvents.length = 0;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
