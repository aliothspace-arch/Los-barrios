export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type WeatherType = 'golden' | 'clear' | 'rain' | 'storm' | 'fog';

export type TimePreset = 'sunset' | 'noon' | 'night' | 'dawn';

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

export interface ShopSpec {
  id: string;
  name: string;
  category: 'market' | 'weapons' | 'clothing' | 'food' | 'customs';
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

export interface VehicleSpec {
  kind: VehicleKind;
  name: string;
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
  speed: number; // signed forward speed m/s
  lateralSpeed: number;
  rpm: number; // 900..7500
  gear: number; // -1 = R, 1..5
  pitch: number; // suspension pitch
  roll: number; // suspension roll
  wheelSpin: number;
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
  timePreset: TimePreset;
  clockText: string;
  cameraMode: CameraMode;
  inVehicle: boolean;
  vehicleName: string;
  speedKmh: number;
  gear: string;
  rpmRatio: number;
  nitro: number;
  vehicleHealth: number;
  nearVehicleName: string | null;
  nearShop: ShopSpec | null;
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
  robbery: RobberyHUDState | null;
}
