# Proyecto Apolo — Architecture & module contracts

This document is the **contract** between all modules. Every agent/developer must read it fully before
writing code. If you need to deviate from a contract, keep backwards compatibility and write the change in
`docs/integration-notes/<your-agent>.md` (create the file) so the integrator can reconcile.

## 0. The game

A realistic, first-person simulator of the **Apollo 11** and **Apollo 13** missions (plus bonus Apollo 12
"SCE to AUX", Apollo 8 "Earthrise", and training scenarios), built as a web game (three.js + Vite). Spanish UI.

**Two roles, chosen every time the game starts** (menu: role → mission → chapter → briefing):

- **Astronauta** — first person inside the spacecraft: the Command Module (riding the Saturn V) and the
  Lunar Module. Every switch, breaker, rotary, pushbutton and DSKY key of the cabins is interactive. The player
  performs the crew's procedures, flies dockings, the lunar landing, manual burns, reentry, EVA.
- **Controlador de vuelo (Houston)** — first person inside the Mission Operations Control Room (MOCR, Building
  30, Houston). The player walks between consoles, sits at them, reads live telemetry from the same simulation,
  pushes console buttons (all interactive), answers GO/NO-GO polls, diagnoses failures (Apollo 13 EECOM,
  Apollo 11 1202 alarms as GUIDO, Apollo 12 SCE to AUX as EECOM), relays instructions via CAPCOM. The crew is
  flown by AI (scripted crew actions on the real switches + autopilots). Optional "TV" view of the spacecraft (T).

Houston radio is audible: Quindar tones, static, synthesized voices (English original with Spanish subtitles,
or Spanish voice), and real NASA public-domain clips for the iconic moments.

**Platforms**: desktop (mouse+keyboard, gamepad optional) and **mobile phones/tablets in landscape only**
(touch controls; portrait shows "gira el teléfono"). Responsive from 640×360 to 4K.

**Hardware budget (important)**: the dev/target machine is an Intel UHD 600 laptop with 4 GB RAM. Target
60 fps at 1280×720 on quality `low`. Keep draw calls < ~250, triangles < ~400k on screen, no per-frame
allocations in hot paths, textures ≤ 2K on `low`/`medium`, shadows only where they matter (lunar surface).
Measure with `?debug=…` + the FPS counter (Ajustes → mostrar FPS) and the smoke tool (reports fps).

## 1. Stack, commands, testing

- Vite 6 + three **0.170.0** (use r170 APIs: `BufferGeometry`, `mergeGeometries` from
  `three/addons/utils/BufferGeometryUtils.js`, `three/addons/...` for examples), vanilla ES modules, no TS,
  no UI framework (use `h()` from `src/core/dom.js`). Fonts via @fontsource (Barlow, Barlow Condensed,
  Share Tech Mono) — already imported in `main.js`; on canvas use `"Barlow Condensed"`, `"Barlow"`,
  `"Share Tech Mono"` after `document.fonts.ready`.
- `npm run dev` — dev server (port 5173).
- `npm run check` — **fast** syntax + import-resolution check of the whole app (≈2 s). Run it often.
- `npm test` — `node --test tests/` (sim modules are DOM-free → unit-testable in node; `three` math works
  in node). Put tests in `tests/<module>.test.js`.
- `npm run smoke -- --url "/?play=a11-launch&role=astronaut" --wait 8000 --shot tools/screenshots/x.png` —
  headless Edge on the real GPU; prints JSON with console/page errors, fps, screenshots (you can view PNGs).
  Options: `--mobile` (844×390 landscape touch), `--steps '[{"wait":2000},{"keys":"KeyC"},{"shot":"a.png"}]'`,
  `--eval "js"`, `--click sel`, `--hold KeyW:1500`. Runs are serialised by a lock file (machine has little
  RAM): keep runs short and do not run `vite build` (use `npm run check`).
- `/?debug=<name>&k=v` loads `src/debug/<name>.js` (default export `async (game, params) => ({ update(dt),
  render(), resize?(w,h), dispose?() })`). Each agent adds its own debug views with **unique, prefixed names**
  (e.g. `src/debug/models-saturnv.js`, `src/debug/panels-cm.js`) to test components in isolation.
- `/?play=<chapterId>&role=astronaut|controller` jumps straight into a chapter.
- `window.__game` is the Game instance (debugging, smoke evals). `window.__APOLO_READY__` true after boot.

## 2. Conventions

- **Units**: SI internally (m, kg, s, N, rad, K or °C). Imperial only for display (Apollo instruments: ft,
  ft/s, nmi, lb, psi, °F) — use `src/core/constants.js` conversions.
- **Time**: `clock.get` = GET seconds since liftoff (negative in countdown). UTC = `clock.utcMs`. Mission
  epochs in `MISSION_EPOCH`. `GET(h,m,s)` helper. Format with `MissionClock.format()`.
- **Frames**: ECI (X → vernal equinox, Z → north pole). **Three.js world axes = ECI axes**, metres,
  rendered **camera-relative** (floating origin). Body axes: see `src/sim/geometry.js` header.
- **Language**: all player-facing text in **Spanish** (neutral Latin-American; tú). Cockpit/console placards
  in authentic **English** (as flown). Radio lines carry `en` (original/authentic) + `es` (translation).
  Code, comments and identifiers in English.
- **No DOM / renderer in `src/sim/**`** (node-testable). Sim may import math from `three`.
- **IDs**: switches `CM.<SYS>.<NAME>` / `LM.<SYS>.<NAME>` / `MOCR.<CONSOLE>.<NAME>`; circuit breakers
  `CM.CB.<NAME>` / `LM.CB.<NAME>`; telemetry keys `CM.<SYS>.<...>` / `LM.<SYS>.<...>` (UPPER_SNAKE, dots).
- **Performance**: reuse temporaries (`const _v = new Vector3()` at module scope), no closures/arrays per frame
  in hot loops, throttle canvas redraws (panels ≤ 15 Hz for dynamic instruments), dispose GPU resources.
- **File ownership**: edit only the paths your agent owns (§3). Read anything. Shared contract files
  (`src/core/*`, `src/sim/{Simulation,Vehicle,SwitchBoard}.js`, `src/cockpit/Panel.js`,
  `src/missions/{MissionRunner,registry}.js`, `src/scenes/PlayScene.js`, `src/main.js`, this doc) belong to
  the architect: if you need a change there, describe it in your integration notes (small, backwards-compatible
  additions may be made if strictly necessary — list them in the notes).

## 3. Directory layout & ownership

| Agent | Owns |
|---|---|
| architect | `src/core/**`, `src/sim/{Simulation,Vehicle,SwitchBoard}.js`, `src/cockpit/Panel.js`, `src/missions/{MissionRunner,registry,stub}.js`, `src/scenes/{PlayScene,DebugScene}.js`, `src/main.js`, `index.html`, `tools/**`, `docs/ARCHITECTURE.md` |
| **csm** | `src/sim/csm/**`, `tests/csm*.test.js`, `docs/systems/CSM.md` |
| **lm** | `src/sim/lm/**`, `tests/lm*.test.js`, `docs/systems/LM.md` |
| **physics** | `src/sim/physics/**`, `src/sim/terrain/**` (pure lunar terrain function shared with rendering), `tests/physics*.test.js` |
| **gnc** | `src/sim/gnc/**`, `tests/gnc*.test.js`, `docs/systems/AGC.md` |
| **widgets** | `src/cockpit/widgets/**`, `src/cockpit/FlatPanelView.js`, `src/cockpit/style/**`, `src/debug/widgets-*.js` |
| **cabins** | `src/cockpit/CockpitView.js`, `src/cockpit/cabins/**`, `src/cockpit/interaction/**` (PanelMesh, PanelInteractor — reused by MOCR), `src/debug/cabins-*.js` |
| **cmpanels** | `src/cockpit/panels/cm/**`, `src/debug/panels-cm*.js` |
| **lmpanels** | `src/cockpit/panels/lm/**`, `src/debug/panels-lm*.js` |
| **models** | `src/render/models/**`, `src/sim/geometry.js` (values only; keys are contract), `src/debug/models-*.js` |
| **env** | `src/render/**` except `models/`, i.e. `FlightView.js`, `SpaceRenderer.js`, `env/**`, `effects/**`, `cameras/**`, `ExteriorFeed.js`, `MenuBackdrop.js`; `src/debug/env-*.js` |
| **mocr** | `src/mocr/**` except `consoles/`, `src/debug/mocr-*.js` |
| **mocrdata** | `src/mocr/consoles/**`, `src/debug/mocrdata-*.js` |
| **ui** | `src/ui/**`, `src/scenes/{Menu,Briefing,Debrief,Hangar,Archive,Credits}Scene.js`, `src/styles/ui/**`, `src/data/**` (encyclopedia, glossary, crew bios), `src/debug/ui-*.js`, `README.md` |
| **audio** | `src/audio/**`, `src/debug/audio-*.js` |
| **a11** | `src/missions/apollo11/**` (except `eva.js`), `src/missions/common/**` |
| **a13** | `src/missions/apollo13/**` (incl. its mini-game overlays in `src/missions/apollo13/ui/`) |
| **bonus** | `src/missions/{apollo12,apollo8,training}/**`, `src/missions/apollo11/eva.js`, `src/eva/**` |

## 4. Core services (`src/core/`)

- `Game` (`game`): `renderer` (single `THREE.WebGLRenderer`, `autoClear=false`, ACES, sRGB), `uiRoot` (HTML
  layer, `pointer-events:auto` children), `bus` (global EventBus), `store`, `input`, `audio` (AudioEngine),
  `assets.texture(name, {sizes:['4k','2k'], srgb})`, `quality` (profile: `name, pixelRatio, antialias, shadows,
  textures, particles, bloom, anisotropy, panelPxPerMm, terrainDetail`), `width/height`, `goto(scene, params)`,
  `showLoading(text)`, `showError(err)`. Scenes: `async enter(params)`, `exit()`, `update(dt)`, `render()`,
  `resize(w,h)`. Registered scenes: `menu, briefing, play, eva, debrief, debug` (+ `hangar, archive, credits`
  auto-registered if the files exist).
- `store` (`Store.js`): `settings` (see `DEFAULT_SETTINGS`), `progress`, `session` ({role, missionId,
  chapterId} — not persisted), `setSetting`, `recordChapterResult`, `unlockAchievement`, `onChange`.
- `Input`: contexts `global`, `flight`, `walk` (views enable theirs with `setContext`). `axis(name)` for
  `pitch, yaw, roll, transX, transY, transZ, walkX, walkZ` (+ any virtual axis like `lookX`), `down/pressed(action)`,
  `mouse {x,y,dx,dy,wheel,buttons,locked}`, `requestPointerLock(el)`. **Touch**: `input.isTouch`,
  `setVirtualAxis(name, v)`, `virtualHold(action, on)`, `virtualPress(action)` — on-screen controls (ui agent)
  feed these, so gameplay code reads the same API on every platform. `captureKeys` lets a widget (DSKY) take
  the keyboard. Default key bindings are in `Input.js` (WASD/QE rotation, IJKL/UO translation, PgUp/PgDn
  throttle, Home/End ROD, arrows LPD, C camera, V next camera, X seat, F panel focus, T MOCR⇄TV, Tab checklist,
  M map, H HUD, F1 help, `.`/`,` warp, `/` 1×, F8 skip, Esc pause).
- `MissionClock`: `get`, `warp`, `effectiveWarp`, `setLimit(name,max)`/`clearLimit`, `warpUp/Down`,
  `dropWarp()`, stops (used by runner), `format`, `formatT`, `parse`. `WARP_LEVELS` 1…10000.
- `EventBus`: `on` (returns unsubscribe), `once`, `off`, `emit`, `clear`.

## 5. Simulation core

`Simulation` (`src/sim/Simulation.js`) is view-independent: `bus` (cleared at chapter end), `clock`, `vehicle`,
`dyn` (FlightDynamics), `gnc` (GNCHost), `csm/lm/saturn` getters, `runner`, `role`, `missionId`, `chapter`.
Substep loop per frame (h ≤ `min(dyn.maxStep(), 10)`):
`vehicle.sw.update(h) → gnc.update(h) → saturn/csm/lm.update(h) → dyn.step(h) → clock.tick(h) → runner.tick(h)`.
**Every `update(dt)` must be stable for dt up to 10 s** (use exponential relaxation, not explicit Euler, for
thermal/pressure models; clamp).

`Vehicle` (`src/sim/Vehicle.js`) is the blackboard — read its header. Key rules:
- `vehicle.state` written only by physics. `vehicle.controls` written by views/AI crew. `vehicle.cmd` written
  only by GNC. `vehicle.tm` written by its owning module (prefix by module). `vehicle.parts` flags written by
  physics (separations) or the owning systems module (e.g. `lmGearDeployed` by LM systems).
- Discrete events: systems call `vehicle.request(kind, data)` → `'vehicle:request'`; physics performs it and
  emits `'vehicle:event' {kind, get, ...}`; config changes emit `'vehicle:config' {config, prev}`.
  Event kinds: see `EVENT_KINDS` in `Vehicle.js` (extend if needed; document additions).
- `vehicle.station` = crew station the player occupies (`'CM' | 'LM'`), `setStation()` emits
  `'vehicle:station'`. `vehicle.isAttached('saturn'|'csm'|'lm')` tells physics what is part of the stack.
- Hardware modules implement: `constructor({vehicle, bus, clock, missionId})`, `reset(preset)`, `update(dt)`,
  `massProps() → {mass, inertia: Vector3}` (own mass only), `propulsion(acc, dt)` (adds body-frame
  `acc.force`, `acc.torque`, `acc.mdot`; consumes propellant), `trigger(failureName, opts)`, `dispose()`.

`SwitchBoard` (`src/sim/SwitchBoard.js`) — read its header (definitions, momentary/rest, guards, stuck, broken
CBs, `pulse`, `release`, `apply(map)`, `snapshot/restore`). **Momentary controls must be handled edge-driven**
via `'switch:changed' {id, value, prev, source}`. Sources: `user | crew | script | system | restore`.

`geometry.js` — module datums, `CONFIGS` (SATURN_V, SATURN_V_SII, SIVB_STACK, SIVB_LM, SIVB, CSM,
CSM_LM_SIVB, CSM_LM, LM, LM_ASC, CSM_LMASC, CM, SM), `moduleTransform(config, module)`, `refShift`,
`DOCKING`, `GEOM` (dimensions, LM/CM eye points). Physics, models, cabins and env all use it so everything
lines up (the docked LM, docking ports, eye points, footpad plane for touchdown).

## 6. Physics (`src/sim/physics/`, agent **physics**)

`FlightDynamics` (keep the stub's API): `init(setup)`, `mode` (`PAD | ASCENT | SPACE | LANDED | ENTRY |
SPLASHED`), `setMode`, `step(h)`, `maxStep()`, `maxWarp()`, `bodies` (passive: `{id, config, r, v, q, w, mass,
ttl?, debris?, label}`), `addBody/removeBody/getBody`, `predict(durationS, stepS) → [{t, r}]`,
`moonPos/moonVel/sunDir` (updated every step), `terrainHeight` hook, `handleRequest`, `dispose`.
Must provide:
- High-quality propagation (RK4 or adaptive) with Earth (J2 optional) + Moon (+ Sun optional) gravity,
  atmosphere (US76-like density, drag, Mach), Earth rotation, Moon rotation (tidally locked approximation).
- **Derived state** (every step): all fields of `vehicle.state` (primary, alt, altTerrain near the Moon using
  `src/sim/terrain/lunarTerrain.js`, speed, vRel, rRel, vSurface, hdot, vHoriz, lat/lon in primary-fixed frame,
  gLoad, dynPressure, mach, apoAlt/periAlt/inclination, inShadow, losEarth, inBlackout, landed, splashed).
- **SaturnV** module (`SaturnV.js`, launch-vehicle mass only): real stage data (Apollo 11 SA-506 and Apollo 13
  SA-508 flight evaluation numbers: thrust, Isp, mass flow, masses, burn times), IU guidance (tower clear, roll
  program to 72° azimuth, pitch program, IGM in upper stages), event timeline (CECO, OECO, staging, interstage
  jettison, S-II CECO — **Apollo 13: S-II center engine early shutdown at T+5:30 from pogo, other engines and
  the S-IVB burn longer**), engine status lights in tm (`CM.LV.ENG1..5`), the S-IVB restart for **TLI**
  (TB6/`XLUNAR` switch), LV guidance takeover (`cmd.lvGuidance`), abort support. Visual timings must match
  history (staging ≈ 2:41, LET jettison ≈ 3:17 by crew, orbit ≈ 11:49 for A11).
- Config transitions for all `EVENT_KINDS` that are separations/dockings, spawning passive bodies
  (S-IC/S-II/interstage/LES/SLA panels/S-IVB/LM descent stage/ascent stage/SM) with plausible separation
  velocities, keeping visual continuity (`refShift`).
- **Docking**: detect capture when the CSM probe tip enters the target drogue within tolerances
  (lateral < 0.3 m, closing 0.03–0.5 m/s, angular misalignment < 10°, rates < 1°/s): emit `DOCK_CAPTURE`, then
  `DOCK_HARD` after probe retract (`CM.DOCK.PROBE` RETRACT or automatic in AI mode), set config.
  Expose `dockingTelemetry(targetId) → {range, rangeRate, lateral: Vector2, angles}` for HUD/COAS.
- **Lunar landing contact**: touchdown when footpads (LM datum) reach the terrain; contact light when probes
  (1.73 m) touch; crash detection (vertical > 3 m/s or horizontal > 1.5 m/s or tilt > 12° or boulder) →
  `'vehicle:event' {kind:'TOUCHDOWN', vSpeed, hSpeed, tilt, crash}`; `LANDED` mode after.
- **Entry**: CM aerodynamics (L/D ≈ 0.3, trim, bank angle from `cmd`/controls), heating, g-load, blackout
  (`inBlackout` ~ 4–6 min; Apollo 13 longer), drogues at 24,000 ft, mains at 10,000 ft (respond to ELS
  switches or auto), splashdown (`SPLASHED`).
- `initialStates.js`: implement **every** name in `INITIAL_STATE_NAMES` consistently with the ephemeris and
  history (e.g. `PRE_LOI` reaches perilune ≈ 60 nmi over the far side at GET 75:49:50; `PRE_PDI` 50,000 ft
  descent orbit perilune ahead of Tranquility at GET 102:33; `A13_TLC_55H` on the hybrid trajectory). Use
  backward propagation from known arrival conditions. Return `{r, v, q, w, mode, primary, config?}`.
- `targeting.js` (ground "RTCC"): `computeBurnPAD(kind, sim) → PAD` for TLI, LOI-1, LOI-2, DOI, TEI, MCCs,
  A13 free-return DPS, PC+2, MCC-5, deorbit/entry PADs; PAD shape:
  `{ name, tig (GET s), dv: {x,y,z} (LVLH, m/s), dvTotal, burnTime, attitude: {roll,pitch,yaw} deg,
  ha, hp (nmi), engine: 'SPS'|'DPS'|'APS'|'RCS'|'SIVB', notes }`.
- `lunarTerrain.js` (`src/sim/terrain/`): pure deterministic function `heightAt(latRad, lonRad) → m` and
  `boulderAt(...)` around landing sites (Tranquility with **West crater + boulder field** at the original
  target), used by physics AND by env rendering so the mesh and the collision agree.

## 7. CSM systems (`src/sim/csm/`, agent **csm**)

Complete registry `CM_SWITCHES` (hundreds of authentic MDC/side/LEB controls with labels/panels/Spanish
`desc`) and `CM_SIGNALS`. **Keep every id of the stub registry exactly** (reserved contract ids). Systems:
EPS (3 fuel cells with reactant valves/purge/radiators, Main Bus A/B, battery bus, entry batteries A/B/C,
pyro batteries, bus ties, battery charger, 3 inverters → AC buses 1/2, DC/AC indicator selectors, overload &
undervolt), cryogenics (O2/H2 tanks 1&2: pressure, quantity, heaters, fans, surge tank), ECS (cabin & suit
pressure/temperature, O2 flow, CO2 with square LiOH canisters, glycol loop/radiators/evaporator, cabin fans,
suit compressors, water), SM RCS quads A–D and CM RCS 1/2 (He/propellant isolation talkbacks, jet power,
propellant use from `cmd.rcsRot/rcsTrans`), SPS (He valves, pilot valves, ΔV THRUST A/B, gimbal motors with
START momentary, TVC, propellant & helium, chamber pressure, ullage requirement), SCS/EMS signals that are
hardware (ΔV counter, g-meter), C&W (lamp matrix, master alarm latch + tone, lamp test, mode), sequencer
(LES/ELS pyros, CSM/LV SEP, CM/SM SEP, SIVB/LM SEP, apex cover, drogues/mains), mission & event timers,
comm (S-band/VHF/HGA states for INCO), docking probe, LV indicators (engine lights from saturn tm),
SCE power. Presets (`reset(name)`): `PRELAUNCH, EARTH_ORBIT, TLC, LUNAR_ORBIT, TEC, ENTRY, POWERED_DOWN,
A13_PRE_EXPLOSION` (+ object form `{preset, switches, consumables}`).
Failures (`trigger`): **`O2_TANK2_EXPLOSION`** (Apollo 13 at GET 55:54:53 after the cryo stir: tank 2 qty
off-scale/0, pressure drop, bay 4 panel lost (`vehicle.parts.smDamaged=true`, emit
`O2_TANK2_EXPLOSION`), FC 1 & 3 failing as O2 bleeds, MAIN BUS B undervolt, master alarm, O2 tank 1 leaking
over ~2 h, attitude jolt; realistic telemetry glitch 1.8 s), **`LIGHTNING_STRIKE`** (Apollo 12 at T+36.5 s
and T+52 s: fuel cells disconnect from buses, "Christmas tree" C&W, SCE garbling telemetry until `SCE_PWR`
→ AUX; FC reset via MNA/MNB FCn ON restores), plus generic ones (`FC_FAIL_n`, `INVERTER_n`, `SPS_HE_LEAK`,
`RCS_QUAD_X_LEAK`, `GLYCOL_LEAK`). Expose helper queries used by missions/MOCR: `powerBudget()` → amps,
`consumables()` → {o2kg, h2kg, waterKg, batAh: {A,B,C}, spsKg, rcsKg}, `isPowered(bus)`.
Telemetry (reserved keys; add many more): `CM.EPS.MNA.V, CM.EPS.MNB.V, CM.EPS.AC1.V, CM.EPS.AC2.V,
CM.EPS.FC{1..3}.AMPS|.V|.ON_LINE|.TEMP_F, CM.EPS.BAT_{A,B,C}.V|.AH, CM.EPS.<switch>_TB (talkbacks:
'GRAY'|'BARBER'|'OPEN'|'CLOSED'), CM.CRYO.{O2,H2}_{1,2}.P_PSI|.QTY (0..1)|.T_F, CM.ECS.CABIN.P_PSI|.T_F,
CM.ECS.SUIT.P_PSI, CM.ECS.PPCO2_MMHG, CM.ECS.O2_FLOW_LBH, CM.SPS.{OX,FUEL}_QTY, CM.SPS.PC_PSI,
CM.SPS.THRUST (bool), CM.RCS.QUAD_{A..D}.QTY, CM.CW.MASTER_ALARM, CM.CW.TONE, CM.CW.<LAMP_SNAKE_CASE>
(FC_1, FC_2, FC_3, FC_BUS_DISCONNECT, MAIN_BUS_A_UNDERVOLT, MAIN_BUS_B_UNDERVOLT, AC_BUS_1, AC_BUS_2,
AC_BUS_1_OVERLOAD, AC_BUS_2_OVERLOAD, CRYO_PRESS, O2_FLOW_HI, CO2_PP_HI, GLYCOL_TEMP_LOW, SUIT_COMPRESSOR,
SPS_PRESS, SM_RCS_A..D, CM_RCS_1, CM_RCS_2, CMC, ISS, BMAG_1_TEMP, BMAG_2_TEMP, PITCH_GMBL_1/2, YAW_GMBL_1/2,
BAT_CHARGER, BAT_RELAY_BUS, SPS_FLANGE_TEMP_HI, UPLINK_ACTY, …), CM.MT.GET (NaN when unpowered),
CM.MT.EVENT, CM.LV.ENG1..5, CM.LV.SII_SEP, CM.LV.LV_GUID, CM.LV.LV_RATE, CM.LV.LIFTOFF, CM.LV.NO_AUTO_ABORT,
CM.LV.ABORT, CM.ALT_FT (cabin altimeter), CM.EMS.DV_FPS|.RTG_NM|.G|.VI_FPS|.LIGHT_05G`.
Document everything in `docs/systems/CSM.md` (switch list per panel, signals, failure behaviour).

## 8. LM systems (`src/sim/lm/`, agent **lm**)

Complete `LM_SWITCHES` / `LM_SIGNALS` (keep stub ids). EPS (descent batteries 1–4 HV/LV, ascent 5–6
normal/backup, CDR/LMP buses, cross-tie, inverters, ED batteries, CSM/LM power transfer, amp-hour accounting
— **Apollo 13 lifeboat power budget**), ECS (cabin/suit loop, suit fans, round LiOH canisters PRIM/SEC with
CO2 removal capacity, **"mailbox" adapter state** `lm.ecs.adapterInstalled` using CM square canisters,
water (descent/ascent tanks, sublimator), O2 (descent/ascent tanks), glycol), DPS (throttle 10–60 % and
92.5 % FTP, He pressurization, propellant gauging + **DES QTY low-level light at ~5.6 %**), APS, LM RCS A/B
(+ ascent interconnect), landing gear deploy, explosive devices (master arm, stage), radar (landing radar
ALT/VEL lights & data good, rendezvous radar modes incl. the Apollo 11 1202-inducing configuration flag),
C&W (LM lamp matrix + master alarms + tone), timers, **ENG ARM breaker broken** failure (A11:
`LM.CB.ENG_ARM` via `sw.setBroken`, fixable with a pen — `lm.fixBreakerWithPen(id)`), engine start/stop/abort
logic (ABORT / ABORT STAGE pushbuttons latch), descent engine command override. Presets: `STOWED, ACTIVATED,
PRE_PDI, LANDED, PRE_ASCENT, LIFEBOAT, POWERED_DOWN`. Reserved telemetry (add more): `LM.EPS.CDR_BUS.V,
LM.EPS.LMP_BUS.V, LM.EPS.BAT{1..6}.V|.AH, LM.EPS.TOTAL_AMPS, LM.EPS.AC.V, LM.ECS.CABIN.P_PSI|.T_F,
LM.ECS.SUIT.P_PSI, LM.ECS.PPCO2_MMHG, LM.ECS.O2_{DES,ASC}_QTY, LM.ECS.H2O_{DES,ASC}_QTY, LM.DPS.{FUEL,OX}_QTY,
LM.DPS.PC_PSI, LM.DPS.THRUST_PCT, LM.APS.{FUEL,OX}_QTY, LM.RCS.{A,B}.QTY, LM.CW.MASTER_ALARM, LM.CW.TONE,
LM.CW.<LAMP> (DES_QTY, ASC_PRESS, DES_REG, CO2_HI, CABIN, SUIT_FAN, GLYCOL, WATER_QTY, PRE_AMPS, LGC, ISS,
RCS_TCA, RCS_A_REG, RCS_B_REG, ASC_QTY, BATTERY, INVERTER, LDG_RDR, RNDZ_RDR, ENG_GMBL, …), LM.MT.GET,
LM.MT.EVENT, LM.ENG.THRUST_PCT, LM.ENG.CMD_THRUST_PCT, LM.ENG.T_W`. Docs in `docs/systems/LM.md`.

## 9. GNC and cockpit

### 9.1 GNC (`src/sim/gnc/`, agent **gnc**)
`GNCHost` keeps the stub API: `cmc`, `lgc` (AGC instances), `ags` (LM Abort Guidance System with DEDA),
`autopilot` (`set(mode, opts)`, `clear()`, `mode`), `activeComputer`, `configure(opts)`, `update(dt)`, `dispose`.
`AGC`: `id`, `powered`, `program`, `dsky` (**DSKY contract below**), `alarms`, `alarm(code)`,
`runProgram(p)`, `uplink(data)`, REFSMMAT/IMU (stable member, gimbal angles OGA/IGA/MGA, **gimbal lock at
MGA > 85° warning / 90° lock → coarse align / P52 needed**, IMU power, caging), state vector, targets (loaded
from PADs via P30/P27 uplink). Programs (CMC/Colossus): P00, P01–P02 (prelaunch), P11 (Earth orbit
insertion monitor), P15 (TLI monitor), P20, P23 (cislunar nav, optional), P27 (uplink), P30 (external ΔV),
P40 (SPS thrusting) / P41 (RCS) / P47 (thrust monitor), P51/P52 (IMU align with star marks via optics
`CM.OPT.MARK` and the 37 Apollo navigation stars), P61–P67 (entry). LGC/Luminary: P00, P12 (powered ascent),
P20 (rendezvous nav), P30, P32–P35 (CSI/CDH/TPI/TPM simplified), P40/P42 (DPS/APS thrusting), P47, P52,
P57 (lunar surface align), P63 (braking), P64 (approach with **LPD** display N64: R1 = time/LPD angle,
redesignation via `controls.lpdAz/lpdEl` clicks), P66 (rate of descent, `controls.rodClicks` ±1 ft/s),
P68 (landing confirm). **Executive overflow 1201/1202 alarms** in P63/P64 when the RR is in the
cycle-stealing configuration (A11: alarms at the historical times), alarm codes via V05 N09; restart
behaviour. Verbs: V05, V06, V16, V21–V25 (load), V32, V33, V34, V35 (lamp test), V37, V48–V49 (DAP data /
auto maneuver), V50 (please perform), V57, V82 (orbit params), V99 (engine enable), etc. Nouns: N09, N17,
N18, N20, N22, N33, N36, N40, N42, N43, N44, N54, N60, N61, N62, N63, N64, N65, N68, N69, N81, N84, N85,
N86, N89, N92, N94. Correct flashing behaviour (V/N flash awaiting PRO/ENTR), KEY REL, OPR ERR, PROG, RESTART,
COMP ACTY; DSKY realistic timing.
Control: CSM DAP (CMC AUTO/HOLD/FREE via `CM.GNC.CMC_MODE`, deadbands, rate), SCS (BMAG rate/attitude hold,
MAN ATT ACCEL/RATE/MIN IMP, `CM.GNC.SC_CONT` CMC/SCS), SPS TVC, LM DAP (PGNS/AGS via `LM.GNC.GUID_CONT`,
MODE CONTROL AUTO/ATT HOLD/OFF, throttle AUTO/MAN, `controls.ttca`), entry bank control (CMC P64-P67 or
manual). Writes `vehicle.cmd`. FDAI drive: `CM.FDAI{1,2}.ROLL|PITCH|YAW` (deg) + `.ERR_*` (−1..1) +
`.RATE_*` (−1..1); `LM.FDAI{1,2}.*`; `CM.GNC.IMU.{OGA,IGA,MGA}`. LM landing displays: `LM.GNC.ALT_FT,
LM.GNC.ALTRATE_FPS, LM.GNC.XPTR_FWD_FPS, LM.GNC.XPTR_LAT_FPS, LM.GNC.LPD_DEG, LM.GNC.TIME_TO_GO,
LM.GNC.CONTACT_LIGHT`, range/rate `LM.RR.RANGE_NM, LM.RR.RATE_FPS`. **AI-crew autopilots** for controller
mode and cadet assists: `ATT_HOLD`, `ATT_MANEUVER {q|attitude}`, `BURN {pad}` (attitude + ullage + engine on
at TIG + cutoff at ΔV), `DOCKING {targetId}`, `LANDING {site}` (P64/P66 flown like Armstrong: redesignate
past West crater, land with ~20–45 s of fuel), `ASCENT`, `ENTRY`, `MANUAL_TERMINATOR_BURN`.

**DSKY contract** (used by widgets/panels/MOCR GUIDO console):
```js
agc.dsky.display = { prog:'63', verb:'06', noun:'62', r1:'+00123', r2:'-01234', r3:'      ',
  flashVN:false, compActy:false, lights:{ uplinkActy, noAtt, stby, keyRel, oprErr, temp, gimbalLock,
  prog, restart, tracker, alt, vel } }       // strings: 2 chars (or '  '), registers 6 chars sign+5 digits
agc.dsky.version   // integer bumped on every display change (use as redraw signature)
agc.dsky.press(key) / agc.dsky.release(key)
// keys: 'VERB','NOUN','+','-','0'..'9','CLR','PRO','KEY REL','ENTR','RSET'
// events: 'dsky:key' {agc,key}, 'dsky:proceed', 'agc:program' {agc,program}, 'agc:alarm' {agc,code}
```
The CM has two DSKY faces (MDC panel 2 and LEB) on the same CMC — both widgets bind to `gnc.cmc.dsky`.
The LM DSKY (panel 4) binds to `gnc.lgc.dsky`. The AGS DEDA binds to `gnc.ags.deda` (same pattern:
`display`, `version`, `press`).

### 9.2 Panels and widgets
`src/cockpit/Panel.js` (read it): millimetre coordinates, `Widget` base (`signature()` primitive → redraw
on change, `draw(g, t)` in mm units, pointer/wheel/key handlers, `switchId`, `signal`, tooltip), `Panel`
(own canvas, dirty rects, `renderTo` for 2D, hit testing, highlights for checklist hints). PanelContext
`ctx = { sw, tm, bus, clock, audio, vehicle, sim, gnc, role, station, settings, input }`.

**Widget library** (agent **widgets**, `src/cockpit/widgets/`; export everything from
`src/cockpit/widgets/index.js`): photoreal-ish 2D canvas drawing (bevels, shadows, engraved labels, screw
heads, panel grey `#7f8487`-ish with subtle texture; MOCR beige/grey; LM panels lighter grey, CM darker).
Required widgets: `ToggleSwitch` (2/3 positions, momentary, **lever-lock**, guarded with red/black guard,
click upper/lower half; touch: tap upper/lower half; long-press/right-click = guard toggle), `RotarySwitch`
(pointer knob, detents, labels around; click left/right half or wheel), `Thumbwheel`, `CircuitBreaker`
(push/pull, IN/OUT with white band visible when OUT, broken state), `PushButton` (plain/lighted/latching,
e.g. ABORT, MASTER ALARM lighted red), `Lamp`, `Annunciator` (C&W matrix tile sets for CM and LM, lamp test),
`Talkback` (barber-pole / gray flag indicator bound to a tm key), `RoundGauge`, `EdgeMeter` (vertical/horizontal
profile meters, dual pointers, used everywhere in Apollo), `DigitalCounter` (mechanical drums), `SevenSegment`
(EL green for DSKY/timers), `MissionTimer`, `EventTimer`, **`DSKY`** (full keypad + EL display, bound to a
dsky source; keyboard entry while hovered: V/N/0-9/+/−/Enter/Backspace=CLR/P=PRO/R=RSET/K=KEY REL),
**`DEDA`**, **`FDAI`** (8-ball attitude ball drawn in 2D with correct markings, error needles, rate needles),
**`EMS`** (ΔV/RTG counters + scroll g-V plot + corridor lights), **`TapeMeter`** (LM ALT/ALT RATE tapes),
**`CrossPointer`** (LM), `ThrustWeight` (LM T/W + thrust meters), `GimbalPositionIndicator` (CM GPI), `Placard`
/ `Label` / `SectionFrame` (engraved section titles and lines), `CRTDisplay` (monochrome raster/vector CRT
look for MOCR: text pages, plots; `draw(fn)` callback API), `LightedButtonModule` (MOCR keysets),
`Clock/Digital readout` for MOCR. All widgets: Spanish tooltips (`desc`) + current position; click sounds via
`ctx.audio?.sfx(name)` (names in §13); hover cursor arrows; highlight support; touch-friendly hit areas
(min 9 mm on panel; views zoom). Also `FlatPanelView` (`src/cockpit/FlatPanelView.js`): a full-screen 2D
canvas viewer for any panel (pan/zoom with mouse/touch/pinch, crisp text via `renderTo`), used as "panel
focus" mode and as fallback on very weak GPUs.

**Panel specs** (ids/sizes are a contract with cabins): `CM_PANEL_SPECS` in
`src/cockpit/panels/cm/index.js` and `LM_PANEL_SPECS` in `src/cockpit/panels/lm/index.js`. Builders
`buildCMPanels(ctx) → Panel[]` and `buildLMPanels(ctx) → Panel[]` (agents **cmpanels**/**lmpanels**) place
widgets bound to the registries with authentic layouts (use NASA Apollo Operations Handbook / panel
drawings knowledge; every registry control must appear on some panel; every widget drawn must work).

### 9.3 CockpitView (agent **cabins**)
3D interior for the CM and LM (keep stub API): low-poly but convincing geometry (CM: three couches, MDC
curving over the crew, side consoles, LEB with optics eyepieces, 5 windows incl. rendezvous windows and
hatch window, tunnel; LM: standing stations, triangular front windows, overhead docking window, panels
1–16 around, AOT, restraints), interior lighting (floodlights, sun through windows), panel meshes built from
`Panel` canvases split in **512 px tiles** (`CanvasTexture` per tile; re-upload only tiles hit by
`panel.render()` dirty rects; ≤ 15 Hz for dynamic panels; immediate after interaction), raycast → UV →
panel mm → `panel.pointerDown/Move/Up`, hover tooltips (HTML), **mouse + touch** (tap = click, drag on empty
space = look, pinch/wheel = zoom FOV, long-press = secondary action, double-tap/F = zoom-to-panel), seats
(`seats`, `setSeat`, X key), head look limits, free look (Z), "panel focus" (smooth camera move to face a
panel, or FlatPanelView), window reticles: CM **COAS** (docking/terminator alignment) and LM **LPD grid** on
the CDR window (degree scale for P64), crew optics view (sextant/telescope for P52 — can be a 2D overlay
showing the star field from the exterior renderer). `getEyeTransform()` in module datum frame; `render(renderer)`
draws after the exterior pass (depth cleared). Export reusable `PanelMesh` + `PanelInteractor` from
`src/cockpit/interaction/` (MOCR uses them).

## 10. Rendering (agents **models** and **env**)

`FlightView` (agent **env**, keep stub API + facade): owns the exterior renderer (`SpaceRenderer`:
multi-pass far/near/cockpit with per-pass near/far planes and depth clears, camera-relative), Earth (Blue
Marble day, night lights, clouds, water specular, atmosphere rim/scattering shader, terminator), Moon (LROC
color + height), Sun (directional light, glare/flare), star field (real bright stars incl. the 37 Apollo
navigation stars; magnitudes), launch site (LC-39A pad, mobile launcher/tower with swing arms retracting,
flame trench, KSC flat terrain, ocean, sky with altitude-dependent colour), lunar surface (from
`lunarTerrain.js`; craters, boulders, low-sun shadows, LM descent dust), ocean for splashdown (USS Hornet /
Iwo Jima at distance, helicopters optional), effects (F-1/J-2/SPS/DPS/APS/RCS plumes, launch smoke & steam,
Max-Q vapor cone, staging (ullage/retro motors, interstage), LES jettison, debris, entry plasma, parachutes
(models), O2 tank venting cloud for A13), exterior camera modes (`exterior:chase`, `exterior:free` (orbit with
mouse/touch), `pad:tower`, `pad:far`, `onboard:interstage` (looking down at S-IC separation),
`target` (docking target), `surface` …), cockpit composition (creates `CockpitView` for `vehicle.station`,
switches on `'vehicle:station'`, renders exterior from the eye pose so windows show the real outside),
`observer` mode (controller TV), `ExteriorFeed` (`createExteriorFeed({game, sim, width, height}) →
{ texture, update(dt), dispose }` low-res render for MOCR wall screens), `MenuBackdrop`
(`createMenuBackdrop(game) → { update(dt), render(), resize(), dispose() }`: Saturn V on the pad at
night with xenon searchlights / Earth from lunar orbit — used by the menu). Handle `'mission:highlight'`
(forward to cockpit), `setCamera/cycleCamera/shake/fade/flash/setSeat/highlight` facade. Read flight
controls from `game.input` (keyboard/gamepad/virtual) into `vehicle.controls` for the astronaut.

Models (agent **models**, `src/render/models/`): procedural three.js models with good PBR materials and
correct proportions/markings (Saturn V black/white roll pattern, "USA"/"UNITED STATES", flag, S-IC fins and
engine fairings, F-1 bells, S-II/S-IVB J-2s, IU, SLA panels opening, LES tower with BPC, CSM with SM bays,
RCS quads, HGA, SPS bell, radiators, CM with docking probe/hatch/windows, damaged SM bay 4 variant, LM
descent stage with gold/black Kapton, legs (stowed/deployed), footpads and probes, DPS bell, ascent stage
facets, windows, RCS quads, antennas, docking target; astronaut A7L suit + PLSS, flag, EASEP (PSEP, LRRR),
parachutes (drogue/main), recovery ship, pad tower/mobile launcher). API:
`createSaturnV({quality})`, `createCSM({damaged})`, `createLM({stowed, ascentOnly})`, `createSIVB()`, …
each returning `{ root, parts: {...}, nozzles: {...}, dockPort?, setConfig?(config, parts), dispose() }`;
plus `buildConfigModel(config, parts, opts)` that assembles any `CONFIGS` entry using `moduleTransform`
(origin = config reference point). Model space = body axes (+X forward/up the stack). LODs for distance.

## 11. Missions (agents **a11**, **a13**, **bonus**)

Chapter module default export (merged with registry metadata by `loadChapter`):
```js
export default {
  setup: { get, config, state /* name from INITIAL_STATE_NAMES or object */, mode?, station, seat,
           csm /* preset or {preset, switches, consumables} or null */, lm, parts?, bodies?: [...], maxWarp?,
           gnc?: {...}, scene?: 'eva' },
  briefing: { summary, objectives: [..], tips?: [..], controller?: { summary, objectives } },
  speakers?: { CAPCOM: 'Charlie Duke', ... },   // name overrides for this chapter
  async run(ctx) { ... }
}
```
`ctx` API (implemented in `MissionRunner.js` — read it): `wait(s)`, `waitReal`, `waitGET`, `waitUntil(pred,
{timeout,maxWarp})`, `waitEvent(type, filter, {timeout})`, `waitSwitch`, `spawn`, `every`, `on`,
`setWarpLimit/clearWarpLimit/dropWarp`, `allowSkip(get,label)/disallowSkip/skipTo(get)`,
**`say(who, en, es, {channel, clip, wait, force})`**, `objective(id,text)`, **`crew(checklist)`**,
**`ground(task)`**, **`poll(p)`**, `choice(c)`, `hint`, `alert`, `caption`, `task`, `pad`, `highlight`,
`score/penalty`, `achievement`, `flag`, `complete({summary})`, `fail(reason)`; refs `sim, vehicle, sw, tm, dyn,
gnc, csm, lm, saturn, view, audio, store, settings, role, isAstronaut, isController, difficulty, t`.
Role semantics: write each chapter once. Crew procedures go through `ctx.crew` (player in astronaut mode, AI
crew in controller mode); Houston decisions through `ctx.ground/poll` (player in controller mode at
`chapter.controllerRole` console, AI otherwise). Skill segments (docking, landing, manual burns, entry)
in controller mode use the GNC AI autopilots while the player monitors/decides; in astronaut mode the player
flies (cadet difficulty may enable assists). Channels: `ag` air-ground (both roles; blocked by LOS/blackout),
`ic` intercom (astronaut only), `loop` MOCR flight loop (controller only), `pao`, `narration`.
Use real transcript lines (Apollo Flight Journal / ALSJ, Apollo 13 air-to-ground and FD loop) with accurate
GET where possible; `es` translation natural. Use NASA clips via `clip:` (§13). Scoring: `ctx.score` items with
max points (accuracy, timing, consumables, alarms handled, fuel at touchdown, etc.). Achievements: export
`achievements` arrays from `src/missions/<mission>/achievements.js` (`[{id, name, desc, icon?}]`) — the ui
achievements screen imports all via `import.meta.glob('../missions/*/achievements.js')`.

**Bus events** emitted by the runner (HUD/MOCR/views consume):
- `mission:start {chapter, role}` · `mission:end {success, summary, reason, score{total,max,items}, grade, stats}`
- `mission:say {id, who, whoLabel, channel, en, es, clip, durationS}` · `mission:sayEnd {id}`
- `mission:objective {id, text, state: active|done|failed, optional}`
- `mission:checklist {id, title, station, mode: player|ai, state: active|done, items:[{id,text,hint,optional,done,manual}]}`
  (HUD → runner: `mission:checklistConfirm {checklistId, itemId}` for manual items,
  `mission:checklistAuto {checklistId, itemId}` cadet auto-perform)
- `mission:crewAction {checklistId, text}` (AI crew did something — controller HUD log)
- `mission:groundTask {id, console, kind, title, prompt, options:[{id,label,detail}], timeoutS, evidence:[tmKeys], hint, resolve(optionId)}`
  · `mission:groundTaskEnd {id, choice, correct, timedOut}`
- `mission:poll {id, title, consoles:[{console, answer, isPlayer}], state: active|done}`
- `mission:choice {id, title, prompt, options:[{id,label,hint}], timeoutS, resolve}` · `mission:choiceEnd {id, choice}`
- `mission:hint {text, durationS}` · `mission:alert {text, level: info|caution|warning|success, durationS}`
- `mission:caption {text, sub, durationS}` · `mission:task {text}` · `mission:pad {pad}` · `mission:score {key, points, max, note}`
- `mission:highlight {ids}` (switch ids / widget ids / tm keys; empty = clear) · `mission:achievement {id}`
- `mission:skipAvailable {get, label} | null` (HUD → `mission:skipRequest`)
Other events: `switch:changed`, `switch:guard`, `switch:broken`, `vehicle:request`, `vehicle:event`,
`vehicle:config`, `vehicle:station`, `dynamics:mode`, `dynamics:bodyAdded/Removed`, `cw:alarm {vehicle, lamp}`,
`systems:failure`, `dsky:key`, `dsky:proceed`, `agc:program`, `agc:alarm`, `clock:warp {warp}`,
`view:camera {mode}`, `view:changed {view}`, `mocr:seat {console}`, `mocr:loop {loops}`, `sim:ready`.

## 12. MOCR (agents **mocr** + **mocrdata**)

`MOCRView` (agent **mocr**, keep stub API): the 1969–70 MOCR — four tiered rows of consoles facing five
large projection screens (world map ground track / trajectory plot / TV / event & consumables lists), clocks
(GET, GMT, time-to-event) above, glass-walled viewing room behind, period details (beige/grey consoles,
rotary dial phones, ashtrays, pneumatic tube stations, binders, headsets, ceiling lights). NPC controllers
seated (low-poly, white shirts, ties, headsets; idle animations; the one at your console disappears when you
sit). **First-person walking** (WASD/arrows + mouse look with pointer lock on desktop; virtual joystick + drag
look on touch), collisions with consoles/walls, **sit/stand** at consoles (E / tap "Sentarse"; seated view
faces the console with mouse free to click buttons), zoom on CRTs. Console geometry hosts Panels from
`buildConsolePanel(consoleId, ctx)` (agent **mocrdata**) via `PanelMesh/PanelInteractor` (agent **cabins**).
Player console = `chapter.controllerRole` (marker + HUD hint); tasks for other consoles may require walking.
Wall screens from `buildWallDisplays(ctx)` and optional `ExteriorFeed` (TV).
Console rows (front→back): BOOSTER, RETRO, FIDO, GUIDO · SURGEON, CAPCOM, EECOM, GNC, TELMU, CONTROL ·
INCO, PROCEDURES (O&P), AFD, FLIGHT, FAO, NETWORK · PAO, DOD, MISSION_DIRECTOR (back row/viewing room).

`buildConsolePanel(consoleId, ctx)` (agent **mocrdata**): each console panel has 1–3 **CRT telemetry pages**
fed live from `ctx.vehicle.tm/state`, `ctx.gnc` (EECOM: CSM EPS/cryo/ECS page with the Apollo 13 signature;
GNC: attitude/RCS/IMU gimbals; GUIDO: CMC/LGC state, program, alarms, DSKY mirror; FIDO: trajectory, apogee/
perigee, ground track; RETRO: abort/entry targets; BOOSTER: Saturn V stage engines/thrust/chamber pressure
with engine-out; TELMU: LM EPS/ECS incl. lifeboat budget; CONTROL: LM GNC/propulsion; SURGEON: crew biomed
ECG/heart rates; INCO: comm/antennas/signal strength; FLIGHT: summary board + poll status; CAPCOM: A/G loop
log and message composer; …), period-correct **display request keyboard** (buttons switch the page shown),
**comm keyset** (lighted voice-loop buttons: A/G, FLIGHT, MOCR DYN, back rooms; selected loops change what
the player hears: `mocr:loop`), event/status lights, **GO / NO GO** pushbuttons and an "acknowledge" button
that answer `mission:groundTask`/`mission:poll` when seated at the asked console (the HUD also shows the
task), "PTT" CAPCOM talk button. **Every button must do something** (switch page, toggle light, select loop,
answer task, phone ring...). Telemetry dropouts during LOS/blackout and the A13 1.8 s data loss.
Wall displays: world map with ground track + station coverage (Earth orbit), Earth–Moon trajectory plot
(cislunar), event timeline, consumables board.

## 13. Audio (agent **audio**)

`AudioEngine` (keep stub API): WebAudio graph with master/sfx/voice/music/ambience buses bound to settings;
`unlock()`; `sfx(name, {gain, pan, rate})` with synthesized sounds: `toggle`, `toggleHeavy`, `rotary`,
`cbIn`, `cbOut`, `guardOpen`, `guardClose`, `button`, `dskyKey`, `thumbwheel`, `uiHover`, `uiClick`,
`uiConfirm`, `uiBack`, `pyro`, `clunk`, `latch`, `bang` (A13), `thud`, `quindarIn` (2525 Hz 250 ms),
`quindarOut` (2475 Hz 250 ms), `shutter`, `paper`, `phoneRing`, `tube`, `footstep`, `chair`, `masterAlarm`
(one-shot), `cwTone`; `loop(name, opts) → {setGain, setRate, setParam, stop}`: `rumbleSIC`, `rumbleSII`,
`rumbleSIVB`, `sps`, `dps`, `aps`, `rcs`, `wind`, `plasma`, `cabinFans`, `suitLoop`, `pumps`, `static`,
`mocrRoom`, `masterAlarmTone`, `breathing`; `radio(line) → Promise` (Quindar in/out for Houston, band-pass +
static + compression; NASA clip if `line.clip`; else speechSynthesis with a distinct voice per speaker —
`voiceMode` setting: `en-sub` English, `es` Spanish, `text` none; Edge "Natural" voices preferred; timeouts
so a missing voice never blocks), `clip(name)`, `music(name|null)` (generative ambient: `menu`, `briefing`,
`tension`, `triumph`, `sad`), `duck`, `setPaused`, `stopAll`. NASA clips (public domain, in
`public/audio/nasa/`): `a11_countdown_liftoff` (~25 s "…ignition sequence start… liftoff, we have a liftoff…"),
`a11_eagle_has_landed` (~3 s), `a11_eagle_has_landed_ext` (~15 s), `a11_one_small_step` (~13 s),
`a13_houston_problem` (~17 s), `a08_merry_christmas`, `jfk_we_choose_launch`, `jfk_we_choose`,
`jfk_return_safely`. `SimAudio` maps sim → sound (engines by thrust & camera distance & atmosphere
(silence in vacuum outside, structure-borne rumble inside), staging bangs, RCS thumps, pumps/fans by EPS
state, C&W tone from `CM.CW.TONE`/`LM.CW.TONE`, entry roar, landing dust hiss, MOCR room murmur + selected
voice loops in controller mode).

## 14. UI (agent **ui**)

Scenes: `MenuScene` (title "PROYECTO APOLO" over `MenuBackdrop`, JFK clip optional; **role selection shown
every start** (two big cards: Astronauta / Controlador de vuelo), then mission select (Apolo 11, Apolo 13 —
campaign; Apolo 12, Apolo 8 — misiones especiales; Entrenamiento), chapter list with lock/complete/grade per
role, plus Archivo, Hangar (3D museum of Saturn V/CSM/LM with exploded view), Logros, Ajustes, Créditos),
`BriefingScene` (role-specific briefing: summary, objectives, crew, historical photo-like illustration,
controls cheat-sheet, "Comenzar"), `DebriefScene` (grade, score breakdown, historical note, achievements,
retry/next/menu), `HangarScene`, `ArchiveScene` (encyclopedia: Saturn V, CSM, LM, crews, MOCR positions,
timelines, glossary — rich Spanish content), `CreditsScene`. `HUD` (keep constructor signature
`{game, sim, view, role, chapter, mission, actions:{resume,restart,quit,toggleView}}` and
`update/resize/setPaused/dispose`): mission clock (GET + countdown "T-"), warp indicator & controls, comms
subtitles (speaker, Spanish + small English original), comm log (scrollback), objectives, checklist panel
(collapsible; "Auto" in cadet), PAD cards, alerts/hints, decision modals (`mission:choice`), ground-task
panel (controller), poll board (controller), telemetry strip (phase-dependent: altitude, velocity, apogee/
perigee, fuel, ΔV, range/rate for docking), trajectory map (M), help overlay (F1), pause menu (resume,
restart, settings, quit), camera/seat indicator, skip button, achievement toasts. **Mobile/touch**:
`TouchControls` overlay (left virtual stick = rotation or walk, right = translation or look, throttle slider,
camera/seat/menu buttons, ROD/LPD buttons in LM landing), enabled when `input.isTouch`; large hit targets;
layouts that fit 844×390 landscape; fullscreen button (+ `screen.orientation.lock('landscape')` when
available); respects safe areas. Settings screen for every `DEFAULT_SETTINGS` key. All text Spanish.

## 15. EVA (agent **bonus**)

`EVAScene` (`src/eva/EVAScene.js`) — may extend PlayScene or be standalone, same chapter/runner contract:
first-person helmet view (visor frame, PLSS status readout) + optional third person (V), 1/6 g kangaroo-hop
locomotion, dust, long shadows (sun ~10–14° elevation), the LM Eagle on the surface, ladder descent, first
step (clip `a11_one_small_step`), flag planting, EASEP deployment, samples, photos (camera "Hasselblad" mode),
TV camera, timeline & consumables; walk/touch controls via `walk` context.

## 16. Definition of done for every agent

1. Implement your scope fully and realistically — no placeholder "TODO" for core features.
2. `npm run check` passes; your unit tests pass (`npm test`); smoke-test your debug view(s) and, when
   relevant, a chapter that uses your module (`npm run smoke -- ...`) with **zero console/page errors**; look
   at your screenshots and iterate on visuals.
3. Performance respected on this machine (check reported fps).
4. Write `docs/integration-notes/<agent>.md`: what you built, public API, any contract additions/deviations,
   what other agents must do to integrate (be specific: file, function, ids).
5. Do not edit files you do not own (except tiny contract additions listed in your notes).
