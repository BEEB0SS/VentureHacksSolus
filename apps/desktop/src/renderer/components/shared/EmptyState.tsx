import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
      <div className="text-solus-text-muted">
        {icon ?? <Inbox className="w-8 h-8" />}
      </div>
      <p className="text-sm font-medium text-solus-text-dim">{title}</p>
      {description && (
        <p className="text-xs text-solus-text-muted max-w-xs">{description}</p>
      )}
    </div>
  );
}
