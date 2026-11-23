"use client";
import { SerwistProvider } from "@serwist/next/react";

/** Enregistre `/sw.js` (désactivé en développement : le fichier n'est construit qu'au build). */
export function PwaProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV !== "production"}>
      {children}
    </SerwistProvider>
  );
}
