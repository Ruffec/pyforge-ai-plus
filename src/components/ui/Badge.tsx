import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success';
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    const variants = {
      default: 'border-transparent bg-pf-primary text-pf-primary-foreground hover:bg-pf-primary/80',
      secondary: 'border-transparent bg-pf-muted text-pf-foreground hover:bg-pf-muted/80',
      outline: 'border-pf-border text-pf-foreground hover:bg-pf-muted',
      destructive: 'border-transparent bg-state-error text-white hover:bg-state-error/80',
      success: 'border-transparent bg-state-success text-white hover:bg-state-success/80',
    };

    return (
      <span
        ref={ref}
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
