import { BaseCardDialog } from '@navet/app/components/primitives';
import { renderCard } from '@navet/app/features/dashboard/utils/card-renderer';
import { useTheme } from '@navet/app/hooks';
import type { DeviceWithType } from '@navet/app/types/device.types';

interface FloorplanDeviceDialogProps {
  device: DeviceWithType | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const NOOP_SIZE_CHANGE = () => {};

/**
 * Device detail window opened from a floor plan marker. It reuses the dashboard
 * device card so the floor plan exposes the same controls as the rest of Navet.
 */
export function FloorplanDeviceDialog({
  device,
  isOpen,
  onOpenChange,
}: FloorplanDeviceDialogProps) {
  const { theme } = useTheme();

  if (!device) {
    return null;
  }

  return (
    <BaseCardDialog
      variant="modal"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={device.name}
      description={device.room || undefined}
      theme={theme}
      maxWidth="md"
      bodyPadding={false}
      bodyClassName="p-4"
      mobileCoverSheet
    >
      <div className="h-[20rem] w-full sm:h-[22rem]">
        {renderCard({
          device: device as Parameters<typeof renderCard>[0]['device'],
          size: 'medium',
          handleSizeChange: NOOP_SIZE_CHANGE,
          isEditMode: false,
        })}
      </div>
    </BaseCardDialog>
  );
}
