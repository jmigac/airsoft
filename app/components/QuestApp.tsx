"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import QuestCodeModal from "./QuestCodeModal";
import { clearGameCodeCookie, readGameCodeCookie, writeGameCodeCookie } from "@/lib/game-cookie";
import { normalizeGameCode, sanitizeGameCode } from "@/lib/game-code";
import { sanitizeQuestPayload } from "@/lib/payload";
import { GamePlayer, GameState, MapSignalType, Team, TEAMS } from "@/lib/types";

const MissionMap = dynamic(() => import("./MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const INITIAL_STATE: GameState = {
  missions: [],
  completions: [],
  missionIntelUploads: [],
  players: [],
  defaultMapCenter: undefined,
  mapMarkers: [],
  mapShapes: [],
  mapSignals: []
};

type LocationShareStatus = "unknown" | "prompt" | "granted" | "denied" | "unavailable";

export default function QuestApp() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [player, setPlayer] = useState<GamePlayer | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [gameInput, setGameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingGameState, setLoadingGameState] = useState(false);
  const [locationShareStatus, setLocationShareStatus] = useState<LocationShareStatus>("unknown");
  const [locationShareMessage, setLocationShareMessage] = useState<string | null>(null);
  const [lastLocationUpdateAt, setLastLocationUpdateAt] = useState<string | null>(null);
  const [selectedIntelMissionId, setSelectedIntelMissionId] = useState("");
  const [intelFiles, setIntelFiles] = useState<File[]>([]);
  const [intelUploadBusy, setIntelUploadBusy] = useState(false);
  const [intelUploadInputKey, setIntelUploadInputKey] = useState(0);
  const selectedTeam = player?.team ?? null;
  const playerId = player?.id ?? null;

  useEffect(() => {
    const fromUrl = (() => {
      if (typeof window === "undefined") {
        return null;
      }

      const search = new URLSearchParams(window.location.search);
      return normalizeGameCode(search.get("game"));
    })();
    const fromCookie = readGameCodeCookie();
    const initialGameCode = fromUrl ?? fromCookie;

    if (!initialGameCode) {
      return;
    }

    setGameCode(initialGameCode);
    setGameInput(initialGameCode);
    writeGameCodeCookie(initialGameCode);
  }, []);

  useEffect(() => {
    if (!gameCode) {
      setPlayer(null);
      setNicknameInput("");
      setLocationShareStatus("unknown");
      setLocationShareMessage(null);
      setLastLocationUpdateAt(null);
      setSelectedIntelMissionId("");
      setIntelFiles([]);
      setIntelUploadInputKey(0);
      return;
    }
  }, [gameCode]);

  useEffect(() => {
    if (!player) {
      setLocationShareStatus("unknown");
      setLocationShareMessage(null);
      setLastLocationUpdateAt(null);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationShareStatus("unavailable");
      return;
    }

    const permissionApi = navigator.permissions;
    if (!permissionApi?.query) {
      setLocationShareStatus((current) => (current === "unknown" ? "prompt" : current));
      return;
    }

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;
    const sync = (state: PermissionState) => {
      if (cancelled) {
        return;
      }

      if (state === "granted") {
        setLocationShareStatus("granted");
        return;
      }

      if (state === "denied") {
        setLocationShareStatus("denied");
        return;
      }

      setLocationShareStatus("prompt");
    };

    void permissionApi
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        permissionStatus = status;
        sync(status.state);
        permissionStatus.onchange = () => {
          sync(permissionStatus?.state ?? "prompt");
        };
      })
      .catch(() => {
        sync("prompt");
      });

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, [playerId]);

  useEffect(() => {
    if (!gameCode) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoadingGameState(true);
        setError(null);
        const [stateRes, meRes] = await Promise.all([
          fetch(`/api/state?game=${encodeURIComponent(gameCode)}`, { cache: "no-store" }),
          fetch(`/api/player/me?game=${encodeURIComponent(gameCode)}`, { cache: "no-store" })
        ]);

        if (!stateRes.ok) {
          const payload = (await stateRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Could not load selected game.");
        }

        const payload = (await stateRes.json()) as GameState;
        const mePayload = meRes.ok
          ? ((await meRes.json()) as { player?: GamePlayer | null })
          : { player: null };
        if (!cancelled) {
          setState(payload);
          setPlayer(mePayload.player ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load game.");
          setGameCode(null);
          clearGameCodeCookie();
          if (typeof window !== "undefined") {
            window.history.replaceState(null, "", "/");
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

    const eventSource = new EventSource(`/api/events?game=${encodeURIComponent(gameCode)}`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { state?: GameState; error?: string };
        if (payload.state) {
          setState(payload.state);
          setPlayer((current) => {
            if (!current) {
              return current;
            }

            return (payload.state?.players ?? []).find((entry) => entry.id === current.id) ?? null;
          });
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

  const completedForTeam = useMemo(() => {
    if (!selectedTeam) {
      return [];
    }

    const missionById = new Map(state.missions.map((mission) => [mission.id, mission]));

    return state.completions
      .filter((completion) => completion.team === selectedTeam)
      .map((completion) => {
        const mission = missionById.get(completion.missionId);
        return {
          id: completion.id,
          name: mission?.name ?? "Unknown quest",
          completedAt: completion.completedAt
        };
      })
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }, [selectedTeam, state.completions, state.missions]);

  const redeemCountsByTeam = useMemo(() => {
    const counts: Record<Team, number> = { red: 0, blue: 0 };

    for (const completion of state.completions) {
      if (completion.team in counts) {
        counts[completion.team] += 1;
      }
    }

    return counts;
  }, [state.completions]);

  const totalRedeems = useMemo(
    () => redeemCountsByTeam.red + redeemCountsByTeam.blue,
    [redeemCountsByTeam]
  );
  const completedMissionIdsForSelectedTeam = useMemo(() => {
    if (!selectedTeam) {
      return new Set<string>();
    }

    return new Set(
      state.completions.filter((completion) => completion.team === selectedTeam).map((completion) => completion.missionId)
    );
  }, [selectedTeam, state.completions]);
  const intelRecoveryMissions = useMemo(
    () =>
      state.missions.filter(
        (mission) => mission.type === "intel_recovery" && !completedMissionIdsForSelectedTeam.has(mission.id)
      ),
    [completedMissionIdsForSelectedTeam, state.missions]
  );

  useEffect(() => {
    if (intelRecoveryMissions.length === 0) {
      setSelectedIntelMissionId("");
      return;
    }

    setSelectedIntelMissionId((current) =>
      current && intelRecoveryMissions.some((mission) => mission.id === current) ? current : intelRecoveryMissions[0].id
    );
  }, [intelRecoveryMissions]);

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

  const selectGameCode = (nextCode: string) => {
    setGameCode(nextCode);
    setState(INITIAL_STATE);
    setError(null);
    setPlayer(null);
    setNicknameInput("");
    writeGameCodeCookie(nextCode);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/?game=${encodeURIComponent(nextCode)}`);
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
      const response = await fetch(`/api/games/${encodeURIComponent(normalizedCode)}`, {
        cache: "no-store"
      });
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

  const leaveGame = () => {
    setGameCode(null);
    setGameInput("");
    setPlayer(null);
    setNicknameInput("");
    setState(INITIAL_STATE);
    setError(null);
    clearGameCodeCookie();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
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

  const joinTeam = async (team: "red" | "blue") => {
    if (!gameCode) {
      return;
    }

    const nickname = nicknameInput.trim();
    if (nickname.length < 2) {
      setError("Nickname is required (minimum 2 characters).");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`/api/player/join?game=${encodeURIComponent(gameCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, team })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        player?: GamePlayer | null;
        state?: GameState;
      };

      if (!response.ok || !payload.player) {
        throw new Error(payload.error ?? "Could not join team.");
      }

      setPlayer(payload.player);
      if (payload.state) {
        setState(payload.state);
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not join team.");
    } finally {
      setBusy(false);
    }
  };

  const submitCompletion = async (rawPayload: string) => {
    if (!gameCode) {
      const message = "Join a game before submitting a quest payload.";
      setError(message);
      throw new Error(message);
    }

    if (!player) {
      const message = "Nickname and team selection are required before submitting payloads.";
      setError(message);
      throw new Error(message);
    }

    const payloadValue = sanitizeQuestPayload(rawPayload);

    const response = await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameCode, payload: payloadValue })
    });

    const payload = await response.json();

    if (!response.ok) {
      const message = payload.error ?? "Completion failed.";
      setError(message);
      throw new Error(message);
    }

    if (payload.state) {
      setState(payload.state);
    }

    setError(null);
  };

  const submitIntelRecovery = async () => {
    if (!gameCode) {
      setError("Join a game before uploading intel.");
      return;
    }

    if (!player) {
      setError("Nickname and team selection are required before uploading intel.");
      return;
    }

    if (!selectedIntelMissionId) {
      setError("Select an Intel Recovery mission first.");
      return;
    }

    if (intelFiles.length === 0) {
      setError("Choose at least one image to upload.");
      return;
    }

    try {
      setIntelUploadBusy(true);
      const formData = new FormData();
      formData.set("gameCode", gameCode);
      formData.set("missionId", selectedIntelMissionId);
      for (const file of intelFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/complete/intel", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; state?: GameState };

      if (!response.ok) {
        throw new Error(payload.error ?? "Intel upload failed.");
      }

      if (payload.state) {
        setState(payload.state);
      }

      setIntelFiles([]);
      setIntelUploadInputKey((current) => current + 1);
      setError(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Intel upload failed.");
    } finally {
      setIntelUploadBusy(false);
    }
  };

  const createQuickSignal = async (payload: { type: MapSignalType; lat: number; lng: number }) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    if (!player) {
      throw new Error("Nickname and team selection are required first.");
    }

    const response = await fetch(`/api/signals?game=${encodeURIComponent(gameCode)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payload.type,
        lat: payload.lat,
        lng: payload.lng
      })
    });
    const responsePayload = (await response.json().catch(() => ({}))) as { error?: string; state?: GameState };

    if (!response.ok) {
      const message = responsePayload.error ?? "Could not place signal.";
      setError(message);
      throw new Error(message);
    }

    if (responsePayload.state) {
      setState(responsePayload.state);
    }
    setError(null);
  };

  const sendLocationSample = useCallback(
    async (showFeedback: boolean) => {
      if (!gameCode || !playerId) {
        return;
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setLocationShareStatus("unavailable");
        if (showFeedback) {
          setLocationShareMessage("Location is not available on this device/browser.");
        }
        return;
      }

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 10_000,
            timeout: 10_000
          });
        });

        const response = await fetch(`/api/player/location?game=${encodeURIComponent(gameCode)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          })
        });

        if (!response.ok) {
          throw new Error("Could not share location.");
        }

        const nowIso = new Date().toISOString();
        setLocationShareStatus("granted");
        setLastLocationUpdateAt(nowIso);
        setLocationShareMessage(null);
      } catch (locationError) {
        const code =
          typeof locationError === "object" && locationError !== null && "code" in locationError
            ? Number((locationError as { code?: unknown }).code)
            : null;

        if (code === 1) {
          setLocationShareStatus("denied");
          setLocationShareMessage("Location access is blocked. Enable Location for this site in browser settings.");
          return;
        }

        if (showFeedback) {
          setLocationShareMessage("Could not get GPS position. Turn on Location services and try again.");
        }
        setLocationShareStatus((current) => (current === "granted" ? current : "prompt"));
      }
    },
    [gameCode, playerId]
  );

  useEffect(() => {
    if (!gameCode || !playerId) {
      return;
    }

    if (locationShareStatus === "unavailable" || locationShareStatus === "denied") {
      return;
    }

    let cancelled = false;

    const sendLocation = async () => {
      if (cancelled) {
        return;
      }
      await sendLocationSample(false);
    };

    void sendLocation();
    const interval = window.setInterval(() => {
      void sendLocation();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [gameCode, locationShareStatus, playerId, sendLocationSample]);

  const locationShareStatusLabel = useMemo(() => {
    if (locationShareStatus === "granted") {
      return "Enabled";
    }

    if (locationShareStatus === "denied") {
      return "Blocked";
    }

    if (locationShareStatus === "unavailable") {
      return "Unsupported";
    }

    if (locationShareStatus === "prompt") {
      return "Not allowed yet";
    }

    return "Checking";
  }, [locationShareStatus]);

  const locationShareStatusClass = useMemo(() => {
    if (locationShareStatus === "granted") {
      return "is-enabled";
    }

    if (locationShareStatus === "denied") {
      return "is-blocked";
    }

    if (locationShareStatus === "unavailable") {
      return "is-unsupported";
    }

    return "is-pending";
  }, [locationShareStatus]);

  if (!gameCode) {
    return (
      <main className="landing-shell">
        <section className="panel landing-panel">
          <h1>Airsoft Quest Tracker</h1>
          <p className="muted">Join an existing game with an invite code. New games can be created only from the admin dashboard.</p>

          <input
            id="game-invite-code"
            name="game_invite_code"
            type="text"
            placeholder="Invite code (e.g. A7C4KQ)"
            value={gameInput}
            onChange={(event) => setGameInput(sanitizeGameCode(event.target.value))}
            className="game-code-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            suppressHydrationWarning
          />

          <div className="inline-actions">
            <button type="button" onClick={() => void joinGame()} disabled={busy}>
              {busy ? "Please wait..." : "Join Existing Game"}
            </button>
            <Link href="/admin" className="nav-link-btn">
              Global Admin Dashboard
            </Link>
          </div>

          <p className="muted">Each game has isolated missions, markers, shapes, and admin settings.</p>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const adminHref = `/admin?game=${encodeURIComponent(gameCode)}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <h1>Airsoft Quest Tracker</h1>
          <Link href={adminHref} className="nav-link-btn">
            Admin Dashboard
          </Link>
        </div>

        <section className="panel">
          <h2>Game Session</h2>
          <p>
            Invite code: <strong>{gameCode}</strong>
          </p>
          <div className="inline-actions">
            <button type="button" onClick={() => void copyInviteCode()}>
              Copy Invite Code
            </button>
            <button type="button" onClick={leaveGame}>
              Switch Game
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Scoreboard</h2>
          <div className="scoreboard-grid">
            <div className="score-card team-red">
              <span>RED</span>
              <strong>{redeemCountsByTeam.red}</strong>
            </div>
            <div className="score-card team-blue">
              <span>BLUE</span>
              <strong>{redeemCountsByTeam.blue}</strong>
            </div>
          </div>
          <p className="muted">Total redeems: {totalRedeems}</p>
        </section>

        <section className="panel">
          <h2>Team Participation</h2>
          {!player && (
            <>
              <input
                type="text"
                placeholder="Nickname (required)"
                value={nicknameInput}
                onChange={(event) => setNicknameInput(event.target.value)}
              />
              <div className="team-grid">
                {TEAMS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={`team-btn team-btn-${candidate}`}
                    onClick={() => void joinTeam(candidate)}
                    disabled={busy}
                  >
                    Join {candidate.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="muted">Team is locked after joining. Ask admin if reassignment is needed.</p>
            </>
          )}
          {player && (
            <>
              <div className="team-grid">
                {TEAMS.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={`team-btn team-btn-${candidate} ${selectedTeam === candidate ? "active" : ""}`}
                    disabled
                  >
                    {candidate.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="muted">
                Nickname: <strong>{player.nickname}</strong>
              </p>
              <p className="muted">Team is locked on this device/session.</p>
              <div className="location-share-box">
                <div className="location-share-top">
                  <p className="muted location-share-label">Location sharing</p>
                  <span className={`location-share-pill ${locationShareStatusClass}`}>{locationShareStatusLabel}</span>
                </div>
                <button
                  type="button"
                  className="location-share-btn"
                  onClick={() => void sendLocationSample(true)}
                  disabled={locationShareStatus === "unavailable"}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                    <path
                      d="M12 2a7 7 0 0 0-7 7c0 4.18 4.55 10.22 6.22 12.3a1 1 0 0 0 1.56 0C14.45 19.22 19 13.18 19 9a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>{locationShareStatus === "granted" ? "Refresh Location" : "Enable Location Sharing"}</span>
                </button>
                {lastLocationUpdateAt && (
                  <p className="muted location-share-meta">
                    Last update: {new Date(lastLocationUpdateAt).toLocaleTimeString()}
                  </p>
                )}
                {locationShareMessage && <p className="error">{locationShareMessage}</p>}
                {locationShareStatus === "denied" && (
                  <p className="muted">If blocked, open browser site settings and set Location to Allow.</p>
                )}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Completed Quests</h2>
          {!selectedTeam && <p className="muted">Join team with nickname to see completed quests.</p>}
          {selectedTeam && completedForTeam.length === 0 && <p className="muted">No completed quests yet.</p>}
          {selectedTeam && completedForTeam.length > 0 && (
            <ul className="quest-list">
              {completedForTeam.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.name}</strong>
                  <span>{new Date(entry.completedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="error">{error}</p>}
      </aside>

      <main className="main-panel">
        <section className="panel entry-panel">
          <h2>Complete Quest</h2>
          {!selectedTeam && <p className="muted">Nickname + team are required before entering payload.</p>}
          {selectedTeam && (
            <>
              {state.missions.some((mission) => mission.type === "qr_payload") && (
                <div className="entry-action-card">
                  <p className="muted">Use mission payload (6 digits) to mark a QR mission as completed.</p>
                  <button type="button" onClick={() => setIsCodeModalOpen(true)}>
                    Enter Quest Payload
                  </button>
                </div>
              )}

              {intelRecoveryMissions.length > 0 && (
                <div className="entry-action-card intel-upload-card">
                  <div>
                    <strong>Intel Recovery</strong>
                    <p className="muted">Upload field photos of discovered intel. Successful image upload completes the mission.</p>
                  </div>

                  <select value={selectedIntelMissionId} onChange={(event) => setSelectedIntelMissionId(event.target.value)}>
                    {intelRecoveryMissions.map((mission) => (
                      <option key={mission.id} value={mission.id}>
                        {mission.name}
                      </option>
                    ))}
                  </select>

                  <input
                    key={intelUploadInputKey}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => setIntelFiles(Array.from(event.target.files ?? []))}
                  />

                  <div className="inline-actions">
                    <button type="button" onClick={() => void submitIntelRecovery()} disabled={intelUploadBusy}>
                      {intelUploadBusy ? "Uploading..." : "Upload Intel Evidence"}
                    </button>
                    {intelFiles.length > 0 && <span className="muted">{intelFiles.length} file(s) selected</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="map-panel">
          {loadingGameState && (
            <div className="map-team-gate">
              <h3>Loading game map...</h3>
            </div>
          )}
          {!loadingGameState && !selectedTeam && (
            <div className="map-team-gate">
              <h3>Join Team Participation</h3>
              <p>Enter nickname and join RED or BLUE to unlock map and payload actions.</p>
            </div>
          )}
          {!loadingGameState && selectedTeam && (
            <MissionMap
              missions={state.missions}
              completions={state.completions}
              players={state.players ?? []}
              mapMarkers={state.mapMarkers ?? []}
              mapShapes={state.mapShapes ?? []}
              mapSignals={state.mapSignals ?? []}
              selectedTeam={selectedTeam}
              defaultCenter={defaultMapCenter}
              onCreateQuickSignal={createQuickSignal}
              showCenterOnPlayerControl
              currentPlayerLocation={player?.location ? { lat: player.location.lat, lng: player.location.lng } : null}
              showZoomControls={false}
            />
          )}
        </section>
      </main>

      <QuestCodeModal
        open={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        onSubmit={submitCompletion}
      />
    </div>
  );
}
