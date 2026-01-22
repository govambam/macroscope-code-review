'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { SessionProvider } from 'next-auth/react'
import { Session } from 'next-auth'
import { useState, useEffect, useRef } from 'react'

// Cache key is namespaced by user to prevent data leaking between sessions
function getCacheKey(userId: string | undefined): string {
  return userId ? `REACT_QUERY_CACHE_${userId}` : 'REACT_QUERY_CACHE_anonymous'
}

export function Providers({
  children,
  session
}: {
  children: React.ReactNode
  session: Session | null
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
            gcTime: 30 * 60 * 1000, // 30 minutes - keep in memory (formerly cacheTime)
            refetchOnWindowFocus: false, // Don't refetch when user returns to tab
            retry: 1, // Only retry failed requests once
          },
        },
      })
  )

  // Track the current user ID for cache namespacing
  const userId = session?.user?.id
  const prevUserIdRef = useRef<string | undefined>(userId)

  // Clear cache when user changes (login/logout)
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      // User changed - clear the query cache
      queryClient.clear()
      prevUserIdRef.current = userId
    }
  }, [userId, queryClient])

  // Load cache from localStorage on mount
  useEffect(() => {
    try {
      const cacheKey = getCacheKey(userId)
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.forks) {
          queryClient.setQueryData(['forks'], parsed.forks)
        }
        if (parsed.prompts) {
          queryClient.setQueryData(['prompts'], parsed.prompts)
        }
      }
    } catch (error) {
      console.error('Failed to load React Query cache:', error)
    }
  }, [queryClient, userId])

  // Save cache to localStorage on changes
  useEffect(() => {
    const cacheKey = getCacheKey(userId)
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      try {
        const forks = queryClient.getQueryData(['forks'])
        const prompts = queryClient.getQueryData(['prompts'])

        // Only include properties that have values (omit undefined to allow cache deletion)
        const cache: Record<string, unknown> = {}
        if (forks !== undefined) {
          cache.forks = forks
        }
        if (prompts !== undefined) {
          cache.prompts = prompts
        }

        localStorage.setItem(cacheKey, JSON.stringify(cache))
      } catch (error) {
        console.error('Failed to save React Query cache:', error)
      }
    })
    return unsubscribe
  }, [queryClient, userId])

  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  )
}
