import { Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { UpdateDot } from '@/components/UpdateDot/UpdateDot';
import { springs } from '@/lib/motion';
import { useSettingsNavigation } from '@/lib/settings';
import { useAndroidUpdateAvailable } from '@/lib/updates';

/** The gear in the Gallery header, which opens Settings. */
export function SettingsButton() {
  const { open } = useSettingsNavigation();
  const available = useAndroidUpdateAvailable();

  return (
    <motion.button
      type="button"
      aria-label="Settings"
      aria-description={available ? 'App update available' : undefined}
      onClick={() => open()}
      whileTap={{ scale: 0.9 }}
      transition={springs.snappy}
      className="relative flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Settings className="size-[22px]" aria-hidden />
      <UpdateDot className="absolute top-1.5 right-1.5" />
    </motion.button>
  );
}
