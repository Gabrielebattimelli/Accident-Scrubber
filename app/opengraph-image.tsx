import { ImageResponse } from "next/og";
import { MASK } from "@/components/Brand";

// Link-preview card, generated at build time.
export const alt = "Raccoon: talk to your video archive. Find any moment, see what's in it, edit it in one sentence, and prove what is original.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const mask = (fill: string) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${MASK}" fill="${fill}" fill-rule="evenodd"/></svg>`,
  ).toString("base64")}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f6f6f7", padding: "72px 80px 64px", color: "#0b0b0d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 38, letterSpacing: -1 }}>
          <img src={mask("#0b0b0d")} width={48} height={48} alt="" />
          Raccoon
        </div>
        <img src={mask("#d4d4d8")} width={300} height={300} alt="" style={{ position: "absolute", right: 70, top: 40 }} />
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ fontSize: 76, letterSpacing: -2.5, lineHeight: 1.05 }}>Talk to your video archive.</div>
          <div style={{ fontSize: 28, color: "#52525b", marginTop: 22, maxWidth: 760, lineHeight: 1.35 }}>
            Find any moment, see what&apos;s in it, edit it in one sentence, and prove what is original.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e6e6e9", marginTop: 56, paddingTop: 26, fontSize: 17, letterSpacing: 2, color: "#71717a" }}>
          <span>VAST · NVIDIA COSMOS · ELEVENLABS · FAL</span>
          <span>VOICE AGENT</span>
        </div>
      </div>
    ),
    size,
  );
}
