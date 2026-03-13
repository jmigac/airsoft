"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AdminAccountRecord,
  AdminAuditEntry,
  AdminDashboardSummary,
  AdminGameDetail,
  AdminGameSummary,
  AdminPlayerRecord
} from "@/lib/admin-types";
import { formatCETDateTime, isValidCETDateTime, normalizeCETDateTimeInput } from "@/lib/mission-time";
import {
  getMarkerColorOption,
  getMarkerIconOption,
  MAP_MARKER_META,
  MARKER_COLOR_OPTIONS,
  MARKER_ICON_OPTIONS
} from "@/lib/map-markers";
import { generateQuestPayload, isValidQuestPayload, sanitizeQuestPayload } from "@/lib/payload";
import { buildPinRevealPath, buildTriggerPath } from "@/lib/qr";
import {
  GAME_STATUSES,
  GameStatus,
  MAP_MARKER_TYPES,
  MapMarker,
  MapMarkerVisibility,
  MISSION_TYPES,
  MissionType,
  TEAMS,
  Team
} from "@/lib/types";

const MissionMap = dynamic(() => import("@/app/components/MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const DASHBOARD_TABS = [
  { id: "overview", label: "Overview" },
  { id: "games", label: "Games" },
  { id: "players", label: "Players" },
  { id: "markers", label: "Markers" },
  { id: "admins", label: "Admins" },
  { id: "audit", label: "Audit" }
] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number]["id"];

type GameFormState = {
  code: string;
  name: string;
  description: string;
  status: GameStatus;
  mapReference: string;
  metadataText: string;
};

type MarkerFormState = {
  type: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  lat: string;
  lng: string;
  visibility: MapMarkerVisibility;
  visibleTeams: Team[];
};

type MapManagementMode = "settings" | "markers" | "polygons" | "missions";
type MapPickTarget = "marker" | "default_center" | "shape" | "mission_center" | "mission_location";

type ShapeFormState = {
  label: string;
  color: string;
  opacity: string;
  points: Array<{ lat: number; lng: number }>;
};

type MissionFormState = {
  name: string;
  type: MissionType;
  qrCode: string;
  mapCenterLat: string;
  mapCenterLng: string;
  locationLat: string;
  locationLng: string;
  radius: string;
  locations: Array<{ lat: number; lng: number; radius: number }>;
  useTimeWindowCET: boolean;
  startsAtCET: string;
  endsAtCET: string;
};

const EMPTY_SUMMARY: AdminDashboardSummary = {
  totalGames: 0,
  totalActivePlayers: 0,
  activeGames: 0,
  recentGames: []
};

const EMPTY_GAME_FORM: GameFormState = {
  code: "",
  name: "",
  description: "",
  status: "active",
  mapReference: "",
  metadataText: "{}"
};

const EMPTY_MARKER_FORM: MarkerFormState = {
  type: "objective",
  name: "",
  description: "",
  icon: MAP_MARKER_META.objective.iconToken,
  color: "#c2410c",
  lat: "",
  lng: "",
  visibility: "all",
  visibleTeams: []
};

const EMPTY_SHAPE_FORM: ShapeFormState = {
  label: "Zone",
  color: "#475569",
  opacity: "0.35",
  points: []
};

const EMPTY_MISSION_FORM: MissionFormState = {
  name: "",
  type: "qr_payload",
  qrCode: "",
  mapCenterLat: "",
  mapCenterLng: "",
  locationLat: "",
  locationLng: "",
  radius: "15",
  locations: [],
  useTimeWindowCET: false,
  startsAtCET: "",
  endsAtCET: ""
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function parseJsonRecord(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Creation metadata must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function toGameFormState(game?: AdminGameSummary | null): GameFormState {
  if (!game) {
    return EMPTY_GAME_FORM;
  }

  return {
    code: game.code,
    name: game.name,
    description: game.description,
    status: game.status,
    mapReference: game.mapReference ?? "",
    metadataText: JSON.stringify(game.creationMetadata ?? {}, null, 2)
  };
}

function toMarkerFormState(marker?: MapMarker | null): MarkerFormState {
  if (!marker) {
    return EMPTY_MARKER_FORM;
  }

  return {
    type: marker.type ?? "custom",
    name: marker.name,
    description: marker.description ?? "",
    icon: marker.icon ?? (marker.type ? MAP_MARKER_META[marker.type].iconToken : MAP_MARKER_META.custom.iconToken),
    color: marker.color,
    lat: marker.lat.toFixed(6),
    lng: marker.lng.toFixed(6),
    visibility: marker.visibility,
    visibleTeams: marker.visibleTeams ?? []
  };
}

function MarkerGlyph({ glyph }: { glyph: string }) {
  return <span className="marker-glyph-preview">{glyph}</span>;
}

export default function GlobalAdminDashboard() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTabId>("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<AdminDashboardSummary>(EMPTY_SUMMARY);

  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [gamesTotal, setGamesTotal] = useState(0);
  const [gamesPage, setGamesPage] = useState(1);
  const [gamesPageSize] = useState(8);
  const [gamesQuery, setGamesQuery] = useState("");
  const [gamesStatusFilter, setGamesStatusFilter] = useState("");
  const [gamesSort, setGamesSort] = useState<"created_at" | "name" | "status" | "player_count">("created_at");
  const [gamesDirection, setGamesDirection] = useState<"asc" | "desc">("desc");
  const [gamesLoading, setGamesLoading] = useState(false);

  const [selectedGameCode, setSelectedGameCode] = useState<string | null>(null);
  const [selectedGameDetail, setSelectedGameDetail] = useState<AdminGameDetail | null>(null);
  const [gameDetailLoading, setGameDetailLoading] = useState(false);
  const [gameFormMode, setGameFormMode] = useState<"create" | "edit">("create");
  const [gameForm, setGameForm] = useState<GameFormState>(EMPTY_GAME_FORM);
  const [gameSaving, setGameSaving] = useState(false);

  const [players, setPlayers] = useState<AdminPlayerRecord[]>([]);
  const [playersTotal, setPlayersTotal] = useState(0);
  const [playersPage, setPlayersPage] = useState(1);
  const [playersPageSize] = useState(10);
  const [playersQuery, setPlayersQuery] = useState("");
  const [playersGameFilter, setPlayersGameFilter] = useState("");
  const [playersLoading, setPlayersLoading] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<AdminPlayerRecord | null>(null);
  const [playerNickname, setPlayerNickname] = useState("");
  const [playerTeam, setPlayerTeam] = useState<Team>("red");
  const [playerSaving, setPlayerSaving] = useState(false);

  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [adminAccounts, setAdminAccounts] = useState<AdminAccountRecord[]>([]);
  const [adminAccountsLoading, setAdminAccountsLoading] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [adminAccountSaving, setAdminAccountSaving] = useState(false);

  const [editingMarker, setEditingMarker] = useState<MapMarker | null>(null);
  const [markerForm, setMarkerForm] = useState<MarkerFormState>(EMPTY_MARKER_FORM);
  const [markerSaving, setMarkerSaving] = useState(false);
  const [mapMode, setMapMode] = useState<MapManagementMode>("markers");
  const [mapPickTarget, setMapPickTarget] = useState<MapPickTarget | null>(null);
  const [pendingMapPoint, setPendingMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [defaultMapCenterLat, setDefaultMapCenterLat] = useState("");
  const [defaultMapCenterLng, setDefaultMapCenterLng] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [shapeForm, setShapeForm] = useState<ShapeFormState>(EMPTY_SHAPE_FORM);
  const [shapeSaving, setShapeSaving] = useState(false);
  const [missionForm, setMissionForm] = useState<MissionFormState>(EMPTY_MISSION_FORM);
  const [missionSaving, setMissionSaving] = useState(false);
  const [mapCenterOverride, setMapCenterOverride] = useState<{ lat: number; lng: number } | null>(null);

  const gamesPageCount = Math.max(1, Math.ceil(gamesTotal / gamesPageSize));
  const playersPageCount = Math.max(1, Math.ceil(playersTotal / playersPageSize));
  const selectedMarkerTypeMeta =
    markerForm.type && markerForm.type in MAP_MARKER_META
      ? MAP_MARKER_META[markerForm.type as keyof typeof MAP_MARKER_META]
      : MAP_MARKER_META.custom;
  const selectedMarkerIcon =
    getMarkerIconOption(markerForm.icon) ?? getMarkerIconOption(selectedMarkerTypeMeta.iconToken);
  const selectedMarkerColor = getMarkerColorOption(markerForm.color) ?? {
    value: markerForm.color,
    label: markerForm.color
  };
  const markerIconOptions = selectedMarkerIcon
    ? MARKER_ICON_OPTIONS
    : [
        {
          token: markerForm.icon as (typeof MARKER_ICON_OPTIONS)[number]["token"],
          label: markerForm.icon || "Custom",
          glyph: "•",
          description: "Custom icon token"
        },
        ...MARKER_ICON_OPTIONS
      ];
  const markerColorOptions = MARKER_COLOR_OPTIONS.some((option) => option.value === selectedMarkerColor.value)
    ? MARKER_COLOR_OPTIONS
    : [{ value: selectedMarkerColor.value, label: `Custom (${selectedMarkerColor.value})` }, ...MARKER_COLOR_OPTIONS];
  const selectedShapeColor = getMarkerColorOption(shapeForm.color) ?? {
    value: shapeForm.color,
    label: shapeForm.color
  };
  const shapeColorOptions = MARKER_COLOR_OPTIONS.some((option) => option.value === selectedShapeColor.value)
    ? MARKER_COLOR_OPTIONS
    : [{ value: selectedShapeColor.value, label: `Custom (${selectedShapeColor.value})` }, ...MARKER_COLOR_OPTIONS];
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const normalizedMissionPayload = sanitizeQuestPayload(missionForm.qrCode);
  const draftPinRevealUrl =
    missionForm.type === "qr_payload" && appOrigin && selectedGameCode && isValidQuestPayload(normalizedMissionPayload)
      ? `${appOrigin}${buildPinRevealPath(normalizedMissionPayload, selectedGameCode)}`
      : "";
  const draftTriggerEndpoint =
    missionForm.type === "qr_payload" && appOrigin && selectedGameCode && isValidQuestPayload(normalizedMissionPayload)
      ? `${appOrigin}${buildTriggerPath(normalizedMissionPayload, selectedGameCode)}`
      : "";
  const draftShape =
    shapeForm.points.length > 0
      ? {
          label: shapeForm.label.trim() || "Draft shape",
          color: shapeForm.color,
          opacity: Number.isFinite(Number(shapeForm.opacity)) ? Number(shapeForm.opacity) : 0.35,
          points: shapeForm.points
        }
      : null;
  const mapPickMode = mapPickTarget !== null;
  const mapPickHintLabel =
    mapPickTarget === "marker"
      ? "Click map to place marker"
      : mapPickTarget === "default_center"
        ? "Click map to set game default center"
        : mapPickTarget === "shape"
          ? "Click map to add polygon points"
          : mapPickTarget === "mission_center"
            ? "Click map to set mission center"
            : mapPickTarget === "mission_location"
              ? "Click map to fill mission location"
              : null;
  const gameOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const game of games) {
      options.set(game.code, game.name);
    }
    if (selectedGameDetail) {
      options.set(selectedGameDetail.game.code, selectedGameDetail.game.name);
    }
    return Array.from(options.entries()).map(([code, name]) => ({ code, name }));
  }, [games, selectedGameDetail]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const initialGame = search.get("game");
    if (initialGame) {
      setSelectedGameCode(initialGame.toUpperCase());
    }
  }, []);

  async function loadSession() {
    try {
      const response = await fetch("/api/admin/session", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        admin?: boolean;
        session?: { email?: string | null } | null;
      };
      setIsAdmin(Boolean(payload.admin));
      setSessionEmail(payload.session?.email ?? null);
    } finally {
      setSessionChecked(true);
    }
  }

  async function loadSummary() {
    const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as AdminDashboardSummary & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not load dashboard summary.");
    }
    setSummary(payload);
  }

  async function loadGames() {
    try {
      setGamesLoading(true);
      const search = new URLSearchParams({
        page: String(gamesPage),
        pageSize: String(gamesPageSize),
        sort: gamesSort,
        direction: gamesDirection
      });
      if (gamesQuery.trim()) {
        search.set("query", gamesQuery.trim());
      }
      if (gamesStatusFilter) {
        search.set("status", gamesStatusFilter);
      }

      const response = await fetch(`/api/admin/games?${search.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: AdminGameSummary[];
        total?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load games.");
      }

      setGames(payload.items ?? []);
      setGamesTotal(payload.total ?? 0);
    } finally {
      setGamesLoading(false);
    }
  }

  async function loadPlayers() {
    try {
      setPlayersLoading(true);
      const search = new URLSearchParams({
        page: String(playersPage),
        pageSize: String(playersPageSize)
      });
      if (playersQuery.trim()) {
        search.set("query", playersQuery.trim());
      }
      if (playersGameFilter) {
        search.set("gameCode", playersGameFilter);
      }

      const response = await fetch(`/api/admin/players?${search.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: AdminPlayerRecord[];
        total?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load players.");
      }

      setPlayers(payload.items ?? []);
      setPlayersTotal(payload.total ?? 0);
    } finally {
      setPlayersLoading(false);
    }
  }

  async function loadAudit() {
    try {
      setAuditLoading(true);
      const response = await fetch("/api/admin/audit?limit=40", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { items?: AdminAuditEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load audit log.");
      }

      setAuditEntries(payload.items ?? []);
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadAdminAccounts() {
    try {
      setAdminAccountsLoading(true);
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        items?: AdminAccountRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load admin accounts.");
      }

      setAdminAccounts(payload.items ?? []);
    } finally {
      setAdminAccountsLoading(false);
    }
  }

  async function loadGameDetail(gameCode: string) {
    try {
      setGameDetailLoading(true);
      const response = await fetch(`/api/admin/games/${encodeURIComponent(gameCode)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as AdminGameDetail & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load game detail.");
      }

      setSelectedGameDetail(payload);
      if (gameFormMode === "edit") {
        setGameForm(toGameFormState(payload.game));
      }
    } finally {
      setGameDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadSummary().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load dashboard summary.");
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadGames().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load games.");
    });
  }, [isAdmin, gamesPage, gamesPageSize, gamesQuery, gamesStatusFilter, gamesSort, gamesDirection]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    void loadPlayers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load players.");
    });
  }, [isAdmin, playersGameFilter, playersPage, playersPageSize, playersQuery]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "audit") {
      return;
    }

    void loadAudit().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load audit log.");
    });
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "admins") {
      return;
    }

    void loadAdminAccounts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load admin accounts.");
    });
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedGameCode) {
      setSelectedGameDetail(null);
      return;
    }

    void loadGameDetail(selectedGameCode).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load game detail.");
    });
  }, [isAdmin, selectedGameCode]);

  useEffect(() => {
    if (editingPlayer) {
      setPlayerNickname(editingPlayer.nickname);
      setPlayerTeam(editingPlayer.team);
      return;
    }

    setPlayerNickname("");
    setPlayerTeam("red");
  }, [editingPlayer]);

  useEffect(() => {
    setMarkerForm(toMarkerFormState(editingMarker));
  }, [editingMarker]);

  useEffect(() => {
    if (!selectedGameDetail) {
      setDefaultMapCenterLat("");
      setDefaultMapCenterLng("");
      return;
    }

    if (!selectedGameDetail.defaultMapCenter) {
      setDefaultMapCenterLat("");
      setDefaultMapCenterLng("");
      return;
    }

    setDefaultMapCenterLat(selectedGameDetail.defaultMapCenter.lat.toFixed(6));
    setDefaultMapCenterLng(selectedGameDetail.defaultMapCenter.lng.toFixed(6));
  }, [selectedGameDetail]);

  useEffect(() => {
    if (!pendingMapPoint || !mapPickTarget) {
      return;
    }

    if (mapPickTarget === "marker") {
      setMarkerForm((current) => ({
        ...current,
        lat: pendingMapPoint.lat.toFixed(6),
        lng: pendingMapPoint.lng.toFixed(6)
      }));
      setMapPickTarget(null);
      return;
    }

    if (mapPickTarget === "default_center") {
      setDefaultMapCenterLat(pendingMapPoint.lat.toFixed(6));
      setDefaultMapCenterLng(pendingMapPoint.lng.toFixed(6));
      setMapPickTarget(null);
      return;
    }

    if (mapPickTarget === "mission_center") {
      setMissionForm((current) => ({
        ...current,
        mapCenterLat: pendingMapPoint.lat.toFixed(6),
        mapCenterLng: pendingMapPoint.lng.toFixed(6)
      }));
      setMapPickTarget(null);
      return;
    }

    if (mapPickTarget === "mission_location") {
      setMissionForm((current) => ({
        ...current,
        locationLat: pendingMapPoint.lat.toFixed(6),
        locationLng: pendingMapPoint.lng.toFixed(6)
      }));
      setMapPickTarget(null);
      return;
    }

    if (mapPickTarget === "shape") {
      setShapeForm((current) => ({
        ...current,
        points: [...current.points, pendingMapPoint]
      }));
    }
  }, [mapPickTarget, pendingMapPoint, selectedGameDetail]);

  async function login() {
    try {
      setAuthBusy(true);
      setError(null);
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Login failed.");
      }

      setEmail("");
      setPassword("");
      setIsAdmin(true);
      await loadSession();
      setNotice("Global admin session opened.");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAdmin(false);
    setSelectedGameCode(null);
    setSelectedGameDetail(null);
    setEditingPlayer(null);
    setEditingMarker(null);
    setSessionEmail(null);
    setNotice(null);
    setError(null);
  }

  function selectGame(code: string, nextTab?: DashboardTabId) {
    if (!code) {
      setSelectedGameCode(null);
      setSelectedGameDetail(null);
      const clearedSearch = new URLSearchParams(window.location.search);
      clearedSearch.delete("game");
      const nextQuery = clearedSearch.toString();
      window.history.replaceState(null, "", nextQuery ? `/admin?${nextQuery}` : "/admin");
      if (nextTab) {
        setActiveTab(nextTab);
      }
      return;
    }

    setSelectedGameCode(code);
    setGameFormMode("edit");
    const knownGame = games.find((game) => game.code === code) ?? selectedGameDetail?.game ?? null;
    setGameForm(toGameFormState(knownGame && knownGame.code === code ? knownGame : null));
    setEditingMarker(null);
    setMapPickTarget(null);
    setPendingMapPoint(null);
    if (nextTab) {
      setActiveTab(nextTab);
    }

    const search = new URLSearchParams(window.location.search);
    search.set("game", code);
    window.history.replaceState(null, "", `/admin?${search.toString()}`);
  }

  async function refreshAfterMutation(options?: { gameCode?: string; includeAudit?: boolean }) {
    await Promise.all([
      loadSummary(),
      loadGames(),
      loadPlayers(),
      activeTab === "admins" ? loadAdminAccounts() : Promise.resolve(),
      options?.includeAudit ? loadAudit() : Promise.resolve()
    ]);

    if (options?.gameCode) {
      await loadGameDetail(options.gameCode);
    }
  }

  async function createAdminAccount() {
    try {
      setAdminAccountSaving(true);
      setError(null);
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newAdminEmail.trim(),
          password: newAdminPassword
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        account?: AdminAccountRecord;
      };
      if (!response.ok || !payload.account) {
        throw new Error(payload.error ?? "Could not create admin account.");
      }

      setNotice(`Created administrator ${payload.account.email}.`);
      setNewAdminEmail("");
      setNewAdminPassword("");
      await Promise.all([loadAdminAccounts(), loadAudit()]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create admin account.");
    } finally {
      setAdminAccountSaving(false);
    }
  }

  async function toggleAdminAccount(account: AdminAccountRecord) {
    const nextActive = !account.active;
    const confirmed = window.confirm(
      `${nextActive ? "Reactivate" : "Deactivate"} administrator ${account.email}?`
    );
    if (!confirmed) {
      return;
    }

    try {
      setAdminAccountSaving(true);
      setError(null);
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        account?: AdminAccountRecord;
      };
      if (!response.ok || !payload.account) {
        throw new Error(payload.error ?? "Could not update admin account.");
      }

      setNotice(`${nextActive ? "Reactivated" : "Deactivated"} ${payload.account.email}.`);
      await Promise.all([loadAdminAccounts(), loadAudit()]);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update admin account.");
    } finally {
      setAdminAccountSaving(false);
    }
  }

  async function submitGameForm() {
    try {
      setGameSaving(true);
      setError(null);
      const metadata = parseJsonRecord(gameForm.metadataText);
      const payload = {
        code: gameForm.code.trim() || undefined,
        name: gameForm.name.trim(),
        description: gameForm.description.trim(),
        status: gameForm.status,
        mapReference: gameForm.mapReference.trim() || null,
        creationMetadata: metadata
      };

      const response = await fetch(
        gameFormMode === "create" ? "/api/admin/games" : `/api/admin/games/${encodeURIComponent(selectedGameCode ?? "")}`,
        {
          method: gameFormMode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        game?: AdminGameSummary;
      };
      if (!response.ok || !body.game) {
        throw new Error(body.error ?? "Could not save game.");
      }

      setNotice(gameFormMode === "create" ? `Created ${body.game.name}.` : `Updated ${body.game.name}.`);
      setGameFormMode("edit");
      setSelectedGameCode(body.game.code);
      setGameForm(toGameFormState(body.game));
      await refreshAfterMutation({ gameCode: body.game.code, includeAudit: activeTab === "audit" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save game.");
    } finally {
      setGameSaving(false);
    }
  }

  async function deleteSelectedGame() {
    if (!selectedGameDetail) {
      return;
    }

    const confirmed = window.confirm(`Delete game ${selectedGameDetail.game.name} (${selectedGameDetail.game.code})?`);
    if (!confirmed) {
      return;
    }

    try {
      setGameSaving(true);
      setError(null);
      const response = await fetch(`/api/admin/games/${encodeURIComponent(selectedGameDetail.game.code)}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not delete game.");
      }

      setNotice(`Deleted ${selectedGameDetail.game.name}.`);
      setSelectedGameCode(null);
      setSelectedGameDetail(null);
      setGameFormMode("create");
      setGameForm(EMPTY_GAME_FORM);
      await refreshAfterMutation({ includeAudit: activeTab === "audit" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete game.");
    } finally {
      setGameSaving(false);
    }
  }

  async function savePlayer() {
    if (!editingPlayer) {
      return;
    }

    try {
      setPlayerSaving(true);
      setError(null);
      const response = await fetch(
        `/api/admin/players/${encodeURIComponent(editingPlayer.id)}?game=${encodeURIComponent(editingPlayer.gameCode)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: playerNickname.trim(), team: playerTeam })
        }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not update player.");
      }

      setNotice(`Updated ${playerNickname.trim()}.`);
      setEditingPlayer(null);
      await refreshAfterMutation({
        gameCode: selectedGameCode && selectedGameCode === editingPlayer.gameCode ? editingPlayer.gameCode : undefined,
        includeAudit: activeTab === "audit"
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update player.");
    } finally {
      setPlayerSaving(false);
    }
  }

  async function removePlayer(player: AdminPlayerRecord) {
    const confirmed = window.confirm(`Remove player ${player.nickname} from ${player.gameName}?`);
    if (!confirmed) {
      return;
    }

    try {
      setPlayerSaving(true);
      setError(null);
      const response = await fetch(
        `/api/admin/players/${encodeURIComponent(player.id)}?game=${encodeURIComponent(player.gameCode)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not remove player.");
      }

      setNotice(`Removed ${player.nickname}.`);
      setEditingPlayer(null);
      await refreshAfterMutation({
        gameCode: selectedGameCode && selectedGameCode === player.gameCode ? player.gameCode : undefined,
        includeAudit: activeTab === "audit"
      });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove player.");
    } finally {
      setPlayerSaving(false);
    }
  }

  async function saveMarker() {
    if (!selectedGameCode) {
      setError("Select a game first.");
      return;
    }

    try {
      setMarkerSaving(true);
      setError(null);
      const lat = Number(markerForm.lat);
      const lng = Number(markerForm.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Marker latitude and longitude are required.");
      }

      const payload = {
        type: markerForm.type || undefined,
        name: markerForm.name.trim(),
        description: markerForm.description.trim(),
        icon: markerForm.icon.trim(),
        color: markerForm.color,
        lat,
        lng,
        visibility: markerForm.visibility,
        visibleTeams: markerForm.visibility === "selected_teams" ? markerForm.visibleTeams : []
      };

      const response = await fetch(
        editingMarker
          ? `/api/admin/markers/${encodeURIComponent(editingMarker.id)}?game=${encodeURIComponent(selectedGameCode)}`
          : `/api/admin/markers?game=${encodeURIComponent(selectedGameCode)}`,
        {
          method: editingMarker ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save marker.");
      }

      setNotice(editingMarker ? `Updated marker ${markerForm.name.trim()}.` : `Created marker ${markerForm.name.trim()}.`);
      setEditingMarker(null);
      setMarkerForm(EMPTY_MARKER_FORM);
      setPendingMapPoint(null);
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save marker.");
    } finally {
      setMarkerSaving(false);
    }
  }

  async function deleteMarker(marker: MapMarker) {
    if (!selectedGameCode) {
      return;
    }

    const confirmed = window.confirm(`Delete marker ${marker.name}?`);
    if (!confirmed) {
      return;
    }

    try {
      setMarkerSaving(true);
      setError(null);
      const response = await fetch(
        `/api/admin/markers/${encodeURIComponent(marker.id)}?game=${encodeURIComponent(selectedGameCode)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not delete marker.");
      }

      setNotice(`Deleted marker ${marker.name}.`);
      if (editingMarker?.id === marker.id) {
        setEditingMarker(null);
      }
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete marker.");
    } finally {
      setMarkerSaving(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
      setError(null);
    } catch {
      setError("Clipboard copy failed.");
    }
  }

  async function saveDefaultMapCenter() {
    if (!selectedGameCode) {
      setError("Select a game first.");
      return;
    }

    try {
      setSettingsSaving(true);
      setError(null);

      const lat = defaultMapCenterLat.trim();
      const lng = defaultMapCenterLng.trim();
      const payload =
        !lat && !lng
          ? { defaultMapCenter: null }
          : {
              defaultMapCenter: {
                lat: Number(lat),
                lng: Number(lng)
              }
            };

      if (
        payload.defaultMapCenter &&
        (!Number.isFinite(payload.defaultMapCenter.lat) || !Number.isFinite(payload.defaultMapCenter.lng))
      ) {
        throw new Error("Default map center coordinates must be valid numbers.");
      }

      const response = await fetch(`/api/admin/settings?game=${encodeURIComponent(selectedGameCode)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save default map center.");
      }

      setNotice(payload.defaultMapCenter ? "Updated game default map center." : "Cleared game default map center.");
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save default map center.");
    } finally {
      setSettingsSaving(false);
    }
  }

  function addMissionLocation() {
    const lat = Number(missionForm.locationLat);
    const lng = Number(missionForm.locationLng);
    const radius = Number(missionForm.radius || "15");

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius) || radius <= 0) {
      setError("Mission location latitude, longitude, and radius must be valid values.");
      return;
    }

    setMissionForm((current) => ({
      ...current,
      locations: [...current.locations, { lat, lng, radius }],
      locationLat: "",
      locationLng: "",
      radius: current.radius || "15"
    }));
    setError(null);
  }

  function removeMissionLocation(index: number) {
    setMissionForm((current) => ({
      ...current,
      locations: current.locations.filter((_, currentIndex) => currentIndex !== index)
    }));
  }

  async function saveMission() {
    if (!selectedGameCode) {
      setError("Select a game first.");
      return;
    }

    try {
      setMissionSaving(true);
      setError(null);

      const qrCode = sanitizeQuestPayload(missionForm.qrCode);
      if (!missionForm.name.trim()) {
        throw new Error("Mission name is required.");
      }

      if (missionForm.type === "qr_payload" && !qrCode) {
        throw new Error("Mission payload is required for QR missions.");
      }

      if (missionForm.type === "qr_payload" && !isValidQuestPayload(qrCode)) {
        throw new Error("Mission payload must be exactly 6 digits.");
      }

      if (missionForm.locations.length === 0) {
        throw new Error("Add at least one mission location.");
      }

      const trimmedCenterLat = missionForm.mapCenterLat.trim();
      const trimmedCenterLng = missionForm.mapCenterLng.trim();
      let mapCenter: { lat: number; lng: number } | undefined;
      if (trimmedCenterLat || trimmedCenterLng) {
        const lat = Number(trimmedCenterLat);
        const lng = Number(trimmedCenterLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error("Mission center coordinates must be valid numbers.");
        }
        mapCenter = { lat, lng };
      }

      let timeWindowCET: { startsAtCET: string; endsAtCET: string } | undefined;
      if (missionForm.useTimeWindowCET) {
        const startsAtCET = normalizeCETDateTimeInput(missionForm.startsAtCET);
        const endsAtCET = normalizeCETDateTimeInput(missionForm.endsAtCET);
        if (!startsAtCET || !endsAtCET) {
          throw new Error("Both CET start and end are required for time-critical missions.");
        }
        if (!isValidCETDateTime(startsAtCET) || !isValidCETDateTime(endsAtCET)) {
          throw new Error("CET start/end must use valid date-time values.");
        }
        if (startsAtCET >= endsAtCET) {
          throw new Error("Mission CET start must be before CET end.");
        }
        timeWindowCET = { startsAtCET, endsAtCET };
      }

      const response = await fetch(`/api/admin/missions?game=${encodeURIComponent(selectedGameCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: missionForm.name.trim(),
          type: missionForm.type,
          qrCode: missionForm.type === "qr_payload" ? qrCode : undefined,
          mapCenter,
          timeWindowCET,
          locations: missionForm.locations
        })
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not create mission.");
      }

      setNotice(`Created mission ${missionForm.name.trim()}.`);
      setMissionForm(EMPTY_MISSION_FORM);
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not create mission.");
    } finally {
      setMissionSaving(false);
    }
  }

  async function deleteMission(missionId: string, missionName: string) {
    if (!selectedGameCode) {
      return;
    }

    const confirmed = window.confirm(`Delete mission ${missionName}?`);
    if (!confirmed) {
      return;
    }

    try {
      setMissionSaving(true);
      setError(null);
      const response = await fetch(
        `/api/admin/missions/${encodeURIComponent(missionId)}?game=${encodeURIComponent(selectedGameCode)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not delete mission.");
      }

      setNotice(`Deleted mission ${missionName}.`);
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete mission.");
    } finally {
      setMissionSaving(false);
    }
  }

  async function saveShape() {
    if (!selectedGameCode) {
      setError("Select a game first.");
      return;
    }

    try {
      setShapeSaving(true);
      setError(null);
      const opacity = Number(shapeForm.opacity);
      if (!shapeForm.label.trim()) {
        throw new Error("Polygon label is required.");
      }
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new Error("Polygon opacity must be between 0 and 1.");
      }
      if (shapeForm.points.length < 3) {
        throw new Error("Polygon needs at least 3 points.");
      }

      const response = await fetch(`/api/admin/shapes?game=${encodeURIComponent(selectedGameCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: shapeForm.label.trim(),
          color: shapeForm.color,
          opacity,
          points: shapeForm.points
        })
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save polygon.");
      }

      setNotice(`Saved polygon ${shapeForm.label.trim()}.`);
      setShapeForm(EMPTY_SHAPE_FORM);
      setMapPickTarget(null);
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save polygon.");
    } finally {
      setShapeSaving(false);
    }
  }

  async function deleteShape(shapeId: string, shapeLabel: string) {
    if (!selectedGameCode) {
      return;
    }

    const confirmed = window.confirm(`Delete polygon ${shapeLabel}?`);
    if (!confirmed) {
      return;
    }

    try {
      setShapeSaving(true);
      setError(null);
      const response = await fetch(
        `/api/admin/shapes/${encodeURIComponent(shapeId)}?game=${encodeURIComponent(selectedGameCode)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not delete polygon.");
      }

      setNotice(`Deleted polygon ${shapeLabel}.`);
      await refreshAfterMutation({ gameCode: selectedGameCode, includeAudit: activeTab === "audit" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete polygon.");
    } finally {
      setShapeSaving(false);
    }
  }

  function toggleMarkerVisibleTeam(team: Team) {
    setMarkerForm((current) => ({
      ...current,
      visibleTeams: current.visibleTeams.includes(team)
        ? current.visibleTeams.filter((entry) => entry !== team)
        : [...current.visibleTeams, team]
    }));
  }

  if (!sessionChecked) {
    return (
      <main className="landing-shell">
        <section className="panel landing-panel">
          <h1>Admin Dashboard</h1>
          <p className="muted">Checking session...</p>
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="landing-shell">
        <section className="panel landing-panel">
          <div className="admin-login-header">
            <div>
              <h1>Global Admin Dashboard</h1>
              <p className="muted">Authorized administrators can manage games, players, markers, and audit history.</p>
            </div>
            <Link href="/" className="nav-link-btn">
              Back To Start
            </Link>
          </div>

          <label className="stack-field">
            <span>Administrator email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void login();
                }
              }}
              placeholder="admin@example.com"
            />
          </label>

          <label className="stack-field">
            <span>Administrator password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void login();
                }
              }}
              placeholder="Admin password"
            />
          </label>

          <div className="inline-actions">
            <button type="button" onClick={() => void login()} disabled={authBusy}>
              {authBusy ? "Signing In..." : "Open Dashboard"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="admin-dashboard-shell">
      <header className="admin-dashboard-topbar">
        <div className="admin-dashboard-hero">
          <div className="admin-dashboard-brand">
            <div>
              <h1>Global Admin</h1>
              <p className="muted">Airsoft Map Quest Tracker</p>
              {sessionEmail && <p className="muted">{sessionEmail}</p>}
            </div>
          </div>

          <div className="admin-dashboard-hero-actions">
            {selectedGameDetail && (
              <button type="button" onClick={() => selectGame(selectedGameDetail.game.code, "markers")}>
                Open Map Ops
              </button>
            )}
            <button type="button" onClick={() => void logout()}>
              Logout
            </button>
          </div>
        </div>

        <div className="admin-dashboard-command-deck">
          <nav className="admin-dashboard-tabs" aria-label="Admin sections">
            {DASHBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <section className="admin-overview-strip" aria-label="Quick stats">
            <article className="admin-stat-card compact">
              <span>Total Games</span>
              <strong>{summary.totalGames}</strong>
            </article>
            <article className="admin-stat-card compact">
              <span>Active Players</span>
              <strong>{summary.totalActivePlayers}</strong>
            </article>
            <article className="admin-stat-card compact">
              <span>Active Games</span>
              <strong>{summary.activeGames}</strong>
            </article>
          </section>

          <section className="admin-selected-game-bar">
            <div className="admin-selected-game-copy">
              <span className="admin-selected-game-label">Selected Game</span>
              {!selectedGameDetail && <strong>No game selected</strong>}
              {selectedGameDetail && (
                <>
                  <strong>
                    {selectedGameDetail.game.name} ({selectedGameDetail.game.code})
                  </strong>
                  <div className="admin-selected-game-meta">
                    <span>{selectedGameDetail.game.status}</span>
                    <span>{selectedGameDetail.game.playerCount} players</span>
                    <span>{selectedGameDetail.game.markerCount} markers</span>
                  </div>
                </>
              )}
            </div>

            <div className="admin-selected-game-actions">
              <select value={selectedGameCode ?? ""} onChange={(event) => selectGame(event.target.value || "")}>
                <option value="">Jump to a game</option>
                {gameOptions.map((game) => (
                  <option key={game.code} value={game.code}>
                    {game.name} ({game.code})
                  </option>
                ))}
              </select>
              {selectedGameDetail && (
                <button type="button" onClick={() => selectGame(selectedGameDetail.game.code, "games")}>
                  Open Detail
                </button>
              )}
            </div>
          </section>
        </div>

        {notice && <p className="success">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </header>

      <main className="admin-dashboard-main">
        {activeTab === "overview" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Dashboard Overview</h2>
                  <p className="muted">Recent games and administrative activity entry points.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGameFormMode("create");
                    setGameForm(EMPTY_GAME_FORM);
                    setActiveTab("games");
                  }}
                >
                  Create Game
                </button>
              </div>

              <div className="admin-stat-grid">
                <article className="admin-stat-card">
                  <span>Total Games</span>
                  <strong>{summary.totalGames}</strong>
                </article>
                <article className="admin-stat-card">
                  <span>Currently Active Games</span>
                  <strong>{summary.activeGames}</strong>
                </article>
                <article className="admin-stat-card">
                  <span>Active Players</span>
                  <strong>{summary.totalActivePlayers}</strong>
                </article>
              </div>
            </section>

            <section className="panel">
              <div className="admin-section-heading">
                <h2>Recently Created Games</h2>
                <button type="button" onClick={() => setActiveTab("games")}>
                  View All Games
                </button>
              </div>

              <div className="admin-list-grid">
                {summary.recentGames.map((game) => (
                  <button
                    key={game.code}
                    type="button"
                    className="admin-list-card"
                    onClick={() => {
                      selectGame(game.code, "games");
                    }}
                  >
                    <strong>{game.name}</strong>
                    <span>{game.code}</span>
                    <span>{formatDateTime(game.createdAt)}</span>
                    <span>{game.playerCount} players</span>
                  </button>
                ))}
                {summary.recentGames.length === 0 && <p className="muted">No games created yet.</p>}
              </div>
            </section>
          </section>
        )}

        {activeTab === "games" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>{gameFormMode === "create" ? "Create New Game" : "Edit Game"}</h2>
                  <p className="muted">Manage game metadata, status, and creation metadata.</p>
                </div>
                {gameFormMode === "edit" && (
                  <button
                    type="button"
                    onClick={() => {
                      setGameFormMode("create");
                      setGameForm(EMPTY_GAME_FORM);
                    }}
                  >
                    New Game Form
                  </button>
                )}
              </div>

              <div className="admin-form-grid">
                <label className="stack-field">
                  <span>Game Code</span>
                  <input
                    type="text"
                    value={gameForm.code}
                    onChange={(event) =>
                      setGameForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                    }
                    disabled={gameFormMode === "edit"}
                    placeholder="Optional custom code"
                  />
                </label>

                <label className="stack-field">
                  <span>Game Name</span>
                  <input
                    type="text"
                    value={gameForm.name}
                    onChange={(event) => setGameForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Weekend Operation"
                  />
                </label>

                <label className="stack-field">
                  <span>Status</span>
                  <select
                    value={gameForm.status}
                    onChange={(event) =>
                      setGameForm((current) => ({ ...current, status: event.target.value as GameStatus }))
                    }
                  >
                    {GAME_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="stack-field admin-form-full">
                  <span>Description</span>
                  <textarea
                    value={gameForm.description}
                    onChange={(event) => setGameForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Mission overview, field notes, or scenario summary"
                  />
                </label>

                <label className="stack-field">
                  <span>Map Reference</span>
                  <input
                    type="text"
                    value={gameForm.mapReference}
                    onChange={(event) => setGameForm((current) => ({ ...current, mapReference: event.target.value }))}
                    placeholder="Mirkovec Forest Sector A"
                  />
                </label>

                <label className="stack-field admin-form-full">
                  <span>Creation Metadata (JSON)</span>
                  <textarea
                    value={gameForm.metadataText}
                    onChange={(event) => setGameForm((current) => ({ ...current, metadataText: event.target.value }))}
                    placeholder='{"createdBy":"global-admin"}'
                    className="code-textarea"
                  />
                </label>
              </div>

              <div className="inline-actions">
                <button type="button" onClick={() => void submitGameForm()} disabled={gameSaving}>
                  {gameSaving ? "Saving..." : gameFormMode === "create" ? "Create Game" : "Save Changes"}
                </button>
                {gameFormMode === "edit" && (
                  <button type="button" onClick={() => void deleteSelectedGame()} disabled={gameSaving}>
                    Delete Game
                  </button>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Games Management</h2>
                  <p className="muted">Search, filter, sort, inspect, and select a game for deeper management.</p>
                </div>
              </div>

              <div className="admin-toolbar">
                <input
                  type="text"
                  value={gamesQuery}
                  onChange={(event) => {
                    setGamesQuery(event.target.value);
                    setGamesPage(1);
                  }}
                  placeholder="Search by name or code"
                />
                <select
                  value={gamesStatusFilter}
                  onChange={(event) => {
                    setGamesStatusFilter(event.target.value);
                    setGamesPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {GAME_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <select value={gamesSort} onChange={(event) => setGamesSort(event.target.value as typeof gamesSort)}>
                  <option value="created_at">Creation Date</option>
                  <option value="name">Game Name</option>
                  <option value="status">Status</option>
                  <option value="player_count">Player Count</option>
                </select>
                <select
                  value={gamesDirection}
                  onChange={(event) => setGamesDirection(event.target.value as typeof gamesDirection)}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Game</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Players</th>
                      <th>Markers</th>
                      <th>Map</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((game) => (
                      <tr
                        key={game.code}
                        className={selectedGameCode === game.code ? "selected" : ""}
                        onClick={() => selectGame(game.code)}
                      >
                        <td>
                          <strong>{game.name}</strong>
                          <div className="muted">{game.code}</div>
                        </td>
                        <td>{game.status}</td>
                        <td>{formatDateTime(game.createdAt)}</td>
                        <td>{game.playerCount}</td>
                        <td>{game.markerCount}</td>
                        <td>{game.mapReference ?? "N/A"}</td>
                      </tr>
                    ))}
                    {!gamesLoading && games.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          No games match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="admin-pagination">
                <span>
                  Page {gamesPage} of {gamesPageCount}
                </span>
                <div className="inline-actions">
                  <button type="button" onClick={() => setGamesPage((current) => Math.max(1, current - 1))} disabled={gamesPage <= 1}>
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setGamesPage((current) => Math.min(gamesPageCount, current + 1))}
                    disabled={gamesPage >= gamesPageCount}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            {selectedGameDetail && (
              <section className="panel">
                <div className="admin-section-heading">
                  <div>
                    <h2>Game Detail</h2>
                    <p className="muted">
                      {selectedGameDetail.game.name} ({selectedGameDetail.game.code})
                    </p>
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={() => setActiveTab("players")}>
                      Manage Players
                    </button>
                    <button type="button" onClick={() => setActiveTab("markers")}>
                      Manage Markers
                    </button>
                  </div>
                </div>

                {gameDetailLoading && <p className="muted">Loading selected game...</p>}
                {!gameDetailLoading && (
                  <div className="admin-detail-grid">
                    <article className="admin-detail-card">
                      <span>Players</span>
                      <strong>{selectedGameDetail.game.playerCount}</strong>
                    </article>
                    <article className="admin-detail-card">
                      <span>Markers</span>
                      <strong>{selectedGameDetail.game.markerCount}</strong>
                    </article>
                    <article className="admin-detail-card">
                      <span>Missions</span>
                      <strong>{selectedGameDetail.missionsCount}</strong>
                    </article>
                    <article className="admin-detail-card">
                      <span>Completions</span>
                      <strong>{selectedGameDetail.completionsCount}</strong>
                    </article>
                  </div>
                )}
              </section>
            )}
          </section>
        )}

        {activeTab === "players" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Players Management</h2>
                  <p className="muted">Search across all games, inspect assignments, edit team/name, or remove players.</p>
                </div>
              </div>

              <div className="admin-toolbar">
                <input
                  type="text"
                  value={playersQuery}
                  onChange={(event) => {
                    setPlayersQuery(event.target.value);
                    setPlayersPage(1);
                  }}
                  placeholder="Search by nickname, player ID, or game code"
                />
                <select
                  value={playersGameFilter}
                  onChange={(event) => {
                    setPlayersGameFilter(event.target.value);
                    setPlayersPage(1);
                  }}
                >
                  <option value="">All games</option>
                  {gameOptions.map((game) => (
                    <option key={game.code} value={game.code}>
                      {game.name} ({game.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Game</th>
                      <th>Team</th>
                      <th>Status</th>
                      <th>Joined</th>
                      <th>Last Seen</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((player) => (
                      <tr key={player.id}>
                        <td>
                          <strong>{player.nickname}</strong>
                          <div className="muted">{player.id}</div>
                        </td>
                        <td>
                          <button type="button" className="linklike-btn" onClick={() => selectGame(player.gameCode, "games")}>
                            {player.gameName}
                          </button>
                        </td>
                        <td>{player.team}</td>
                        <td>{player.status}</td>
                        <td>{formatDateTime(player.joinedAt)}</td>
                        <td>{formatDateTime(player.lastSeenAt)}</td>
                        <td>
                          <div className="inline-actions">
                            <button type="button" onClick={() => setEditingPlayer(player)}>
                              Edit
                            </button>
                            <button type="button" onClick={() => void removePlayer(player)}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!playersLoading && players.length === 0 && (
                      <tr>
                        <td colSpan={7} className="empty-row">
                          No players match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="admin-pagination">
                <span>
                  Page {playersPage} of {playersPageCount}
                </span>
                <div className="inline-actions">
                  <button type="button" onClick={() => setPlayersPage((current) => Math.max(1, current - 1))} disabled={playersPage <= 1}>
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlayersPage((current) => Math.min(playersPageCount, current + 1))}
                    disabled={playersPage >= playersPageCount}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            {editingPlayer && (
              <section className="panel">
                <div className="admin-section-heading">
                  <div>
                    <h2>Edit Player</h2>
                    <p className="muted">
                      {editingPlayer.gameName} ({editingPlayer.gameCode})
                    </p>
                  </div>
                  <button type="button" onClick={() => setEditingPlayer(null)}>
                    Clear
                  </button>
                </div>

                <div className="admin-form-grid">
                  <label className="stack-field">
                    <span>Nickname</span>
                    <input type="text" value={playerNickname} onChange={(event) => setPlayerNickname(event.target.value)} />
                  </label>
                  <label className="stack-field">
                    <span>Team</span>
                    <select value={playerTeam} onChange={(event) => setPlayerTeam(event.target.value as Team)}>
                      {TEAMS.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="inline-actions">
                  <button type="button" onClick={() => void savePlayer()} disabled={playerSaving}>
                    {playerSaving ? "Saving..." : "Save Player"}
                  </button>
                </div>
              </section>
            )}
          </section>
        )}

        {activeTab === "markers" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Map Operations</h2>
                  <p className="muted">
                    Manage markers, polygons, mission geometry, and game map settings with the map kept in view.
                  </p>
                </div>
                <select
                  value={selectedGameCode ?? ""}
                  onChange={(event) => selectGame(event.target.value || "", "markers")}
                >
                  <option value="">Select a game</option>
                  {gameOptions.map((game) => (
                    <option key={game.code} value={game.code}>
                      {game.name} ({game.code})
                    </option>
                  ))}
                </select>
              </div>

              {!selectedGameDetail && <p className="muted">Select a game to manage its map objects.</p>}
              {selectedGameDetail && (
                <div className="map-ops-layout">
                  <div className="map-ops-sidebar">
                    <div className="map-ops-toolbar">
                      <div className="map-ops-tool-switcher">
                        <button
                          type="button"
                          className={mapMode === "markers" ? "active" : ""}
                          onClick={() => setMapMode("markers")}
                        >
                          Markers
                        </button>
                        <button
                          type="button"
                          className={mapMode === "polygons" ? "active" : ""}
                          onClick={() => setMapMode("polygons")}
                        >
                          Polygons
                        </button>
                        <button
                          type="button"
                          className={mapMode === "missions" ? "active" : ""}
                          onClick={() => setMapMode("missions")}
                        >
                          Missions
                        </button>
                        <button
                          type="button"
                          className={mapMode === "settings" ? "active" : ""}
                          onClick={() => setMapMode("settings")}
                        >
                          Settings
                        </button>
                      </div>

                      <div className="map-ops-stats">
                        <span>{selectedGameDetail.markers.length} markers</span>
                        <span>{selectedGameDetail.state.mapShapes?.length ?? 0} polygons</span>
                        <span>{selectedGameDetail.state.missions.length} missions</span>
                        <span>{selectedGameDetail.state.mapSignals?.length ?? 0} live signals</span>
                      </div>

                      {mapPickHintLabel && <div className="map-hint-pill">{mapPickHintLabel}</div>}
                      {pendingMapPoint && (
                        <div className="marker-picked-point">
                          <strong>Picked point</strong>
                          <span>
                            {pendingMapPoint.lat.toFixed(6)}, {pendingMapPoint.lng.toFixed(6)}
                          </span>
                        </div>
                      )}
                    </div>

                    {mapMode === "markers" && (
                      <section className="map-ops-section">
                        <section className="marker-editor-hero">
                          <div className="marker-editor-badge" style={{ background: selectedMarkerColor.value }}>
                            {selectedMarkerIcon ? <MarkerGlyph glyph={selectedMarkerIcon.glyph} /> : <MarkerGlyph glyph="•" />}
                          </div>
                          <div className="marker-editor-copy">
                            <strong>{markerForm.name.trim() || selectedMarkerTypeMeta.label}</strong>
                            <p className="muted">{selectedMarkerTypeMeta.description}</p>
                            <div className="marker-editor-meta">
                              <span>{selectedMarkerColor.label}</span>
                              <span>{selectedMarkerIcon?.label ?? "No icon"}</span>
                              <span>
                                {markerForm.lat && markerForm.lng
                                  ? `${markerForm.lat}, ${markerForm.lng}`
                                  : "Pick coordinates from the map or enter them manually"}
                              </span>
                            </div>
                          </div>
                        </section>

                        <div className="admin-form-grid marker-editor-grid">
                          <label className="stack-field">
                            <span>Marker Type</span>
                            <div className="field-with-preview">
                              <div className="field-preview-badge" style={{ background: selectedMarkerTypeMeta.color }}>
                                <MarkerGlyph
                                  glyph={
                                    getMarkerIconOption(selectedMarkerTypeMeta.iconToken)?.glyph ?? selectedMarkerTypeMeta.shortLabel
                                  }
                                />
                              </div>
                              <select
                                value={markerForm.type}
                                onChange={(event) =>
                                  setMarkerForm((current) => {
                                    const previousMeta =
                                      current.type && current.type in MAP_MARKER_META
                                        ? MAP_MARKER_META[current.type as keyof typeof MAP_MARKER_META]
                                        : MAP_MARKER_META.custom;
                                    const nextType = event.target.value;
                                    const nextMeta =
                                      nextType in MAP_MARKER_META
                                        ? MAP_MARKER_META[nextType as keyof typeof MAP_MARKER_META]
                                        : MAP_MARKER_META.custom;

                                    return {
                                      ...current,
                                      type: nextType,
                                      icon:
                                        !current.icon || current.icon === previousMeta.iconToken ? nextMeta.iconToken : current.icon,
                                      color: current.color === previousMeta.color ? nextMeta.color : current.color
                                    };
                                  })
                                }
                              >
                                {MAP_MARKER_TYPES.map((type) => {
                                  const meta = MAP_MARKER_META[type];
                                  const glyph = getMarkerIconOption(meta.iconToken)?.glyph ?? meta.shortLabel;
                                  return (
                                    <option key={type} value={type}>
                                      {`${glyph} ${meta.label} - ${meta.description}`}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          </label>

                          <label className="stack-field">
                            <span>Title</span>
                            <input
                              type="text"
                              value={markerForm.name}
                              onChange={(event) => setMarkerForm((current) => ({ ...current, name: event.target.value }))}
                              placeholder="Bridge Capture Point"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Icon / Style</span>
                            <div className="field-with-preview">
                              <div className="field-preview-badge neutral">
                                <MarkerGlyph glyph={selectedMarkerIcon?.glyph ?? "•"} />
                              </div>
                              <select
                                value={markerForm.icon}
                                onChange={(event) => setMarkerForm((current) => ({ ...current, icon: event.target.value }))}
                              >
                                {markerIconOptions.map((option) => (
                                  <option key={option.token} value={option.token}>
                                    {`${option.glyph} ${option.label} - ${option.description}`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>

                          <label className="stack-field">
                            <span>Color</span>
                            <div className="field-with-preview">
                              <div className="field-preview-swatch" style={{ background: selectedMarkerColor.value }} />
                              <select
                                value={selectedMarkerColor.value}
                                onChange={(event) => setMarkerForm((current) => ({ ...current, color: event.target.value }))}
                              >
                                {markerColorOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>

                          <label className="stack-field">
                            <span>Latitude</span>
                            <input
                              type="text"
                              value={markerForm.lat}
                              onChange={(event) => setMarkerForm((current) => ({ ...current, lat: event.target.value }))}
                              placeholder="46.245562"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Longitude</span>
                            <input
                              type="text"
                              value={markerForm.lng}
                              onChange={(event) => setMarkerForm((current) => ({ ...current, lng: event.target.value }))}
                              placeholder="16.110200"
                            />
                          </label>

                          <label className="stack-field admin-form-full">
                            <span>Description</span>
                            <textarea
                              value={markerForm.description}
                              onChange={(event) =>
                                setMarkerForm((current) => ({ ...current, description: event.target.value }))
                              }
                              placeholder="Explain what this marker means and who should care about it."
                            />
                          </label>

                          <label className="stack-field">
                            <span>Visibility</span>
                            <select
                              value={markerForm.visibility}
                              onChange={(event) =>
                                setMarkerForm((current) => ({
                                  ...current,
                                  visibility: event.target.value as MapMarkerVisibility,
                                  visibleTeams: event.target.value === "selected_teams" ? current.visibleTeams : []
                                }))
                              }
                            >
                              <option value="all">Visible To All Players</option>
                              <option value="admins">Visible Only To Admins</option>
                              <option value="selected_teams">Visible To Selected Teams</option>
                            </select>
                          </label>
                        </div>

                        {markerForm.visibility === "selected_teams" && (
                          <div className="inline-actions">
                            {TEAMS.map((team) => (
                              <button
                                key={team}
                                type="button"
                                className={markerForm.visibleTeams.includes(team) ? "active" : ""}
                                onClick={() => toggleMarkerVisibleTeam(team)}
                              >
                                {team.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() => setMapPickTarget((current) => (current === "marker" ? null : "marker"))}
                          >
                            {mapPickTarget === "marker" ? "Stop Coordinate Picking" : "Pick Coordinates On Map"}
                          </button>
                          <button type="button" onClick={() => void saveMarker()} disabled={markerSaving}>
                            {markerSaving ? "Saving..." : editingMarker ? "Save Marker Changes" : "Create Marker"}
                          </button>
                          {editingMarker && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMarker(null);
                                setMarkerForm(EMPTY_MARKER_FORM);
                              }}
                            >
                              Clear Marker Form
                            </button>
                          )}
                        </div>

                        <div className="admin-table-wrap">
                          <table className="admin-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Visibility</th>
                                <th>Coordinates</th>
                                <th>Updated</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedGameDetail.markers.map((marker) => (
                                <tr key={marker.id}>
                                  <td>
                                    <div className="marker-row-title">
                                      <span className="field-preview-badge" style={{ background: marker.color }}>
                                        <MarkerGlyph
                                          glyph={
                                            getMarkerIconOption(marker.icon)?.glyph ??
                                            (marker.type
                                              ? getMarkerIconOption(MAP_MARKER_META[marker.type].iconToken)?.glyph
                                              : null) ??
                                            "•"
                                          }
                                        />
                                      </span>
                                      <div>
                                        <strong>{marker.name}</strong>
                                        <div className="muted">{marker.description ?? "No description"}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td>{marker.type ?? "custom"}</td>
                                  <td>{marker.visibility}</td>
                                  <td>
                                    {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
                                  </td>
                                  <td>{formatDateTime(marker.updatedAt)}</td>
                                  <td>
                                    <div className="inline-actions">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingMarker(marker);
                                          setMapCenterOverride({ lat: marker.lat, lng: marker.lng });
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setMapCenterOverride({ lat: marker.lat, lng: marker.lng })}
                                      >
                                        Focus
                                      </button>
                                      <button type="button" onClick={() => void deleteMarker(marker)}>
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {selectedGameDetail.markers.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="empty-row">
                                    No markers created for this game yet.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}

                    {mapMode === "polygons" && (
                      <section className="map-ops-section">
                        <div className="admin-section-heading">
                          <div>
                            <h3>Polygon Management</h3>
                            <p className="muted">Draw field zones, danger areas, boundaries, and admin-only overlays.</p>
                          </div>
                        </div>

                        <div className="admin-form-grid">
                          <label className="stack-field">
                            <span>Polygon Label</span>
                            <input
                              type="text"
                              value={shapeForm.label}
                              onChange={(event) => setShapeForm((current) => ({ ...current, label: event.target.value }))}
                              placeholder="Restricted Woodline"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Color</span>
                            <div className="field-with-preview">
                              <div className="field-preview-swatch" style={{ background: selectedShapeColor.value }} />
                              <select
                                value={selectedShapeColor.value}
                                onChange={(event) => setShapeForm((current) => ({ ...current, color: event.target.value }))}
                              >
                                {shapeColorOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </label>

                          <label className="stack-field">
                            <span>Opacity</span>
                            <input
                              type="number"
                              min="0"
                              max="1"
                              step="0.05"
                              value={shapeForm.opacity}
                              onChange={(event) => setShapeForm((current) => ({ ...current, opacity: event.target.value }))}
                              placeholder="0.35"
                            />
                          </label>
                        </div>

                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() => setMapPickTarget((current) => (current === "shape" ? null : "shape"))}
                          >
                            {mapPickTarget === "shape" ? "Stop Drawing" : "Pick Polygon Points"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setShapeForm((current) => ({ ...current, points: current.points.slice(0, -1) }))
                            }
                            disabled={shapeForm.points.length === 0}
                          >
                            Undo Last Point
                          </button>
                          <button type="button" onClick={() => setShapeForm(EMPTY_SHAPE_FORM)} disabled={shapeSaving}>
                            Clear Draft
                          </button>
                          <button type="button" onClick={() => void saveShape()} disabled={shapeSaving}>
                            {shapeSaving ? "Saving..." : "Save Polygon"}
                          </button>
                        </div>

                        {shapeForm.points.length > 0 && (
                          <div className="map-object-list">
                            {shapeForm.points.map((point, index) => (
                              <div key={`${point.lat}-${point.lng}-${index}`} className="map-object-card compact">
                                <strong>Draft Point {index + 1}</strong>
                                <span>
                                  {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="map-object-list">
                          {(selectedGameDetail.state.mapShapes ?? []).map((shape) => (
                            <article key={shape.id} className="map-object-card">
                              <div className="map-object-card-top">
                                <span className="map-object-swatch" style={{ background: shape.color }} />
                                <strong>{shape.label}</strong>
                              </div>
                              <span className="muted">
                                {shape.points.length} points, opacity {shape.opacity.toFixed(2)}
                              </span>
                              <div className="inline-actions">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (shape.points[0]) {
                                      setMapCenterOverride(shape.points[0]);
                                    }
                                  }}
                                >
                                  Focus
                                </button>
                                <button type="button" onClick={() => void deleteShape(shape.id, shape.label)}>
                                  Delete
                                </button>
                              </div>
                            </article>
                          ))}
                          {(selectedGameDetail.state.mapShapes ?? []).length === 0 && (
                            <p className="muted">No polygons defined for this game.</p>
                          )}
                        </div>
                      </section>
                    )}

                    {mapMode === "missions" && (
                      <section className="map-ops-section">
                        <div className="admin-section-heading">
                          <div>
                            <h3>Mission Builder</h3>
                            <p className="muted">Create QR missions or Intel Recovery missions with map circles, time windows, and quest centers.</p>
                          </div>
                          {missionForm.type === "qr_payload" && (
                            <button
                              type="button"
                              onClick={() =>
                                setMissionForm((current) => ({
                                  ...current,
                                  qrCode: generateQuestPayload()
                                }))
                              }
                            >
                              Generate 6 Digits
                            </button>
                          )}
                        </div>

                        <div className="admin-form-grid">
                          <label className="stack-field">
                            <span>Mission Name</span>
                            <input
                              type="text"
                              value={missionForm.name}
                              onChange={(event) => setMissionForm((current) => ({ ...current, name: event.target.value }))}
                              placeholder="Village Radio Sweep"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Mission Type</span>
                            <select
                              value={missionForm.type}
                              onChange={(event) =>
                                setMissionForm((current) => ({
                                  ...current,
                                  type: event.target.value as MissionType,
                                  qrCode: event.target.value === "qr_payload" ? current.qrCode : ""
                                }))
                              }
                            >
                              {MISSION_TYPES.map((missionType) => (
                                <option key={missionType} value={missionType}>
                                  {missionType === "qr_payload" ? "QR Payload Mission" : "Intel Recovery"}
                                </option>
                              ))}
                            </select>
                          </label>

                          {missionForm.type === "qr_payload" && (
                            <label className="stack-field">
                              <span>Mission Payload</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                value={missionForm.qrCode}
                                onChange={(event) =>
                                  setMissionForm((current) => ({
                                    ...current,
                                    qrCode: sanitizeQuestPayload(event.target.value)
                                  }))
                                }
                                placeholder="6 digits"
                              />
                            </label>
                          )}

                          {missionForm.type === "intel_recovery" && (
                            <article className="map-object-card compact admin-form-full">
                              <strong>Intel Recovery</strong>
                              <span className="muted">
                                Players will complete this mission by uploading one or more photos of recovered field intel.
                              </span>
                            </article>
                          )}

                          <label className="stack-field">
                            <span>Completion Mode</span>
                            <input
                              type="text"
                              value={missionForm.type === "qr_payload" ? "QR payload redeem" : "Image upload evidence"}
                              disabled
                            />
                          </label>

                          <label className="stack-field">
                            <span>Location Latitude</span>
                            <input
                              type="text"
                              value={missionForm.locationLat}
                              onChange={(event) =>
                                setMissionForm((current) => ({ ...current, locationLat: event.target.value }))
                              }
                              placeholder="46.245562"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Location Longitude</span>
                            <input
                              type="text"
                              value={missionForm.locationLng}
                              onChange={(event) =>
                                setMissionForm((current) => ({ ...current, locationLng: event.target.value }))
                              }
                              placeholder="16.110200"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Radius (m)</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={missionForm.radius}
                              onChange={(event) => setMissionForm((current) => ({ ...current, radius: event.target.value }))}
                              placeholder="15"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Quest Map Center Latitude</span>
                            <input
                              type="text"
                              value={missionForm.mapCenterLat}
                              onChange={(event) =>
                                setMissionForm((current) => ({ ...current, mapCenterLat: event.target.value }))
                              }
                              placeholder="Optional mission center"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Quest Map Center Longitude</span>
                            <input
                              type="text"
                              value={missionForm.mapCenterLng}
                              onChange={(event) =>
                                setMissionForm((current) => ({ ...current, mapCenterLng: event.target.value }))
                              }
                              placeholder="Optional mission center"
                            />
                          </label>
                        </div>

                        <label className="checkbox-row mission-toggle-row">
                          <input
                            type="checkbox"
                            checked={missionForm.useTimeWindowCET}
                            onChange={(event) =>
                              setMissionForm((current) => ({ ...current, useTimeWindowCET: event.target.checked }))
                            }
                          />
                          <span>Time-critical mission (redeemable only within a CET window)</span>
                        </label>

                        {missionForm.useTimeWindowCET && (
                          <div className="admin-form-grid">
                            <label className="stack-field">
                              <span>Start (CET)</span>
                              <input
                                type="datetime-local"
                                value={missionForm.startsAtCET}
                                onChange={(event) =>
                                  setMissionForm((current) => ({
                                    ...current,
                                    startsAtCET: normalizeCETDateTimeInput(event.target.value)
                                  }))
                                }
                              />
                            </label>

                            <label className="stack-field">
                              <span>End (CET)</span>
                              <input
                                type="datetime-local"
                                value={missionForm.endsAtCET}
                                onChange={(event) =>
                                  setMissionForm((current) => ({
                                    ...current,
                                    endsAtCET: normalizeCETDateTimeInput(event.target.value)
                                  }))
                                }
                              />
                            </label>
                          </div>
                        )}

                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setMapPickTarget((current) => (current === "mission_location" ? null : "mission_location"))
                            }
                          >
                            {mapPickTarget === "mission_location" ? "Stop Picking Location" : "Pick Location On Map"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMapPickTarget((current) => (current === "mission_center" ? null : "mission_center"))
                            }
                          >
                            {mapPickTarget === "mission_center" ? "Stop Picking Center" : "Pick Mission Center"}
                          </button>
                          <button type="button" onClick={addMissionLocation}>
                            Add Circle Location
                          </button>
                          <button type="button" onClick={() => void saveMission()} disabled={missionSaving}>
                            {missionSaving ? "Saving..." : "Save Mission"}
                          </button>
                        </div>

                        {(draftPinRevealUrl || draftTriggerEndpoint) && (
                          <div className="map-object-list">
                            {draftPinRevealUrl && (
                              <article className="map-object-card compact">
                                <strong>QR Reveal URL</strong>
                                <code>{draftPinRevealUrl}</code>
                                <button
                                  type="button"
                                  onClick={() => void copyText(draftPinRevealUrl, "Copied draft QR reveal URL.")}
                                >
                                  Copy
                                </button>
                              </article>
                            )}
                            {draftTriggerEndpoint && (
                              <article className="map-object-card compact">
                                <strong>Trigger Endpoint</strong>
                                <code>{draftTriggerEndpoint}</code>
                                <button
                                  type="button"
                                  onClick={() => void copyText(draftTriggerEndpoint, "Copied draft trigger endpoint.")}
                                >
                                  Copy
                                </button>
                              </article>
                            )}
                          </div>
                        )}

                        {missionForm.locations.length > 0 && (
                          <div className="map-object-list">
                            {missionForm.locations.map((location, index) => (
                              <article key={`${location.lat}-${location.lng}-${index}`} className="map-object-card compact">
                                <strong>Draft Circle {index + 1}</strong>
                                <span>
                                  {location.lat.toFixed(6)}, {location.lng.toFixed(6)} ({location.radius}m)
                                </span>
                                <div className="inline-actions">
                                  <button
                                    type="button"
                                    onClick={() => setMapCenterOverride({ lat: location.lat, lng: location.lng })}
                                  >
                                    Focus
                                  </button>
                                  <button type="button" onClick={() => removeMissionLocation(index)}>
                                    Remove
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}

                        <div className="map-object-list">
                          {selectedGameDetail.state.missions.map((mission) => {
                            const missionRevealUrl = mission.qrCode && appOrigin
                              ? `${appOrigin}${buildPinRevealPath(mission.qrCode, selectedGameDetail.game.code)}`
                              : "";
                            const missionEndpoint = mission.qrCode && appOrigin
                              ? `${appOrigin}${buildTriggerPath(mission.qrCode, selectedGameDetail.game.code)}`
                              : "";
                            const fallbackCenter = mission.locations[0]
                              ? { lat: mission.locations[0].lat, lng: mission.locations[0].lng }
                              : null;

                            return (
                              <article key={mission.id} className="map-object-card">
                                <div className="map-object-card-top">
                                  <strong>{mission.name}</strong>
                                  <span className="muted">
                                    {mission.type === "intel_recovery" ? "Intel Recovery" : "QR Mission"} · {mission.locations.length} circles
                                  </span>
                                </div>
                                {mission.qrCode ? <code>{mission.qrCode}</code> : <span className="muted">Completed by field image upload</span>}
                                {mission.mapCenter && (
                                  <span className="muted">
                                    Center: {mission.mapCenter.lat.toFixed(6)}, {mission.mapCenter.lng.toFixed(6)}
                                  </span>
                                )}
                                {mission.timeWindowCET && (
                                  <span className="muted">
                                    {formatCETDateTime(mission.timeWindowCET.startsAtCET)} -{" "}
                                    {formatCETDateTime(mission.timeWindowCET.endsAtCET)}
                                  </span>
                                )}
                                <div className="inline-actions">
                                  {mission.qrCode && (
                                    <button
                                      type="button"
                                      onClick={() => void copyText(mission.qrCode ?? "", `Copied mission payload ${mission.qrCode}.`)}
                                    >
                                      Copy Payload
                                    </button>
                                  )}
                                  {mission.qrCode && (
                                    <button
                                      type="button"
                                      onClick={() => void copyText(missionRevealUrl, `Copied QR reveal URL for ${mission.name}.`)}
                                      disabled={!missionRevealUrl}
                                    >
                                      Copy QR URL
                                    </button>
                                  )}
                                  {mission.qrCode && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copyText(missionEndpoint, `Copied trigger endpoint for ${mission.name}.`)
                                      }
                                      disabled={!missionEndpoint}
                                    >
                                      Copy Endpoint
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const center = mission.mapCenter ?? fallbackCenter;
                                      if (!center) {
                                        setError("Mission has no coordinates to focus.");
                                        return;
                                      }
                                      setMapCenterOverride(center);
                                      setError(null);
                                    }}
                                  >
                                    Focus
                                  </button>
                                  <button type="button" onClick={() => void deleteMission(mission.id, mission.name)}>
                                    Delete
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                          {selectedGameDetail.state.missions.length === 0 && (
                            <p className="muted">No missions configured for this game.</p>
                          )}
                        </div>
                      </section>
                    )}

                    {mapMode === "settings" && (
                      <section className="map-ops-section">
                        <div className="admin-section-heading">
                          <div>
                            <h3>Map Settings</h3>
                            <p className="muted">Set the default map entry point and review live tactical overlays.</p>
                          </div>
                        </div>

                        <div className="admin-form-grid">
                          <label className="stack-field">
                            <span>Default Center Latitude</span>
                            <input
                              type="text"
                              value={defaultMapCenterLat}
                              onChange={(event) => setDefaultMapCenterLat(event.target.value)}
                              placeholder="46.245562"
                            />
                          </label>

                          <label className="stack-field">
                            <span>Default Center Longitude</span>
                            <input
                              type="text"
                              value={defaultMapCenterLng}
                              onChange={(event) => setDefaultMapCenterLng(event.target.value)}
                              placeholder="16.110200"
                            />
                          </label>
                        </div>

                        <div className="inline-actions">
                          <button
                            type="button"
                            onClick={() => setMapPickTarget((current) => (current === "default_center" ? null : "default_center"))}
                          >
                            {mapPickTarget === "default_center" ? "Stop Picking Center" : "Pick Default Center"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDefaultMapCenterLat("");
                              setDefaultMapCenterLng("");
                            }}
                          >
                            Clear
                          </button>
                          <button type="button" onClick={() => void saveDefaultMapCenter()} disabled={settingsSaving}>
                            {settingsSaving ? "Saving..." : "Save Start Position"}
                          </button>
                        </div>

                        <div className="map-object-list">
                          <article className="map-object-card compact">
                            <strong>Current Default Center</strong>
                            <span>
                              {selectedGameDetail.defaultMapCenter
                                ? `${selectedGameDetail.defaultMapCenter.lat.toFixed(6)}, ${selectedGameDetail.defaultMapCenter.lng.toFixed(6)}`
                                : "Not set"}
                            </span>
                            {selectedGameDetail.defaultMapCenter && (
                              <button
                                type="button"
                                onClick={() => setMapCenterOverride(selectedGameDetail.defaultMapCenter)}
                              >
                                Focus
                              </button>
                            )}
                          </article>

                          <article className="map-object-card compact">
                            <strong>Live Tactical Signals</strong>
                            <span>{selectedGameDetail.state.mapSignals?.length ?? 0} active signal markers on map</span>
                          </article>
                        </div>
                      </section>
                    )}
                  </div>

                  <div className="panel admin-map-panel map-ops-map">
                    <div className="admin-section-heading">
                      <div>
                        <h3>{selectedGameDetail.game.name}</h3>
                        <p className="muted">
                          {selectedGameDetail.game.code} · {selectedGameDetail.game.mapReference ?? "No map reference"}
                        </p>
                      </div>
                      <div className="inline-actions">
                        <button type="button" onClick={() => setMapCenterOverride(selectedGameDetail.defaultMapCenter)}>
                          Reset Focus
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMapPickTarget(null);
                            setPendingMapPoint(null);
                            setMapCenterOverride(null);
                          }}
                        >
                          Clear Map State
                        </button>
                      </div>
                    </div>

                    <div className="map-panel">
                      <MissionMap
                        missions={selectedGameDetail.state.missions}
                        completions={selectedGameDetail.state.completions}
                        players={selectedGameDetail.state.players ?? []}
                        mapMarkers={selectedGameDetail.state.mapMarkers ?? []}
                        mapShapes={selectedGameDetail.state.mapShapes ?? []}
                        mapSignals={selectedGameDetail.state.mapSignals ?? []}
                        selectedTeam={null}
                        mapPickMode={mapPickMode}
                        onMapClick={(point) => setPendingMapPoint(point)}
                        defaultCenter={selectedGameDetail.defaultMapCenter}
                        centerOverride={mapCenterOverride}
                        draftShape={draftShape}
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>
          </section>
        )}

        {activeTab === "admins" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Admin Accounts</h2>
                  <p className="muted">Create and manage the real administrator accounts used to access this dashboard.</p>
                </div>
              </div>

              <div className="admin-form-grid">
                <label className="stack-field">
                  <span>Admin Email</span>
                  <input
                    type="email"
                    value={newAdminEmail}
                    onChange={(event) => setNewAdminEmail(event.target.value)}
                    placeholder="new-admin@example.com"
                  />
                </label>
                <label className="stack-field">
                  <span>Temporary Password</span>
                  <input
                    type="password"
                    value={newAdminPassword}
                    onChange={(event) => setNewAdminPassword(event.target.value)}
                    placeholder="Minimum 8 characters"
                  />
                </label>
              </div>

              <div className="inline-actions">
                <button type="button" onClick={() => void createAdminAccount()} disabled={adminAccountSaving}>
                  {adminAccountSaving ? "Saving..." : "Create Admin Account"}
                </button>
              </div>
            </section>

            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Administrators</h2>
                  <p className="muted">Active and inactive dashboard users.</p>
                </div>
                <button type="button" onClick={() => void loadAdminAccounts()}>
                  Refresh
                </button>
              </div>

              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Last Login</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminAccounts.map((account) => (
                      <tr key={account.id}>
                        <td>
                          <strong>{account.email}</strong>
                        </td>
                        <td>{account.role}</td>
                        <td>{account.active ? "active" : "inactive"}</td>
                        <td>{formatDateTime(account.createdAt)}</td>
                        <td>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Never"}</td>
                        <td>
                          <button type="button" onClick={() => void toggleAdminAccount(account)} disabled={adminAccountSaving}>
                            {account.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!adminAccountsLoading && adminAccounts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          No administrator accounts found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        )}

        {activeTab === "audit" && (
          <section className="admin-view-stack">
            <section className="panel">
              <div className="admin-section-heading">
                <div>
                  <h2>Audit Log</h2>
                  <p className="muted">Recent admin actions for accountability and troubleshooting.</p>
                </div>
                <button type="button" onClick={() => void loadAudit()}>
                  Refresh
                </button>
              </div>

              {auditLoading && <p className="muted">Loading audit log...</p>}
              {!auditLoading && auditEntries.length === 0 && <p className="muted">No audit entries available.</p>}
              <div className="admin-audit-list">
                {auditEntries.map((entry) => (
                  <article key={entry.id} className="admin-audit-card">
                    <div className="admin-audit-top">
                      <strong>{entry.message}</strong>
                      <span>{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <div className="admin-audit-meta">
                      <span>{entry.action}</span>
                      <span>{entry.entityType}</span>
                      {entry.gameCode && <span>{entry.gameCode}</span>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        )}
      </main>
    </div>
  );
}
