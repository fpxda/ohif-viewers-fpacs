import { cache, getEnabledElement, BaseVolumeViewport, Types } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';

function _getVolumeFromViewport(viewport: Types.IBaseVolumeViewport) {
  const volumeIds = viewport.getAllVolumeIds();
  const volumes = volumeIds.map(id => cache.getVolume(id));
  const dynamicVolume = volumes.find(volume => volume.isDynamicVolume());

  return dynamicVolume ?? volumes[0];
}

/**
 * Return all viewports that needs to be synchronized with the source
 * viewport passed as parameter when cine is updated.
 * @param servicesManager ServiceManager
 * @param srcViewportIndex Source viewport index
 * @returns array with viewport information.
 */
function _getSyncedViewports(servicesManager: AppTypes.ServicesManager, srcViewportId) {
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;

  const { viewports: viewportsStates } = viewportGridService.getState();
  const srcViewportState = viewportsStates.get(srcViewportId);

  if (srcViewportState?.viewportOptions?.viewportType !== 'volume') {
    return [];
  }

  const srcViewport = cornerstoneViewportService.getCornerstoneViewport(srcViewportId);

  const srcVolume = srcViewport ? _getVolumeFromViewport(srcViewport) : null;

  if (!srcVolume?.isDynamicVolume()) {
    return [];
  }

  const { volumeId: srcVolumeId } = srcVolume;

  return Array.from(viewportsStates.values())
    .filter(({ viewportId }) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      return viewportId !== srcViewportId && viewport?.hasVolumeId(srcVolumeId);
    })
    .map(({ viewportId }) => ({ viewportId }));
}

function initCineService(servicesManager: AppTypes.ServicesManager) {
  const { cineService } = servicesManager.services;

  const getSyncedViewports = viewportId => {
    return _getSyncedViewports(servicesManager, viewportId);
  };

  const playClip = (element, playClipOptions) => {
    // FIX (fpacs): el playClip de cornerstone3D defaultea `dynamicCineEnabled` a true y,
    // cuando es truthy, llama `viewport.getAllVolumeIds()` SIN chequear el tipo de viewport.
    // Ese metodo solo existe en viewports de volumen; los multiframe (ecografias US y demas
    // cine de stack) usan un StackViewport -> `getAllVolumeIds is not a function` -> crashea
    // el visor al darle play. Solo habilitamos el cine dinamico para viewports de volumen.
    const enabledElement = getEnabledElement(element);
    const isVolumeViewport = enabledElement?.viewport instanceof BaseVolumeViewport;
    const options = {
      ...playClipOptions,
      dynamicCineEnabled: isVolumeViewport ? playClipOptions?.dynamicCineEnabled : false,
    };
    return utilities.cine.playClip(element, options);
  };

  const stopClip = (element, stopClipOptions) => {
    return utilities.cine.stopClip(element, stopClipOptions);
  };

  cineService.setServiceImplementation({
    getSyncedViewports,
    playClip,
    stopClip,
  });
}

export default initCineService;
