import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/** Pass/fail/state chips. Verdict vocabulary matches the domain layer. */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
  {
    variants: {
      variant: {
        pass: "border-verify/40 bg-verify-wash text-verify",
        fail: "border-reject/40 bg-reject-wash text-reject",
        incomplete: "border-pending/40 bg-pending-wash text-pending",
        not_started: "border-border bg-muted text-muted-foreground",
        info: "border-primary/40 bg-primary/5 text-primary",
        neutral: "border-border bg-card text-muted-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
