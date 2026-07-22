import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        // Drops the native number-input spinner arrows and centers the text -
        // used where horizontal room is tight (e.g. BedPanel's 3-up width/
        // length/rotation row) and the spinner chrome alone was eating enough
        // width to clip a 3-digit cm value or a negative rotation.
        numeric:
          "px-1.5 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Input({
  className,
  type = "text",
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(inputVariants({ className }))}
      {...props}
    />
  )
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(inputVariants({ className }))}
      {...props}
    />
  )
}

export { Input, Textarea, Select, inputVariants }
