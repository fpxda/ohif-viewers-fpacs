import { AllInOneMenu, Icon } from '@ohif/ui';
import React, { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { VolumeRenderingPresetsProps } from '../../types/ViewportPresets';
import { VolumeRenderingPresetsContent } from './VolumeRenderingPresetsContent';

export function VolumeRenderingPresets({
  viewportId,
  servicesManager,
  commandsManager,
  volumeRenderingPresets,
}: VolumeRenderingPresetsProps): ReactElement {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { uiModalService } = servicesManager.services;

  const onClickPresets = () => {
    uiModalService.show({
      content: VolumeRenderingPresetsContent,
      title: 'Rendering Presets',
      movable: true,
      contentProps: {
        onClose: uiModalService.hide,
        presets: volumeRenderingPresets,
        viewportId,
        commandsManager,
      },
      containerDimensions: 'h-[543px] w-[460px]',
      contentDimensions: 'h-[493px] w-[460px]  pl-[12px] pr-[12px]',
    });
  };

  return (
    <AllInOneMenu.Item
      label={t('Rendering Presets')}
      icon={<Icon name="VolumeRendering" />}
      rightIcon={<Icon name="action-new-dialog" />}
      onClick={onClickPresets}
    />
  );
}
