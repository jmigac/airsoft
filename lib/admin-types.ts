import { GamePlayer, GameState, GameStatus, MapMarker, MapMarkerType, MapMarkerVisibility, Team } from "./types";

export type AdminDashboardSummary = {
  totalGames: number;
  totalActivePlayers: number;
  activeGames: number;
  recentGames: AdminGameSummary[];
};

export type AdminGameSummary = {
  code: string;
  name: string;
  description: string;
  status: GameStatus;
  mapReference: string | null;
  createdAt: string;
  updatedAt: string;
  playerCount: number;
  markerCount: number;
  activePlayerCount: number;
  defaultMapCenter: { lat: number; lng: number } | null;
  creationMetadata: Record<string, unknown>;
};

export type AdminGamesResponse = {
  items: AdminGameSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminPlayerStatus = "active" | "disconnected";

export type AdminPlayerRecord = {
  id: string;
  nickname: string;
  gameCode: string;
  gameName: string;
  team: Team;
  joinedAt: string;
  lastSeenAt: string;
  status: AdminPlayerStatus;
  location?: GamePlayer["location"];
};

export type AdminPlayersResponse = {
  items: AdminPlayerRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  gameCode: string | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminAuditResponse = {
  items: AdminAuditEntry[];
};

export type AdminAccountRecord = {
  id: string;
  authUserId: string;
  email: string;
  role: "global_admin";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AdminGameDetail = {
  game: AdminGameSummary;
  players: AdminPlayerRecord[];
  markers: MapMarker[];
  missionsCount: number;
  shapesCount: number;
  completionsCount: number;
  defaultMapCenter: { lat: number; lng: number } | null;
  state: GameState;
};

export type AdminGameMutationInput = {
  code?: string;
  name: string;
  description?: string;
  status: GameStatus;
  mapReference?: string | null;
  creationMetadata?: Record<string, unknown>;
};

export type AdminPlayerMutationInput = {
  nickname: string;
  team: Team;
};

export type AdminMarkerMutationInput = {
  gameCode: string;
  type?: MapMarkerType;
  name: string;
  description?: string;
  icon?: string;
  color: string;
  lat: number;
  lng: number;
  visibility: MapMarkerVisibility;
  visibleTeams?: Team[];
};
