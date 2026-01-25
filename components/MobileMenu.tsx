'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useSession, signOut } from 'next-auth/react'

interface MobileMenuProps {
  className?: string
}

export function MobileMenu({ className = '' }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const { data: session } = useSession()

  // Close menu when route changes
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Close menu and reset body scroll when viewport exceeds mobile breakpoint
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768 && isOpen) {
        setIsOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isOpen])

  const displayName = session?.user?.name || session?.user?.login || 'User'
  const username = session?.user?.login || session?.user?.email?.split('@')?.[0] || ''

  return (
    <>
      {/* Mobile Header - visible only on mobile */}
      <div className={`md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-40 flex items-center justify-between px-4 ${className}`}>
        {/* Hamburger button */}
        <button
          onClick={() => setIsOpen(true)}
          className="p-2 -ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center">
          <Image
            src="/Macroscope-text-logo.png"
            alt="Macroscope"
            width={120}
            height={24}
            className="h-6 w-auto"
            priority
            unoptimized
          />
        </Link>

        {/* User avatar */}
        <button
          onClick={() => setIsOpen(true)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open menu"
        >
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt={displayName}
              width={32}
              height={32}
              className="rounded-full ring-2 ring-gray-100"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="text-indigo-600 font-semibold text-sm">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </button>
      </div>

      {/* Overlay menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-50 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Sliding menu */}
          <div className="fixed top-0 left-0 bottom-0 w-[280px] bg-white z-50 shadow-xl flex flex-col md:hidden animate-in slide-in-from-left duration-200">
            {/* Menu Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200">
              <Image
                src="/Macroscope-text-logo.png"
                alt="Macroscope"
                width={120}
                height={24}
                className="h-6 w-auto"
                unoptimized
              />
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-4 py-4">
              <div className="space-y-1">
                <Link
                  href="/"
                  onClick={() => setIsOpen(false)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-base font-medium rounded-lg transition-colors min-h-[48px] ${
                    pathname === '/'
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  PR Reviews
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setIsOpen(false)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-base font-medium rounded-lg transition-colors min-h-[48px] ${
                    pathname === '/settings'
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </Link>
              </div>
            </nav>

            {/* User Info at Bottom */}
            {session?.user && (
              <div className="border-t border-gray-200 p-4">
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
                      <span className="text-indigo-600 font-semibold">
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

                <a
                  href="https://github.com/govambam/macroscope-code-review?tab=readme-ov-file#macroscope-code-review-tool"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors min-h-[44px]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Docs
                </a>

                <button
                  onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors min-h-[44px]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
