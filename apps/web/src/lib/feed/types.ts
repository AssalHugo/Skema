/** Données du feed vertical, partagées entre le serveur et le lecteur client. */
import type { GeneratedStoryboard } from "@/lib/storyboard/types";

export interface FeedItem {
  episodeId: string;
  title: string;
  courseTitle: string;
  chapterTitle: string;
  storyboard: GeneratedStoryboard;
  progress: { watchedPct: number; quizCorrect: boolean | null } | null;
}

export interface ProgressUpdate {
  episodeId: string;
  /** 0..100 : on ne conserve que le maximum atteint. */
  watchedPct?: number;
  quizCorrect?: boolean;
}
