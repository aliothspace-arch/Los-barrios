export type GamePhase = 'playing' | 'paused' | 'gameover';

export type WeatherType = 'golden' | 'clear' | 'rain' | 'storm' | 'fog';

export type CameraMode = 'chase' | 'cinematic' | 'hood';

export type VehicleKind = 'greenwood' | 'infernus' | 'sabre' | 'savanna' | 'police';

export type PlayerOutfitId = 'classic_cj' | 'grove_jacket' | 'ls_suit' | 'street_red';

export type ShopItemEffect =
  | 'heal_full'
  | 'heal_medium'
  | 'armor_full'
  | 'nitro_refill'
  | 'repair_vehicle'
  | 'respray_vehicle'
  | 'outfit_grove'
  | 'outfit_suit'
  | 'outfit_red'
  | 'outfit_classic';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  price: number;
  effect: ShopItemEffect;
  requiresVehicle?: boolean;
}

export type ShopVenueMode = 'indoor' | 'street_cart' | 'outdoor_bay';

export interface ShopSpec {
  id: string;
  name: string;
  category: 'market' | 'weapons' | 'clothing' | 'food' | 'customs';
  venueMode: ShopVenueMode;
  buildingId?: string;
  originX: number;
  originZ: number;
  facingHeading: number; // local +Z faces out the door / street side
  doorX?: number;
  doorZ?: number;
  counterLocalZ: number;
  counterHalfW: number;
  counterHalfD: number;
  registerX: number;
  registerZ: number;
  clerkX: number;
  clerkZ: number;
  x: number;
  z: number;
  accentHex: string;
  robMin: number;
  robMax: number;
  robWantedStars: number;
  items: ShopItem[];
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface ColliderAABB {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  category: 'building' | 'prop' | 'fence' | 'tree' | 'boundary';
}

export interface BuildingBlueprint {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotY: number;
  style:
    | 'grove_house'
    | 'commercial'
    | 'motel'
    | 'art_deco'
    | 'apartment'
    | 'skyscraper'
    | 'maze_bank'
    | 'gas_station';
  paletteIndex: number;
  signText?: string;
  signColor?: string;
}

export interface RoadSegment {
  x: number;
  z: number;
  w: number;
  d: number;
  orientation: 'ns' | 'ew' | 'plaza';
}

export type VehicleDrivetrain = 'RWD' | 'AWD';

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
  drivetrain: VehicleDrivetrain;
  mass: number;
  maxEngineForce: number;
  maxBrakeForce: number;
  maxSpeed: number; // m/s
  reverseSpeed: number; // m/s
  steerRate: number;
  maxSteerAngle: number;
  lateralGrip: number;
  driftGrip: number;
  dragCoeff: number;
  length: number;
  width: number;
  radius: number;
  wheelbase: number;
  trackWidth: number;
  frontWeightBias: number; // 0.42..0.56
  cgHeight: number;
  tireGripMu: number;
  cornerStiffness: number;
  gearRatios: readonly [number, number, number, number, number, number];
  reverseGearRatio: number;
  finalDrive: number;
  redlineRpm: number;
  suspensionFreq: number;
  suspensionDamping: number;
  assistStrength: number;
  primaryColor: number;
  secondaryColor: number;
  interiorColor: number;
  isPolice?: boolean;
}

export interface VehicleState {
  id: string;
  spec: VehicleSpec;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number; // radians, 0 = +Z, Math.PI = -Z
  angularVel: number;
  steerAngle: number;
  visualSteerAngle: number;
  speed: number; // signed forward speed m/s
  lateralSpeed: number;
  longAccel: number;
  latAccel: number;
  rpm: number; // 900..7800
  gear: number; // -1 = R, 1..6
  pitch: number; // suspension pitch
  roll: number; // suspension roll
  chassisHeave: number;
  chassisHeaveVel: number;
  wheelCompression: [number, number, number, number]; // FL, FR, RL, RR
  wheelCompressionVel: [number, number, number, number];
  wheelGroundY: [number, number, number, number];
  wheelSpin: number;
  frontWheelSpin: number;
  rearWheelSpin: number;
  rearSlipRatio: number; // 0..1 burnout / rear slip
  frontSlipRatio: number; // 0..1 brake lockup / understeer
  absActive: boolean;
  shiftCutTimer: number;
  shiftKickDir: number;
  reverseHoldTimer: number;
  curbImpactPulse: number;
  health: number; // 0..100
  nitro: number; // 0..100
  nitroActive: boolean;
  braking: boolean;
  drifting: boolean;
  sirenOn: boolean;
  driver: 'none' | 'player' | 'civilian' | 'police';
  routeLoop: number;
  waypointIndex: number;
  aiStuckTimer: number;
  damageFlash: number;
  customPaintHex?: number;
}

export interface VehicleTransitionState {
  mode: 'none' | 'entering' | 'exiting';
  vehicleId: string | null;
  side: 1 | -1; // +1 = local +X (driver side), -1 = local -X (passenger side)
  progress: number; // 0..1
  duration: number; // seconds
  startX: number;
  startZ: number;
  startHeading: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  grounded: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  walkCycle: number;
  sprinting: boolean;
  health: number;
  armor: number;
  inVehicleId: string | null;
  vehicleTransition: VehicleTransitionState;
  attackTimer: number;
  damageFlash: number;
  outfitId: PlayerOutfitId;
}

export interface PedState {
  id: string;
  role: 'civilian' | 'ballas' | 'grove' | 'police_foot' | 'clerk';
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  walkCycle: number;
  health: number;
  state: 'walk' | 'flee' | 'windup' | 'chase' | 'ko';
  stateTimer: number;
  homeX: number;
  homeZ: number;
  targetX: number;
  targetZ: number;
  shirtColor: number;
  pantsColor: number;
  skinTone: number;
  hatColor?: number;
  koTimer: number;
  hitFlash: number;
  activity?: 'stroll' | 'jog' | 'chat' | 'wait';
  walkAxis?: 'x' | 'z';
  walkSpan?: number;
  faceAngle?: number;
}

export interface CheckpointObjective {
  id: number;
  x: number;
  z: number;
  label: string;
  reward: number;
  collected: boolean;
}

export interface ControlInput {
  forward: number; // 0..1
  backward: number; // 0..1
  left: number; // 0..1
  right: number; // 0..1
  handbrake: boolean;
  sprintOrNitro: boolean;
  jumpOrAction: boolean;
  enterVehiclePressed: boolean;
  cameraOrbitDeltaX: number;
  cameraOrbitDeltaY: number;
}

export interface RunSummary {
  outcome: 'wasted' | 'victory';
  cash: number;
  checkpointsCleared: number;
  totalCheckpoints: number;
  distanceKm: number;
  peakWanted: number;
  timeSeconds: number;
}

export type RobberyPhase =
  | 'entering'
  | 'intimidate'
  | 'branch_reveal'
  | 'comply_open'
  | 'comply_bag'
  | 'rebel_draw'
  | 'rebel_qte_dodge'
  | 'rebel_qte_counter'
  | 'rebel_brawl'
  | 'exiting';

export type RobberyOutcome = 'pending' | 'comply' | 'rebel';

export type RobberyActionType =
  | 'intimidate'
  | 'threaten'
  | 'rush'
  | 'grab_cash'
  | 'dodge'
  | 'counter'
  | 'punch'
  | 'loot_register'
  | 'exit_door';

export interface RobberyDialogueLine {
  id: number;
  speaker: string;
  role: 'cj' | 'clerk';
  text: string;
  pitch: number;
  rate: number;
}

export interface RobberyQTEPrompt {
  id: string;
  action: RobberyActionType;
  label: string;
  keyHint: string;
  progress: number; // 0..1 elapsed across window
  sweetMin: number; // 0..1
  sweetMax: number; // 0..1
  urgent?: boolean;
}

export interface RobberyHUDState {
  shopId: string;
  shopName: string;
  ownerName: string;
  venueMode: ShopVenueMode;
  phase: RobberyPhase;
  outcome: RobberyOutcome;
  intimidation: number; // 0..100
  rage: number; // 0..100
  bagCash: number;
  stacksCollected: number;
  totalStacks: number;
  clerkHealth: number; // 0..100
  clerkKo: boolean;
  registerLooted: boolean;
  canLootRegister: boolean;
  canExitDoor: boolean;
  dodgeCooldownRatio: number; // 0 = ready, 1 = just used
  qte: RobberyQTEPrompt | null;
  dialogue: RobberyDialogueLine | null;
  feedbackText: string | null;
  feedbackTone: 'good' | 'warn' | 'bad';
  cooperationChancePct: number;
}

export interface HUDState {
  phase: GamePhase;
  cash: number;
  health: number;
  armor: number;
  wantedLevel: number; // 0..5
  district: string;
  weather: WeatherType;
  clockText: string;
  cameraMode: CameraMode;
  inVehicle: boolean;
  vehicleName: string;
  speedKmh: number;
  gear: string;
  rpmRatio: number;
  nitro: number;
  vehicleHealth: number;
  tractionSlip: boolean;
  absActive: boolean;
  shiftFlash: boolean;
  nearVehicleName: string | null;
  nearShop: ShopSpec | null;
  nearShopCooldown: number;
  activeShop: ShopSpec | null;
  activeShopCooldown: number;
  outfitId: PlayerOutfitId;
  checkpointsCleared: number;
  totalCheckpoints: number;
  objectiveLabel: string;
  muted: boolean;
  fps: number;
  touchControlsVisible: boolean;
  runSummary: RunSummary | null;
  bannerText: string | null;
  ambientDialogue: RobberyDialogueLine | null;
  robbery: RobberyHUDState | null;
}
