'use client'

import { useSession, signOut } from 'next-auth/react'
import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'

export function UserMenu() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!session?.user) return null

  const displayName = session.user.name || session.user.login || 'User'
  const username = session.user.login || session.user.email?.split('@')[0] || ''

  return (
    <div className="border-t border-gray-200 p-4 mt-auto relative" ref={menuRef}>
      {/* User Info Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
      >
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={displayName}
            width={36}
            height={36}
            className="rounded-full ring-2 ring-gray-100"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
            <span className="text-indigo-600 font-semibold text-sm">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-gray-900 truncate">
            {displayName}
          </p>
          {username && (
            <p className="text-xs text-gray-500 truncate">
              @{username}
            </p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs text-gray-500">Signed in as</p>
            <p className="text-sm font-medium text-gray-900 truncate">{username ? `@${username}` : displayName}</p>
          </div>
          <a
            href="https://github.com/govambam/macroscope-code-review?tab=readme-ov-file#macroscope-code-review-tool"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full text-sm text-gray-600 hover:text-gray-900 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Docs
          </a>
          <button
            onClick={() => signOut({ callbackUrl: '/auth/signin' })}
            className="w-full text-sm text-gray-600 hover:text-gray-900 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left flex items-center gap-2 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
