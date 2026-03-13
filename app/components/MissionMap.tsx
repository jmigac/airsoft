"use client";

import { divIcon, point as leafletPoint, type Map as LeafletMap } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents
} from "react-leaflet";
import { MAP_SIGNAL_META, MAP_SIGNAL_DURATION_MS } from "@/lib/map-signals";
import { getMarkerIconOption, MAP_MARKER_META } from "@/lib/map-markers";
import { formatCETDateTime, isMissionExpired } from "@/lib/mission-time";
import {
  Completion,
  MapCenter,
  GamePlayer,
  MapMarker,
  MapShape,
  MapShapeDraft,
  MapSignal,
  MapSignalType,
  Mission,
  Team
} from "@/lib/types";

type Props = {
  missions: Mission[];
  completions: Completion[];
  players: GamePlayer[];
  mapMarkers: MapMarker[];
  mapShapes: MapShape[];
  mapSignals: MapSignal[];
  selectedTeam: Team | null;
  mapPickMode?: boolean;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  onCreateQuickSignal?: (payload: { type: MapSignalType; lat: number; lng: number }) => Promise<void>;
  defaultCenter?: MapCenter | null;
  centerOverride?: { lat: number; lng: number } | null;
  draftShape?: MapShapeDraft | null;
  showCenterOnPlayerControl?: boolean;
  currentPlayerLocation?: MapCenter | null;
  showZoomControls?: boolean;
};

type SignalGestureMenu = {
  lat: number;
  lng: number;
  anchorX: number;
  anchorY: number;
  selectedType: MapSignalType | null;
};

type PressStartPayload = {
  lat: number;
  lng: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
};

type PressMovePayload = {
  clientX: number;
  clientY: number;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const SIGNAL_LONG_PRESS_MS = 420;
const SIGNAL_CANCEL_MOVE_PX = 12;
const SIGNAL_SELECT_DISTANCE_PX = 42;
const SIGNAL_MENU_RADIUS_PX = 76;

const SIGNAL_MENU_OPTIONS: Array<{ type: MapSignalType; dx: number; dy: number }> = [
  { type: "info", dx: 0, dy: -SIGNAL_MENU_RADIUS_PX },
  { type: "danger", dx: -SIGNAL_MENU_RADIUS_PX * 0.82, dy: SIGNAL_MENU_RADIUS_PX * 0.6 },
  { type: "intel", dx: SIGNAL_MENU_RADIUS_PX * 0.82, dy: SIGNAL_MENU_RADIUS_PX * 0.6 }
];

function getClientPoint(event: MouseEvent | TouchEvent) {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) {
      return null;
    }

    return {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  return {
    x: event.clientX,
    y: event.clientY
  };
}

function MapClickHandler({
  mapPickMode,
  onMapClick,
  onPressStart,
  onPressMove,
  onPressEnd
}: {
  mapPickMode: boolean;
  onMapClick: (point: { lat: number; lng: number }) => void;
  onPressStart?: (payload: PressStartPayload) => void;
  onPressMove?: (payload: PressMovePayload) => void;
  onPressEnd?: () => void;
}) {
  useMapEvents({
    click(event) {
      if (mapPickMode) {
        onMapClick({
          lat: event.latlng.lat,
          lng: event.latlng.lng
        });
      }
    },
    mousedown(event) {
      const point = getClientPoint(event.originalEvent);
      if (!point || !onPressStart) {
        return;
      }
      onPressStart({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
        clientX: point.x,
        clientY: point.y,
        target: event.originalEvent.target
      });
    },
    mousemove(event) {
      const point = getClientPoint(event.originalEvent);
      if (!point || !onPressMove) {
        return;
      }
      onPressMove({ clientX: point.x, clientY: point.y });
    },
    mouseup() {
      onPressEnd?.();
    }
  });

  return null;
}

function MapCenterController({ center }: { center: { lat: number; lng: number } | null }) {
  const map = useMap();

  useEffect(() => {
    if (!center) {
      return;
    }

    map.flyTo([center.lat, center.lng], map.getZoom(), {
      duration: 0.5
    });
  }, [center, map]);

  return null;
}

function MapInstanceBridge({ onMap }: { onMap: (map: LeafletMap) => void }) {
  const map = useMap();

  useEffect(() => {
    onMap(map);
  }, [map, onMap]);

  return null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export default function MissionMap({
  missions,
  completions,
  players,
  mapMarkers,
  mapShapes,
  mapSignals,
  selectedTeam,
  mapPickMode = false,
  onMapClick = () => undefined,
  onCreateQuickSignal,
  defaultCenter = null,
  centerOverride = null,
  draftShape = null,
  showCenterOnPlayerControl = false,
  currentPlayerLocation = null,
  showZoomControls = true
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const [signalGestureMenu, setSignalGestureMenu] = useState<SignalGestureMenu | null>(null);
  const [signalPickerBusy, setSignalPickerBusy] = useState(false);
  const [signalPickerError, setSignalPickerError] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const signalLongPressTimer = useRef<number | null>(null);
  const pressStartRef = useRef<PressStartPayload | null>(null);

  const isFullscreenSupported = useMemo(() => {
    if (typeof document === "undefined") {
      return false;
    }

    const documentWithWebkit = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;
    return (
      typeof document.exitFullscreen === "function" ||
      typeof documentWithWebkit.webkitExitFullscreen === "function" ||
      typeof root.requestFullscreen === "function" ||
      typeof root.webkitRequestFullscreen === "function"
    );
  }, []);

  const showFullscreenToggle = isMobileViewport && isFullscreenSupported;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 1024px) and (pointer: coarse)");
    const sync = () => {
      setIsMobileViewport(mobileQuery.matches);
    };

    sync();
    mobileQuery.addEventListener("change", sync);
    return () => {
      mobileQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const syncFullscreen = () => {
      const documentWithWebkit = document as FullscreenDocument;
      setIsFullscreen(Boolean(document.fullscreenElement ?? documentWithWebkit.webkitFullscreenElement));

      if (mapInstance) {
        // Leaflet needs explicit resize when container dimensions change in fullscreen transitions.
        window.setTimeout(() => {
          mapInstance.invalidateSize();
        }, 120);
      }
    };

    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen as EventListener);
    };
  }, [mapInstance]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 5_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!onCreateQuickSignal || !selectedTeam) {
      setSignalGestureMenu(null);
      setSignalPickerBusy(false);
      setSignalPickerError(null);
    }
  }, [onCreateQuickSignal, selectedTeam]);

  useEffect(() => {
    if (!mapInstance) {
      return;
    }

    if (signalGestureMenu) {
      mapInstance.dragging.disable();
      mapInstance.doubleClickZoom.disable();
      mapInstance.boxZoom.disable();
      return;
    }

    mapInstance.dragging.enable();
    mapInstance.doubleClickZoom.enable();
    mapInstance.boxZoom.enable();
  }, [mapInstance, signalGestureMenu]);

  const completedMissionIds = new Set(
    completions
      .filter((completion) => (selectedTeam ? completion.team === selectedTeam : true))
      .map((completion) => completion.missionId)
  );

  const center: [number, number] = centerOverride
    ? [centerOverride.lat, centerOverride.lng]
    : defaultCenter
      ? [defaultCenter.lat, defaultCenter.lng]
    : [46.245562, 16.1102002];
  const markerIcons = useMemo(
    () =>
      mapMarkers.reduce<Record<string, ReturnType<typeof divIcon>>>((icons, marker) => {
        const markerText = marker.name.trim() || "Marker";
        const iconGlyph =
          getMarkerIconOption(marker.icon)?.glyph ??
          (marker.type ? getMarkerIconOption(MAP_MARKER_META[marker.type].iconToken)?.glyph : null) ??
          null;
        const markerWidth = Math.max(46, Math.ceil(markerText.length * 8.2) + (iconGlyph ? 42 : 18));
        icons[marker.id] = divIcon({
          className: "military-marker-wrapper",
          html: `<span class="military-marker-badge" style="background:${marker.color};">${
            iconGlyph ? `<span class="military-marker-glyph">${escapeHtml(iconGlyph)}</span>` : ""
          }<span>${escapeHtml(markerText)}</span></span>`,
          iconSize: [markerWidth, 28],
          iconAnchor: [Math.round(markerWidth / 2), 14]
        });
        return icons;
      }, {}),
    [mapMarkers]
  );
  const activeMapSignals = useMemo(
    () =>
      mapSignals.filter(
        (signal) =>
          Date.parse(signal.expiresAt) > now.getTime() &&
          (selectedTeam ? signal.team === selectedTeam : true)
      ),
    [mapSignals, now, selectedTeam]
  );
  const activePlayerLocations = useMemo(
    () =>
      players.filter(
        (player) =>
          player.location &&
          Date.parse(player.location.updatedAt) > now.getTime() - 75_000 &&
          (selectedTeam ? player.team === selectedTeam : true)
      ),
    [players, now, selectedTeam]
  );
  const signalIcons = useMemo(
    () =>
      activeMapSignals.reduce<Record<string, ReturnType<typeof divIcon>>>((icons, signal) => {
        const signalMeta = MAP_SIGNAL_META[signal.type];
        icons[signal.id] = divIcon({
          className: "quick-signal-marker-wrapper",
          html: `<span class="quick-signal-badge quick-signal-${signal.team}" style="background:${signalMeta.color};">${escapeHtml(signalMeta.shortLabel)}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        return icons;
      }, {}),
    [activeMapSignals]
  );

  const signalGestureEnabled = Boolean(onCreateQuickSignal && selectedTeam);

  const clearSignalLongPressTimer = () => {
    if (signalLongPressTimer.current !== null) {
      window.clearTimeout(signalLongPressTimer.current);
      signalLongPressTimer.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearSignalLongPressTimer();
    };
  }, []);

  const toLocalPoint = (clientX: number, clientY: number) => {
    const rect = mapWrapRef.current?.getBoundingClientRect();
    if (!rect) {
      return null;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
  };

  const findHoveredSignalType = (menu: SignalGestureMenu, clientX: number, clientY: number): MapSignalType | null => {
    const local = toLocalPoint(clientX, clientY);
    if (!local) {
      return null;
    }

    let selected: MapSignalType | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const option of SIGNAL_MENU_OPTIONS) {
      const optionX = menu.anchorX + option.dx;
      const optionY = menu.anchorY + option.dy;
      const distance = Math.hypot(local.x - optionX, local.y - optionY);
      if (distance < SIGNAL_SELECT_DISTANCE_PX && distance < bestDistance) {
        bestDistance = distance;
        selected = option.type;
      }
    }

    return selected;
  };

  const startSignalGesture = (payload: PressStartPayload) => {
    if (!signalGestureEnabled) {
      return;
    }

    if (signalPickerBusy) {
      return;
    }

    if (payload.target instanceof HTMLElement) {
      if (
        payload.target.closest(".leaflet-control") ||
        payload.target.closest(".leaflet-popup") ||
        payload.target.closest(".map-picker-hint")
      ) {
        return;
      }
    }

    clearSignalLongPressTimer();
    pressStartRef.current = payload;

    signalLongPressTimer.current = window.setTimeout(() => {
      const start = pressStartRef.current;
      if (!start) {
        return;
      }

      const local = toLocalPoint(start.clientX, start.clientY);
      if (!local) {
        return;
      }

      const clampedX = Math.max(96, Math.min(local.width - 96, local.x));
      const clampedY = Math.max(96, Math.min(local.height - 96, local.y));

      setSignalGestureMenu({
        lat: start.lat,
        lng: start.lng,
        anchorX: clampedX,
        anchorY: clampedY,
        selectedType: null
      });
      setSignalPickerError(null);
    }, SIGNAL_LONG_PRESS_MS);
  };

  const moveSignalGesture = (payload: PressMovePayload) => {
    const start = pressStartRef.current;
    if (!start) {
      return;
    }

    if (!signalGestureMenu) {
      const distance = Math.hypot(payload.clientX - start.clientX, payload.clientY - start.clientY);
      if (distance > SIGNAL_CANCEL_MOVE_PX) {
        clearSignalLongPressTimer();
        pressStartRef.current = null;
      }
      return;
    }

    setSignalGestureMenu((current) => {
      if (!current) {
        return current;
      }
      const nextType = findHoveredSignalType(current, payload.clientX, payload.clientY);
      if (current.selectedType === nextType) {
        return current;
      }
      return { ...current, selectedType: nextType };
    });
  };

  const endSignalGesture = () => {
    clearSignalLongPressTimer();
    const activeMenu = signalGestureMenu;
    pressStartRef.current = null;

    if (!activeMenu) {
      return;
    }

    if (activeMenu.selectedType && !signalPickerBusy) {
      void placeQuickSignal(activeMenu.selectedType, activeMenu.lat, activeMenu.lng);
      return;
    }

    setSignalGestureMenu(null);
  };

  useEffect(() => {
    if (!signalGestureEnabled) {
      return;
    }

    const handleEnd = () => {
      endSignalGesture();
    };

    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);

    return () => {
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, [signalGestureEnabled, signalGestureMenu, signalPickerBusy]);

  useEffect(() => {
    if (!mapInstance || !signalGestureEnabled) {
      return;
    }

    const container = mapInstance.getContainer();

    const handleTouchStart = (event: TouchEvent) => {
      const point = getClientPoint(event);
      if (!point) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const latLng = mapInstance.containerPointToLatLng(
        leafletPoint(point.x - rect.left, point.y - rect.top)
      );

      startSignalGesture({
        lat: latLng.lat,
        lng: latLng.lng,
        clientX: point.x,
        clientY: point.y,
        target: event.target
      });
    };

    const handleTouchMove = (event: TouchEvent) => {
      const point = getClientPoint(event);
      if (!point) {
        return;
      }
      moveSignalGesture({ clientX: point.x, clientY: point.y });
    };

    const handleTouchEnd = () => {
      endSignalGesture();
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [mapInstance, signalGestureEnabled, signalGestureMenu, signalPickerBusy]);

  const placeQuickSignal = async (type: MapSignalType, lat: number, lng: number) => {
    if (!onCreateQuickSignal) {
      return;
    }

    try {
      setSignalPickerBusy(true);
      setSignalPickerError(null);
      await onCreateQuickSignal({
        type,
        lat,
        lng
      });
      setSignalGestureMenu(null);
    } catch (error) {
      setSignalPickerError(error instanceof Error ? error.message : "Could not place signal.");
    } finally {
      setSignalPickerBusy(false);
    }
  };

  const toggleFullscreen = async () => {
    if (!mapWrapRef.current) {
      return;
    }

    const documentWithWebkit = document as FullscreenDocument;
    const mapElement = mapWrapRef.current as FullscreenElement;
    const currentFullscreenElement = document.fullscreenElement ?? documentWithWebkit.webkitFullscreenElement;

    try {
      setFullscreenError(null);
      if (currentFullscreenElement) {
        if (typeof document.exitFullscreen === "function") {
          await document.exitFullscreen();
        } else if (typeof documentWithWebkit.webkitExitFullscreen === "function") {
          await documentWithWebkit.webkitExitFullscreen();
        }
        return;
      }

      if (typeof mapElement.requestFullscreen === "function") {
        await mapElement.requestFullscreen();
      } else if (typeof mapElement.webkitRequestFullscreen === "function") {
        await mapElement.webkitRequestFullscreen();
      } else {
        setFullscreenError("Fullscreen mode is not supported on this browser.");
      }
    } catch {
      setFullscreenError("Could not toggle fullscreen mode.");
    }
  };

  const centerMapOnCurrentPlayer = () => {
    if (!mapInstance || !currentPlayerLocation) {
      return;
    }

    mapInstance.flyTo([currentPlayerLocation.lat, currentPlayerLocation.lng], mapInstance.getZoom(), {
      duration: 0.45
    });
  };

  return (
    <div className="map-wrap-inner" ref={mapWrapRef}>
      <MapContainer
        center={center}
        zoom={19}
        className={`map-root ${signalGestureMenu ? "signal-picker-open" : ""}`}
        scrollWheelZoom
        zoomControl={showZoomControls}
      >
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        <MapCenterController center={centerOverride ?? defaultCenter} />
        <MapInstanceBridge onMap={setMapInstance} />
        <MapClickHandler
          mapPickMode={mapPickMode}
          onMapClick={onMapClick}
          onPressStart={startSignalGesture}
          onPressMove={moveSignalGesture}
          onPressEnd={endSignalGesture}
        />

        {mapMarkers.map((marker) => {
          return (
            <Marker
              key={marker.id}
              position={[marker.lat, marker.lng]}
              icon={markerIcons[marker.id]}
            >
              <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                {marker.name}
              </Tooltip>
              <Popup>
                <strong>{marker.name}</strong>
                <br />
                {marker.lat.toFixed(6)}, {marker.lng.toFixed(6)}
              </Popup>
            </Marker>
          );
        })}

        {mapShapes.map((shape) => {
          if (shape.points.length < 3) {
            return null;
          }

          return (
            <Polygon
              key={shape.id}
              positions={shape.points.map((point) => [point.lat, point.lng])}
              pathOptions={{
                color: shape.color,
                fillColor: shape.color,
                fillOpacity: shape.opacity
              }}
            >
              <Tooltip permanent direction="center" className="mission-circle-label" opacity={1}>
                {shape.label}
              </Tooltip>
              <Popup>
                <strong>{shape.label}</strong>
                <br />
                Color: {shape.color}
                <br />
                Transparency: {shape.opacity.toFixed(2)}
              </Popup>
            </Polygon>
          );
        })}

        {draftShape &&
          draftShape.points.map((point, index) => (
            <CircleMarker
              key={`draft-shape-point-${index}-${point.lat}-${point.lng}`}
              center={[point.lat, point.lng]}
              radius={5}
              pathOptions={{
                color: draftShape.color,
                fillColor: draftShape.color,
                fillOpacity: 1,
                weight: 2
              }}
            />
          ))}

        {draftShape && draftShape.points.length >= 2 && (
          <Polyline
            positions={draftShape.points.map((point) => [point.lat, point.lng])}
            pathOptions={{
              color: draftShape.color,
              opacity: 1,
              dashArray: "6 6",
              weight: 3
            }}
          />
        )}

        {draftShape && draftShape.points.length >= 3 && (
          <Polygon
            positions={draftShape.points.map((point) => [point.lat, point.lng])}
            pathOptions={{
              color: draftShape.color,
              fillColor: draftShape.color,
              fillOpacity: draftShape.opacity,
              dashArray: "6 6"
            }}
          >
            <Tooltip permanent direction="center" className="mission-circle-label" opacity={1}>
              Draft: {draftShape.label}
            </Tooltip>
          </Polygon>
        )}

        {missions.map((mission) =>
          mission.locations.map((location) => {
            const done = completedMissionIds.has(mission.id);
            const failed = !done && isMissionExpired(mission, now);
            const circleColor = done ? "#179b61" : failed ? "#cc2f2f" : "#ad6a1a";

            return (
              <Circle
                key={location.id}
                center={[location.lat, location.lng]}
                radius={location.radius}
                pathOptions={{
                  color: circleColor,
                  fillColor: circleColor,
                  fillOpacity: 0.25
                }}
              >
                <Tooltip permanent direction="center" className="mission-circle-label" opacity={1}>
                  {failed ? <span className="mission-failed-x">X</span> : mission.name}
                </Tooltip>
                <Popup>
                  <strong>{mission.name}</strong>
                  <br />
                  Type: {mission.type === "intel_recovery" ? "Intel Recovery" : "QR Mission"}
                  <br />
                  Radius: {location.radius}m
                  {mission.timeWindowCET && (
                    <>
                      <br />
                      Window: {formatCETDateTime(mission.timeWindowCET.startsAtCET)} -{" "}
                      {formatCETDateTime(mission.timeWindowCET.endsAtCET)}
                    </>
                  )}
                  {mission.type === "intel_recovery" && (
                    <>
                      <br />
                      Upload photo evidence to complete.
                    </>
                  )}
                  {failed && (
                    <>
                      <br />
                      <span className="popup-failed">FAILED (out of time)</span>
                    </>
                  )}
                </Popup>
              </Circle>
            );
          })
        )}

        {activeMapSignals.map((signal) => {
          const signalMeta = MAP_SIGNAL_META[signal.type];
          const secondsLeft = Math.max(0, Math.ceil((Date.parse(signal.expiresAt) - now.getTime()) / 1000));

          return (
            <Marker key={signal.id} position={[signal.lat, signal.lng]} icon={signalIcons[signal.id]}>
              <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                {signalMeta.label} ({signal.team.toUpperCase()})
              </Tooltip>
              <Popup>
                <strong>{signalMeta.label}</strong>
                <br />
                Team: {signal.team.toUpperCase()}
                <br />
                Expires in: {secondsLeft}s
              </Popup>
            </Marker>
          );
        })}

        {activePlayerLocations.map((player) => {
          if (!player.location) {
            return null;
          }

          const color = player.team === "red" ? "#c53131" : "#1f76d1";
          return (
            <CircleMarker
              key={`player-location-${player.id}`}
              center={[player.location.lat, player.location.lng]}
              radius={6}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.9,
                weight: 2
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]} className="player-location-label" opacity={1}>
                {player.nickname}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {signalGestureEnabled && signalGestureMenu && (
        <div
          className="map-signal-radial"
          style={{
            left: signalGestureMenu.anchorX,
            top: signalGestureMenu.anchorY
          }}
        >
          <div className="map-signal-center-dot" />
          {SIGNAL_MENU_OPTIONS.map((option) => {
            const signalMeta = MAP_SIGNAL_META[option.type];
            const active = signalGestureMenu.selectedType === option.type;
            return (
              <div
                key={option.type}
                className={`map-signal-radial-option ${active ? "active" : ""}`}
                style={{
                  transform: `translate(${option.dx}px, ${option.dy}px)`,
                  borderColor: signalMeta.color
                }}
              >
                <span className="map-signal-radial-badge" style={{ background: signalMeta.color }}>
                  {signalMeta.shortLabel}
                </span>
                <span>{signalMeta.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {signalGestureEnabled && (
        <div className="map-signal-gesture-hint">
          <span className="muted">Hold, drag to icon, release ({MAP_SIGNAL_DURATION_MS / 60000} min)</span>
          {signalPickerError && <p className="error">{signalPickerError}</p>}
        </div>
      )}

      {(showCenterOnPlayerControl || showFullscreenToggle) && (
        <div className="map-top-right-controls">
          {showCenterOnPlayerControl && (
            <button
              type="button"
              className="map-top-icon-btn map-center-target-btn"
              onClick={centerMapOnCurrentPlayer}
              disabled={!currentPlayerLocation}
              title={currentPlayerLocation ? "Center on current player" : "Location is not available yet"}
              aria-label="Center map on current player"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path
                  d="M11 2h2v3.07A7.002 7.002 0 0 1 18.93 11H22v2h-3.07A7.002 7.002 0 0 1 13 18.93V22h-2v-3.07A7.002 7.002 0 0 1 5.07 13H2v-2h3.07A7.002 7.002 0 0 1 11 5.07V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}

          {showFullscreenToggle && (
            <button
              type="button"
              className="map-top-icon-btn map-fullscreen-btn"
              onClick={() => void toggleFullscreen()}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen map"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen map"}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                {isFullscreen ? (
                  <path
                    d="M9 5H5v4h2V7h2V5Zm8 0h-4v2h2v2h2V5ZM7 15H5v4h4v-2H7v-2Zm10 0h-2v2h-2v2h4v-4Z"
                    fill="currentColor"
                  />
                ) : (
                  <path
                    d="M5 5h6v2H7v4H5V5Zm14 0v6h-2V7h-4V5h6Zm-2 14h-6v-2h4v-4h2v6ZM5 19v-6h2v4h4v2H5Z"
                    fill="currentColor"
                  />
                )}
              </svg>
            </button>
          )}
        </div>
      )}

      {showFullscreenToggle && fullscreenError && (
        <div className="map-top-right-error">
          <p className="error">{fullscreenError}</p>
        </div>
      )}

      {mapPickMode && (
        <p className="map-picker-hint">
          Map picker enabled: click map to fill admin coordinates, tactical icons and shape points.
        </p>
      )}
    </div>
  );
}
