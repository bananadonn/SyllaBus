import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * `calendar.app.created` lets the app create its own secondary calendars and manage events on
 * them only. It cannot read or touch the user's other calendars.
 */
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "TokenExpired";
  }
}

export const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth } = NextAuth({
  providers: googleConfigured
    ? [
        Google({
          authorization: { params: { scope: `openid email profile ${CALENDAR_SCOPE}` } },
        }),
      ]
    : [],
  session: { strategy: "jwt" },
  // If the user cancels on Google's page, come back to the app (it shows a message) instead of
  // Auth.js's bare error page, which has no way back.
  pages: { error: "/" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.expiresAt = account.expires_at; // seconds since epoch
      }
      return token;
    },
    async session({ session, token }) {
      const expiresAt = token.expiresAt as number | undefined;
      if (expiresAt && Date.now() / 1000 > expiresAt - 60) {
        session.error = "TokenExpired";
      } else {
        session.accessToken = token.accessToken as string | undefined;
      }
      return session;
    },
  },
});
