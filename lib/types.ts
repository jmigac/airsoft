export const TEAMS = ["red", "blue"] as const;

export type Team = (typeof TEAMS)[number];

export type MissionLocation = {
  id: string;
  lat: number;
  lng: number;
  radius: number;
};

export type MapCenter = {
  lat: number;
  lng: number;
};

export type PlayerLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  updatedAt: string;
};

export type GamePlayer = {
  id: string;
  sessionId: string;
  nickname: string;
  team: Team;
  joinedAt: string;
  lastSeenAt: string;
  location?: PlayerLocation;
};

export const MAP_SIGNAL_TYPES = ["info", "danger", "intel"] as const;

export type MapSignalType = (typeof MAP_SIGNAL_TYPES)[number];

export type MapSignal = {
  id: string;
  type: MapSignalType;
  team: Team;
  lat: number;
  lng: number;
  createdAt: string;
  expiresAt: string;
};

export const MAP_MARKER_TYPES = ["village", "north_spawn", "south_spawn", "house"] as const;

export type MapMarkerType = (typeof MAP_MARKER_TYPES)[number];

export type MapMarker = {
  id: string;
  type?: MapMarkerType;
  name: string;
  color: string;
  lat: number;
  lng: number;
  createdAt: string;
};

export type MapShape = {
  id: string;
  label: string;
  color: string;
  opacity: number;
  points: MapCenter[];
  createdAt: string;
};

export type MapShapeDraft = {
  label: string;
  color: string;
  opacity: number;
  points: MapCenter[];
};

export type MissionTimeWindowCET = {
  startsAtCET: string;
  endsAtCET: string;
};

export type Mission = {
  id: string;
  name: string;
  qrCode: string;
  mapCenter?: MapCenter;
  timeWindowCET?: MissionTimeWindowCET;
  locations: MissionLocation[];
  createdAt: string;
};

export type Completion = {
  id: string;
  missionId: string;
  team: Team;
  completedAt: string;
  qrCode: string;
};

export type GameState = {
  missions: Mission[];
  completions: Completion[];
  players?: GamePlayer[];
  defaultMapCenter?: MapCenter;
  mapMarkers?: MapMarker[];
  mapShapes?: MapShape[];
  mapSignals?: MapSignal[];
};
