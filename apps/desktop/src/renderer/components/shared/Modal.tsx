import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-solus-surface border border-solus-border rounded-lg w-full max-w-lg mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-solus-border">
          <h2 className="text-sm font-semibold text-solus-text">{title}</h2>
          <button
            onClick={onClose}
            className="text-solus-text-muted hover:text-solus-text transition-colors p-1 rounded"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 text-solus-text">
          {children}
        </div>
      </div>
    </div>
  );
}
