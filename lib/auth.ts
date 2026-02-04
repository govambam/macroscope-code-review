import { NextAuthOptions } from "next-auth"
import GithubProvider from "next-auth/providers/github"

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Allow any GitHub user to sign in (no org membership check)
      const githubLogin = (profile as { login?: string })?.login
      console.log(`Auth: Sign in for ${githubLogin || "unknown"}`)
      return true
    },
    async session({ session, token }) {
      // Add GitHub username to session for future user tracking
      if (token && session.user) {
        session.user.id = token.sub!
        session.user.login = (token.login as string) || session.user.name || ""
      }
      return session
    },
    async jwt({ token, profile }) {
      // Store GitHub login in token
      if (profile) {
        token.login = (profile as { login?: string }).login
      }
      return token
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  secret: process.env.NEXTAUTH_SECRET,
}
