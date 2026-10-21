/**
 * Cálculo de la distancia TA-GT (fpacs, 2026-10-21). Puro, sin cornerstone: se testea solo.
 *
 * TA-GT = distancia, medida a lo largo de la línea bicondílea posterior, entre la perpendicular que
 * pasa por el vértice de la garganta troclear (GT) y la que pasa por el centro de la tuberosidad
 * tibial anterior (TA). Equivale a proyectar los dos puntos sobre esa línea y medir entre las
 * proyecciones (los "pies" de las perpendiculares). Referencia: video del dueño (Horos, 1,97 cm).
 *
 * Entradas en coordenadas de mundo (mm en CT): `c1`,`c2` = dos puntos de la cara posterior de los
 * cóndilos; `gt` = vértice de la tróclea; `ta` = centro de la tuberosidad. Devuelve null si la
 * línea de los cóndilos es degenerada (los dos puntos iguales).
 */
export type Vec3 = [number, number, number];

export type TaGtResult = {
  distanceMm: number; // siempre >= 0
  footGt: Vec3; // pie de la perpendicular desde GT sobre la línea bicondílea
  footTa: Vec3; // pie de la perpendicular desde TA
  // Extremos de la línea bicondílea extendida para que incluya los dos pies (para dibujar).
  baseStart: Vec3;
  baseEnd: Vec3;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function computeTaGt(c1: Vec3, c2: Vec3, gt: Vec3, ta: Vec3): TaGtResult | null {
  const dir = sub(c2, c1);
  const len = Math.sqrt(dot(dir, dir));
  if (!(len > 1e-9)) {
    return null;
  }
  const u = scale(dir, 1 / len);
  // Posición de cada pie a lo largo de la línea, medida desde c1.
  const tGt = dot(sub(gt, c1), u);
  const tTa = dot(sub(ta, c1), u);
  const tMin = Math.min(0, len, tGt, tTa);
  const tMax = Math.max(0, len, tGt, tTa);
  return {
    distanceMm: Math.abs(tTa - tGt),
    footGt: add(c1, scale(u, tGt)),
    footTa: add(c1, scale(u, tTa)),
    baseStart: add(c1, scale(u, tMin)),
    baseEnd: add(c1, scale(u, tMax)),
  };
}

/** Texto del valor en formato argentino: "TA-GT 19,7 mm". */
export function formatTaGt(distanceMm: number): string {
  return `TA-GT ${distanceMm.toFixed(1).replace('.', ',')} mm`;
}
