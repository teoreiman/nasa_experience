// Shared vehicle geometry: module datums, vehicle configurations and docking relations.
// Owned by the "models" agent for value refinements; keys and semantics are a contract used by
// physics, rendering, cockpit and missions. Units: metres.
//
// Body axes (right-handed):
//   Saturn V / S-IVB / CSM / CM: +X along the longitudinal axis toward the nose (CM apex, LES).
//     +Y to the crew's right (LMP side), +Z = X × Y (toward the crew's feet / lower equipment bay).
//     Crew in the CM looks along +X with head toward -Z.
//   LM: +X up (thrust axis, toward the docking tunnel), +Z forward (windows, front hatch),
//     +Y to the right (LMP side).
//
// Module datums (each module's model and cockpit are built in its own datum frame):
//   SIC   : S-IC F-1 nozzle exit plane.
//   SII   : bottom of the S-IC/S-II interstage.
//   SIVB  : S-IVB J-2 nozzle exit plane (includes the IU on top).
//   SLA   : bottom of the spacecraft-LM adapter (top of the IU).
//   CSM   : CM/SM interface plane (CM heat-shield base). CM at +X, SM at -X. Also LES datum.
//   LM    : footpad contact plane (gear deployed), LM centreline.
//
// A configuration is an assembly of modules with one reference point (approx. CG) that the physics
// integrates. Module poses inside a configuration are given relative to that reference point.

import { Quaternion, Vector3 } from 'three';

// Stack stations (X in the Saturn V stack frame, origin at S-IC nozzle exit plane).
export const STACK = {
  sicBase: 0.0,
  sicTop: 42.0,
  siiDatum: 42.0, // interstage bottom
  interstageTop: 47.6,
  siiTop: 66.9,
  sivbDatum: 68.0,
  sivbTop: 85.9,
  iuTop: 86.8,
  slaDatum: 86.8,
  slaTop: 95.3,
  csmDatum: 99.25, // CM/SM interface
  cmApex: 102.48,
  lesTop: 110.6,
  lmDatum: 85.8, // LM footpad-plane datum while stowed in the SLA (legs folded)
};

// Saturn IB (Skylab / ASTP vehicles on the LC-39B "milkstool"): stations from the H-1 exit plane.
export const STACK_IB = {
  sibBase: 0.0,
  sibTop: 25.3,
  sivbDatum: 22.3,
  slaDatum: 41.1,
  slaTop: 49.6,
  csmDatum: 53.55,
  lesTop: 64.9,
  milkstool: 38.7, // pedestal height above the ML deck
};
const IB_STATIONS = { SIB: STACK_IB.sibBase, SIVB: STACK_IB.sivbDatum, SLA: STACK_IB.slaDatum, CSM: STACK_IB.csmDatum, LES: STACK_IB.csmDatum };

export const GEOM = {
  saturnV: {
    diameter: 10.06,
    height: 110.6,
    sivbDiameter: 6.604,
    sicEngineExitDia: 3.76,
    sicOutboardRadius: 3.56,
    siiEngineExitDia: 1.96,
    siiOutboardRadius: 2.65,
    finSpan: 18.0,
  },
  csm: {
    cmHeight: 3.23,
    cmBaseRadius: 1.956,
    cmHalfAngle: 33, // deg
    smLength: 3.95,
    smRadius: 1.956,
    spsGimbalX: -3.95,
    spsNozzleLength: 2.85,
    spsExitRadius: 1.25,
    rcsQuadX: -1.45,
    dockRingX: 3.48, // CM docking ring (tunnel) plane
    probeTipX: 4.30, // extended docking probe tip
    hatchWindowZ: -1.2,
  },
  lm: {
    height: 7.04,
    footpadRadius: 0.47,
    footpadCircleRadius: 4.72, // footpad centre distance from centreline (diagonal span ~9.45 m)
    probeLength: 1.73, // lunar surface sensing probes below footpads → CONTACT LIGHT
    descStageBottomX: 1.55,
    descStageTopX: 3.25,
    ascStageBaseX: 3.25,
    dpsExitX: 1.30,
    apsExitX: 3.05,
    dockRingX: 7.04, // top drogue/docking ring plane
    porchX: 3.30,
    eyeCDR: { x: 5.15, y: -0.47, z: 0.55 },
    eyeLMP: { x: 5.15, y: 0.47, z: 0.55 },
  },
  cmEye: {
    CDR: { x: 1.25, y: -0.62, z: -0.30 },
    CMP: { x: 1.25, y: 0.0, z: -0.30 },
    LMP: { x: 1.25, y: 0.62, z: -0.30 },
    LEB: { x: 0.95, y: 0.0, z: 0.55 },
  },
};

const ID = new Quaternion();
// LM docked to the CSM: noses together, LM +X = CSM -X, LM +Y = CSM -Y, LM +Z = CSM +Z.
const Q_LM_IN_CSM = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);

// Module pose in a configuration: X offset (along the config axis) from the config reference point
// plus a rotation (module frame -> config frame). For stacks everything is collinear on X.
function stackPose(datumStation, refStation) {
  return { offset: new Vector3(datumStation - refStation, 0, 0), quat: ID.clone() };
}

const CSM_REF = -1.2; // CSM CG ≈ 1.2 m aft of CM/SM interface (loaded)
const DOCKED_LM_DATUM_X = GEOM.csm.dockRingX + GEOM.lm.dockRingX; // LM datum along CSM +X when docked

export const CONFIGS = {
  // Full Saturn V on the pad / first stage flight.
  SATURN_V: {
    ref: 33.0,
    modules: ['SIC', 'SII', 'SIVB', 'SLA', 'LM_STOWED', 'CSM', 'LES'],
    stack: true,
  },
  // After S-IC separation (interstage and LES may still be attached; flags in vehicle.parts).
  SATURN_V_SII: {
    ref: 63.0,
    modules: ['SII', 'SIVB', 'SLA', 'LM_STOWED', 'CSM', 'LES'],
    stack: true,
  },
  // Saturn IB: S-IB + S-IVB-200 + SLA + CSM + LES, and after S-IB separation.
  SATURN_IB: { ref: 20.0, modules: ['SIB', 'SIVB', 'SLA', 'CSM', 'LES'], stack: true, stations: IB_STATIONS },
  SATURN_IB_SIVB: { ref: 38.0, modules: ['SIVB', 'SLA', 'CSM', 'LES'], stack: true, stations: IB_STATIONS },
  // S-IVB + IU + SLA + LM + CSM (Earth parking orbit, TLI).
  SIVB_STACK: {
    ref: 84.0,
    modules: ['SIVB', 'SLA', 'LM_STOWED', 'CSM'],
    stack: true,
  },
  // S-IVB with the LM still on the SLA base (passive target during TD&E).
  SIVB_LM: { ref: 80.0, modules: ['SIVB', 'SLA_BASE', 'LM_STOWED'], stack: true },
  SIVB: { ref: 77.0, modules: ['SIVB', 'SLA_BASE'], stack: true },
  CSM: { ref: CSM_REF, modules: ['CSM'], stack: false },
  // CSM docked to the LM that is still attached to the S-IVB (between docking and extraction).
  CSM_LM_SIVB: { ref: 84.0, modules: ['SIVB', 'SLA_BASE', 'LM_STOWED', 'CSM_DOCKED_TOP'], stack: true },
  CSM_LM: { ref: 1.9, modules: ['CSM', 'LM_DOCKED'], stack: false },
  LM: { ref: 2.5, modules: ['LM'], stack: false },
  LM_ASC: { ref: 4.9, modules: ['LM_ASC'], stack: false },
  CSM_LMASC: { ref: 0.6, modules: ['CSM', 'LM_ASC_DOCKED'], stack: false },
  CM: { ref: 1.0, modules: ['CM'], stack: false },
  // Apollo 13 after the SM jettison: CM still docked to the LM lifeboat.
  CM_LM: { ref: 3.6, modules: ['CM', 'LM_DOCKED'], stack: false },
  SM: { ref: -2.0, modules: ['SM'], stack: false },
};

/**
 * Pose of a module datum inside a configuration, relative to the configuration reference point.
 * @param {string} config key of CONFIGS
 * @param {string} module one of: SIC, SII, SIVB, SLA, SLA_BASE, LM_STOWED, CSM, CSM_DOCKED_TOP,
 *   LES, LM, LM_DOCKED, LM_ASC, LM_ASC_DOCKED, CM, SM
 * @returns {{offset: Vector3, quat: Quaternion}}
 */
export function moduleTransform(config, module) {
  const c = CONFIGS[config];
  if (!c) throw new Error(`Unknown config ${config}`);
  if (c.stack) {
    const st = c.stations?.[module] ?? {
      SIC: STACK.sicBase,
      SII: STACK.siiDatum,
      SIVB: STACK.sivbDatum,
      SLA: STACK.slaDatum,
      SLA_BASE: STACK.slaDatum,
      LM_STOWED: STACK.lmDatum,
      CSM: STACK.csmDatum,
      LES: STACK.csmDatum,
    }[module];
    if (st !== undefined) return stackPose(st, c.ref);
    if (module === 'CSM_DOCKED_TOP') {
      // CSM turned around (apex pointing down the stack, -X) docked to the stowed LM's drogue.
      const lmTop = STACK.lmDatum + GEOM.lm.dockRingX;
      const datum = lmTop + GEOM.csm.dockRingX;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
      return { offset: new Vector3(datum - c.ref, 0, 0), quat: q };
    }
  }
  switch (module) {
    case 'CSM':
    case 'CM':
    case 'SM':
      return { offset: new Vector3(-c.ref, 0, 0), quat: ID.clone() };
    case 'LM':
    case 'LM_ASC':
      return { offset: new Vector3(-c.ref, 0, 0), quat: ID.clone() };
    case 'LM_DOCKED':
    case 'LM_ASC_DOCKED':
      return { offset: new Vector3(DOCKED_LM_DATUM_X - c.ref, 0, 0), quat: Q_LM_IN_CSM.clone() };
    default:
      throw new Error(`Module ${module} not in config ${config}`);
  }
}

/** Shift (in the body frame of the old config) of the reference point when switching configs
 *  that share the same axis (e.g. staging). Used by physics to keep visual continuity. */
export function refShift(fromConfig, toConfig, sharedModule) {
  const a = moduleTransform(fromConfig, sharedModule);
  const b = moduleTransform(toConfig, sharedModule);
  // module datum in old config = a.offset ; in new config = b.offset. New ref (in old frame) = a.offset - b.offset
  return a.offset.clone().sub(b.offset);
}

export const DOCKING = {
  // LM pose in the CSM frame when docked (CSM datum frame): datum position and rotation.
  lmInCsm: { position: new Vector3(DOCKED_LM_DATUM_X, 0, 0), quat: Q_LM_IN_CSM.clone() },
};
