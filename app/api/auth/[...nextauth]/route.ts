import NextAuth, { NextAuthOptions } from "next-auth"
import GithubProvider from "next-auth/providers/github"

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user read:org",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // Check if user is member of macroscope-gtm org
      if (!account?.access_token || !profile) {
        console.log("Auth: Sign in failed - Missing account or profile")
        return false
      }

      const githubLogin = (profile as { login?: string }).login

      if (!githubLogin) {
        console.log("Auth: Sign in failed - No GitHub login found")
        return false
      }

      try {
        console.log(`Auth: Checking org membership for ${githubLogin}`)

        const response = await fetch(
          `https://api.github.com/orgs/macroscope-gtm/members/${githubLogin}`,
          {
            headers: {
              Authorization: `Bearer ${account.access_token}`,
              Accept: "application/vnd.github+json",
            },
          }
        )

        if (response.status === 204) {
          // 204 = user is a member
          console.log(`Auth: Access granted - ${githubLogin} is a member of macroscope-gtm`)
          return true
        } else if (response.status === 404) {
          // 404 = user is not a member
          console.log(`Auth: Access denied - ${githubLogin} is not a member of macroscope-gtm`)
          return false
        } else {
          console.log(`Auth: Unexpected response status: ${response.status}`)
          return false
        }
      } catch (error) {
        console.error("Auth: Error checking org membership:", error)
        return false
      }
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

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
