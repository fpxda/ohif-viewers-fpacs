import { BaseVolumeViewport, cache, imageLoader, utilities, Types as CoreTypes } from '@cornerstonejs/core';
import { AnnotationDisplayTool, drawing } from '@cornerstonejs/tools';

/**
 * Superponer corte (fpacs, 2026-10-21) — herramienta propia del visor.
 *
 * Qué resuelve: la medición de anteversión/torsión femoral en tomografía exige ver en UNA sola
 * imagen dos cortes axiales que están en lugares distintos (el cuello femoral en la cadera y los
 * cóndilos en la rodilla) y medir el ángulo entre ambos ejes. OHIF no trae eso: su "Image Overlay"
 * dibuja los planos de overlay DICOM (grupo 60xx) que embebe el equipo, y la traducción
 * "Superposición de imagen" hacía creer que era esto. Pedido del dueño del 2026-10-21.
 *
 * Cómo funciona: el comando `fpacsToggleSliceSuperimpose` (commandsModule) "fija" el corte que
 * está en pantalla (su imageId queda en `SliceSuperimposeTool.fixedImageId`) y habilita esta tool.
 * Desde entonces, en cada render de un viewport de stack, la tool dibuja ese corte fijo como un
 * <image> translúcido en la capa SVG de anotaciones (misma técnica que ImageOverlayViewerTool),
 * ubicado con la geometría DICOM del corte fijo proyectada a canvas: así sobrevive zoom, pan,
 * rotación y volteo. Las mediciones (Ángulo de Cobb) se dibujan encima, sobre el corte actual.
 * Volver a tocar el botón saca la superposición. Es una capa de DIBUJO, no modifica píxeles ni
 * guarda nada en el estudio.
 *
 * Límites conocidos: el corte fijo se dibuja con la ventana (W/L) y el negativo del viewport
 * actual, para que los dos cortes se vean iguales; se regenera como máximo cada REGEN_MS mientras
 * se arrastra la ventana. En viewports de volumen (MPR/3D) no dibuja nada.
 */

// Opacidad del corte fijo sobre el actual: 0,5 deja ver las dos corticales a la vez.
const DEFAULT_OPACITY = 0.5;
// Mientras el usuario arrastra la ventana, no regeneramos el PNG más seguido que esto
// (un 512² por frame en un celular tartamudea).
const REGEN_MS = 100;

type Voi = { lower: number; upper: number };

class SliceSuperimposeTool extends AnnotationDisplayTool {
  static toolName = 'SliceSuperimpose';

  /** imageId del corte fijado por el comando; null = nada que superponer. */
  static fixedImageId: string | null = null;

  static setFixedImage(imageId: string | null): void {
    SliceSuperimposeTool.fixedImageId = imageId;
    SliceSuperimposeTool.rendered = null;
  }

  static clearFixedImage(): void {
    SliceSuperimposeTool.setFixedImage(null);
  }

  // Último PNG generado y la clave (imageId|ventana|negativo) con la que se generó.
  private static rendered: { key: string; dataUrl: string } | null = null;
  private static regenTimer: ReturnType<typeof setTimeout> | null = null;
  private static loading: string | null = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: [],
      configuration: {
        opacity: DEFAULT_OPACITY,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  onSetToolDisabled = (): void => {};

  renderAnnotation = (enabledElement, svgDrawingHelper): boolean => {
    const { viewport } = enabledElement;
    const fixedImageId = SliceSuperimposeTool.fixedImageId;
    // Solo viewports de stack: en MPR/3D no hay "corte actual" comparable.
    if (!fixedImageId || viewport instanceof BaseVolumeViewport) {
      return false;
    }
    if (typeof viewport.getCurrentImageId !== 'function') {
      return false;
    }
    // Sobre el propio corte fijo no hace falta dibujar nada (quedaría idéntico).
    if (viewport.getCurrentImageId() === fixedImageId) {
      return false;
    }

    const image = cache.getImage(fixedImageId) as CoreTypes.IImage | undefined;
    if (!image) {
      // Se fue del caché (raro: 3 GB). Se vuelve a cargar y se repinta cuando llega.
      this._ensureLoaded(fixedImageId, viewport);
      return false;
    }

    const dataUrl = this._getDataUrl(image, viewport);
    if (!dataUrl) {
      return false;
    }

    // Geometría: las tres esquinas del corte fijo (borde exterior de los píxeles) en mundo y
    // luego en canvas. La proyección es ortográfica sobre el plano de la cámara, así que un corte
    // a otra altura (z) cae exactamente donde cae su x/y. Con tres esquinas sale una matriz que
    // cubre rotación y volteo sin casos especiales.
    const { columns, rows } = image;
    const toCanvas = (col: number, row: number): [number, number] => {
      const world = utilities.imageToWorldCoords(fixedImageId, [col, row]);
      const c = viewport.worldToCanvas(world);
      return [c[0], c[1]];
    };
    const tl = toCanvas(-0.5, -0.5);
    const tr = toCanvas(columns - 0.5, -0.5);
    const bl = toCanvas(-0.5, rows - 0.5);
    const a = (tr[0] - tl[0]) / columns;
    const b = (tr[1] - tl[1]) / columns;
    const c = (bl[0] - tl[0]) / rows;
    const d = (bl[1] - tl[1]) / rows;
    if (![a, b, c, d, tl[0], tl[1]].every(Number.isFinite)) {
      return false;
    }

    const svgns = 'http://www.w3.org/2000/svg';
    const svgNodeHash = 'fpacs-slice-superimpose';
    const existing = svgDrawingHelper.getSvgNode(svgNodeHash);
    const attributes = {
      'data-id': svgNodeHash,
      x: 0,
      y: 0,
      width: columns,
      height: rows,
      href: dataUrl,
      preserveAspectRatio: 'none',
      transform: `matrix(${a} ${b} ${c} ${d} ${tl[0]} ${tl[1]})`,
      opacity: this.configuration.opacity,
      // Las mediciones se hacen sobre el corte actual: esta capa no captura el mouse.
      style: 'pointer-events:none',
    };

    if (existing) {
      drawing.setAttributesIfNecessary(attributes, existing);
      svgDrawingHelper.setNodeTouched(svgNodeHash);
    } else {
      const node = document.createElementNS(svgns, 'image');
      drawing.setNewAttributesIfValid(attributes, node);
      svgDrawingHelper.appendNode(node, svgNodeHash);
      // Al fondo de la capa: si quedara arriba, taparía (al 50 %) las mediciones ya dibujadas.
      const layer = node.parentNode;
      if (layer && layer.firstChild !== node) {
        layer.insertBefore(node, layer.firstChild);
      }
    }
    return true;
  };

  /** Recarga un corte fijo que se fue del caché y repinta el viewport cuando llega. */
  private _ensureLoaded(imageId: string, viewport): void {
    if (SliceSuperimposeTool.loading === imageId) {
      return;
    }
    SliceSuperimposeTool.loading = imageId;
    imageLoader
      .loadAndCacheImage(imageId)
      .then(() => viewport.render())
      .catch(err => console.warn('[fpacs] no se pudo recargar el corte fijo', imageId, err))
      .finally(() => {
        SliceSuperimposeTool.loading = null;
      });
  }

  /**
   * PNG (data URL) del corte fijo con la ventana y el negativo del viewport actual. Cacheado por
   * clave; si la clave cambia muy seguido (arrastre de W/L) se regenera con retardo y mientras
   * tanto se sigue mostrando el anterior.
   */
  private _getDataUrl(image: CoreTypes.IImage, viewport): string | null {
    const props = viewport.getProperties?.() ?? {};
    const voi = resolveVoi(props.voiRange, image);
    const invert = props.invert ?? image.invert ?? false;
    const key = `${image.imageId}|${voi.lower}|${voi.upper}|${invert ? 1 : 0}`;
    const current = SliceSuperimposeTool.rendered;
    if (current?.key === key) {
      return current.dataUrl;
    }
    if (!current) {
      const dataUrl = renderSliceToDataUrl(image, voi, invert);
      SliceSuperimposeTool.rendered = { key, dataUrl };
      return dataUrl;
    }
    if (!SliceSuperimposeTool.regenTimer) {
      SliceSuperimposeTool.regenTimer = setTimeout(() => {
        SliceSuperimposeTool.regenTimer = null;
        SliceSuperimposeTool.rendered = null;
        viewport.render();
      }, REGEN_MS);
    }
    return current.dataUrl;
  }
}

/** Ventana a usar: la del viewport; si no la tiene, la que trae el corte; si no, min/max. */
function resolveVoi(voiRange: Voi | undefined, image: CoreTypes.IImage): Voi {
  if (voiRange && Number.isFinite(voiRange.lower) && Number.isFinite(voiRange.upper)) {
    return voiRange;
  }
  const wc = Array.isArray(image.windowCenter) ? image.windowCenter[0] : image.windowCenter;
  const ww = Array.isArray(image.windowWidth) ? image.windowWidth[0] : image.windowWidth;
  if (Number.isFinite(wc) && Number.isFinite(ww) && ww > 0) {
    return { lower: wc - ww / 2, upper: wc + ww / 2 };
  }
  return { lower: image.minPixelValue, upper: image.maxPixelValue };
}

/**
 * Convierte los píxeles del corte a un PNG en escala de grises con la ventana dada. Los datos de
 * cornerstone ya vienen en unidades de modalidad (HU) cuando `preScale.scaled` es true; si no,
 * se aplica slope/intercept acá. Aplicarlo dos veces corre la ventana sin aviso: por eso el if.
 * Las imágenes color (RGB) se copian tal cual.
 */
function renderSliceToDataUrl(image: CoreTypes.IImage, voi: Voi, invert: boolean): string {
  const { columns, rows } = image;
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }
  const imageData = ctx.createImageData(columns, rows);
  const out = imageData.data;
  const pixels = image.getPixelData();
  const total = columns * rows;

  if (image.color) {
    const comps = image.numberOfComponents || (image.rgba ? 4 : 3);
    for (let i = 0; i < total; i++) {
      out[i * 4] = pixels[i * comps];
      out[i * 4 + 1] = pixels[i * comps + 1];
      out[i * 4 + 2] = pixels[i * comps + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const scaled = image.preScale?.scaled === true;
    const slope = scaled ? 1 : (image.slope ?? 1);
    const intercept = scaled ? 0 : (image.intercept ?? 0);
    const range = Math.max(voi.upper - voi.lower, 1e-6);
    for (let i = 0; i < total; i++) {
      const value = pixels[i] * slope + intercept;
      let gray = ((value - voi.lower) / range) * 255;
      gray = gray < 0 ? 0 : gray > 255 ? 255 : gray;
      if (invert) {
        gray = 255 - gray;
      }
      out[i * 4] = gray;
      out[i * 4 + 1] = gray;
      out[i * 4 + 2] = gray;
      out[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

export default SliceSuperimposeTool;
