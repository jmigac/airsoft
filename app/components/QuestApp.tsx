"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import QuestCodeModal from "./QuestCodeModal";
import { clearGameCodeCookie, readGameCodeCookie, writeGameCodeCookie } from "@/lib/game-cookie";
import { normalizeGameCode, sanitizeGameCode } from "@/lib/game-code";
import { sanitizeQuestPayload } from "@/lib/payload";
import { GameState, MapSignalType, TEAMS, Team } from "@/lib/types";

const MissionMap = dynamic(() => import("./MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const INITIAL_STATE: GameState = {
  missions: [],
  completions: [],
  defaultMapCenter: undefined,
  mapMarkers: [],
  mapShapes: [],
  mapSignals: []
};

export default function QuestApp() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [team, setTeam] = useState<Team | "">("");
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [gameInput, setGameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingGameState, setLoadingGameState] = useState(false);

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
      setTeam("");
      return;
    }

    const savedTeam = localStorage.getItem(`team:${gameCode}`) as Team | null;
    if (savedTeam && TEAMS.includes(savedTeam)) {
      setTeam(savedTeam);
    } else {
      setTeam("");
    }
  }, [gameCode]);

  useEffect(() => {
    if (!gameCode) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoadingGameState(true);
        setError(null);
        const stateRes = await fetch(`/api/state?game=${encodeURIComponent(gameCode)}`, { cache: "no-store" });

        if (!stateRes.ok) {
          const payload = (await stateRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Could not load selected game.");
        }

        const payload = (await stateRes.json()) as GameState;
        if (!cancelled) {
          setState(payload);
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
    if (!team) {
      return [];
    }

    const missionById = new Map(state.missions.map((mission) => [mission.id, mission]));

    return state.completions
      .filter((completion) => completion.team === team)
      .map((completion) => {
        const mission = missionById.get(completion.missionId);
        return {
          id: completion.id,
          name: mission?.name ?? "Unknown quest",
          completedAt: completion.completedAt
        };
      })
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }, [state.completions, state.missions, team]);

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

  const createNewGame = async () => {
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

      setGameInput(payload.gameCode);
      selectGameCode(payload.gameCode);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create game.");
    } finally {
      setBusy(false);
    }
  };

  const leaveGame = () => {
    setGameCode(null);
    setGameInput("");
    setTeam("");
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

  const setSelectedTeam = (nextTeam: Team) => {
    if (!gameCode) {
      return;
    }

    setTeam(nextTeam);
    localStorage.setItem(`team:${gameCode}`, nextTeam);
  };

  const submitCompletion = async (rawPayload: string) => {
    if (!gameCode) {
      const message = "Join a game before submitting a quest payload.";
      setError(message);
      throw new Error(message);
    }

    if (!team) {
      const message = "Select a team before submitting a quest payload.";
      setError(message);
      throw new Error(message);
    }

    const payloadValue = sanitizeQuestPayload(rawPayload);

    const response = await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameCode, team, payload: payloadValue })
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

  const createQuickSignal = async (payload: { type: MapSignalType; lat: number; lng: number }) => {
    if (!gameCode) {
      throw new Error("Join a game first.");
    }

    if (!team) {
      throw new Error("Select team first.");
    }

    const response = await fetch(`/api/signals?game=${encodeURIComponent(gameCode)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team,
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

  if (!gameCode) {
    return (
      <main className="landing-shell">
        <section className="panel landing-panel">
          <h1>Airsoft Quest Tracker</h1>
          <p className="muted">Join an existing game with invite code or create your own game.</p>

          <input
            id="game-invite-code"
            name="game_invite_code"
            type="text"
            placeholder="Invite code (e.g. A7C4KQ)"
            value={gameInput}
            onChange={(event) => setGameInput(sanitizeGameCode(event.target.value))}
            className="game-code-input"
          />

          <div className="inline-actions">
            <button type="button" onClick={() => void joinGame()} disabled={busy}>
              {busy ? "Please wait..." : "Join Existing Game"}
            </button>
            <button type="button" onClick={() => void createNewGame()} disabled>
              {busy ? "Please wait..." : "Create New Game"}
            </button>
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
            Admin
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
          <h2>Your Team</h2>
          <div className="team-grid">
            {TEAMS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`team-btn team-btn-${candidate} ${team === candidate ? "active" : ""}`}
                onClick={() => setSelectedTeam(candidate)}
              >
                {candidate.toUpperCase()}
              </button>
            ))}
          </div>
          {!team && <p className="muted">Click on Team Participation (RED or BLUE) before entering quest payload.</p>}
        </section>

        <section className="panel">
          <h2>Completed Quests</h2>
          {!team && <p className="muted">Select team to see completed quests.</p>}
          {team && completedForTeam.length === 0 && <p className="muted">No completed quests yet.</p>}
          {team && completedForTeam.length > 0 && (
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
          {!team && <p className="muted">Select your team first, then enter a 6-digit payload.</p>}
          {team && (
            <>
              <p className="muted">Use mission payload (6 digits) to mark quest as completed.</p>
              <button type="button" onClick={() => setIsCodeModalOpen(true)}>
                Enter Quest Payload
              </button>
            </>
          )}
        </section>

        <section className="map-panel">
          {loadingGameState && (
            <div className="map-team-gate">
              <h3>Loading game map...</h3>
            </div>
          )}
          {!loadingGameState && !team && (
            <div className="map-team-gate">
              <h3>Select Team Participation</h3>
              <p>Click on Team Participation button (RED or BLUE) to unlock the map.</p>
            </div>
          )}
          {!loadingGameState && team && (
            <MissionMap
              missions={state.missions}
              completions={state.completions}
              mapMarkers={state.mapMarkers ?? []}
              mapShapes={state.mapShapes ?? []}
              mapSignals={state.mapSignals ?? []}
              selectedTeam={team}
              defaultCenter={defaultMapCenter}
              onCreateQuickSignal={createQuickSignal}
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
