import type { DeviceWithType } from '@navet/app/types/device.types';
import { normalizeRoomName } from '@navet/app/utils/room-name';
import {
  type FloorplanPoint,
  type FloorplanV1,
  type FloorplanZone,
  type FloorplanZoneId,
  getZoneAutoPositions,
} from './floorplan';

export interface FloorplanMarker {
  entityId: string;
  point: FloorplanPoint;
  device: DeviceWithType;
  auto: boolean;
}

function buildZoneByRoomName(zones: readonly FloorplanZone[]): Map<string, FloorplanZone> {
  const map = new Map<string, FloorplanZone>();
  for (const zone of zones) {
    if (zone.roomId && !map.has(normalizeRoomName(zone.roomId))) {
      map.set(normalizeRoomName(zone.roomId), zone);
    }
  }
  return map;
}

export function buildFloorplanMarkers(
  floorplan: FloorplanV1,
  devices: readonly DeviceWithType[]
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

  const zoneByRoomName = buildZoneByRoomName(floorplan.zones);
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
