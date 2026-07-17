import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Loader2, Compass } from "lucide-react";

const STEPS = [
  "Understanding your request",
  "Finding destinations",
  "Checking lodging",
  "Checking transport",
  "Finding activities",
];

const STEP_INTERVAL_MS = 2600;

export function CurationOverlay({ open }: { open: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep(0);
      return;
    }
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      STEP_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/95 backdrop-blur-sm"
          data-testid="curation-overlay"
        >
          <div className="w-full max-w-sm px-8">
            <div className="mb-8 flex items-center gap-2 text-white">
              <Compass className="h-6 w-6" />
              <span className="font-display text-xl font-semibold">Planning your trip</span>
            </div>
            <ul className="space-y-4">
              {STEPS.map((label, i) => {
                const state = i < step ? "done" : i === step ? "active" : "pending";
                return (
                  <motion.li
                    key={label}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: state === "pending" ? 0.45 : 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="flex items-center gap-3 text-sm text-white"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-active">
                      {state === "done" ? (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                          <Check className="h-3.5 w-3.5" />
                        </motion.span>
                      ) : state === "active" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-sidebar-muted" />
                      )}
                    </span>
                    <span className={state === "active" ? "font-medium" : ""}>{label}</span>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
