import React from 'react';

type DotStatus = 'healthy' | 'warning' | 'error' | 'offline';

interface StatusDotProps {
  status: DotStatus;
  label?: string;
  pulse?: boolean;
}

const statusColorMap: Record<DotStatus, string> = {
  healthy: 'bg-solus-success',
  warning: 'bg-solus-warning',
  error: 'bg-solus-error',
  offline: 'bg-solus-text-muted',
};

export function StatusDot({ status, label, pulse = false }: StatusDotProps) {
  const colorClass = statusColorMap[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2.5 w-2.5">
        {pulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-75`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colorClass}`} />
      </span>
      {label && (
        <span className="text-xs text-solus-text-dim">{label}</span>
      )}
    </div>
  );
}
