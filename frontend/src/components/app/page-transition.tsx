import type { ReactNode } from 'react';
import { motion } from 'motion/react';

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      data-slot="page-transition"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
