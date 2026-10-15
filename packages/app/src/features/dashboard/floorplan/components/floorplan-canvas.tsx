import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { getThemeFocusRingClassName } from '@navet/app/components/system/tokens';
import { cn } from '@navet/app/components/ui/utils';
import { getDeviceTypeIcon } from '@navet/app/constants/device-type-icons';
import { useTheme } from '@navet/app/hooks';
import type { DeviceWithType } from '@navet/app/types/device.types';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FloorplanPoint, FloorplanV1, FloorplanZoneId } from '../floorplan';

export function getDevicePicture(device: DeviceWithType): string | null {
  const picture = (device as { entityPicture?: unknown }).entityPicture;
  return typeof picture === 'string' && picture.length > 0 ? picture : null;
}

export function getDeviceClass(device: DeviceWithType): string | undefined {
  const deviceClass = (device as { deviceClass?: unknown }).deviceClass;
  return typeof deviceClass === 'string' && deviceClass.length > 0 ? deviceClass : undefined;
}

export type FloorplanCanvasMode = 'zone' | 'device';

export interface FloorplanMarker {
  entityId: string;
  point: FloorplanPoint;
  device: DeviceWithType;
  auto: boolean;
}

export interface FloorplanCanvasProps {
  floorplan: FloorplanV1;
  mode: FloorplanCanvasMode;
  isDrawing: boolean;
  draftPoints: FloorplanPoint[];
  selectedZoneId: FloorplanZoneId | null;
  selectedEntityId: string | null;
  markers: readonly FloorplanMarker[];
  onAddDraftPoint: (point: FloorplanPoint) => void;
  onMovePlacement: (entityId: string, point: FloorplanPoint) => void;
  onCommitPlacement: (entityId: string, point: FloorplanPoint) => void;
  onSelectZone: (zoneId: FloorplanZoneId | null) => void;
  onSelectEntity: (entityId: string | null) => void;
}

interface Size {
  width: number;
  height: number;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function toPolygonPoints(points: readonly FloorplanPoint[]) {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
}

function computeContainRect(container: Size, image: Size): Size {
  if (container.width <= 0 || container.height <= 0) {
    return { width: 0, height: 0 };
  }
  if (image.width <= 0 || image.height <= 0) {
    return container;
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function FloorplanCanvas({
  floorplan,
  mode,
  isDrawing,
  draftPoints,
  selectedZoneId,
  selectedEntityId,
  markers,
  onAddDraftPoint,
  onMovePlacement,
  onCommitPlacement,
  onSelectZone,
  onSelectEntity,
}: FloorplanCanvasProps) {
  const { theme, accentColor } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const focusRing = getThemeFocusRingClassName(theme);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  const [draftCursor, setDraftCursor] = useState<FloorplanPoint | null>(null);
  const activeDragRef = useRef<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      const rect = element.getBoundingClientRect();
      setContainerSize((current) =>
        Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
          ? current
          : { width: rect.width, height: rect.height }
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(
    () =>
      computeContainRect(containerSize, {
        width: floorplan.imageWidth,
        height: floorplan.imageHeight,
      }),
    [containerSize, floorplan.imageHeight, floorplan.imageWidth]
  );

  const pointFromEvent = useCallback((clientX: number, clientY: number): FloorplanPoint | null => {
    const frame = frameRef.current;
    if (!frame) {
      return null;
    }
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  const handleDrawingPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const point = pointFromEvent(event.clientX, event.clientY);
    if (point) {
      onAddDraftPoint(point);
    }
  };

  const handleMarkerPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    entityId: string
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    activeDragRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectEntity(entityId);
  };

  const handleMarkerPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    entityId: string
  ) => {
    if (activeDragRef.current !== event.pointerId) {
      return;
    }
    const point = pointFromEvent(event.clientX, event.clientY);
    if (point) {
      onMovePlacement(entityId, point);
    }
  };

  const handleMarkerPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, entityId: string) => {
    if (activeDragRef.current !== event.pointerId) {
      return;
    }
    activeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const point = pointFromEvent(event.clientX, event.clientY);
    if (point) {
      onCommitPlacement(entityId, point);
    }
  };

  if (!floorplan.image) {
    return null;
  }

  const draftPolygon =
    draftPoints.length >= 2
      ? `${toPolygonPoints(draftPoints)}${
          draftCursor && isDrawing ? ` ${draftCursor.x * 100},${draftCursor.y * 100}` : ''
        }`
      : null;
  const hasFrameSize = frameSize.width > 0;
  const isDrawingOverlay = mode === 'zone' && isDrawing;

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden p-2"
    >
      <div
        ref={frameRef}
        data-floorplan-frame
        className={cn(
          'relative touch-none overflow-hidden rounded-[18px] border',
          surface.border,
          hasFrameSize ? '' : 'h-full w-full'
        )}
        style={hasFrameSize ? { width: frameSize.width, height: frameSize.height } : undefined}
        onPointerMove={(event) => {
          if (!isDrawing) {
            return;
          }
          setDraftCursor(pointFromEvent(event.clientX, event.clientY));
        }}
        onPointerLeave={() => setDraftCursor(null)}
      >
        <img
          src={floorplan.image}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none block h-full w-full select-none"
        />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {floorplan.zones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            return (
              <polygon
                key={zone.id}
                points={toPolygonPoints(zone.points)}
                fill={zone.color}
                fillOpacity={isSelected ? 0.34 : 0.18}
                stroke={zone.color}
                strokeOpacity={isSelected ? 1 : 0.7}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={isDrawingOverlay ? undefined : 'cursor-pointer'}
                onPointerDown={
                  isDrawingOverlay
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        onSelectZone(zone.id === selectedZoneId ? null : zone.id);
                      }
                }
              />
            );
          })}
          {draftPolygon ? (
            <polygon
              points={draftPolygon}
              fill={accentColor}
              fillOpacity={0.16}
              stroke={accentColor}
              strokeOpacity={0.9}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {draftPoints.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x * 100}
              cy={point.y * 100}
              r={1.4}
              fill={accentColor}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {isDrawingOverlay ? (
          <div
            role="presentation"
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={handleDrawingPointerDown}
          />
        ) : null}

        {mode === 'device' &&
          markers.map(({ entityId, point, device, auto }) => {
            const isSelected = entityId === selectedEntityId;
            const DeviceIcon = getDeviceTypeIcon(device.type, getDeviceClass(device));
            const picture = getDevicePicture(device);
            return (
              <button
                key={entityId}
                type="button"
                aria-label={device.name}
                data-floorplan-marker
                data-floorplan-marker-auto={auto ? 'true' : undefined}
                onPointerDown={(event) => handleMarkerPointerDown(event, entityId)}
                onPointerMove={(event) => handleMarkerPointerMove(event, entityId)}
                onPointerUp={(event) => handleMarkerPointerUp(event, entityId)}
                onPointerCancel={(event) => handleMarkerPointerUp(event, entityId)}
                className={cn(
                  'absolute z-[2] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center overflow-hidden rounded-full border text-white active:cursor-grabbing',
                  auto ? 'border-dashed' : surface.borderStrong,
                  focusRing
                )}
                style={{
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  backgroundColor: accentColor,
                  opacity: auto && !isSelected ? 0.9 : 1,
                  boxShadow: isSelected
                    ? `0 0 0 2px ${accentColor}, 0 8px 18px -6px rgba(2,8,20,0.6)`
                    : '0 6px 14px -6px rgba(2,8,20,0.55)',
                }}
              >
                {picture ? (
                  <img
                    src={picture}
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none h-full w-full object-cover"
                  />
                ) : (
                  <DeviceIcon className="pointer-events-none h-4 w-4" aria-hidden="true" />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
