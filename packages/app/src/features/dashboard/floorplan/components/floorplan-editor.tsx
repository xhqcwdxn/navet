import { NavigationWorkspace } from '@navet/app/components/patterns';
import {
  BaseCardDialog,
  Button,
  coverSheetHeaderClassName,
  IconButton,
  Input,
  Select,
} from '@navet/app/components/primitives';
import { InteractivePill } from '@navet/app/components/primitives/interactive-pill';
import {
  getThemeSurfaceTokens,
  navetIconSizeTokens,
  navetTypographyTokens,
} from '@navet/app/components/system/tokens';
import { cn } from '@navet/app/components/ui/utils';
import { getDeviceTypeIcon } from '@navet/app/constants/device-type-icons';
import { useAreaRooms, useDevices, useI18n, useMediaQuery, useTheme } from '@navet/app/hooks';
import type { DeviceWithType } from '@navet/app/types/device.types';
import { readFileAsDataUrl, validateImageFile } from '@navet/app/utils/image-upload';
import { normalizeRoomName } from '@navet/app/utils/room-name';
import {
  Check,
  Layers,
  Map as MapIcon,
  MapPin,
  MapPinOff,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type FloorplanPoint,
  type FloorplanV1,
  type FloorplanZone,
  type FloorplanZoneId,
  getDefaultFloorplanPlacement,
  getZoneAutoPositions,
  MAX_FLOORPLAN_ZONE_POINTS,
  MIN_FLOORPLAN_ZONE_POINTS,
} from '../floorplan';
import { useFloorplanStore } from '../floorplan-store';
import {
  FloorplanCanvas,
  type FloorplanMarker,
  getDeviceClass,
  getDevicePicture,
} from './floorplan-canvas';

const MAX_VISIBLE_DEVICES = 150;

type FloorplanEditorMode = 'zone' | 'device';

function loadImageSize(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => reject(new Error('decode'));
    image.src = source;
  });
}

function buildMarkers(
  floorplan: FloorplanV1,
  devices: readonly DeviceWithType[],
  zoneByRoomName: ReadonlyMap<string, FloorplanZone>
): FloorplanMarker[] {
  const markers: FloorplanMarker[] = [];
  const explicitlyPlaced = new Set<string>();

  for (const device of devices) {
    const point = floorplan.placements[device.id];
    if (point) {
      markers.push({ entityId: device.id, point, device, auto: false });
      explicitlyPlaced.add(device.id);
    }
  }

  const autoDevicesByZoneId = new Map<FloorplanZoneId, DeviceWithType[]>();
  for (const device of devices) {
    if (explicitlyPlaced.has(device.id)) {
      continue;
    }
    const zone = zoneByRoomName.get(normalizeRoomName(device.room));
    if (!zone) {
      continue;
    }
    const list = autoDevicesByZoneId.get(zone.id);
    if (list) {
      list.push(device);
    } else {
      autoDevicesByZoneId.set(zone.id, [device]);
    }
  }

  for (const [zoneId, list] of autoDevicesByZoneId) {
    const zone = floorplan.zones.find((entry) => entry.id === zoneId);
    if (!zone) {
      continue;
    }
    const positions = getZoneAutoPositions(zone.points, list.length);
    list.forEach((device, index) => {
      markers.push({
        entityId: device.id,
        point: positions[index] ?? { x: 0.5, y: 0.5 },
        device,
        auto: true,
      });
    });
  }

  return markers;
}

export interface FloorplanEditorDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FloorplanEditorDialog({ isOpen, onOpenChange }: FloorplanEditorDialogProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const isWide = useMediaQuery('(min-width: 900px)');
  const rooms = useAreaRooms();
  const deviceCollection = useDevices({ enabled: isOpen });
  const devices = useMemo(() => Object.values(deviceCollection).flat(), [deviceCollection]);

  const floorplan = useFloorplanStore((state) => state.floorplan);
  const setImage = useFloorplanStore((state) => state.setImage);
  const addZone = useFloorplanStore((state) => state.addZone);
  const updateZone = useFloorplanStore((state) => state.updateZone);
  const removeZone = useFloorplanStore((state) => state.removeZone);
  const setPlacement = useFloorplanStore((state) => state.setPlacement);
  const removePlacement = useFloorplanStore((state) => state.removePlacement);
  const resetFloorplan = useFloorplanStore((state) => state.resetFloorplan);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<FloorplanEditorMode>('zone');
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<FloorplanPoint[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<FloorplanZoneId | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [deviceQuery, setDeviceQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setIsDrawing(false);
      setDraftPoints([]);
    }
  }, [isOpen]);

  const zoneByRoomName = useMemo(() => {
    const map = new Map<string, FloorplanZone>();
    for (const zone of floorplan.zones) {
      if (zone.roomId && !map.has(normalizeRoomName(zone.roomId))) {
        map.set(normalizeRoomName(zone.roomId), zone);
      }
    }
    return map;
  }, [floorplan.zones]);

  const markers = useMemo(
    () => buildMarkers(floorplan, devices, zoneByRoomName),
    [devices, floorplan, zoneByRoomName]
  );
  const markerEntityIds = useMemo(
    () => new Set(markers.map((marker) => marker.entityId)),
    [markers]
  );

  const filteredDevices = useMemo(() => {
    const query = deviceQuery.trim().toLocaleLowerCase();
    const matched = query
      ? devices.filter(
          (device) =>
            device.name.toLocaleLowerCase().includes(query) ||
            device.room.toLocaleLowerCase().includes(query)
        )
      : devices;
    return matched
      .slice()
      .sort((left, right) => {
        const leftOnPlan = markerEntityIds.has(left.id) ? 0 : 1;
        const rightOnPlan = markerEntityIds.has(right.id) ? 0 : 1;
        if (leftOnPlan !== rightOnPlan) {
          return leftOnPlan - rightOnPlan;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, MAX_VISIBLE_DEVICES);
  }, [deviceQuery, devices, markerEntityIds]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      const uploadError = validateImageFile(file);
      if (uploadError) {
        toast.error(
          uploadError === 'Please upload an image file'
            ? t('dashboard.floorplan.image.invalid')
            : t('dashboard.floorplan.image.tooLarge')
        );
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const size = await loadImageSize(dataUrl);
        setImage(dataUrl, size.width, size.height);
      } catch {
        toast.error(t('dashboard.floorplan.image.invalid'));
      }
    },
    [setImage, t]
  );

  const startDrawing = useCallback(() => {
    setMode('zone');
    setIsDrawing(true);
    setDraftPoints([]);
    setSelectedEntityId(null);
  }, []);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setDraftPoints([]);
  }, []);

  const undoDraftPoint = useCallback(() => {
    setDraftPoints((current) => current.slice(0, -1));
  }, []);

  const addDraftPoint = useCallback((point: FloorplanPoint) => {
    setDraftPoints((current) =>
      current.length >= MAX_FLOORPLAN_ZONE_POINTS ? current : [...current, point]
    );
  }, []);

  const finishDrawing = useCallback(() => {
    setDraftPoints((current) => {
      if (current.length < MIN_FLOORPLAN_ZONE_POINTS) {
        return current;
      }
      const zoneId = addZone({
        name: t('dashboard.floorplan.zones.defaultName', { count: floorplan.zones.length + 1 }),
        roomId: null,
        points: current,
      });
      if (zoneId) {
        setSelectedZoneId(zoneId);
      }
      setIsDrawing(false);
      return [];
    });
  }, [addZone, floorplan.zones.length, t]);

  const handleSelectDevice = useCallback(
    (device: DeviceWithType) => {
      setMode('device');
      setSelectedEntityId(device.id);
      if (!markerEntityIds.has(device.id)) {
        setPlacement(
          device.id,
          getDefaultFloorplanPlacement(
            floorplan.zones,
            device.room || null,
            Object.keys(floorplan.placements).length
          )
        );
      }
    },
    [floorplan.placements, floorplan.zones, markerEntityIds, setPlacement]
  );

  const modeOptions = [
    { value: 'zone' as const, label: t('dashboard.floorplan.mode.zones'), icon: Layers },
    { value: 'device' as const, label: t('dashboard.floorplan.mode.devices'), icon: MapPin },
  ];

  const draftCountLabel = t(
    draftPoints.length === 1
      ? 'dashboard.floorplan.zones.points.one'
      : 'dashboard.floorplan.zones.points.other',
    { count: draftPoints.length }
  );

  const modeToggle = (
    <div role="tablist" className="flex gap-1.5">
      {modeOptions.map((option) => {
        const Icon = option.icon;
        return (
          <InteractivePill
            key={option.value}
            active={mode === option.value}
            intent="action"
            size="small"
            onClick={() => {
              setMode(option.value);
              if (option.value !== 'zone') {
                setIsDrawing(false);
                setDraftPoints([]);
              }
            }}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[18px] px-3 py-2 text-sm"
          >
            <Icon className={navetIconSizeTokens.sm} aria-hidden="true" />
            <span className="truncate">{option.label}</span>
          </InteractivePill>
        );
      })}
    </div>
  );

  const zonePanel = (
    <>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="small"
          leading={<Upload className={navetIconSizeTokens.sm} aria-hidden="true" />}
          onClick={openFilePicker}
          className="flex-1"
        >
          {t('dashboard.floorplan.image.replace')}
        </Button>
        <Button
          variant="destructive"
          size="small"
          leading={<X className={navetIconSizeTokens.sm} aria-hidden="true" />}
          onClick={resetFloorplan}
          className="flex-1"
        >
          {t('dashboard.floorplan.image.remove')}
        </Button>
      </div>

      <p className={cn(navetTypographyTokens.label, surface.textSecondary)}>
        {t('dashboard.floorplan.zones.description')}
      </p>

      {isDrawing ? (
        <div className={cn('flex flex-col gap-2 rounded-[18px] border p-3', surface.border)}>
          <span className={cn(navetTypographyTokens.label, surface.textPrimary)}>
            {draftCountLabel}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="small"
              leading={<Undo2 className={navetIconSizeTokens.sm} aria-hidden="true" />}
              disabled={draftPoints.length === 0}
              onClick={undoDraftPoint}
            >
              {t('common.undo')}
            </Button>
            <Button variant="ghost" size="small" onClick={cancelDrawing}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="small"
              leading={<Check className={navetIconSizeTokens.sm} aria-hidden="true" />}
              disabled={draftPoints.length < MIN_FLOORPLAN_ZONE_POINTS}
              onClick={finishDrawing}
            >
              {t('dashboard.floorplan.zones.finish')}
            </Button>
          </div>
          {draftPoints.length < MIN_FLOORPLAN_ZONE_POINTS ? (
            <span className={cn('text-xs', surface.textMuted)}>
              {t('dashboard.floorplan.zones.minPoints')}
            </span>
          ) : null}
        </div>
      ) : (
        <Button
          variant="primary"
          size="small"
          leading={<MapIcon className={navetIconSizeTokens.sm} aria-hidden="true" />}
          onClick={startDrawing}
        >
          {t('dashboard.floorplan.zones.draw')}
        </Button>
      )}

      {floorplan.zones.length === 0 ? (
        <p className={cn('text-xs', surface.textMuted)}>{t('dashboard.floorplan.zones.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {floorplan.zones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            return (
              <div
                key={zone.id}
                className={cn(
                  'flex flex-col gap-2 rounded-[18px] border p-3 transition-[border-color] motion-reduce:transition-none',
                  isSelected ? surface.borderStrong : surface.border
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={zone.name || t('dashboard.floorplan.zones.nameLabel')}
                    onClick={() => setSelectedZoneId(isSelected ? null : zone.id)}
                    className="h-4 w-4 shrink-0 rounded-full border"
                    style={{
                      backgroundColor: zone.color,
                      borderColor: isSelected ? zone.color : 'transparent',
                      boxShadow: isSelected ? `0 0 0 3px ${zone.color}33` : undefined,
                    }}
                  />
                  <Input
                    size="small"
                    value={zone.name}
                    placeholder={t('dashboard.floorplan.zones.nameLabel')}
                    onFocus={() => setSelectedZoneId(zone.id)}
                    onChange={(event) => updateZone(zone.id, { name: event.target.value })}
                    containerClassName="min-w-0 flex-1"
                  />
                  <IconButton
                    variant="ghost"
                    size="small"
                    label={t('dashboard.floorplan.zones.delete')}
                    icon={<Trash2 className={navetIconSizeTokens.sm} aria-hidden="true" />}
                    onClick={() => {
                      if (selectedZoneId === zone.id) {
                        setSelectedZoneId(null);
                      }
                      removeZone(zone.id);
                    }}
                  />
                </div>
                <Select
                  size="small"
                  value={zone.roomId ?? ''}
                  onChange={(event) => updateZone(zone.id, { roomId: event.target.value || null })}
                >
                  <option value="">{t('dashboard.floorplan.zones.unlinked')}</option>
                  {rooms.map((room) => (
                    <option key={room} value={room}>
                      {room}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const devicePanel = (
    <>
      <p className={cn(navetTypographyTokens.label, surface.textSecondary)}>
        {t('dashboard.floorplan.devices.autoHint')}
      </p>
      <Input
        size="small"
        value={deviceQuery}
        onChange={(event) => setDeviceQuery(event.target.value)}
        placeholder={t('dashboard.floorplan.devices.searchPlaceholder')}
        leading={<Search className={navetIconSizeTokens.sm} aria-hidden="true" />}
      />
      {filteredDevices.length === 0 ? (
        <p className={cn('text-xs', surface.textMuted)}>{t('dashboard.floorplan.devices.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {filteredDevices.map((device) => {
            const DeviceIcon = getDeviceTypeIcon(device.type, getDeviceClass(device));
            const picture = getDevicePicture(device);
            const onFloorplan = markerEntityIds.has(device.id);
            const isExplicit = device.id in floorplan.placements;
            const isSelected = device.id === selectedEntityId;
            return (
              <div
                key={device.id}
                className={cn(
                  'flex items-center gap-2 rounded-[16px] border px-2 py-1.5',
                  isSelected ? surface.borderStrong : 'border-transparent',
                  surface.hoverBg
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectDevice(device)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border',
                      surface.border
                    )}
                  >
                    {picture ? (
                      <img
                        src={picture}
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <DeviceIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn('block truncate text-sm font-semibold', surface.textPrimary)}
                    >
                      {device.name}
                    </span>
                    <span className={cn('block truncate text-xs', surface.textMuted)}>
                      {device.room || t('common.noRoom')}
                    </span>
                  </span>
                </button>
                {onFloorplan && isExplicit ? (
                  <IconButton
                    variant="ghost"
                    size="small"
                    label={t('dashboard.floorplan.devices.remove')}
                    icon={<MapPinOff className={navetIconSizeTokens.sm} aria-hidden="true" />}
                    onClick={() => removePlacement(device.id)}
                  />
                ) : onFloorplan ? (
                  <MapPin
                    className={cn('mr-1 shrink-0 opacity-60', navetIconSizeTokens.sm)}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const panel = (
    <div className="flex flex-col gap-3 p-4">
      {modeToggle}
      {mode === 'zone' ? zonePanel : devicePanel}
    </div>
  );

  const canvas = (
    <FloorplanCanvas
      floorplan={floorplan}
      mode={mode}
      isDrawing={isDrawing}
      draftPoints={draftPoints}
      selectedZoneId={selectedZoneId}
      selectedEntityId={selectedEntityId}
      markers={markers}
      onAddDraftPoint={addDraftPoint}
      onMovePlacement={(entityId, point) => setPlacement(entityId, point)}
      onCommitPlacement={(entityId, point) => setPlacement(entityId, point)}
      onSelectZone={setSelectedZoneId}
      onSelectEntity={setSelectedEntityId}
    />
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <BaseCardDialog
        variant="fullscreen"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title={t('dashboard.floorplan.title')}
        description={t('dashboard.floorplan.description')}
        theme={theme}
        contentClassName={cn(
          'md:left-1/2 md:right-auto md:w-[calc(100%-4rem)] md:max-w-[1200px] md:-translate-x-1/2',
          surface.shellPanel,
          surface.border
        )}
        shellBodyClassName="h-full min-h-0"
      >
        <NavigationWorkspace.Frame
          aria-label={t('dashboard.floorplan.title')}
          className="h-full min-h-0 max-h-full rounded-none border-0 bg-transparent shadow-none"
        >
          <NavigationWorkspace.Header
            className={cn(
              coverSheetHeaderClassName,
              'flex min-w-0 items-start justify-between gap-3 pb-3 pl-[calc(env(safe-area-inset-left,0px)+1rem)] pr-[calc(env(safe-area-inset-right,0px)+1rem)] sm:gap-4 sm:px-5 sm:!py-4'
            )}
          >
            <div className="min-w-0">
              <h1 className={cn(navetTypographyTokens.sectionHeading, surface.textPrimary)}>
                {t('dashboard.floorplan.title')}
              </h1>
              <p
                className={cn('mt-1 max-w-2xl', navetTypographyTokens.label, surface.textSecondary)}
              >
                {t('dashboard.floorplan.description')}
              </p>
            </div>
            <IconButton
              data-cover-sheet-inline-dismiss
              variant="ghost"
              label={t('common.close')}
              icon={<X className={navetIconSizeTokens.sm} aria-hidden="true" />}
              onClick={() => onOpenChange(false)}
              className={cn('min-h-11 min-w-11 shrink-0', surface.subtleBg, surface.hoverBg)}
            />
          </NavigationWorkspace.Header>

          {floorplan.image ? (
            isWide ? (
              <NavigationWorkspace.Body className="grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.36fr)]">
                <NavigationWorkspace.Sidebar className="overflow-y-auto">
                  {panel}
                </NavigationWorkspace.Sidebar>
                <NavigationWorkspace.Content>{canvas}</NavigationWorkspace.Content>
              </NavigationWorkspace.Body>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  className={cn(
                    'max-h-[44dvh] shrink-0 overflow-y-auto border-b',
                    surface.border,
                    surface.panelMuted
                  )}
                >
                  {panel}
                </div>
                <div className="min-h-0 flex-1">{canvas}</div>
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div
                className={cn(
                  'flex max-w-sm flex-col items-center gap-3 rounded-[22px] border p-6 text-center',
                  surface.border,
                  surface.subtleBg
                )}
              >
                <MapIcon className="h-8 w-8 opacity-70" aria-hidden="true" />
                <h2 className={cn(navetTypographyTokens.sectionHeading, surface.textPrimary)}>
                  {t('dashboard.floorplan.empty.title')}
                </h2>
                <p className={cn(navetTypographyTokens.label, surface.textSecondary)}>
                  {t('dashboard.floorplan.empty.description')}
                </p>
                <Button
                  variant="primary"
                  leading={<Upload className={navetIconSizeTokens.sm} aria-hidden="true" />}
                  onClick={openFilePicker}
                >
                  {t('dashboard.floorplan.upload')}
                </Button>
              </div>
            </div>
          )}
        </NavigationWorkspace.Frame>
      </BaseCardDialog>
    </>
  );
}
