"use client";
import { createAuthClient } from "better-auth/react";

/** Client Better Auth (même origine que l'app : pas de baseURL nécessaire). */
export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
