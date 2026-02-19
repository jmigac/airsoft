export const TEAMS = ["red", "blue"] as const;

export type Team = (typeof TEAMS)[number];

export type MissionLocation = {
  id: string;
  lat: number;
  lng: number;
  radius: number;
};

export type Mission = {
  id: string;
  name: string;
  qrCode: string;
  mapCenter?: {
    lat: number;
    lng: number;
  };
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
};
