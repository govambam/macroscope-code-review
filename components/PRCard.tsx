'use client'

interface PRRecord {
  prNumber: number
  prUrl: string
  prTitle: string
  createdAt: string
  updatedAt?: string | null
  commitCount: number
  state: string
  branchName: string
  macroscopeBugs?: number
  hasAnalysis?: boolean
  analysisId?: number | null
  originalPrUrl?: string | null
  isInternal?: boolean
  createdBy?: string | null
  // Macroscope review status tracking
  macroscopeReviewStatus?: 'pending' | 'in_progress' | 'completed' | 'failed' | null
  macroscopeBugsCount?: number | null
  macroscopeCheckStartedAt?: string | null
  macroscopeCheckCompletedAt?: string | null
}

interface PRCardProps {
  pr: PRRecord
  repoName: string
  isSelected: boolean
  onToggleSelect: () => void
  onAction: () => void
  owner?: string | null
  onOwnerClick?: () => void
}

export function PRCard({
  pr,
  repoName,
  isSelected,
  onToggleSelect,
  onAction,
  owner,
  onOwnerClick,
}: PRCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getBugsDisplay = () => {
    if (!pr.hasAnalysis) {
      return { text: '-', color: 'text-gray-400', bg: 'bg-gray-100' }
    }
    const bugs = pr.macroscopeBugs ?? 0
    if (bugs === 0) {
      return { text: '0', color: 'text-green-600', bg: 'bg-green-100' }
    }
    return { text: String(bugs), color: 'text-orange-600', bg: 'bg-orange-100' }
  }

  const getReviewStatusDisplay = () => {
    const status = pr.macroscopeReviewStatus
    const bugsCount = pr.macroscopeBugsCount

    switch (status) {
      case 'pending':
        return {
          text: 'Queued',
          color: 'text-gray-500',
          bg: 'bg-gray-100',
          icon: (
            <svg className="w-3.5 h-3.5 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          ),
        }
      case 'in_progress':
        return {
          text: 'Reviewing',
          color: 'text-blue-600',
          bg: 'bg-blue-100',
          icon: (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ),
        }
      case 'completed':
        if (bugsCount !== null && bugsCount !== undefined && bugsCount > 0) {
          return {
            text: `${bugsCount} bug${bugsCount > 1 ? 's' : ''}`,
            color: 'text-orange-600',
            bg: 'bg-orange-100',
            icon: (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ),
          }
        }
        return {
          text: 'No bugs',
          color: 'text-green-600',
          bg: 'bg-green-100',
          icon: (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ),
        }
      case 'failed':
        return {
          text: 'Failed',
          color: 'text-red-600',
          bg: 'bg-red-100',
          icon: (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ),
        }
      default:
        return null
    }
  }

  const bugs = getBugsDisplay()
  const reviewStatus = getReviewStatusDisplay()

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      {/* Header with checkbox and PR number */}
      <div className="flex items-start gap-3 mb-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="mt-1 h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary min-w-[20px]"
        />
        <div className="flex-1 min-w-0">
          <a
            href={pr.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium text-sm hover:underline"
          >
            #{pr.prNumber}
          </a>
          <h3 className="text-base font-medium text-gray-900 leading-tight mt-0.5 line-clamp-2">
            {pr.prTitle}
          </h3>
        </div>
      </div>

      {/* Status and Action Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Macroscope review status badge (if tracking is enabled for this PR) */}
          {reviewStatus ? (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium ${reviewStatus.bg} ${reviewStatus.color}`}>
              {reviewStatus.icon}
              {reviewStatus.text}
            </span>
          ) : (
            /* Fallback to analysis-based bug count badge */
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium ${bugs.bg} ${bugs.color}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {bugs.text}
            </span>
          )}

          {/* Internal/External badge */}
          {pr.isInternal && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
              Internal
            </span>
          )}
        </div>

        {/* Action Button */}
        {(() => {
          const status = pr.macroscopeReviewStatus
          const isReviewInProgress = status === 'pending' || status === 'in_progress'
          const reviewCompleteNoBugs = status === 'completed' && (pr.macroscopeBugsCount === 0 || pr.macroscopeBugsCount === null)

          // If review is pending/in_progress, show disabled state
          if (isReviewInProgress) {
            return (
              <button
                disabled
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed min-h-[44px]"
              >
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Wait
              </button>
            )
          }

          // If review completed with no bugs, show disabled state
          if (reviewCompleteNoBugs && !pr.hasAnalysis) {
            return (
              <button
                disabled
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed min-h-[44px]"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Done
              </button>
            )
          }

          // Normal Run/View button
          return (
            <button
              onClick={onAction}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${
                pr.hasAnalysis
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-primary hover:bg-primary-hover text-white'
              }`}
            >
              {pr.hasAnalysis ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run
                </>
              )}
            </button>
          )
        })()}
      </div>

      {/* Metadata Row */}
      <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
        {owner && (
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            @{owner}
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formatDate(pr.updatedAt || pr.createdAt)}
        </span>
      </div>
    </div>
  )
}

// Repo group header for mobile
interface RepoGroupHeaderProps {
  repoName: string
  prCount: number
  isExpanded: boolean
  onToggle: () => void
  checkboxState: 'checked' | 'unchecked' | 'indeterminate'
  onToggleSelect: () => void
}

export function RepoGroupHeader({
  repoName,
  prCount,
  isExpanded,
  onToggle,
  checkboxState,
  onToggleSelect,
}: RepoGroupHeaderProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200 cursor-pointer min-h-[52px]"
      onClick={onToggle}
    >
      {/* Expand arrow */}
      <svg
        className={`w-5 h-5 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checkboxState === 'checked'}
        ref={(el) => {
          if (el) el.indeterminate = checkboxState === 'indeterminate'
        }}
        onChange={(e) => {
          e.stopPropagation()
          onToggleSelect()
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary flex-shrink-0"
      />

      {/* Repo name */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-900 truncate block">{repoName}</span>
      </div>

      {/* PR count badge */}
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 flex-shrink-0">
        {prCount} PR{prCount !== 1 ? 's' : ''}
      </span>
    </div>
  )
}
