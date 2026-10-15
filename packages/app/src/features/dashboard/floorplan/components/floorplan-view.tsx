import { dispatchEntityCommand } from '@navet/app/commands';
import { getThemeSurfaceTokens, navetTypographyTokens } from '@navet/app/components/system/tokens';
import { cn } from '@navet/app/components/ui/utils';
import { useI18n, useServiceActionHandler, useTheme } from '@navet/app/hooks';
import type { DeviceWithType } from '@navet/app/types/device.types';
import type { NavetUiCommand } from '@navet/core/types';
import { useCallback, useMemo, useState } from 'react';
import type { FloorplanPoint, FloorplanZoneId } from '../floorplan';
import { buildFloorplanMarkers } from '../floorplan-markers';
import { useFloorplanStore } from '../floorplan-store';
import { FloorplanCanvas } from './floorplan-canvas';
import { FloorplanDeviceDialog } from './floorplan-device-dialog';

const EMPTY_DRAFT_POINTS: FloorplanPoint[] = [];
const NOOP = () => {};
const NOOP_PLACEMENT = (_entityId: string, _point: FloorplanPoint) => {};
const NOOP_ZONE_SELECT = (_zoneId: FloorplanZoneId | null) => {};

/** Maps a device to its primary command. Returns null when the device has no simple action. */
function getMarkerCommand(device: DeviceWithType): NavetUiCommand | null {
  switch (device.type) {
    case 'lights':
    case 'fans':
      return { type: device.state ? 'turn_off' : 'turn_on', entityId: device.id };
    case 'switches':
    case 'helpers':
      if (device.serviceAction === 'press') {
        return { type: 'press', entityId: device.id };
      }
      return { type: device.state ? 'turn_off' : 'turn_on', entityId: device.id };
    case 'locks':
      return { type: device.state ? 'unlock' : 'lock', entityId: device.id };
    case 'scenes':
      return { type: 'turn_on', entityId: device.id };
    case 'covers':
      return { type: device.state === 'open' ? 'close' : 'open', entityId: device.id };
    case 'media':
      return { type: 'play_pause', entityId: device.id };
    default:
      return null;
  }
}

export interface FloorplanViewSectionProps {
  devices: readonly DeviceWithType[];
}

export function FloorplanViewSection({ devices }: FloorplanViewSectionProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const runAction = useServiceActionHandler();
  const floorplan = useFloorplanStore((state) => state.floorplan);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [detailDevice, setDetailDevice] = useState<DeviceWithType | null>(null);

  const markers = useMemo(() => buildFloorplanMarkers(floorplan, devices), [devices, floorplan]);

  const findDevice = useCallback(
    (entityId: string) => markers.find((marker) => marker.entityId === entityId)?.device ?? null,
    [markers]
  );

  const handleActivateMarker = useCallback(
    (entityId: string) => {
      const device = findDevice(entityId);
      if (!device) {
        return;
      }
      setSelectedEntityId(entityId);
      const command = getMarkerCommand(device);
      if (!command) {
        setDetailDevice(device);
        return;
      }
      void runAction(async () => {
        await dispatchEntityCommand(command, device.providerId);
      }, t('dashboard.floorplan.view.controlFailed'));
    },
    [findDevice, runAction, t]
  );

  const handleLongPressMarker = useCallback(
    (entityId: string) => {
      setSelectedEntityId(entityId);
      const device = findDevice(entityId);
      if (device) {
        setDetailDevice(device);
      }
    },
    [findDevice]
  );

  if (!floorplan.image) {
    return null;
  }

  return (
    <section aria-label={t('dashboard.floorplan.title')} className="flex flex-col">
      <div className="mb-3 flex items-center gap-3">
        <h2 className={cn('text-lg font-semibold md:text-xl', surface.textPrimary)}>
          {t('dashboard.floorplan.title')}
        </h2>
        <div className={cn('h-px flex-1', surface.borderStrong)} />
      </div>
      <div
        className={cn('overflow-hidden rounded-[22px] border', surface.border, surface.subtleBg)}
      >
        <div className="h-[18rem] w-full sm:h-[24rem]">
          <FloorplanCanvas
            floorplan={floorplan}
            mode="device"
            isDrawing={false}
            draftPoints={EMPTY_DRAFT_POINTS}
            selectedZoneId={null}
            selectedEntityId={selectedEntityId}
            markers={markers}
            readOnly
            onActivateMarker={handleActivateMarker}
            onLongPressMarker={handleLongPressMarker}
            onAddDraftPoint={NOOP}
            onMovePlacement={NOOP_PLACEMENT}
            onCommitPlacement={NOOP_PLACEMENT}
            onSelectZone={NOOP_ZONE_SELECT}
            onSelectEntity={setSelectedEntityId}
          />
        </div>
      </div>
      {markers.length > 0 ? (
        <p className={cn('mt-2', navetTypographyTokens.label, surface.textMuted)}>
          {t('dashboard.floorplan.view.hint')}
        </p>
      ) : null}
      <FloorplanDeviceDialog
        device={detailDevice}
        isOpen={detailDevice !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailDevice(null);
          }
        }}
      />
    </section>
  );
}
