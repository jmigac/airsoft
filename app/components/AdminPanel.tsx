"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  formatCETDateTime,
  isValidCETDateTime,
  normalizeCETDateTimeInput
} from "@/lib/mission-time";
import { MAP_MARKER_META } from "@/lib/map-markers";
import { generateQuestPayload, isValidQuestPayload, sanitizeQuestPayload } from "@/lib/payload";
import { buildPinRevealPath, buildTriggerPath } from "@/lib/qr";
import {
  MAP_MARKER_TYPES,
  MapCenter,
  MapMarker,
  MapMarkerType,
  MapShape,
  MapShapeDraft,
  Mission
} from "@/lib/types";

export type MissionPayload = {
  name: string;
  qrCode: string;
  mapCenter?: { lat: number; lng: number };
  timeWindowCET?: { startsAtCET: string; endsAtCET: string };
  locations: Array<{ lat: number; lng: number; radius: number }>;
};

const DEFAULT_LOCATION_RADIUS_METERS = 15;

type Props = {
  isAdmin: boolean;
  missions: Mission[];
  mapMarkers: MapMarker[];
  mapShapes: MapShape[];
  defaultMapCenter: MapCenter | null;
  mapPickMode: boolean;
  pendingMapPoint: { lat: number; lng: number } | null;
  onMapPickModeChange: (enabled: boolean) => void;
  onLogin: (password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onUpdateDefaultMapCenter: (center: MapCenter | null) => Promise<void>;
  onCreateMapMarker: (payload: {
    type?: string;
    name: string;
    color: string;
    lat: number;
    lng: number;
  }) => Promise<void>;
  onDeleteMapMarker: (markerId: string) => Promise<void>;
  onCreateMapShape: (payload: {
    label: string;
    color: string;
    opacity: number;
    points: Array<{ lat: number; lng: number }>;
  }) => Promise<void>;
  onDeleteMapShape: (shapeId: string) => Promise<void>;
  onCreateMission: (payload: MissionPayload) => Promise<void>;
  onDeleteMission: (missionId: string) => Promise<void>;
  onFocusMissionMap: (center: { lat: number; lng: number }) => void;
  onShapeDraftChange: (draft: MapShapeDraft | null) => void;
};

export default function AdminPanel({
  isAdmin,
  missions,
  mapMarkers,
  mapShapes,
  defaultMapCenter,
  mapPickMode,
  pendingMapPoint,
  onMapPickModeChange,
  onLogin,
  onLogout,
  onUpdateDefaultMapCenter,
  onCreateMapMarker,
  onDeleteMapMarker,
  onCreateMapShape,
  onDeleteMapShape,
  onCreateMission,
  onDeleteMission,
  onFocusMissionMap,
  onShapeDraftChange
}: Props) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [mapCenterLat, setMapCenterLat] = useState("");
  const [mapCenterLng, setMapCenterLng] = useState("");
  const [defaultMapCenterLat, setDefaultMapCenterLat] = useState("");
  const [defaultMapCenterLng, setDefaultMapCenterLng] = useState("");
  const [markerName, setMarkerName] = useState("Village");
  const [markerColor, setMarkerColor] = useState("#f0a020");
  const [markerPresetType, setMarkerPresetType] = useState<MapMarkerType>("village");
  const [shapeLabel, setShapeLabel] = useState("Zone");
  const [shapeColor, setShapeColor] = useState("#5f676c");
  const [shapeOpacity, setShapeOpacity] = useState("0.35");
  const [shapePoints, setShapePoints] = useState<Array<{ lat: number; lng: number }>>([]);
  const [useTimeWindowCET, setUseTimeWindowCET] = useState(false);
  const [startsAtCET, setStartsAtCET] = useState("");
  const [endsAtCET, setEndsAtCET] = useState("");
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

  useEffect(() => {
    if (!defaultMapCenter) {
      setDefaultMapCenterLat("");
      setDefaultMapCenterLng("");
      return;
    }

    setDefaultMapCenterLat(defaultMapCenter.lat.toFixed(6));
    setDefaultMapCenterLng(defaultMapCenter.lng.toFixed(6));
  }, [defaultMapCenter]);

  useEffect(() => {
    if (shapePoints.length === 0) {
      onShapeDraftChange(null);
      return;
    }

    const parsedOpacity = Number(shapeOpacity);
    const normalizedOpacity = Number.isFinite(parsedOpacity) ? Math.min(1, Math.max(0, parsedOpacity)) : 0.35;

    onShapeDraftChange({
      label: shapeLabel.trim() || "Draft shape",
      color: shapeColor,
      opacity: normalizedOpacity,
      points: shapePoints
    });
  }, [onShapeDraftChange, shapeColor, shapeLabel, shapeOpacity, shapePoints]);

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

  const applyPickedPointToDefaultMapCenter = () => {
    if (!pendingMapPoint) {
      setError("Click the map first to pick default map center coordinates.");
      return;
    }

    setDefaultMapCenterLat(pendingMapPoint.lat.toFixed(6));
    setDefaultMapCenterLng(pendingMapPoint.lng.toFixed(6));
    setError(null);
  };

  const saveDefaultMapCenter = async () => {
    const trimmedLat = defaultMapCenterLat.trim();
    const trimmedLng = defaultMapCenterLng.trim();

    if (!trimmedLat && !trimmedLng) {
      try {
        setBusy(true);
        setError(null);
        await onUpdateDefaultMapCenter(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not reset default map center.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsedLat = Number(trimmedLat);
    const parsedLng = Number(trimmedLng);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      setError("Default map center latitude and longitude must be valid numbers.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await onUpdateDefaultMapCenter({
        lat: parsedLat,
        lng: parsedLng
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save default map center.");
    } finally {
      setBusy(false);
    }
  };

  const applyMarkerPreset = (markerType: MapMarkerType) => {
    setMarkerPresetType(markerType);
    setMarkerName(MAP_MARKER_META[markerType].label);
    setMarkerColor(MAP_MARKER_META[markerType].color);
  };

  const placeMapMarkerAtPickedPoint = async () => {
    if (!pendingMapPoint) {
      setError("Click the map first to pick marker coordinates.");
      return;
    }

    if (!markerName.trim()) {
      setError("Marker name is required.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await onCreateMapMarker({
        type: markerPresetType,
        name: markerName.trim(),
        color: markerColor,
        lat: pendingMapPoint.lat,
        lng: pendingMapPoint.lng
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place map marker.");
    } finally {
      setBusy(false);
    }
  };

  const removeMapMarker = async (markerId: string) => {
    try {
      setBusy(true);
      setError(null);
      await onDeleteMapMarker(markerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove map marker.");
    } finally {
      setBusy(false);
    }
  };

  const addPickedPointToShape = () => {
    if (!pendingMapPoint) {
      setError("Click the map first to pick shape point coordinates.");
      return;
    }

    setShapePoints((current) => [
      ...current,
      { lat: pendingMapPoint.lat, lng: pendingMapPoint.lng }
    ]);
    setError(null);
  };

  const undoLastShapePoint = () => {
    setShapePoints((current) => current.slice(0, -1));
  };

  const clearShapeDraft = () => {
    setShapePoints([]);
    setError(null);
  };

  const saveShape = async () => {
    const trimmedLabel = shapeLabel.trim();
    const parsedOpacity = Number(shapeOpacity);

    if (!trimmedLabel) {
      setError("Shape label is required.");
      return;
    }

    if (!Number.isFinite(parsedOpacity) || parsedOpacity < 0 || parsedOpacity > 1) {
      setError("Shape transparency must be between 0 and 1.");
      return;
    }

    if (shapePoints.length < 3) {
      setError("Shape requires at least 3 points.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await onCreateMapShape({
        label: trimmedLabel,
        color: shapeColor,
        opacity: parsedOpacity,
        points: shapePoints
      });
      setShapePoints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save shape.");
    } finally {
      setBusy(false);
    }
  };

  const removeShape = async (shapeId: string) => {
    try {
      setBusy(true);
      setError(null);
      await onDeleteMapShape(shapeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove shape.");
    } finally {
      setBusy(false);
    }
  };

  const submitMission = async () => {
    const normalizedPayload = qrCode.trim();
    const trimmedCenterLat = mapCenterLat.trim();
    const trimmedCenterLng = mapCenterLng.trim();
    const normalizedStartsAtCET = normalizeCETDateTimeInput(startsAtCET);
    const normalizedEndsAtCET = normalizeCETDateTimeInput(endsAtCET);

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

    let timeWindowCET: { startsAtCET: string; endsAtCET: string } | undefined;
    if (useTimeWindowCET) {
      if (!normalizedStartsAtCET || !normalizedEndsAtCET) {
        setError("For time-critical mission, provide both start and end in CET.");
        return;
      }

      if (!isValidCETDateTime(normalizedStartsAtCET) || !isValidCETDateTime(normalizedEndsAtCET)) {
        setError("CET start/end must be valid date+time values.");
        return;
      }

      if (normalizedStartsAtCET >= normalizedEndsAtCET) {
        setError("CET start must be before CET end.");
        return;
      }

      timeWindowCET = {
        startsAtCET: normalizedStartsAtCET,
        endsAtCET: normalizedEndsAtCET
      };
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
        timeWindowCET,
        locations
      });
      setName("");
      setQrCode("");
      setMapCenterLat("");
      setMapCenterLng("");
      setUseTimeWindowCET(false);
      setStartsAtCET("");
      setEndsAtCET("");
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
        <section className="admin-section">
          <h3>1. Map Settings</h3>
          <p className="muted">Set the visitor start position and toggle map click picker.</p>

          <div className="location-grid">
            <input
              type="text"
              placeholder="Default latitude"
              value={defaultMapCenterLat}
              onChange={(event) => setDefaultMapCenterLat(event.target.value)}
            />
            <input
              type="text"
              placeholder="Default longitude"
              value={defaultMapCenterLng}
              onChange={(event) => setDefaultMapCenterLng(event.target.value)}
            />
            <button type="button" onClick={applyPickedPointToDefaultMapCenter}>
              Use Picked Point
            </button>
          </div>

          <div className="inline-actions">
            <button type="button" onClick={() => void saveDefaultMapCenter()} disabled={busy}>
              {busy ? "Saving..." : "Save Start Position"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDefaultMapCenterLat("");
                setDefaultMapCenterLng("");
                setError(null);
              }}
              disabled={busy}
            >
              Clear Fields
            </button>
            <button type="button" onClick={() => onMapPickModeChange(!mapPickMode)}>
              {mapPickMode ? "Disable" : "Enable"} map click picker
            </button>
          </div>

          {defaultMapCenter && (
            <p className="muted">
              Current visitor map start: {defaultMapCenter.lat.toFixed(6)}, {defaultMapCenter.lng.toFixed(6)}
            </p>
          )}
        </section>

        <section className="admin-section">
          <h3>2. Tactical Icons</h3>
          <p className="muted">Pick a point from map, enter icon name, choose color, then add marker.</p>

          <div className="inline-actions">
            <button type="button" onClick={() => onMapPickModeChange(!mapPickMode)}>
              {mapPickMode ? "Disable" : "Select Point From Map"}
            </button>
          </div>

          {mapPickMode && (
            <p className="muted">Map point picker active: click on the map to choose marker coordinates.</p>
          )}

          <input
            type="text"
            disabled
            value={
              pendingMapPoint
                ? `${pendingMapPoint.lat.toFixed(6)}, ${pendingMapPoint.lng.toFixed(6)}`
                : "No picked point yet"
            }
          />

          <div className="location-grid">
            <input
              type="text"
              placeholder="Icon name (shown inside marker)"
              value={markerName}
              onChange={(event) => setMarkerName(event.target.value)}
            />
            <input type="color" value={markerColor} onChange={(event) => setMarkerColor(event.target.value)} />
            <button type="button" onClick={() => void placeMapMarkerAtPickedPoint()} disabled={busy}>
              Add Marker
            </button>
          </div>

          <div className="map-marker-btn-grid">
            {MAP_MARKER_TYPES.map((type) => {
              const meta = MAP_MARKER_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  className="map-marker-type-btn"
                  style={{ background: meta.color, borderColor: meta.color, color: "#fff" }}
                  onClick={() => applyMarkerPreset(type)}
                  disabled={busy}
                >
                  Preset {meta.label}
                </button>
              );
            })}
          </div>

          {mapMarkers.length === 0 && <p className="muted">No tactical icons placed yet.</p>}
          {mapMarkers.length > 0 && (
            <ul className="location-list">
              {mapMarkers.map((marker) => {
                return (
                  <li key={marker.id}>
                    <span>
                      <span className="map-marker-legend-dot" style={{ background: marker.color }} />
                      {marker.name}: {marker.lat.toFixed(6)}, {marker.lng.toFixed(6)}
                    </span>
                    <button type="button" onClick={() => void removeMapMarker(marker.id)} disabled={busy}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="admin-section">
          <h3>3. Map Shapes</h3>
          <p className="muted">Pick points from map, then draw polygon with color, transparency and label.</p>

          <div className="inline-actions">
            <button type="button" onClick={() => onMapPickModeChange(!mapPickMode)}>
              {mapPickMode ? "Disable" : "Select Point From Map"}
            </button>
          </div>

          {mapPickMode && (
            <p className="muted">Map point picker active: click on the map, then use Add Picked Point.</p>
          )}

          <div className="location-grid">
            <input
              type="text"
              placeholder="Shape label"
              value={shapeLabel}
              onChange={(event) => setShapeLabel(event.target.value)}
            />
            <input type="color" value={shapeColor} onChange={(event) => setShapeColor(event.target.value)} />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              placeholder="Transparency"
              value={shapeOpacity}
              onChange={(event) => setShapeOpacity(event.target.value)}
            />
          </div>

          <div className="inline-actions">
            <button type="button" onClick={addPickedPointToShape}>
              Add Picked Point
            </button>
            <button type="button" onClick={undoLastShapePoint} disabled={shapePoints.length === 0}>
              Undo Last Point
            </button>
            <button type="button" onClick={clearShapeDraft} disabled={shapePoints.length === 0}>
              Clear Draft
            </button>
            <button type="button" onClick={() => void saveShape()} disabled={busy}>
              {busy ? "Saving..." : "Save Shape"}
            </button>
          </div>

          {shapePoints.length > 0 && (
            <ul className="location-list">
              {shapePoints.map((point, index) => (
                <li key={`${point.lat}-${point.lng}-${index}`}>
                  <span>
                    Point {index + 1}: {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {mapShapes.length === 0 && <p className="muted">No map shapes drawn yet.</p>}
          {mapShapes.length > 0 && (
            <ul className="location-list">
              {mapShapes.map((shape) => (
                <li key={shape.id}>
                  <span>
                    <span className="map-marker-legend-dot" style={{ background: shape.color }} />
                    {shape.label} ({shape.points.length} pts, alpha {shape.opacity.toFixed(2)})
                  </span>
                  <button type="button" onClick={() => void removeShape(shape.id)} disabled={busy}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-section">
          <h3>4. Mission Builder</h3>
          <p className="muted">Create mission payload, locations, time window and quest map center.</p>

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
            <button
              type="button"
              onClick={() => void copyText(draftTriggerEndpoint)}
              disabled={!draftTriggerEndpoint}
            >
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
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={useTimeWindowCET}
              onChange={(event) => setUseTimeWindowCET(event.target.checked)}
            />
            <span>Time-critical mission (redeemable only in CET interval)</span>
          </label>

          {useTimeWindowCET && (
            <div className="time-window-grid">
              <label>
                <span className="muted">Start (CET)</span>
                <input
                  type="datetime-local"
                  value={startsAtCET}
                  onChange={(event) => setStartsAtCET(normalizeCETDateTimeInput(event.target.value))}
                />
              </label>
              <label>
                <span className="muted">End (CET)</span>
                <input
                  type="datetime-local"
                  value={endsAtCET}
                  onChange={(event) => setEndsAtCET(normalizeCETDateTimeInput(event.target.value))}
                />
              </label>
            </div>
          )}

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
        </section>
      </div>

      <section className="admin-section">
        <h3>5. Existing Missions</h3>
        <p className="muted">Review, copy payload links, focus map, or delete existing missions.</p>

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

                  {mission.timeWindowCET && (
                    <div className="endpoint-box">
                      <span className="muted">Redeem window (CET):</span>
                      <code>
                        {formatCETDateTime(mission.timeWindowCET.startsAtCET)} -{" "}
                        {formatCETDateTime(mission.timeWindowCET.endsAtCET)}
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
      </section>

      {error && <p className="error">{error}</p>}
    </section>
  );
}
