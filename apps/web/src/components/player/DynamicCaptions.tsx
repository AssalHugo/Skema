"use client";
import { AnimatePresence, motion } from "framer-motion";
import { captionAt } from "@/lib/player/timeline";
import type { GeneratedStoryboard } from "@/lib/storyboard/types";

/**
 * Sous-titres karaoké : une ligne (`displaySegments`) à la fois, le mot en
 * cours surligné d'après `wordTimings` (une mark SSML par mot affiché, S.3).
 */
export function DynamicCaptions({ storyboard, timeMs }: { storyboard: GeneratedStoryboard; timeMs: number }) {
  const caption = captionAt(storyboard.displaySegments, storyboard.wordTimings, timeMs);
  return (
    <div className="pointer-events-none flex min-h-[5.5rem] items-end justify-center px-5" aria-live="off">
      <AnimatePresence mode="wait" initial={false}>
        {caption && (
          <motion.p
            key={caption.segmentIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="text-center text-[1.45rem] font-extrabold leading-tight tracking-tight [text-shadow:0_2px_12px_rgba(0,0,0,.85)]"
          >
            {caption.words.map((w) => (
              <span
                key={w.index}
                className={`mx-[0.12em] inline-block rounded-md px-[0.08em] transition-[color,background-color,transform] duration-100 ${
                  w.state === "current"
                    ? "scale-110 bg-accent text-black [text-shadow:none]"
                    : w.state === "past"
                      ? "text-white"
                      : "text-white/45"
                }`}
              >
                {w.word}
              </span>
            ))}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
