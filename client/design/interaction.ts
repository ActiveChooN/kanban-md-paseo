import { useState } from "react";
import type { Theme } from "./tokens";

/** Web: only keyboard-style focus (`:focus-visible`) shows a ring, not mouse clicks. Native has no such signal. */
function focusVisible(event?: { target?: unknown }) {
  try { return (event?.target as { matches?(selector: string): boolean } | undefined)?.matches?.(":focus-visible") ?? true; }
  catch { return true; }
}

/** Focus/hover/press state for a Pressable. Hover only fires on web; never rely on it alone. */
export function useInteraction() {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return {
    focused, hovered, pressed,
    handlers: {
      onFocus: (event?: { target?: unknown }) => setFocused(focusVisible(event)), onBlur: () => setFocused(false),
      onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false),
      onPressIn: () => setPressed(true), onPressOut: () => setPressed(false),
    },
  };
}

/**
 * The web host styles every `:focus-visible` element with a 2px outline (text inputs match on any focus).
 * Our controls draw their own ring, so they opt out; spread this on inputs whose ring sits on a wrapper.
 */
export const noOutline = { outlineWidth: 0 } as const;

/**
 * Border for a control with a 2px accent focus ring. `pad` is the resting padding;
 * it shrinks by 1 while focused so the ring does not shift layout.
 */
export function focusRing(theme: Theme, focused: boolean, color: string, pad: { h: number; v: number }, ring = theme.colors.accent) {
  const width = focused ? 2 : 1;
  return { ...noOutline, borderWidth: width, borderColor: focused ? ring : color,
    paddingHorizontal: Math.max(0, pad.h - width + 1), paddingVertical: Math.max(0, pad.v - width + 1) };
}
