import React from 'react';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function Card({ title, children, className = '', compact = false }: CardProps) {
  const padding = compact ? 'p-3' : 'p-4';

  return (
    <div
      className={`bg-solus-surface border border-solus-border rounded-lg ${padding} ${className}`}
    >
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-solus-text-dim mb-3">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}
