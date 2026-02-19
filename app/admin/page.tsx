"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminPanel, { MissionPayload } from "@/app/components/AdminPanel";
import { normalizeGameCode, sanitizeGameCode } from "@/lib/game-code";
import { GameState, MapShapeDraft } from "@/lib/types";

const MissionMap = dynamic(() => import("@/app/components/MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const INITIAL_STATE: GameState = {
  missions: [],
  completions: [],
  defaultMapCenter: undefined,
  mapMarkers: [],
  mapShapes: []
};

function appendGameCode(path: string, gameCode: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}game=${encodeURIComponent(gameCode)}`;
}

export default function AdminPage() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [isAdmin, setIsAdmin] = useState(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [gameInput, setGameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingMapPoint, setPendingMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickMode, setMapPickMode] = useState(false);
  const [mapCenterOverride, setMapCenterOverride] = useState<{ lat: number; lng: number } | null>(null);
  const [draftShape, setDraftShape] = useState<MapShapeDraft | null>(null);
  const [loadingGameState, setLoadingGameState] = useState(false);

  const defaultMapCenter = useMemo(
    () =>
      state.defaultMapCenter
        ? {
            lat: state.defaultMapCenter.lat,
            lng: state.defaultMapCenter.lng
          }
        : null,
    [state.defaultMapCenter?.lat, state.defaultMapCenter?.lng]
  );

  useEffect(() => {
    const fromUrl = (() => {
      if (typeof window === "undefined") {
        return null;
      }

      const search = new URLSearchParams(window.location.search);
      return normalizeGameCode(search.get("game"));
    })();
    const fromStorage =
      typeof window !== "undefined" ? normalizeGameCode(localStorage.getItem("game_code")) : null;
    const initialGameCode = fromUrl ?? fromStorage;

    if (!initialGameCode) {
      return;
    }

    setGameCode(initialGameCode);
    setGameInput(initialGameCode);
    localStorage.setItem("game_code", initialGameCode);
  }, []);

  useEffect(() => {
    if (!gameCode) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoadingGameState(true);
        setError(null);
        const [stateRes, statusRes] = await Promise.all([
          fetch(appendGameCode("/api/state", gameCode), { cache: "no-store" }),
          fetch(appendGameCode("/api/admin/status", gameCode), { cache: "no-store" })
        ]);

        if (!stateRes.ok) {
          const payload = (await stateRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load selected game.");
        }

        const statePayload = (await stateRes.json()) as GameState;
        const statusPayload = statusRes.ok
          ? ((await statusRes.json()) as { admin: boolean })
          : { admin: false };

        if (!cancelled) {
          setState(statePayload);
          setIsAdmin(statusPayload.admin);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load admin state.");
          setGameCode(null);
          setIsAdmin(false);
          localStorage.removeItem("game_code");
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/admin");
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingGameState(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [gameCode]);

  useEffect(() => {
    if (!gameCode) {
      return;
    }

    const eventSource = new EventSource(appendGameCode("/api/events", gameCode));

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { state?: GameState; error?: string };
        if (payload.state) {
          setState(payload.state);
        }
        if (payload.error) {
          setError(payload.error);
        }
      } catch {
        setError("Realtime event parse failed.");
      }
    };

    eventSource.onerror = () => {
      setError("Realtime connection interrupted. Retrying...");
    };

    return () => {
      eventSource.close();
    };
  }, [gameCode]);

  const selectGameCode = (nextCode: string) => {
    setGameCode(nextCode);
    setGameInput(nextCode);
    setState(INITIAL_STATE);
    setError(null);
    setIsAdmin(false);
    localStorage.setItem("game_code", nextCode);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/admin?game=${encodeURIComponent(nextCode)}`);
    }
  };

  const joinGame = async () => {
    const normalizedCode = normalizeGameCode(gameInput);
    if (!normalizedCode) {
      setError("Invite code must be 6 letters/numbers.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`/api/games/${encodeURIComponent(normalizedCode)}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Game not found.");
      }
      selectGameCode(normalizedCode);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not join game.");
    } finally {
      setBusy(false);
    }
  };

  const createGame = async () => {
    try {
      setBusy(true);
      setError(null);
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; gameCode?: string };
      if (!response.ok || !payload.gameCode) {
        throw new Error(payload.error ?? "Could not create game.");
      }

      selectGameCode(payload.gameCode);
      setIsAdmin(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create game.");
    } finally {
      setBusy(false);
    }
  };

  const copyInviteCode = async () => {
    if (!gameCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(gameCode);
      setError(null);
    } catch {
      setError("Clipboard copy failed.");
    }
  };

  const logoutAdmin = async () => {
    if (!gameCode) {
      return;
    }

    await fetch(appendGameCode("/api/admin/logout", gameCode), { method: "POST" });
    setIsAdmin(false);
    setMapPickMode(false);
    setDraftShape(null);
  };

  const loginAsAdmin = async (password: string) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode("/api/admin/login", gameCode), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, gameCode })
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? "Login failed");
    }

    setIsAdmin(true);
  };

  const createMission = async (mission: MissionPayload) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode("/api/admin/missions", gameCode), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mission)
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to create mission");
    }

    if (payload.state) {
      setState(payload.state);
    }
  };

  const deleteMission = async (missionId: string) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode(`/api/admin/missions/${missionId}`, gameCode), {
      method: "DELETE"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to delete mission");
    }

    if (payload.state) {
      setState(payload.state);
    }
  };

  const createMapMarker = async (payload: { type?: string; name: string; color: string; lat: number; lng: number }) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode("/api/admin/markers", gameCode), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to create marker");
    }

    if (body.state) {
      setState(body.state);
    }
  };

  const deleteMapMarker = async (markerId: string) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode(`/api/admin/markers/${markerId}`, gameCode), {
      method: "DELETE"
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to delete marker");
    }

    if (body.state) {
      setState(body.state);
    }
  };

  const createMapShape = async (payload: {
    label: string;
    color: string;
    opacity: number;
    points: Array<{ lat: number; lng: number }>;
  }) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode("/api/admin/shapes", gameCode), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to create shape");
    }

    if (body.state) {
      setState(body.state);
    }
  };

  const deleteMapShape = async (shapeId: string) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode(`/api/admin/shapes/${shapeId}`, gameCode), {
      method: "DELETE"
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "Failed to delete shape");
    }

    if (body.state) {
      setState(body.state);
    }
  };

  const updateDefaultMapCenter = async (center: { lat: number; lng: number } | null) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    const response = await fetch(appendGameCode("/api/admin/settings", gameCode), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultMapCenter: center })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to update default map center");
    }

    if (payload.state) {
      setState(payload.state);
    }

    setMapCenterOverride(center);
  };

  if (!gameCode) {
    return (
      <main className="landing-shell">
        <section className="panel landing-panel">
          <h1>Admin Console</h1>
          <p className="muted">Enter game invite code to manage an existing game or create a new one.</p>

          <input
            type="text"
            placeholder="Invite code"
            value={gameInput}
            onChange={(event) => setGameInput(sanitizeGameCode(event.target.value))}
            className="game-code-input"
          />

          <div className="inline-actions">
            <button type="button" onClick={() => void joinGame()} disabled={busy}>
              {busy ? "Please wait..." : "Open Existing Game"}
            </button>
            <button type="button" onClick={() => void createGame()} disabled={busy}>
              {busy ? "Please wait..." : "Create New Game"}
            </button>
            <Link href="/" className="nav-link-btn">
              Back To Game
            </Link>
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const gameHref = `/?game=${encodeURIComponent(gameCode)}`;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <h1>Admin Console ({gameCode})</h1>
        <div className="inline-actions">
          <button type="button" onClick={() => void copyInviteCode()}>
            Copy Invite Code
          </button>
          <Link href={gameHref} className="nav-link-btn">
            Back To Game
          </Link>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="admin-page-grid">
        <section className="map-panel admin-map-panel">
          {loadingGameState && <div className="map-loading">Loading map...</div>}
          {!loadingGameState && (
            <MissionMap
              missions={state.missions}
              completions={state.completions}
              mapMarkers={state.mapMarkers ?? []}
              mapShapes={state.mapShapes ?? []}
              selectedTeam={null}
              mapPickMode={mapPickMode}
              onMapClick={(point) => setPendingMapPoint(point)}
              defaultCenter={defaultMapCenter}
              centerOverride={mapCenterOverride}
              draftShape={draftShape}
            />
          )}
        </section>

        <AdminPanel
          gameCode={gameCode}
          isAdmin={isAdmin}
          missions={state.missions}
          mapMarkers={state.mapMarkers ?? []}
          mapShapes={state.mapShapes ?? []}
          defaultMapCenter={defaultMapCenter}
          mapPickMode={mapPickMode}
          pendingMapPoint={pendingMapPoint}
          onMapPickModeChange={setMapPickMode}
          onLogin={loginAsAdmin}
          onLogout={logoutAdmin}
          onUpdateDefaultMapCenter={updateDefaultMapCenter}
          onCreateMapMarker={createMapMarker}
          onDeleteMapMarker={deleteMapMarker}
          onCreateMapShape={createMapShape}
          onDeleteMapShape={deleteMapShape}
          onCreateMission={createMission}
          onDeleteMission={deleteMission}
          onFocusMissionMap={setMapCenterOverride}
          onShapeDraftChange={setDraftShape}
        />
      </div>
    </div>
  );
}
