"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import type { QuizQuestion } from "@/lib/storyboard/types";

const LETTERS = ["A", "B", "C", "D"];

/** Quiz à 4 choix affiché en fin de capsule ; la réponse part dans `/api/progress`. */
export function QuizOverlay({
  quiz,
  onAnswer,
  onReplay,
  onNext,
  hasNext,
}: {
  quiz: QuizQuestion;
  onAnswer: (correct: boolean) => void;
  onReplay: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === quiz.correctIndex;

  function pick(i: number) {
    if (answered) return;
    setPicked(i);
    onAnswer(i === quiz.correctIndex);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-20 flex flex-col justify-end bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <motion.section
        initial={{ y: 60 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="flex flex-col gap-3 rounded-t-3xl border-t border-white/10 bg-zinc-900 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Quiz éclair</p>
        <p className="text-lg font-bold leading-snug">{quiz.question}</p>
        <div className="flex flex-col gap-2">
          {quiz.choices.map((choice, i) => {
            const state = !answered
              ? "idle"
              : i === quiz.correctIndex
                ? "right"
                : i === picked
                  ? "wrong"
                  : "dim";
            return (
              <motion.button
                key={i}
                type="button"
                whileTap={answered ? undefined : { scale: 0.97 }}
                animate={state === "wrong" ? { x: [0, -6, 6, -4, 4, 0] } : undefined}
                transition={{ duration: 0.35 }}
                onClick={() => pick(i)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[0.95rem] ${
                  state === "idle"
                    ? "border-white/15 bg-white/5 active:bg-white/10"
                    : state === "right"
                      ? "border-accent bg-accent/15 text-accent"
                      : state === "wrong"
                        ? "border-red-400 bg-red-400/10 text-red-300"
                        : "border-white/5 text-white/40"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    state === "right" ? "bg-accent text-black" : state === "wrong" ? "bg-red-400 text-black" : "bg-white/10"
                  }`}
                >
                  {state === "right" ? "✓" : state === "wrong" ? "✕" : LETTERS[i]}
                </span>
                {choice}
              </motion.button>
            );
          })}
        </div>
        {answered && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-white/80">
              <strong className={correct ? "text-accent" : "text-red-300"}>{correct ? "Bien vu ! " : "Pas tout à fait. "}</strong>
              {quiz.explanation}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onReplay} className="flex-1 rounded-2xl border border-white/15 py-3 text-sm font-semibold">
                ↺ Revoir
              </button>
              {hasNext && (
                <button type="button" onClick={onNext} className="flex-[2] rounded-2xl bg-accent py-3 text-sm font-bold text-black">
                  Capsule suivante ↓
                </button>
              )}
            </div>
          </motion.div>
        )}
        {!answered && (
          <button type="button" onClick={onReplay} className="self-center py-1 text-xs text-white/50">
            Revoir la capsule avant de répondre
          </button>
        )}
      </motion.section>
    </motion.div>
  );
}
