import React from 'react';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function Card({ title, children, className = '', compact = false }: CardProps) {
  return (
    <div className={`bg-solus-surface/60 rounded-lg ${compact ? 'p-3' : 'p-4'} ${className}`}>
      {title && (
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-solus-text-muted mb-3">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}
