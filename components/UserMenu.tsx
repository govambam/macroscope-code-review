'use client'

import { useSession, signOut } from 'next-auth/react'
import Image from 'next/image'

export function UserMenu() {
  const { data: session } = useSession()

  if (!session?.user) return null

  const displayName = session.user.name || session.user.login || 'User'
  const username = session.user.login || session.user.email?.split('@')[0] || ''

  return (
    <div className="border-t border-gray-200 p-4 mt-auto">
      <div className="flex items-center gap-3 mb-3">
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={displayName}
            width={40}
            height={40}
            className="rounded-full ring-2 ring-gray-100"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
            <span className="text-indigo-600 font-semibold text-sm">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {displayName}
          </p>
          {username && (
            <p className="text-xs text-gray-500 truncate">
              @{username}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/auth/signin' })}
        className="w-full text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors text-left flex items-center gap-2 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sign Out
      </button>
    </div>
  )
}
