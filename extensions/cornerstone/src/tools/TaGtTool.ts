import { CobbAngleTool, annotation as csAnnotation, drawing } from '@cornerstonejs/tools';
import { computeTaGt, formatTaGt } from './taGtMath';
import type { Vec3 } from './taGtMath';

/**
 * Distancia TA-GT (fpacs, 2026-10-21) — herramienta propia del visor.
 *
 * Qué mide: la distancia tuberosidad tibial anterior – garganta troclear de la rodilla, como en el
 * video de referencia del dueño (Horos, "líneas perpendiculares"). Se usa junto con "Superponer
 * corte": se fija el corte de la tuberosidad, se va al corte de la tróclea y se mide sobre los dos.
 *
 * Cómo se dibuja (cuatro clics, igual que el Ángulo de Cobb, del que hereda la edición de puntos):
 *   1-2. dos puntos sobre la cara posterior de los cóndilos (línea bicondílea posterior);
 *   3.   el vértice de la garganta troclear;
 *   4.   el centro de la tuberosidad tibial anterior.
 * La herramienta dibuja la línea bicondílea (extendida), las dos perpendiculares desde los puntos 3 y
 * 4 hasta ella y el valor "TA-GT xx,x mm". El cálculo vive en taGtMath.ts (puro, en mm de mundo).
 *
 * Límites: no aparece en el panel de mediciones de OHIF (no tiene mapeo al measurement service);
 * el valor se lee sobre la imagen. Si se dibujan solo dos puntos, queda la línea sin medida.
 */
class TaGtTool extends CobbAngleTool {
  static toolName = 'TaGt';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
    // CobbAngleTool define renderAnnotation en su constructor: se reemplaza después de super().
    this.renderAnnotation = this._renderTaGt;
  }

  /**
   * Recalcula la medida de una anotación. Mismo contrato que el de CobbAngleTool (lo llama la
   * clase base, también su versión con throttle al arrastrar un punto): deja el resultado en
   * `data.cachedStats[targetId]` para cada target y avisa que la anotación cambió.
   */
  _calculateCachedStats(annotation, _renderingEngine, _enabledElement) {
    const data = annotation.data;
    if (data.handles.points.length !== 4) {
      return;
    }
    const [c1, c2, gt, ta] = data.handles.points as Vec3[];
    const result = computeTaGt(c1, c2, gt, ta);
    for (const targetId of Object.keys(data.cachedStats)) {
      data.cachedStats[targetId] = {
        // `angle` se deja en un valor no nulo: la clase base usa `angle == null` como
        // "todavía no calculado" en algunos caminos (selección, arrastre).
        angle: result ? result.distanceMm : null,
        distanceMm: result ? result.distanceMm : null,
        taGt: result,
      };
    }
    annotation.invalidated = false;
    // A diferencia de CobbAngleTool no se dispara ANNOTATION_MODIFIED: ese evento lo consume el panel
    // de mediciones de OHIF, donde esta tool no está mapeada, y su helper no es API pública de
    // cornerstone. El repintado lo pide la propia interacción (arrastre de puntos).
    return data.cachedStats;
  }

  private _renderTaGt = (enabledElement, svgDrawingHelper): boolean => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;
    let annotations = csAnnotation.state.getAnnotations(this.getToolName(), element);
    if (!annotations?.length) {
      return renderStatus;
    }
    annotations = this.filterInteractableAnnotationsForElement(element, annotations);
    if (!annotations?.length) {
      return renderStatus;
    }
    const targetId = this.getTargetId(viewport);
    const styleSpecifier: Record<string, unknown> = {
      toolGroupId: this.toolGroupId,
      toolName: this.getToolName(),
      viewportId: viewport.id,
    };

    for (const annotation of annotations) {
      const { annotationUID, data } = annotation;
      const { points, activeHandleIndex } = data.handles;
      styleSpecifier.annotationUID = annotationUID;
      const { color, lineWidth, lineDash } = this.getAnnotationStyle({ annotation, styleSpecifier });
      const canvasCoordinates = points.map(p => viewport.worldToCanvas(p));

      // Medida: se calcula la primera vez y cada vez que se mueve un punto.
      if (points.length === 4 && (!data.cachedStats[targetId] || annotation.invalidated)) {
        data.cachedStats[targetId] = data.cachedStats[targetId] ?? {};
        this._calculateCachedStats(annotation, viewport.getRenderingEngine(), enabledElement);
      }

      // Puntos de agarre: solo con la anotación activa (igual que Cobb).
      if (activeHandleIndex !== null && activeHandleIndex !== undefined && !this.editData) {
        drawing.drawHandles(svgDrawingHelper, annotationUID, '0', canvasCoordinates, {
          color,
          lineDash,
          lineWidth,
        });
      }

      const stats = data.cachedStats[targetId];
      const res = stats?.taGt;
      // Mientras se dibuja (menos de 4 puntos) o si la línea es degenerada: la línea de los cóndilos tal cual.
      if (points.length < 4 || !res) {
        drawing.drawLine(svgDrawingHelper, annotationUID, 'base', canvasCoordinates[0], canvasCoordinates[1], {
          color,
          width: lineWidth,
          lineDash,
        });
        renderStatus = true;
        continue;
      }

      const toCanvas = (p: Vec3) => viewport.worldToCanvas(p);
      // Línea bicondílea extendida hasta los pies de las perpendiculares.
      drawing.drawLine(svgDrawingHelper, annotationUID, 'base', toCanvas(res.baseStart), toCanvas(res.baseEnd), {
        color,
        width: lineWidth,
        lineDash,
      });
      // Perpendiculares: desde la tróclea y desde la tuberosidad hasta la línea bicondílea.
      drawing.drawLine(svgDrawingHelper, annotationUID, 'perpGt', canvasCoordinates[2], toCanvas(res.footGt), {
        color,
        width: lineWidth,
        lineDash,
      });
      drawing.drawLine(svgDrawingHelper, annotationUID, 'perpTa', canvasCoordinates[3], toCanvas(res.footTa), {
        color,
        width: lineWidth,
        lineDash,
      });
      renderStatus = true;

      // Valor: caja de texto enlazada, que el usuario puede mover (misma mecánica que Cobb).
      const options = this.getLinkedTextBoxStyle(styleSpecifier, annotation);
      if (!options.visibility) {
        continue;
      }
      const textLines = [formatTaGt(res.distanceMm)];
      if (!data.handles.textBox.hasMoved) {
        const anchor = toCanvas(res.footTa);
        data.handles.textBox.worldPosition = viewport.canvasToWorld([anchor[0] + 12, anchor[1] + 12]);
      }
      const textBoxPosition = viewport.worldToCanvas(data.handles.textBox.worldPosition);
      const boundingBox = drawing.drawLinkedTextBox(
        svgDrawingHelper,
        annotationUID,
        'taGtText',
        textLines,
        textBoxPosition,
        [toCanvas(res.footGt), toCanvas(res.footTa)],
        {},
        options
      );
      const { x: left, y: top, width, height } = boundingBox;
      data.handles.textBox.worldBoundingBox = {
        topLeft: viewport.canvasToWorld([left, top]),
        topRight: viewport.canvasToWorld([left + width, top]),
        bottomLeft: viewport.canvasToWorld([left, top + height]),
        bottomRight: viewport.canvasToWorld([left + width, top + height]),
      };
    }
    return renderStatus;
  };
}

export default TaGtTool;
