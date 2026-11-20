import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

/** The text of the option `value` names among a select's `<option>` children. */
function chosenLabel(children: ReactNode, value: ComponentProps<"select">["value"]) {
  for (const child of Children.toArray(children)) {
    if (isValidElement<{ value?: unknown; children?: ReactNode }>(child) && String(child.props.value) === String(value)) {
      return Children.toArray(child.props.children).join("");
    }
  }
  return "";
}

/**
 * A native select that shows its current choice as wrapping text, so a long value is never cut short ("Hidden (dr…")
 * on a phone with enlarged text. The select itself stays the control, laid over the box with its own text hidden: its
 * name, keyboard use, picker and focus ring are the browser's. `className` styles the box (border, padding, text size,
 * width, and its states through `has-[...]`, since the box is not the control); `value` must be controlled and the
 * options direct children.
 */
export function WrappingSelect({ className = "", children, value, ...props }: ComponentProps<"select"> & { value: string }) {
  return (
    <span className={`relative flex items-center gap-2 ${className}`}>
      <span aria-hidden="true" data-select-value className="min-w-0 flex-1 [overflow-wrap:break-word]">{chosenLabel(children, value)}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-4 shrink-0">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
      </svg>
      {/*
        * Over the whole box, its 1px border included, so the target is the box's full size. Its own text is transparent
        * (forced colours too), and its options keep readable colours in the picker.
        */}
      <select
        {...props}
        value={value}
        className="absolute -left-px -top-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer appearance-none rounded-[inherit] bg-transparent text-transparent disabled:cursor-not-allowed forced-colors:[forced-color-adjust:none] [&_option]:bg-white [&_option]:text-navy-900"
      >
        {children}
      </select>
    </span>
  );
}
