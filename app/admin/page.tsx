"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminPanel, { MissionPayload } from "@/app/components/AdminPanel";
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

export default function AdminPage() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMapPoint, setPendingMapPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickMode, setMapPickMode] = useState(false);
  const [mapCenterOverride, setMapCenterOverride] = useState<{ lat: number; lng: number } | null>(null);
  const [draftShape, setDraftShape] = useState<MapShapeDraft | null>(null);
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
    setDraftShape(null);
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

  const createMapMarker = async (payload: { type?: string; name: string; color: string; lat: number; lng: number }) => {
    const response = await fetch("/api/admin/markers", {
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
    const response = await fetch(`/api/admin/markers/${markerId}`, {
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
    const response = await fetch("/api/admin/shapes", {
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
    const response = await fetch(`/api/admin/shapes/${shapeId}`, {
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
    const response = await fetch("/api/admin/settings", {
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
            mapMarkers={state.mapMarkers ?? []}
            mapShapes={state.mapShapes ?? []}
            selectedTeam={null}
            mapPickMode={mapPickMode}
            onMapClick={(point) => setPendingMapPoint(point)}
            defaultCenter={defaultMapCenter}
            centerOverride={mapCenterOverride}
            draftShape={draftShape}
          />
        </section>

        <AdminPanel
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
