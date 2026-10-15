import { STORE_STORAGE_KEYS } from '@navet/app/constants/storage-keys';
import {
  readLocalStorageWithMigration,
  removeLocalStorageWithMigration,
  writeLocalStorageWithMigration,
} from '@navet/app/utils/local-storage-migration';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createEmptyFloorplan,
  createFloorplanZoneId,
  FLOORPLAN_ZONE_COLORS,
  type FloorplanPoint,
  type FloorplanV1,
  type FloorplanZone,
  type FloorplanZoneId,
  MAX_FLOORPLAN_ZONE_POINTS,
  MAX_FLOORPLAN_ZONES,
  parseFloorplan,
} from './floorplan';

export interface AddFloorplanZoneInput {
  name: string;
  roomId: string | null;
  color?: string;
  points: FloorplanPoint[];
}

export interface UpdateFloorplanZonePatch {
  name?: string;
  roomId?: string | null;
  color?: string;
  points?: FloorplanPoint[];
}

interface FloorplanState {
  floorplan: FloorplanV1;
  setImage: (image: string | null, imageWidth?: number, imageHeight?: number) => void;
  addZone: (input: AddFloorplanZoneInput) => FloorplanZoneId | null;
  updateZone: (zoneId: FloorplanZoneId, patch: UpdateFloorplanZonePatch) => void;
  removeZone: (zoneId: FloorplanZoneId) => void;
  setPlacement: (entityId: string, point: FloorplanPoint) => void;
  removePlacement: (entityId: string) => void;
  clearPlacements: () => void;
  resetFloorplan: () => void;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export const useFloorplanStore = create<FloorplanState>()(
  persist(
    (set) => ({
      floorplan: readInitialFloorplan(),
      setImage: (image, imageWidth = 0, imageHeight = 0) =>
        set((state) => ({
          floorplan: {
            ...state.floorplan,
            image,
            imageWidth: image ? Math.max(0, Math.round(imageWidth)) : 0,
            imageHeight: image ? Math.max(0, Math.round(imageHeight)) : 0,
          },
        })),
      addZone: (input) => {
        const points = input.points.slice(0, MAX_FLOORPLAN_ZONE_POINTS).map((point) => ({
          x: clamp01(point.x),
          y: clamp01(point.y),
        }));
        if (points.length < 3) {
          return null;
        }

        const zoneId = createFloorplanZoneId();
        const zone: FloorplanZone = {
          id: zoneId,
          name: input.name.trim(),
          roomId: input.roomId,
          color: input.color ?? FLOORPLAN_ZONE_COLORS[0],
          points,
        };
        set((state) => {
          const zones = [...state.floorplan.zones, zone].slice(0, MAX_FLOORPLAN_ZONES);
          return { floorplan: { ...state.floorplan, zones } };
        });
        return zoneId;
      },
      updateZone: (zoneId, patch) =>
        set((state) => {
          if (!state.floorplan.zones.some((zone) => zone.id === zoneId)) {
            return state;
          }
          return {
            floorplan: {
              ...state.floorplan,
              zones: state.floorplan.zones.map((zone) =>
                zone.id === zoneId
                  ? {
                      ...zone,
                      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                      ...(patch.roomId !== undefined ? { roomId: patch.roomId } : {}),
                      ...(patch.color !== undefined ? { color: patch.color } : {}),
                      ...(patch.points !== undefined
                        ? {
                            points: patch.points
                              .slice(0, MAX_FLOORPLAN_ZONE_POINTS)
                              .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) })),
                          }
                        : {}),
                    }
                  : zone
              ),
            },
          };
        }),
      removeZone: (zoneId) =>
        set((state) => ({
          floorplan: {
            ...state.floorplan,
            zones: state.floorplan.zones.filter((zone) => zone.id !== zoneId),
          },
        })),
      setPlacement: (entityId, point) =>
        set((state) => {
          if (!entityId) {
            return state;
          }
          const next = { x: clamp01(point.x), y: clamp01(point.y) };
          const current = state.floorplan.placements[entityId];
          if (current && current.x === next.x && current.y === next.y) {
            return state;
          }
          return {
            floorplan: {
              ...state.floorplan,
              placements: { ...state.floorplan.placements, [entityId]: next },
            },
          };
        }),
      removePlacement: (entityId) =>
        set((state) => {
          if (!(entityId in state.floorplan.placements)) {
            return state;
          }
          const placements = { ...state.floorplan.placements };
          delete placements[entityId];
          return { floorplan: { ...state.floorplan, placements } };
        }),
      clearPlacements: () =>
        set((state) => ({ floorplan: { ...state.floorplan, placements: {} } })),
      resetFloorplan: () => set({ floorplan: createEmptyFloorplan() }),
    }),
    {
      name: STORE_STORAGE_KEYS.floorplan,
      storage: createJSONStorage(() => ({
        getItem: (name) => readLocalStorageWithMigration(name, localStorage),
        setItem: (name, value) => writeLocalStorageWithMigration(name, value, localStorage),
        removeItem: (name) => removeLocalStorageWithMigration(name, localStorage),
      })),
      partialize: (state) => ({ floorplan: state.floorplan }),
      merge: (persistedState, currentState) => {
        const state = persistedState as Partial<FloorplanState> | undefined;
        return {
          ...currentState,
          floorplan: parseFloorplan(state?.floorplan),
        };
      },
    }
  )
);

function readInitialFloorplan(): FloorplanV1 {
  if (typeof window === 'undefined') {
    return createEmptyFloorplan();
  }

  try {
    const raw = readLocalStorageWithMigration(STORE_STORAGE_KEYS.floorplan, window.localStorage);
    if (!raw) {
      return createEmptyFloorplan();
    }
    const parsed = JSON.parse(raw) as { state?: { floorplan?: unknown } };
    return parseFloorplan(parsed.state?.floorplan);
  } catch {
    return createEmptyFloorplan();
  }
}
