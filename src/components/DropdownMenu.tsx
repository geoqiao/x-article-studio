import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  triggerLabel: ReactNode;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  triggerTitle?: string;
  align?: "start" | "end";
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
};

const supportsCommandFor = () =>
  typeof HTMLButtonElement !== "undefined" &&
  "commandForElement" in HTMLButtonElement.prototype;

const supportsAnchor = () =>
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("position-area", "block-end");

const supportsFocusGroup = () =>
  typeof HTMLElement !== "undefined" &&
  "focusGroup" in HTMLElement.prototype;

/**
 * Accessible popup menu using native Popover API + focusgroup with progressive
 * fallbacks for command invokers, CSS Anchor Positioning, and arrow-key navigation.
 */
export function DropdownMenu({
  triggerLabel,
  triggerAriaLabel,
  triggerClassName = "",
  triggerTitle,
  align = "start",
  disabled = false,
  children,
}: Props) {
  const reactId = useId();
  const triggerId = `menu-trigger-${reactId}`;
  const menuId = `menu-popover-${reactId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const enterOnOpenRef = useRef(false);
  const pointerPressedRef = useRef(false);
  const [open, setOpen] = useState(false);

  const getEnabledItems = () => {
    const list = listRef.current;
    if (!list) return [] as HTMLElement[];
    return Array.from(list.querySelectorAll<HTMLElement>("button, a[href]")).filter(
      (item) =>
        !(item as HTMLButtonElement).disabled &&
        item.getAttribute("aria-disabled") !== "true",
    );
  };

  const positionFallback = () => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger || supportsAnchor()) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    let left =
      align === "end" ? triggerRect.right - popRect.width : triggerRect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
    let top = triggerRect.bottom + gap;
    if (top + popRect.height > window.innerHeight - margin) {
      top = Math.max(margin, triggerRect.top - popRect.height - gap);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  };

  const close = () => {
    const popover = popoverRef.current;
    if (popover?.matches(":popover-open")) {
      popover.hidePopover();
    }
  };

  useEffect(() => {
    const popover = popoverRef.current;
    const list = listRef.current;
    if (!popover || !list) return;

    const nativeFocusGroup = supportsFocusGroup();
    if (!nativeFocusGroup) {
      list.setAttribute("role", "menu");
      list.querySelectorAll("button, a[href]").forEach((item) => {
        if (!item.getAttribute("role")) item.setAttribute("role", "menuitem");
      });
    }

    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        if (!nativeFocusGroup) {
          list.querySelectorAll("button, a[href]").forEach((item) => {
            if (!item.getAttribute("role")) item.setAttribute("role", "menuitem");
          });
        }
        positionFallback();
        if (enterOnOpenRef.current) {
          enterOnOpenRef.current = false;
          getEnabledItems()[0]?.focus({ preventScroll: true });
        } else if (pointerPressedRef.current) {
          pointerPressedRef.current = false;
          triggerRef.current?.focus({ preventScroll: true });
        }
      } else {
        enterOnOpenRef.current = false;
        pointerPressedRef.current = false;
      }
    };

    const onListKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus({ preventScroll: true });
        popover.hidePopover();
        return;
      }
      if (event.key === "Tab") {
        popover.hidePopover();
        return;
      }
      if (
        !nativeFocusGroup &&
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      ) {
        const items = getEnabledItems();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : current < 0
                ? 0
                : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                  items.length;
        event.preventDefault();
        items[next]?.focus({ preventScroll: true });
      }
    };

    popover.addEventListener("toggle", onToggle);
    list.addEventListener("keydown", onListKeyDown);
    return () => {
      popover.removeEventListener("toggle", onToggle);
      list.removeEventListener("keydown", onListKeyDown);
    };
  }, [align]);

  useEffect(() => {
    if (!open || supportsAnchor()) return;
    const reposition = () => positionFallback();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align]);

  const commandAttrs = supportsCommandFor()
    ? ({ commandfor: menuId, command: "toggle-popover" } as Record<string, string>)
    : {};

  return (
    <div className="menu-anchor">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={triggerClassName}
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerTitle}
        disabled={disabled}
        {...commandAttrs}
        onPointerDown={(event) => {
          if (event.button === 0) pointerPressedRef.current = true;
        }}
        onClick={(event) => {
          if (event.detail === 0) {
            enterOnOpenRef.current = !open;
          }
          if (!supportsCommandFor()) {
            const popover = popoverRef.current;
            if (!popover) return;
            if (popover.matches(":popover-open")) popover.hidePopover();
            else popover.showPopover();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            enterOnOpenRef.current = true;
            if (open) {
              enterOnOpenRef.current = false;
              getEnabledItems()[0]?.focus({ preventScroll: true });
            } else {
              triggerRef.current?.click();
            }
          }
        }}
      >
        {triggerLabel}
      </button>
      <div
        ref={popoverRef}
        id={menuId}
        popover="auto"
        className={`menu-popover menu-align-${align}`}
      >
        <div
          ref={listRef}
          className="menu-list"
          aria-labelledby={triggerId}
          {...({ focusgroup: "menu nomemory" } as Record<string, string>)}
        >
          {children(close)}
        </div>
      </div>
    </div>
  );
}
