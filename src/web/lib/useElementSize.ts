import { useLayoutEffect, useState, type RefObject } from 'react';

/** Content-box width and height of an element, kept up to date as it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (width: number, height: number) =>
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    update(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      update(Math.round(width), Math.round(height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * True when the element sits in a Live grid cell with a fixed height, so a chart
 * should shrink to fit it rather than make the card scroll. Set by `--fit-height`.
 */
export function fitsHeight(element: HTMLElement | null): boolean {
  return element !== null && getComputedStyle(element).getPropertyValue('--fit-height').trim() === '1';
}
