import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { anonymous } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { authAccount, authRateLimit, authSession, authUser, authVerification } from "@/db/schema";

const developmentSecret = "local-only-family-utils-secret-replace-before-deploy";

export function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const google = clientId && clientSecret
    ? { google: { clientId, clientSecret, prompt: "select_account" as const, scope: ["openid", "email", "profile"] } }
    : {};

  return betterAuth({
    appName: "Family Utils",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: secret || developmentSecret,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
    }),
    socialProviders: google,
    emailAndPassword: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.isAnonymous) return;
            const allowedEmails = new Set((process.env.FAMILY_BOOTSTRAP_EMAILS ?? "")
              .split(",")
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean));
            if (!allowedEmails.has(user.email.toLowerCase())) {
              throw new APIError("FORBIDDEN", { message: "Access is not available for this account" });
            }
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60 * 15,
      max: 10,
    },
    plugins: [
      anonymous({
        disableDeleteAnonymousUser: true,
        generateRandomEmail: () => `device-${randomUUID()}@anonymous.family-utils.invalid`,
        generateName: () => "Integrante familiar",
      }),
    ],
    advanced: {
      database: { generateId: "uuid" },
    },
  });
}
