import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'md', children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-pf-ring disabled:pointer-events-none disabled:opacity-50';

    const variants = {
      default: 'bg-pf-primary text-pf-primary-foreground hover:bg-pf-primary/90',
      secondary: 'bg-pf-muted text-pf-foreground hover:bg-pf-muted/80',
      outline:
        'border border-pf-border bg-transparent text-pf-foreground hover:bg-pf-muted hover:text-pf-foreground',
      ghost: 'bg-transparent text-pf-foreground hover:bg-pf-muted hover:text-pf-foreground',
      destructive: 'bg-state-error text-white hover:bg-state-error/90',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs',
      md: 'h-10 px-4 text-sm',
      lg: 'h-11 px-6 text-base',
      icon: 'h-10 w-10',
    };

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
