import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";

import { cn } from "@/lib/utils";
import { inputVariants } from "@/components/ui/input";

/** Autocomplete combo box wrapper around Base UI's `Autocomplete` primitive
 * (already a dependency via `@base-ui/react`, same library `popover.tsx`/
 * `dialog.tsx` already wrap) - a free-typed text input with a suggestions
 * popup, for fields where a user should be able to pick an existing value
 * (family/genus names already on file) while still being free to type a
 * genuinely new one. Deliberately `Autocomplete.Root`, not `Combobox.Root`:
 * a combobox constrains the committed value to the item list, which is
 * wrong here - a new family/genus is a legitimate value, not an error.
 * Reused by both the Add-plant dialog (#257) and the plant-detail identity
 * line (#237) for the same family/genus find-or-create interaction. */
function Autocomplete<ItemValue>(props: AutocompletePrimitive.Root.Props<ItemValue>) {
  return <AutocompletePrimitive.Root {...props} />;
}

function AutocompleteInput({ className, ...props }: AutocompletePrimitive.Input.Props) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(inputVariants({ className }))}
      {...props}
    />
  );
}

function AutocompletePopup({
  className,
  children,
  emptyMessage = "No matches - your typed value will be used as-is.",
  ...props
}: AutocompletePrimitive.Popup.Props & { emptyMessage?: string }) {
  return (
    <AutocompletePrimitive.Portal>
      {/* z-[60]: a `position: fixed` positioner with no explicit z-index of
          its own paints *behind* any sibling with an explicit z-index (per
          CSS2.1's stacking order, positioned elements at stack level 0
          paint before ones with a positive level, regardless of DOM order)
          - fatal when this primitive is used inside a Dialog (dialog.tsx's
          own wrapper is z-50; see PlantsDatabase.tsx's identical fix for
          its raw Popover-based parent-picker). Harmless when used outside a
          dialog (#237's plain-page usage), so this stays unconditional
          rather than a prop callers have to remember to pass. */}
      <AutocompletePrimitive.Positioner sideOffset={4} className="z-[60] outline-none">
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-popup"
          className={cn(
            "z-50 max-h-56 w-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
            className,
          )}
          {...props}
        >
          <AutocompletePrimitive.Empty className="px-2 py-1.5 text-xs text-muted-foreground">
            {emptyMessage}
          </AutocompletePrimitive.Empty>
          {children}
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  );
}

function AutocompleteList(props: AutocompletePrimitive.List.Props) {
  return <AutocompletePrimitive.List data-slot="autocomplete-list" {...props} />;
}

function AutocompleteItem({ className, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Autocomplete, AutocompleteInput, AutocompletePopup, AutocompleteList, AutocompleteItem };
