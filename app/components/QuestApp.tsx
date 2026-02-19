"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import QuestCodeModal from "./QuestCodeModal";
import { sanitizeQuestPayload } from "@/lib/payload";
import { GameState, TEAMS, Team } from "@/lib/types";

const MissionMap = dynamic(() => import("./MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const INITIAL_STATE: GameState = {
  missions: [],
  completions: []
};

export default function QuestApp() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [team, setTeam] = useState<Team | "">("");
  const [error, setError] = useState<string | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  useEffect(() => {
    const savedTeam = localStorage.getItem("team") as Team | null;
    if (savedTeam && TEAMS.includes(savedTeam)) {
      setTeam(savedTeam);
    }

    const load = async () => {
      try {
        const stateRes = await fetch("/api/state", { cache: "no-store" });

        if (stateRes.ok) {
          const payload = (await stateRes.json()) as GameState;
          setState(payload);
        }
      } catch {
        setError("Failed to load initial state.");
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { state?: GameState };
        if (payload.state) {
          setState(payload.state);
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
  }, []);

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

  const setSelectedTeam = (nextTeam: Team) => {
    setTeam(nextTeam);
    localStorage.setItem("team", nextTeam);
  };

  const submitCompletion = async (rawPayload: string) => {
    if (!team) {
      const message = "Select a team before submitting a quest payload.";
      setError(message);
      throw new Error(message);
    }

    const payloadValue = sanitizeQuestPayload(rawPayload);

    const response = await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team, payload: payloadValue })
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <h1>Airsoft Quest Tracker</h1>
          <Link href="/admin" className="nav-link-btn">
            Admin
          </Link>
        </div>

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
                className={team === candidate ? "team-btn active" : "team-btn"}
                onClick={() => setSelectedTeam(candidate)}
              >
                {candidate.toUpperCase()}
              </button>
            ))}
          </div>
          {!team && <p className="muted">Choose a team before entering quest payload.</p>}
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
          <MissionMap
            missions={state.missions}
            completions={state.completions}
            selectedTeam={team || null}
          />
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
