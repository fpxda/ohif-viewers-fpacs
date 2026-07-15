import { LengthTool } from '@cornerstonejs/tools';

/**
 * Línea recta simple para marcar/señalar sobre la imagen (fpacs).
 * Extiende LengthTool pero oculta la caja de texto con la medida y su
 * línea de enlace (el "link line"): el renderAnnotation del padre hace
 * `continue` cuando el estilo del textBox tiene visibility=false, así
 * no se dibuja ni la caja ni el conector. La medida igual se calcula
 * (cachedStats) y se ve en el panel de mediciones.
 */
class PlainLineTool extends LengthTool {
  static toolName = 'PlainLine';

  // forzamos la invisibilidad del textBox sin importar el estilo global
  getLinkedTextBoxStyle(): Record<string, unknown> {
    return { visibility: false };
  }
}

export default PlainLineTool;
