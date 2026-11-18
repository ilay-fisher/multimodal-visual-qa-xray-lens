/**
 * Focus trap step: the item Tab (or Shift+Tab) should land on, wrapping at both ends.
 * Focus that is not in the list enters it at the first item, or the last for Shift+Tab.
 */
export function nextFocus<T>(list: readonly T[], current: T | null | undefined, shift: boolean): T | undefined {
  if (!list.length) return undefined;
  const i = current == null ? -1 : list.indexOf(current);
  if (i < 0) return shift ? list[list.length - 1] : list[0];
  return list[(i + (shift ? -1 : 1) + list.length) % list.length];
}
