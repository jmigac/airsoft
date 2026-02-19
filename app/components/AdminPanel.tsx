"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { generateQuestPayload, isValidQuestPayload, sanitizeQuestPayload } from "@/lib/payload";
import { buildPinRevealPath, buildTriggerPath } from "@/lib/qr";
import { Mission } from "@/lib/types";

export type MissionPayload = {
  name: string;
  qrCode: string;
  mapCenter?: { lat: number; lng: number };
  locations: Array<{ lat: number; lng: number; radius: number }>;
};

const DEFAULT_LOCATION_RADIUS_METERS = 15;

type Props = {
  isAdmin: boolean;
  missions: Mission[];
  mapPickMode: boolean;
  pendingMapPoint: { lat: number; lng: number } | null;
  onMapPickModeChange: (enabled: boolean) => void;
  onLogin: (password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onCreateMission: (payload: MissionPayload) => Promise<void>;
  onDeleteMission: (missionId: string) => Promise<void>;
  onFocusMissionMap: (center: { lat: number; lng: number }) => void;
};

export default function AdminPanel({
  isAdmin,
  missions,
  mapPickMode,
  pendingMapPoint,
  onMapPickModeChange,
  onLogin,
  onLogout,
  onCreateMission,
  onDeleteMission,
  onFocusMissionMap
}: Props) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [mapCenterLat, setMapCenterLat] = useState("");
  const [mapCenterLng, setMapCenterLng] = useState("");
  const [radius, setRadius] = useState(String(DEFAULT_LOCATION_RADIUS_METERS));
  const [locations, setLocations] = useState<Array<{ lat: number; lng: number; radius: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appOrigin, setAppOrigin] = useState("");
  const [draftQrPreview, setDraftQrPreview] = useState<string | null>(null);
  const [missionQrPreviews, setMissionQrPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      setAppOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (pendingMapPoint && mapPickMode) {
      setLat(pendingMapPoint.lat.toFixed(6));
      setLng(pendingMapPoint.lng.toFixed(6));
    }
  }, [pendingMapPoint, mapPickMode]);

  const draftPinRevealUrl = useMemo(() => {
    const payload = qrCode.trim();
    if (!payload || !appOrigin || !isValidQuestPayload(payload)) {
      return "";
    }

    return `${appOrigin}${buildPinRevealPath(payload)}`;
  }, [appOrigin, qrCode]);

  const draftTriggerEndpoint = useMemo(() => {
    const payload = qrCode.trim();
    if (!payload || !appOrigin || !isValidQuestPayload(payload)) {
      return "";
    }

    return `${appOrigin}${buildTriggerPath(payload)}`;
  }, [appOrigin, qrCode]);

  useEffect(() => {
    if (!draftPinRevealUrl) {
      setDraftQrPreview(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const qr = await import("qrcode");
        const image = await qr.toDataURL(draftPinRevealUrl, {
          width: 220,
          margin: 1
        });

        if (!cancelled) {
          setDraftQrPreview(image);
        }
      } catch {
        if (!cancelled) {
          setDraftQrPreview(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [draftPinRevealUrl]);

  useEffect(() => {
    if (!isAdmin || !appOrigin || missions.length === 0) {
      setMissionQrPreviews({});
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const qr = await import("qrcode");
        const nextPreviews: Record<string, string> = {};

        for (const mission of missions) {
          const revealUrl = `${appOrigin}${buildPinRevealPath(mission.qrCode)}`;
          nextPreviews[mission.id] = await qr.toDataURL(revealUrl, {
            width: 150,
            margin: 1
          });
        }

        if (!cancelled) {
          setMissionQrPreviews(nextPreviews);
        }
      } catch {
        if (!cancelled) {
          setMissionQrPreviews({});
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [appOrigin, isAdmin, missions]);

  const doLogin = async () => {
    try {
      setBusy(true);
      setError(null);
      await onLogin(password);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value: string) => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setError(null);
    } catch {
      setError("Clipboard copy failed.");
    }
  };

  const generatePayload = () => {
    setQrCode(generateQuestPayload());
    setError(null);
  };

  const addLocation = () => {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    const parsedRadius = radius.trim() === "" ? DEFAULT_LOCATION_RADIUS_METERS : Number(radius);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || !Number.isFinite(parsedRadius)) {
      setError("Latitude, longitude and radius must be valid numbers.");
      return;
    }

    if (parsedRadius <= 0) {
      setError("Radius must be greater than 0.");
      return;
    }

    setLocations((current) => [...current, { lat: parsedLat, lng: parsedLng, radius: parsedRadius }]);
    setError(null);
  };

  const applyPickedPointToMapCenter = () => {
    if (!pendingMapPoint) {
      setError("Click the map first to pick map center coordinates.");
      return;
    }

    setMapCenterLat(pendingMapPoint.lat.toFixed(6));
    setMapCenterLng(pendingMapPoint.lng.toFixed(6));
    setError(null);
  };

  const removeLocation = (index: number) => {
    setLocations((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const submitMission = async () => {
    const normalizedPayload = qrCode.trim();
    const trimmedCenterLat = mapCenterLat.trim();
    const trimmedCenterLng = mapCenterLng.trim();

    if (!name.trim() || !normalizedPayload) {
      setError("Mission name and payload are required.");
      return;
    }

    if (!isValidQuestPayload(normalizedPayload)) {
      setError("Mission payload must be exactly 6 digits.");
      return;
    }

    if (locations.length === 0) {
      setError("Add at least one location circle.");
      return;
    }

    let mapCenter: { lat: number; lng: number } | undefined;
    if (trimmedCenterLat || trimmedCenterLng) {
      const parsedMapCenterLat = Number(trimmedCenterLat);
      const parsedMapCenterLng = Number(trimmedCenterLng);

      if (!Number.isFinite(parsedMapCenterLat) || !Number.isFinite(parsedMapCenterLng)) {
        setError("Map center latitude and longitude must be valid numbers.");
        return;
      }

      mapCenter = {
        lat: parsedMapCenterLat,
        lng: parsedMapCenterLng
      };
    }

    try {
      setBusy(true);
      setError(null);
      await onCreateMission({
        name: name.trim(),
        qrCode: normalizedPayload,
        mapCenter,
        locations
      });
      setName("");
      setQrCode("");
      setMapCenterLat("");
      setMapCenterLng("");
      setLocations([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create mission");
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <section className="panel">
        <h2>Admin Login</h2>
        <p className="muted">App works anonymously. Login only for mission management.</p>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="button" onClick={() => void doLogin()} disabled={busy || !password}>
          {busy ? "Checking..." : "Login"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="admin-header">
        <h2>Admin Panel</h2>
        <button type="button" onClick={() => void onLogout()} disabled={busy}>
          Logout
        </button>
      </div>

      <div className="admin-form">
        <input
          type="text"
          placeholder="Mission name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="Mission payload (6 digits)"
          value={qrCode}
          onChange={(event) => setQrCode(sanitizeQuestPayload(event.target.value))}
        />

        <div className="inline-actions">
          <button type="button" onClick={generatePayload}>
            Generate 6 Digits
          </button>
          <button type="button" onClick={() => void copyText(draftPinRevealUrl)} disabled={!draftPinRevealUrl}>
            Copy QR URL
          </button>
          <button type="button" onClick={() => void copyText(draftTriggerEndpoint)} disabled={!draftTriggerEndpoint}>
            Copy Endpoint
          </button>
        </div>

        {draftPinRevealUrl && (
          <div className="endpoint-box">
            <span className="muted">QR reveal URL:</span>
            <code>{draftPinRevealUrl}</code>
          </div>
        )}

        {draftTriggerEndpoint && (
          <div className="endpoint-box">
            <span className="muted">Trigger endpoint:</span>
            <code>{draftTriggerEndpoint}</code>
          </div>
        )}

        {draftQrPreview && (
          <div className="qr-preview-box">
            <Image
              src={draftQrPreview}
              alt="Generated mission QR preview"
              width={180}
              height={180}
              unoptimized
            />
            <span className="muted">Scan opens a centered page showing only the PIN payload.</span>
          </div>
        )}

        <div className="location-grid">
          <input type="text" placeholder="Latitude" value={lat} onChange={(event) => setLat(event.target.value)} />
          <input type="text" placeholder="Longitude" value={lng} onChange={(event) => setLng(event.target.value)} />
          <input
            type="text"
            placeholder="Radius meters"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
          />
        </div>

        <div className="inline-actions">
          <button type="button" onClick={addLocation}>
            Add Circle Location
          </button>
          <button type="button" onClick={() => onMapPickModeChange(!mapPickMode)}>
            {mapPickMode ? "Disable" : "Enable"} map click picker
          </button>
        </div>

        <h3>Map Center For This Quest</h3>
        <div className="location-grid">
          <input
            type="text"
            placeholder="Map center latitude"
            value={mapCenterLat}
            onChange={(event) => setMapCenterLat(event.target.value)}
          />
          <input
            type="text"
            placeholder="Map center longitude"
            value={mapCenterLng}
            onChange={(event) => setMapCenterLng(event.target.value)}
          />
          <button type="button" onClick={applyPickedPointToMapCenter}>
            Use Picked Point
          </button>
        </div>

        {locations.length > 0 && (
          <ul className="location-list">
            {locations.map((location, index) => (
              <li key={`${location.lat}-${location.lng}-${index}`}>
                <span>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)} ({location.radius}m)
                </span>
                <button type="button" onClick={() => removeLocation(index)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={() => void submitMission()} disabled={busy}>
          {busy ? "Saving..." : "Save Mission"}
        </button>
      </div>

      <h3>Existing Missions</h3>
      {missions.length === 0 && <p className="muted">No missions defined yet.</p>}

      {missions.length > 0 && (
        <ul className="mission-list">
          {missions.map((mission) => {
            const endpoint = appOrigin ? `${appOrigin}${buildTriggerPath(mission.qrCode)}` : "";
            const revealUrl = appOrigin ? `${appOrigin}${buildPinRevealPath(mission.qrCode)}` : "";
            const qrPreview = missionQrPreviews[mission.id];
            const fallbackCenter = mission.locations[0]
              ? { lat: mission.locations[0].lat, lng: mission.locations[0].lng }
              : null;

            return (
              <li key={mission.id} className="mission-item">
                <div className="mission-top-row">
                  <span>
                    {mission.name} ({mission.locations.length} circles)
                  </span>
                  <button
                    type="button"
                    onClick={() => void onDeleteMission(mission.id)}
                    disabled={busy}
                    className="danger"
                  >
                    Delete
                  </button>
                </div>

                <div className="endpoint-box">
                  <span className="muted">Payload:</span>
                  <code>{mission.qrCode}</code>
                </div>

                {mission.mapCenter && (
                  <div className="endpoint-box">
                    <span className="muted">Map center:</span>
                    <code>
                      {mission.mapCenter.lat.toFixed(6)}, {mission.mapCenter.lng.toFixed(6)}
                    </code>
                  </div>
                )}

                {revealUrl && (
                  <div className="endpoint-box">
                    <span className="muted">QR reveal URL:</span>
                    <code>{revealUrl}</code>
                  </div>
                )}

                {endpoint && (
                  <div className="endpoint-box">
                    <span className="muted">Trigger endpoint:</span>
                    <code>{endpoint}</code>
                  </div>
                )}

                <div className="inline-actions">
                  <button type="button" onClick={() => void copyText(mission.qrCode)}>
                    Copy Payload
                  </button>
                  <button type="button" onClick={() => void copyText(revealUrl)} disabled={!revealUrl}>
                    Copy QR URL
                  </button>
                  <button type="button" onClick={() => void copyText(endpoint)} disabled={!endpoint}>
                    Copy Endpoint
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const centerToUse = mission.mapCenter ?? fallbackCenter;
                      if (!centerToUse) {
                        setError("Mission has no coordinates to center the map.");
                        return;
                      }
                      onFocusMissionMap(centerToUse);
                    }}
                  >
                    Switch Map
                  </button>
                </div>

                {qrPreview && (
                  <div className="qr-preview-box">
                    <Image src={qrPreview} alt={`QR code for ${mission.name}`} width={140} height={140} unoptimized />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
