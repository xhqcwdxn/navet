export const FLOORPLAN_VERSION = 1 as const;

declare const floorplanZoneIdBrand: unique symbol;

export type FloorplanZoneId = string & {
  readonly [floorplanZoneIdBrand]: true;
};

export interface FloorplanPoint {
  x: number;
  y: number;
}

export interface FloorplanZone {
  id: FloorplanZoneId;
  name: string;
  roomId: string | null;
  color: string;
  points: FloorplanPoint[];
}

export interface FloorplanPlacement {
  x: number;
  y: number;
}

export interface FloorplanV1 {
  version: typeof FLOORPLAN_VERSION;
  image: string | null;
  imageWidth: number;
  imageHeight: number;
  zones: FloorplanZone[];
  placements: Record<string, FloorplanPlacement>;
}

export const MAX_FLOORPLAN_ZONES = 64;
export const MAX_FLOORPLAN_ZONE_POINTS = 256;
export const MIN_FLOORPLAN_ZONE_POINTS = 3;
export const MAX_FLOORPLAN_ZONE_NAME_LENGTH = 60;
export const MAX_FLOORPLAN_ENTITY_ID_LENGTH = 320;
export const MAX_FLOORPLAN_IMAGE_LENGTH = 4_000_000;
export const MAX_FLOORPLAN_IMAGE_DIMENSION = 20_000;
export const MAX_FLOORPLAN_PLACEMENTS = 2_000;

export const FLOORPLAN_ZONE_COLORS = [
  '#0ea5e9',
  '#8b5cf6',
  '#f97316',
  '#10b981',
  '#ec4899',
  '#eab308',
  '#ef4444',
  '#14b8a6',
] as const;

const OPAQUE_ZONE_ID_PATTERN = /^zone_[a-zA-Z0-9_-]{6,154}$/;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp|avif|gif);base64,[a-zA-Z0-9+/=]+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeText(value: string): string {
  return Array.from(value.normalize('NFKC'))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
}

function sanitizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? normalizeText(value).slice(0, maxLength).trim() : '';
}

function createRandomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '_');
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function createFloorplanZoneId(): FloorplanZoneId {
  return `zone_${createRandomSuffix()}` as FloorplanZoneId;
}

export function isFloorplanZoneId(value: unknown): value is FloorplanZoneId {
  return typeof value === 'string' && value.length <= 160 && OPAQUE_ZONE_ID_PATTERN.test(value);
}

function sanitizePoint(value: unknown): FloorplanPoint | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.x !== 'number' || typeof value.y !== 'number') {
    return null;
  }
  return { x: clamp01(value.x), y: clamp01(value.y) };
}

function sanitizeZonePoints(value: unknown): FloorplanPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: FloorplanPoint[] = [];
  for (const rawPoint of value.slice(0, MAX_FLOORPLAN_ZONE_POINTS)) {
    const point = sanitizePoint(rawPoint);
    if (point) {
      points.push(point);
    }
  }
  return points;
}

function sanitizeZoneColor(value: unknown, fallbackIndex: number): string {
  if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  return FLOORPLAN_ZONE_COLORS[fallbackIndex % FLOORPLAN_ZONE_COLORS.length];
}

function sanitizeZone(value: unknown, usedIds: Set<string>, fallbackIndex: number) {
  if (!isRecord(value)) {
    return null;
  }

  const points = sanitizeZonePoints(value.points);
  if (points.length < MIN_FLOORPLAN_ZONE_POINTS) {
    return null;
  }

  let id = isFloorplanZoneId(value.id) ? value.id : createFloorplanZoneId();
  if (usedIds.has(id)) {
    id = createFloorplanZoneId();
  }
  usedIds.add(id);

  const roomId = sanitizeText(value.roomId, MAX_FLOORPLAN_ENTITY_ID_LENGTH);

  return {
    id,
    name: sanitizeText(value.name, MAX_FLOORPLAN_ZONE_NAME_LENGTH),
    roomId: roomId || null,
    color: sanitizeZoneColor(value.color, fallbackIndex),
    points,
  } satisfies FloorplanZone;
}

function sanitizePlacements(value: unknown): Record<string, FloorplanPlacement> {
  if (!isRecord(value)) {
    return {};
  }

  const placements: Record<string, FloorplanPlacement> = {};
  for (const [entityId, rawPlacement] of Object.entries(value).slice(0, MAX_FLOORPLAN_PLACEMENTS)) {
    if (!entityId || entityId.length > MAX_FLOORPLAN_ENTITY_ID_LENGTH) {
      continue;
    }
    const placement = sanitizePoint(rawPlacement);
    if (placement) {
      placements[entityId] = placement;
    }
  }
  return placements;
}

function sanitizeImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_FLOORPLAN_IMAGE_LENGTH) {
    return null;
  }
  return IMAGE_DATA_URL_PATTERN.test(value) ? value : null;
}

function sanitizeImageDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_FLOORPLAN_IMAGE_DIMENSION, Math.round(value));
}

export function createEmptyFloorplan(): FloorplanV1 {
  return {
    version: FLOORPLAN_VERSION,
    image: null,
    imageWidth: 0,
    imageHeight: 0,
    zones: [],
    placements: {},
  };
}

export function parseFloorplan(value: unknown): FloorplanV1 {
  if (!isRecord(value) || value.version !== FLOORPLAN_VERSION) {
    return createEmptyFloorplan();
  }

  const usedIds = new Set<string>();
  const zones: FloorplanZone[] = [];
  if (Array.isArray(value.zones)) {
    for (const [index, rawZone] of value.zones.slice(0, MAX_FLOORPLAN_ZONES).entries()) {
      const zone = sanitizeZone(rawZone, usedIds, index);
      if (zone) {
        zones.push(zone);
      }
    }
  }

  const image = sanitizeImage(value.image);
  if (!image) {
    return createEmptyFloorplan();
  }

  return {
    version: FLOORPLAN_VERSION,
    image,
    imageWidth: sanitizeImageDimension(value.imageWidth),
    imageHeight: sanitizeImageDimension(value.imageHeight),
    zones,
    placements: sanitizePlacements(value.placements),
  };
}

export function getFloorplanZoneBounds(points: readonly FloorplanPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (points.length === 0) {
    return null;
  }

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function getFloorplanZoneCentroid(points: readonly FloorplanPoint[]): FloorplanPoint {
  if (points.length === 0) {
    return { x: 0.5, y: 0.5 };
  }

  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: clamp01(x / points.length), y: clamp01(y / points.length) };
}

export function isPointInFloorplanZone(
  point: FloorplanPoint,
  points: readonly FloorplanPoint[]
): boolean {
  if (points.length < MIN_FLOORPLAN_ZONE_POINTS) {
    return false;
  }

  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index, index += 1
  ) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function findFloorplanZoneAtPoint(
  zones: readonly FloorplanZone[],
  point: FloorplanPoint
): FloorplanZoneId | null {
  for (let index = zones.length - 1; index >= 0; index -= 1) {
    if (isPointInFloorplanZone(point, zones[index].points)) {
      return zones[index].id;
    }
  }
  return null;
}

export function getZoneAutoPositions(
  points: readonly FloorplanPoint[],
  count: number
): FloorplanPoint[] {
  if (count <= 0) {
    return [];
  }

  const bounds = getFloorplanZoneBounds(points);
  if (!bounds) {
    return [];
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const width = Math.max(0.0001, bounds.maxX - bounds.minX);
  const height = Math.max(0.0001, bounds.maxY - bounds.minY);

  const positions: FloorplanPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.push({
      x: clamp01(bounds.minX + ((column + 0.5) / columns) * width),
      y: clamp01(bounds.minY + ((row + 0.5) / rows) * height),
    });
  }
  return positions;
}

export function getDefaultFloorplanPlacement(
  zones: readonly FloorplanZone[],
  roomId: string | null,
  occupiedCount: number
): FloorplanPoint {
  const zone = roomId ? zones.find((entry) => entry.roomId === roomId) : undefined;
  if (zone) {
    return getFloorplanZoneCentroid(zone.points);
  }

  const column = occupiedCount % 6;
  const row = Math.floor(occupiedCount / 6) % 6;
  return {
    x: clamp01(0.5 + (column - 2.5) * 0.045),
    y: clamp01(0.5 + (row - 2.5) * 0.045),
  };
}
