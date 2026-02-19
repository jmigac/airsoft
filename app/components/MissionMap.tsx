"use client";

import { divIcon } from "leaflet";
import { useEffect, useMemo, useState } from "react";
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
import { formatCETDateTime, isMissionExpired } from "@/lib/mission-time";
import { Completion, MapCenter, MapMarker, MapShape, MapShapeDraft, Mission, Team } from "@/lib/types";

type Props = {
  missions: Mission[];
  completions: Completion[];
  mapMarkers: MapMarker[];
  mapShapes: MapShape[];
  selectedTeam: Team | null;
  mapPickMode?: boolean;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  defaultCenter?: MapCenter | null;
  centerOverride?: { lat: number; lng: number } | null;
  draftShape?: MapShapeDraft | null;
};

function MapClickHandler({
  mapPickMode,
  onMapClick
}: {
  mapPickMode: boolean;
  onMapClick: (point: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(event) {
      if (mapPickMode) {
        onMapClick({
          lat: event.latlng.lat,
          lng: event.latlng.lng
        });
      }
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
  mapMarkers,
  mapShapes,
  selectedTeam,
  mapPickMode = false,
  onMapClick = () => undefined,
  defaultCenter = null,
  centerOverride = null,
  draftShape = null
}: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

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
        const markerWidth = Math.max(28, Math.ceil(markerText.length * 8.2) + 18);
        icons[marker.id] = divIcon({
          className: "military-marker-wrapper",
          html: `<span class="military-marker-badge" style="background:${marker.color};">${escapeHtml(markerText)}</span>`,
          iconSize: [markerWidth, 28],
          iconAnchor: [Math.round(markerWidth / 2), 14]
        });
        return icons;
      }, {}),
    [mapMarkers]
  );

  return (
    <div className="map-wrap-inner">
      <MapContainer center={center} zoom={19} className="map-root" scrollWheelZoom>
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        <MapCenterController center={centerOverride ?? defaultCenter} />
        <MapClickHandler mapPickMode={mapPickMode} onMapClick={onMapClick} />

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
                  Radius: {location.radius}m
                  {mission.timeWindowCET && (
                    <>
                      <br />
                      Window: {formatCETDateTime(mission.timeWindowCET.startsAtCET)} -{" "}
                      {formatCETDateTime(mission.timeWindowCET.endsAtCET)}
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
      </MapContainer>

      {mapPickMode && (
        <p className="map-picker-hint">
          Map picker enabled: click map to fill admin coordinates, tactical icons and shape points.
        </p>
      )}
    </div>
  );
}
