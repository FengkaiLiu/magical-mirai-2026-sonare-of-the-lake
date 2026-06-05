/**
 * Device detection helpers.
 *
 * IS_TOUCH — true when the primary pointing device is touch (phone/tablet).
 *            Uses the CSS pointer:coarse media query, which is false on Windows
 *            desktops even when navigator.maxTouchPoints > 0 (Windows reports
 *            touch capacity but the primary pointer is still a mouse).
 *            Use this to control mobile UI (virtual joystick, touch labels).
 */
export const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches;
