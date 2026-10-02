// Multi-camera scenes: segment file names encode the scene, the camera and the chunk, so the same
// moment from another camera shares a scene key and differs only in the view.
//   run_3_seed_7.ceiling_2.…chunk_4_segment_1   (indoor sim)
//   Warehouse_3_Camera_2_chunk_4_segment_1      (warehouse sim)

const PATTERNS = [
  /(run_\d+_seed_\d+)\.((?:ceiling|eye)_\d+)\..*?(chunk_\d+_segment_\d+)/,
  /(Warehouse_\d+)_(Camera_\d+)_(chunk_\d+_segment_\d+)/,
];

/** { scene, view } for a segment source, e.g. view "Ceiling 2" / "Eye-Level 1" / "Camera 3". */
export function angleOf(source: string | undefined): { scene?: string; view?: string } {
  for (const re of PATTERNS) {
    const m = source?.match(re);
    if (m) {
      const view = m[2].replace(/_/g, " ").replace(/^eye/, "eye-level").replace(/\b\w/g, (c) => c.toUpperCase());
      return { scene: m[1] + m[3], view };
    }
  }
  return {};
}
