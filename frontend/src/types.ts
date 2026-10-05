// Types matching the FastAPI /api/analysis/{id} response.

export interface ProjectInfo {
  id: string;
  name: string;
  source: string;
  type?: string;
}

export interface GridInfo {
  cell_size: number;
  bounds: [number, number, number, number];
  nx: number;
  ny: number;
  x: number[];
  y: number[];
}

export interface PointStats {
  captured: number;
  kept: number;
  outliers_removed: number;
  /** True when only ground-classified points (LAS class 2) were used. */
  ground_only?: boolean;
}

export interface Dimensions {
  width_m: number; // east–west
  depth_m: number; // north–south
  height_m: number; // vertical
}

export interface ElevStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  n: number;
}

export interface CutFill {
  cut: number;
  fill: number;
  net: number;
  target_elev_m: number;
}

export interface Histogram {
  counts: number[];
  edges: number[];
}

export interface MapSurface {
  data: number[][];
  min?: number;
  max?: number;
}

export interface Maps {
  elevation: MapSurface;
  slope: MapSurface;
  aspect: MapSurface;
  curvature: MapSurface;
  roughness: MapSurface;
  coverage?: MapSurface;
  /** 1 where the cell was actually scanned (pinholes closed), else 0. */
  mask?: MapSurface;
}

export interface CoverageInfo {
  revisited_pct: number;
  covered_pct: number;
  n_submaps: number;
}

export interface RegistrationInfo {
  action: string;
  overlap: number;
  rmse: number;
  into: number | null;
}

export interface Analysis {
  project: ProjectInfo;
  grid: GridInfo;
  points: PointStats;
  dimensions?: Dimensions;
  stats: ElevStats;
  percent_flat: Record<string, number>;
  relief_m: number;
  area_m2: number;
  cut_fill: CutFill;
  histograms: { elevation: Histogram; slope: Histogram };
  maps: Maps;
  coverage?: CoverageInfo;
  registration?: RegistrationInfo;
}