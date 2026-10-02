import { ImageResponse } from "next/og";
import { MASK } from "@/components/Brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${MASK}" fill="#ededef" fill-rule="evenodd"/></svg>`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#111113" }}>
        <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={136} height={136} alt="" />
      </div>
    ),
    size,
  );
}
