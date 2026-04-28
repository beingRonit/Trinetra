import * as React from 'react';

type ButtonVariant =
  | 'default'
  | 'noShadow'
  | 'neutral'
  | 'reverse'
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'danger';

type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseClasses =
  'inline-flex items-center justify-center whitespace-nowrap rounded-[5px] text-sm font-medium ring-offset-surface transition-all gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border-2';

const variantClasses: Record<ButtonVariant, string> = {
  default:
    'text-on-primary bg-primary border-primary shadow-[4px_4px_0_0_rgba(152,207,227,0.35)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none',
  noShadow: 'text-on-primary bg-primary border-primary',
  neutral:
    'bg-surface text-on-surface border-outline-variant shadow-[4px_4px_0_0_rgba(64,72,75,0.9)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none',
  reverse:
    'text-on-primary bg-primary border-primary shadow-[4px_4px_0_0_rgba(152,207,227,0.35)] hover:-translate-x-[4px] hover:-translate-y-[4px] hover:shadow-[4px_4px_0_0_rgba(152,207,227,0.35)]',
  primary:
    'text-on-primary bg-primary border-primary shadow-[4px_4px_0_0_rgba(152,207,227,0.35)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none',
  secondary:
    'bg-surface-container-high text-on-surface border-outline-variant shadow-[4px_4px_0_0_rgba(64,72,75,0.9)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none',
  ghost: 'bg-transparent text-on-surface-variant border-transparent hover:bg-surface-container hover:text-on-surface',
  outline:
    'bg-transparent text-primary border-primary shadow-[4px_4px_0_0_rgba(152,207,227,0.25)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none hover:bg-primary/10',
  danger:
    'bg-error-container text-error border-error/40 shadow-[4px_4px_0_0_rgba(147,0,10,0.45)] hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 px-3',
  lg: 'h-11 px-8',
  icon: 'h-10 w-10',
};

function cx(...values: Array<string | undefined | false | null>) {
  return values.filter(Boolean).join(' ');
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(baseClasses, variantClasses[variant], sizeClasses[size], className)}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button };
