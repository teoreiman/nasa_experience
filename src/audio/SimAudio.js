// Per-chapter audio director: maps simulation state/events to sound. Engine roar by thrust, view
// and atmosphere (outside: silent in vacuum; inside: structure-borne rumble), staging pyros and
// clunks, RCS thumps, docking latches, cabin fans/pumps by bus power, the master-alarm tone,
// aerodynamic wind, entry plasma, parachutes, splashdown, and the MOCR room in controller mode.

const VACUUM_ALT = 90000;

export class SimAudio {
  constructor({ game, sim, view, role }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.role = role;
    this.audio = game.audio;
    this.loops = {};
    this._rcsPrev = 0;
    this._t = 0;
    const bus = sim.bus;
    this._off = [
      bus.on('vehicle:event', (e) => this._event(e)),
      bus.on('switch:changed', (e) => this._switch(e)),
      bus.on('agc:alarm', () => this.audio?.sfx?.('cwTone', { gain: 0.6 })),
      bus.on('mocr:seat', () => this.audio?.sfx?.('chair')),
    ];
  }

  _loop(name, on, gain = 1) {
    let l = this.loops[name];
    if (on && !l) {
      l = this.loops[name] = this.audio?.loop?.(name);
      if (!l) return null;
    }
    if (!l) return null;
    if (!on) {
      l.setGain(0, 0.25);
      return l;
    }
    l.setGain(gain);
    return l;
  }

  get inside() {
    const v = this.view;
    if (this.role === 'controller') return false;
    return !v || v.cameraMode === 'cockpit';
  }

  _event(e) {
    const a = this.audio;
    if (!a) return;
    const near = this.inside ? 1 : 0.6;
    switch (e.kind) {
      case 'IGNITION_SEQUENCE':
        a.sfx('ignition', { gain: near });
        break;
      case 'LIFTOFF':
        a.sfx('clunk', { gain: 0.8 * near }); // hold-down arms release
        break;
      case 'SIC_SEP':
      case 'SIB_SEP':
      case 'SII_SEP':
      case 'CSM_SEP':
      case 'CM_SM_SEP':
      case 'LM_STAGE':
        a.sfx('pyro', { gain: near });
        setTimeout(() => a.sfx('clunk', { gain: 0.8 * near }), 120);
        break;
      case 'SIC_CECO':
      case 'SII_CECO':
        a.sfx('thud', { gain: 0.5 * near });
        break;
      case 'SII_INTERSTAGE_JETT':
        a.sfx('pyro', { gain: 0.45 * near });
        break;
      case 'LES_JETT':
        a.sfx('pyro', { gain: 1.1 * near });
        setTimeout(() => a.sfx('bang', { gain: 0.4 * near }), 60);
        break;
      case 'DOCK_CAPTURE':
        a.sfx('latch', { gain: 1 });
        a.sfx('clunk', { gain: 0.7 });
        break;
      case 'DOCK_HARD':
        a.sfx('latchRipple');
        break;
      case 'DOCK_BOUNCE':
        a.sfx('clunk', { gain: 1.2 });
        a.sfx('thud', { gain: 0.8 });
        break;
      case 'UNDOCK':
      case 'LM_EXTRACT':
        a.sfx('pyro', { gain: 0.5 });
        a.sfx('clunk', { gain: 0.8 });
        break;
      case 'TOUCHDOWN':
        a.sfx(e.crash ? 'bang' : 'thud', { gain: e.crash ? 1.2 : 1 });
        break;
      case 'DROGUE_DEPLOY':
      case 'MAIN_DEPLOY':
      case 'APEX_COVER_JETT':
        a.sfx('pyro', { gain: 0.7 });
        if (e.kind !== 'APEX_COVER_JETT') setTimeout(() => a.sfx('chute'), 150);
        break;
      case 'SPLASHDOWN':
        a.sfx('splash', { gain: 1.2 });
        a.sfx('thud', { gain: 1 });
        break;
      case 'O2_TANK2_EXPLOSION':
        a.sfx('bang', { gain: 1.4 });
        setTimeout(() => a.sfx('clunk', { gain: 1 }), 200);
        break;
      case 'LIGHTNING_STRIKE':
        a.sfx('bang', { gain: 1.1 });
        break;
      default:
        break;
    }
  }

  _switch({ source, id }) {
    // AI crew flipping switches in the cabin: quieter clicks so the player hears the crew work
    if (source === 'crew' && this.inside) this.audio?.sfx?.(id.includes('.CB.') ? 'cbIn' : 'toggle', { gain: 0.45, pan: (Math.random() - 0.5) * 0.8 });
  }

  update(dt) {
    const a = this.audio;
    if (!a?.ctx) return;
    this._t += dt;
    const sim = this.sim;
    const v = sim.vehicle;
    const st = v.state;
    const tm = v.tm;
    const inside = this.inside;
    const paused = this.game.scene?.paused;
    if (paused) return;
    const alt = st.primary === 'EARTH' ? st.alt : 1e9;
    const air = Math.max(0, Math.min(1, 1 - alt / VACUUM_ALT));

    // ---- Saturn V
    const sat = v.modules.saturn;
    const satThrust = sat && v.isAttached('saturn') ? sat.thrust : 0;
    const stage = sat?.stage;
    const kSIC = stage === 'SIC' ? Math.min(1, satThrust / 3.4e7) : stage === 'SIB' ? Math.min(1, satThrust / 7.5e6) * 0.8 : 0;
    const kUpper = stage === 'SII' || stage === 'SIVB' || stage === 'SIVB_TLI' ? Math.min(1, satThrust / (stage === 'SII' ? 5e6 : 1e6)) : 0;
    if (inside) {
      // structure-borne: low, heavy, muffled; strongest near the pad (ground reflection) and max-Q
      const q = st.dynPressure / 33000;
      const g1 = kSIC * (0.55 + 0.45 * air + 0.25 * q);
      const l1 = this._loop('rumbleSIC', kSIC > 0.01, g1);
      l1?.setParam('muffle', 260 + 500 * air);
      l1?.setParam('crackle', 0.15 + 0.4 * air);
      const l2 = this._loop('rumbleSII', kUpper > 0.01, kUpper * 0.45);
      l2?.setParam('muffle', 300);
      l2?.setParam('crackle', 0.05);
    } else {
      // outside: full crackling roar in the air, silence in vacuum
      const dist = this.view?.cameraDistance?.() ?? 120;
      const att = Math.min(1, 400 / Math.max(60, dist));
      const g1 = kSIC * air * (0.4 + 0.6 * att);
      const l1 = this._loop('rumbleSIC', g1 > 0.005, g1 * 1.3);
      l1?.setParam('muffle', 1200 + 7000 * att);
      l1?.setParam('crackle', 1.1);
      const l2 = this._loop('rumbleSII', kUpper * air > 0.005, kUpper * air * 0.6);
      l2?.setParam('muffle', 4000);
    }

    // ---- spacecraft engines (heard through the structure; faint when viewed from outside)
    const k = inside ? 1 : 0.35;
    const sps = !!tm['CM.SPS.THRUST'];
    this._loop('sps', sps, 0.8 * k)?.setParam('muffle', inside ? 600 : 400);
    const dps = !!tm['LM.DPS.FIRING'] && v.isAttached('lm');
    const dl = this._loop('dps', dps, (0.45 + 0.4 * (v.cmd.dpsThrottle ?? 0.5)) * k);
    dl?.setParam('rate', 50 + 25 * (v.cmd.dpsThrottle ?? 0.5));
    this._loop('aps', !!v.modules.lm?.apsFiring, 0.7 * k);

    // ---- RCS: a pop when jets start firing, chatter while they fire
    const rcs = v.cmd.rcsRot.length() + v.cmd.rcsTrans.length();
    if (rcs > 0.15 && this._rcsPrev <= 0.15) a.sfx('rcsPop', { gain: inside ? 0.9 : 0.4, pan: (Math.random() - 0.5) * 0.6 });
    this._rcsPrev = rcs;
    this._loop('rcs', rcs > 0.15, Math.min(1, rcs) * (inside ? 0.55 : 0.2));

    // ---- aerodynamics
    const qn = Math.min(1, st.dynPressure / 30000);
    const entry = sim.dyn.mode === 'ENTRY';
    const wl = this._loop('wind', qn > 0.01 && !entry, qn * (inside ? 0.6 : 0.9));
    wl?.setParam('pitch', 300 + 1200 * qn);
    const plasma = entry && st.speed > 2500 ? Math.min(1, st.dynPressure / 15000) : 0;
    this._loop('plasma', plasma > 0.01, plasma * 1.1);
    if (entry && st.speed < 2500) {
      const w2 = this._loop('wind', qn > 0.002, Math.min(1, qn * 3) * 0.6);
      w2?.setParam('pitch', 250 + 600 * qn);
    }

    // ---- cabin environment
    const cmPowered = v.modules.csm && ((tm['CM.EPS.MNA.V'] ?? 0) > 20 || (tm['CM.EPS.MNB.V'] ?? 0) > 20);
    const lmPowered = v.modules.lm && ((tm['LM.EPS.CDR_BUS.V'] ?? 0) > 20 || (tm['LM.EPS.LMP_BUS.V'] ?? 0) > 20);
    const station = v.station;
    this._loop('cabinFans', inside && station === 'CM' && !!cmPowered, 0.5);
    this._loop('suitLoop', inside && station === 'LM' && !!lmPowered, 0.45);
    this._loop('pumps', inside && ((station === 'CM' && cmPowered) || (station === 'LM' && lmPowered)), 0.35);
    const tone = station === 'LM' ? tm['LM.CW.TONE'] : tm['CM.CW.TONE'];
    this._loop('masterAlarmTone', !!tone && this.role === 'astronaut', 0.55);
    if (this.role === 'controller') this._loop('mocrRoom', true, 0.55);
  }

  dispose() {
    this._off.forEach((f) => f());
    for (const l of Object.values(this.loops)) l?.stop?.(0.3);
    this.loops = {};
  }
}
