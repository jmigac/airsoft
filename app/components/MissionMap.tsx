"use client";

import { useEffect, useState } from "react";
import { Circle, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { formatCETDateTime, isMissionExpired } from "@/lib/mission-time";
import { Completion, Mission, Team } from "@/lib/types";

type Props = {
  missions: Mission[];
  completions: Completion[];
  selectedTeam: Team | null;
  mapPickMode?: boolean;
  onMapClick?: (point: { lat: number; lng: number }) => void;
  centerOverride?: { lat: number; lng: number } | null;
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

export default function MissionMap({
  missions,
  completions,
  selectedTeam,
  mapPickMode = false,
  onMapClick = () => undefined,
  centerOverride = null
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
    : [46.245562, 16.1102002];

  return (
    <div className="map-wrap-inner">
      <MapContainer center={center} zoom={19} className="map-root" scrollWheelZoom>
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        <MapCenterController center={centerOverride} />
        <MapClickHandler mapPickMode={mapPickMode} onMapClick={onMapClick} />

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

      {mapPickMode && <p className="map-picker-hint">Map picker enabled: click map to fill admin location fields.</p>}
    </div>
  );
}
