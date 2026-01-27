import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request })

  // If no token and trying to access protected route, redirect to signin
  if (!token) {
    const signInUrl = new URL("/auth/signin", request.url)
    signInUrl.searchParams.set("callbackUrl", request.url)
    return NextResponse.redirect(signInUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /auth/* (auth pages - signin, error)
     * - /api/auth/* (NextAuth API routes)
     * - /_next/static (static files)
     * - /_next/image (image optimization)
     * - /favicon.ico, /robots.txt (public files)
     */
    "/((?!auth|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
}
