import { Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { useSettingsNavigation } from '@/lib/settings';

/** The gear in the Gallery header, which opens Settings. */
export function SettingsButton() {
  const { open } = useSettingsNavigation();

  return (
    <motion.button
      type="button"
      aria-label="Settings"
      onClick={open}
      whileTap={{ scale: 0.9 }}
      transition={springs.snappy}
      className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Settings className="size-[22px]" aria-hidden />
    </motion.button>
  );
}
