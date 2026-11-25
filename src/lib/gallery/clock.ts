let clock = () => new Date();

export function galleryNow() {
  return clock();
}

/** Replace the clock in isolated tests and restore the previous provider afterward. */
export function injectGalleryClock(next: () => Date) {
  const previous = clock;
  clock = next;
  return () => { clock = previous; };
}
