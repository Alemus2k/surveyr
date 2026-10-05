import { useEffect, useRef } from "react";

export type ColorFn = (v: number) => [number, number, number];

interface Props {
  data: number[][];
  toColor: ColorFn;
  title: string;
}

/** 2D planar color map over a grid, drawn on a canvas. */
export function MapViewer({ data, toColor, title }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ny = data.length;
    const nx = data[0]?.length ?? 0;
    if (ny === 0 || nx === 0) return;
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(nx, ny);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const [r, g, b] = toColor(data[iy][ix]);
        const idx = (iy * nx + ix) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [data, toColor]);

  return (
    <div className="map-tile">
      <div className="map-title">{title}</div>
      <canvas ref={canvas} style={{ width: "100%", display: "block" }} />
    </div>
  );
}