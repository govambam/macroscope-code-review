'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { SessionProvider } from 'next-auth/react'
import { Session } from 'next-auth'
import { useState, useEffect } from 'react'

const CACHE_KEY = 'REACT_QUERY_CACHE'

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

  // Load cache from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
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
  }, [queryClient])

  // Save cache to localStorage on changes
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      try {
        const cache = {
          forks: queryClient.getQueryData(['forks']),
          prompts: queryClient.getQueryData(['prompts']),
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
      } catch (error) {
        console.error('Failed to save React Query cache:', error)
      }
    })
    return unsubscribe
  }, [queryClient])

  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </SessionProvider>
  )
}
