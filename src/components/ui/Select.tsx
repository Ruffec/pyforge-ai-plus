import React from 'react';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`flex h-10 w-full appearance-none rounded-md border border-pf-border bg-pf-card px-3 py-2 text-sm text-pf-card-foreground focus:outline-none focus:ring-2 focus:ring-pf-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';

export type SelectItemProps = React.OptionHTMLAttributes<HTMLOptionElement>;

export const SelectItem = React.forwardRef<HTMLOptionElement, SelectItemProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <option ref={ref} className={`${className}`} {...props}>
        {children}
      </option>
    );
  }
);

SelectItem.displayName = 'SelectItem';
