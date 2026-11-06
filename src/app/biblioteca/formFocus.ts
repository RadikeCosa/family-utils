import type { FieldErrors } from "@/lib/library/form-errors";
export function focusFirstInvalid(form: HTMLFormElement | null, errors: FieldErrors) {
  if (!form) return;
  const first = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name]")].find(control => errors[control.name]);
  if (!first) return;
  for (let parent = first.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  // React must commit aria-invalid and the descriptions before focus is announced.
  requestAnimationFrame(() => {
    if (!first.isConnected) return;
    const header = form.querySelector("header");
    const footer = form.querySelector("footer");
    if (header && footer) {
      const formBox = form.getBoundingClientRect();
      const fieldBox = first.getBoundingClientRect();
      const top = Math.max(formBox.top, header.getBoundingClientRect().bottom);
      const bottom = Math.min(formBox.bottom, footer.getBoundingClientRect().top);
      form.scrollTop += fieldBox.top + fieldBox.height / 2 - (top + bottom) / 2;
      first.focus({ preventScroll: true });
    } else first.focus();
  });
}
