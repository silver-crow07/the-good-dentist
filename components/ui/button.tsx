import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-tight transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white shadow-soft hover:bg-primary-deep hover:shadow-lift",
        light:
          "bg-white text-primary shadow-soft hover:bg-mint hover:shadow-lift",
        outline:
          "border border-primary/25 bg-white text-primary hover:border-primary/60 hover:bg-mint",
        onDark:
          "border border-white/35 text-white hover:border-white hover:bg-white/10",
        subtle: "bg-mint text-primary hover:bg-primary/10",
        ghost: "text-ink hover:bg-mint hover:text-primary",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-sm",
        lg: "h-12 px-7 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonOwnProps = VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & ButtonOwnProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export function ButtonLink({
  className,
  variant,
  size,
  href,
  ...props
}: ComponentProps<typeof Link> & ButtonOwnProps) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
