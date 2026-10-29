// The player's vehicle: shared state blackboard read/written by every simulation module.
//
//   vehicle.state     physics state (written ONLY by FlightDynamics)
//   vehicle.controls  manual crew inputs (written by the view/input layer or by AI crew)
//   vehicle.cmd       computer/autopilot outputs (written by GNC), consumed by systems
//   vehicle.sw        SwitchBoard with every CM./LM. control
//   vehicle.tm        telemetry: flat object 'CM.EPS.MNA.V' -> number|boolean|string
//   vehicle.modules   { saturn, csm, lm } hardware simulations (null when not present)
//   vehicle.config    key of CONFIGS in geometry.js (changed only by FlightDynamics)
//   vehicle.parts     visual/part flags inside a config (interstage attached, LES attached, gear deployed…)
//
// Discrete vehicle events go through the bus:
//   vehicle.request(kind, data) → 'vehicle:request' (systems ask physics to perform a separation)
//   physics emits 'vehicle:event' { kind, ... } after performing it and 'vehicle:config' { config, prev }.

import { Quaternion, Vector3 } from 'three';
import { SwitchBoard } from './SwitchBoard.js';
import { CONFIGS } from './geometry.js';

export const EVENT_KINDS = [
  'IGNITION_SEQUENCE', 'LIFTOFF', 'TOWER_CLEAR', 'SIC_CECO', 'SIC_OECO', 'SIC_SEP', 'SII_IGNITION',
  'SII_INTERSTAGE_JETT', 'LES_JETT', 'SII_CECO', 'SII_OECO', 'SII_SEP', 'SIVB_IGNITION', 'SIVB_CUTOFF',
  'ORBIT_INSERTION', 'TLI_IGNITION', 'TLI_CUTOFF', 'CSM_SEP', 'SLA_PANELS_JETT', 'DOCK_CAPTURE',
  'DOCK_HARD', 'LM_EXTRACT', 'UNDOCK', 'LM_GEAR_DEPLOY', 'TOUCHDOWN', 'LM_STAGE', 'LM_ASC_LIFTOFF',
  'DOCK_LM_ASC', 'LM_ASC_JETT', 'LM_JETT', 'CM_SM_SEP', 'ENTRY_INTERFACE', 'BLACKOUT_START',
  'BLACKOUT_END', 'APEX_COVER_JETT', 'DROGUE_DEPLOY', 'MAIN_DEPLOY', 'SPLASHDOWN', 'ABORT',
  'O2_TANK2_EXPLOSION', 'LIGHTNING_STRIKE',
];

export class Vehicle {
  constructor({ bus, clock, config = 'CSM' }) {
    this.bus = bus;
    this.clock = clock;
    this.sw = new SwitchBoard(bus);
    this.tm = Object.create(null);
    this.config = config;
    this.parts = {
      interstage: true, // S-IC/S-II aft interstage attached
      les: true, // launch escape system attached
      bpc: true, // boost protective cover (with LES)
      slaPanels: true,
      lmGearDeployed: false,
      probeExtended: true,
      apexCover: true,
      drogues: false,
      mains: false,
      smDamaged: false, // Apollo 13 bay 4 panel missing
    };
    this.station = 'CM'; // crew station the player occupies: 'CM' | 'LM'
    this.state = {
      r: new Vector3(), // ECI position of the config reference point (m)
      v: new Vector3(), // ECI velocity (m/s)
      q: new Quaternion(), // body → ECI
      w: new Vector3(), // body angular rate (rad/s)
      accel: new Vector3(), // sensed (non-gravitational) acceleration, body frame (m/s²)
      mass: 1,
      primary: 'EARTH', // 'EARTH' | 'MOON'
      alt: 0, // altitude above primary mean radius (m)
      altTerrain: NaN, // above local terrain (Moon, near surface) (m)
      speed: 0, // inertial speed relative to primary (m/s)
      vRel: new Vector3(), // velocity relative to primary (ECI axes)
      rRel: new Vector3(), // position relative to primary (ECI axes)
      hdot: 0, // vertical speed (m/s)
      vHoriz: 0, // horizontal speed (m/s), primary-fixed frame when near the surface
      vSurface: new Vector3(), // velocity relative to the rotating surface (ECI axes)
      lat: 0,
      lon: 0, // primary body-fixed (rad)
      gLoad: 0,
      dynPressure: 0, // Pa
      mach: 0,
      apoAlt: NaN,
      periAlt: NaN,
      inclination: NaN,
      inBlackout: false,
      inShadow: false,
      losEarth: false, // no line of sight to Earth (behind the Moon) → no comms
      landed: false,
      splashed: false,
      liftoff: false,
    };
    this.controls = {
      rhc: new Vector3(), // rotation hand controller: x roll, y pitch, z yaw (-1..1)
      thc: new Vector3(), // translation hand controller: body +X, +Y, +Z (-1..1)
      ttca: 0, // LM manual throttle 0..1 (TTCA)
      rodClicks: 0, // LM ROD switch impulses (+ = descend slower), consumed by GNC
      lpdAz: 0, // LM LPD redesignation clicks (+ right), consumed by GNC
      lpdEl: 0, // (+ = long / farther)
      abort: false, // CM THC counter-clockwise (abort handle)
      outOfDetent: false, // RHC/ACA out of detent this frame
    };
    this.cmd = {
      rcsRot: new Vector3(), // -1..1 jet command per body axis (roll, pitch, yaw)
      rcsTrans: new Vector3(), // -1..1 per body axis (X, Y, Z)
      sps: false, // SPS thrust-on signal from CMC/SCS
      dps: false,
      aps: false,
      dpsThrottle: 0.1, // 0.1..1 (fraction of rated thrust); 0.925 max in practice
      gimbalPitch: 0, // rad (SPS/DPS trim)
      gimbalYaw: 0,
      ullage: false,
      lvGuidance: 'IU', // 'IU' | 'CMC' (S-IVB steering takeover)
    };
    this.modules = { saturn: null, csm: null, lm: null };
    this.crew = { CM: ['CDR', 'CMP', 'LMP'], LM: [] };
  }

  get configDef() {
    return CONFIGS[this.config];
  }

  has(module) {
    return this.configDef?.modules.some((m) => m === module || m.startsWith(module + '_')) ?? false;
  }

  get hasSaturn() {
    return this.has('SIC') || this.has('SII') || this.has('SIVB');
  }

  get hasCSM() {
    return this.has('CSM') || this.has('CM');
  }

  get hasLM() {
    return this.has('LM');
  }

  /** Whether a hardware module ('saturn' | 'csm' | 'lm') is part of the active vehicle in the
   *  current config. Physics sums mass/propulsion only for attached modules. */
  isAttached(key) {
    const mods = this.configDef?.modules ?? [];
    if (key === 'saturn') return mods.some((m) => m === 'SIC' || m === 'SII' || m === 'SIVB');
    if (key === 'csm') return mods.some((m) => m === 'CSM' || m === 'CM' || m === 'SM' || m === 'CSM_DOCKED_TOP');
    if (key === 'lm') return mods.some((m) => m.startsWith('LM'));
    return false;
  }

  /** Ask FlightDynamics to perform a discrete event (separation, docking release, staging…). */
  request(kind, data = {}) {
    this.bus.emit('vehicle:request', { kind, ...data });
  }

  /** Called by FlightDynamics only. */
  _setConfig(config, info = {}) {
    if (!CONFIGS[config]) throw new Error(`Unknown config ${config}`);
    const prev = this.config;
    if (prev === config) return;
    this.config = config;
    this.bus.emit('vehicle:config', { config, prev, ...info });
  }

  setStation(station) {
    if (this.station === station) return;
    const prev = this.station;
    this.station = station;
    this.bus.emit('vehicle:station', { station, prev });
  }
}
