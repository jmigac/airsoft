import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630
};

export const contentType = "image/png";
export const alt = "Realtime map + payload mission tracking application for Tiglin playground";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(135deg, #111f14 0%, #0a120d 56%, #1a2f1f 100%)",
          color: "#d6e1c7",
          fontFamily: "Arial, sans-serif",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(132,160,118,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(132,160,118,0.16) 1px, transparent 1px)",
            backgroundSize: "44px 44px"
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -120,
            left: -60,
            width: 500,
            height: 500,
            borderRadius: "999px",
            border: "2px solid rgba(160,191,140,0.45)"
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -40,
            left: 20,
            width: 340,
            height: 340,
            borderRadius: "999px",
            border: "2px solid rgba(160,191,140,0.35)"
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 120,
            top: 120,
            width: 16,
            height: 16,
            borderRadius: "999px",
            background: "#f3cc63",
            boxShadow: "0 0 0 12px rgba(243,204,99,0.18)"
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 160,
            top: 270,
            width: 12,
            height: 12,
            borderRadius: "999px",
            background: "#f3cc63",
            boxShadow: "0 0 0 9px rgba(243,204,99,0.2)"
          }}
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: "70px 82px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "relative"
          }}
        >
          <div
            style={{
              fontSize: 34,
              letterSpacing: 8,
              color: "#a8bf93",
              textTransform: "uppercase"
            }}
          >
            Military Command Feed
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                fontSize: 124,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: 16,
                textTransform: "uppercase"
              }}
            >
              TIGLIN
            </div>
            <div
              style={{
                fontSize: 32,
                color: "#a8bf93",
                letterSpacing: 3
              }}
            >
              Tactical Mission Tracker
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: "#a8bf93",
              fontSize: 24,
              letterSpacing: 2
            }}
          >
            <div>Grid: Echo-7</div>
            <div>Status: Operational</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size
    }
  );
}
