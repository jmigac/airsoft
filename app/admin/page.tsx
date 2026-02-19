"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import AdminPanel, { MissionPayload } from "@/app/components/AdminPanel";
import { GameState } from "@/lib/types";

const MissionMap = dynamic(() => import("@/app/components/MissionMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
});

const INITIAL_STATE: GameState = {
  missions: [],
  completions: []
};

export default function AdminPage() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMapPoint, setPendingMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickMode, setMapPickMode] = useState(false);
  const [mapCenterOverride, setMapCenterOverride] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [stateRes, statusRes] = await Promise.all([
          fetch("/api/state", { cache: "no-store" }),
          fetch("/api/admin/status", { cache: "no-store" })
        ]);

        if (stateRes.ok) {
          const payload = (await stateRes.json()) as GameState;
          setState(payload);
        }

        if (statusRes.ok) {
          const payload = (await statusRes.json()) as { admin: boolean };
          setIsAdmin(payload.admin);
        }
      } catch {
        setError("Failed to load admin state.");
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

  const loginAsAdmin = async (password: string) => {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? "Login failed");
    }

    setIsAdmin(true);
  };

  const logoutAdmin = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAdmin(false);
    setMapPickMode(false);
  };

  const createMission = async (mission: MissionPayload) => {
    const response = await fetch("/api/admin/missions", {
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
    const response = await fetch(`/api/admin/missions/${missionId}`, {
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

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <h1>Admin Console</h1>
        <Link href="/" className="nav-link-btn">
          Back To Game
        </Link>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="admin-page-grid">
        <section className="map-panel admin-map-panel">
          <MissionMap
            missions={state.missions}
            completions={state.completions}
            selectedTeam={null}
            mapPickMode={mapPickMode}
            onMapClick={(point) => setPendingMapPoint(point)}
            centerOverride={mapCenterOverride}
          />
        </section>

        <AdminPanel
          isAdmin={isAdmin}
          missions={state.missions}
          mapPickMode={mapPickMode}
          pendingMapPoint={pendingMapPoint}
          onMapPickModeChange={setMapPickMode}
          onLogin={loginAsAdmin}
          onLogout={logoutAdmin}
          onCreateMission={createMission}
          onDeleteMission={deleteMission}
          onFocusMissionMap={setMapCenterOverride}
        />
      </div>
    </div>
  );
}
