import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders children and responds to click', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>点击我</Button>);

    const button = screen.getByRole('button', { name: /点击我/ });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and does not trigger click', async () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        禁用
      </Button>
    );

    const button = screen.getByRole('button', { name: /禁用/ });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it.each([
    ['default', 'bg-pf-primary'],
    ['secondary', 'bg-pf-muted'],
    ['outline', 'border-pf-border'],
    ['ghost', 'bg-transparent'],
    ['destructive', 'bg-state-error'],
  ] as const)('applies %s variant classes', (variant, expectedClass) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button')).toHaveClass(expectedClass);
  });

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-10'],
    ['lg', 'h-11'],
    ['icon', 'h-10 w-10'],
  ] as const)('applies %s size classes', (size, expectedClass) => {
    render(<Button size={size}>{size}</Button>);
    const button = screen.getByRole('button');
    expectedClass.split(' ').forEach((cls) => {
      expect(button).toHaveClass(cls);
    });
  });
});
