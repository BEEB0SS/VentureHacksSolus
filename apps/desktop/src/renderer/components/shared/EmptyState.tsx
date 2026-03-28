import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
      <p className="text-sm text-solus-text-dim">{title}</p>
      {description && (
        <p className="text-xs text-solus-text-muted max-w-[280px] leading-relaxed">{description}</p>
      )}
    </div>
  );
}
