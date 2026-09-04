"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  target: HTMLDivElement;
  previousCursor: string;
  previousUserSelect: string;
}

interface UseResizablePanelOptions {
  ariaLabel: string;
  cssVariable: `--${string}`;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  growthDirection: "left" | "right";
  storageKey: string;
  panelRef: RefObject<HTMLDivElement | null>;
}

function clamp(val: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, val)));
}

function readStoredWidth(storageKey: string): number | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, String(width));
  } catch {
    // ignore
  }
}

export function useResizablePanel(options: UseResizablePanelOptions) {
  const {
    ariaLabel,
    cssVariable,
    defaultWidth,
    minWidth,
    maxWidth,
    growthDirection,
    storageKey,
    panelRef,
  } = options;

  const currentWidthRef = useRef(defaultWidth);
  const dragRef = useRef<DragState | null>(null);

  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  const commitWidth = useCallback(
    (nextWidth: number, persist = true) => {
      const clamped = clamp(nextWidth, minWidth, maxWidth);
      setWidth(clamped);
      currentWidthRef.current = clamped;
      if (panelRef.current) {
        panelRef.current.style.setProperty(cssVariable, `${clamped}px`);
      }
      if (persist) {
        writeStoredWidth(storageKey, clamped);
      }
    },
    [cssVariable, maxWidth, minWidth, panelRef, storageKey]
  );

  // Restore stored width on DOM element after mount (prevents cascading renders & hydration mismatch)
  useEffect(() => {
    const stored = readStoredWidth(storageKey);
    if (stored !== null) {
      const clamped = clamp(stored, minWidth, maxWidth);
      currentWidthRef.current = clamped;
      if (panelRef.current) {
        panelRef.current.style.setProperty(cssVariable, `${clamped}px`);
      }
    }
  }, [cssVariable, maxWidth, minWidth, panelRef, storageKey]);

  const stopDragging = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    try {
      drag.target.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }

    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
    dragRef.current = null;
    setIsResizing(false);
    commitWidth(currentWidthRef.current, true);
  }, [commitWidth]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - drag.startX;
      const effectiveDelta = growthDirection === "right" ? deltaX : -deltaX;
      const nextWidth = drag.startWidth + effectiveDelta;
      commitWidth(nextWidth, false);
    },
    [commitWidth, growthDirection]
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      if (dragRef.current && dragRef.current.pointerId === event.pointerId) {
        stopDragging();
      }
    },
    [stopDragging]
  );

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [isResizing, onPointerMove, onPointerUp]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }

      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: currentWidthRef.current,
        target,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect,
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizing(true);
    },
    []
  );

  const separatorProps = {
    role: "separator" as const,
    "aria-label": ariaLabel,
    "aria-orientation": "vertical" as const,
    "aria-valuenow": width,
    "aria-valuemin": minWidth,
    "aria-valuemax": maxWidth,
    tabIndex: 0,
    suppressHydrationWarning: true,
    onPointerDown,
  };

  return [width, isResizing, separatorProps, commitWidth] as const;
}
