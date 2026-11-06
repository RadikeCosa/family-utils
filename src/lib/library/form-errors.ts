import { codePointLength, experienceInput, familyDay } from "./rules.ts";
export type FieldErrors = Record<string, string>;
export type OperationIssue = { code: string; status: number; path: string };
const messages: Record<string, string> = {
  CONFLICT: "Los datos cambiaron. Revisá la versión actual antes de volver a guardar.",
  DUPLICATE: "Ya hay una película parecida. Revisá las coincidencias antes de continuar.",
  NO_ACCESS: "Tu acceso ya no está disponible. Volvé a ingresar a tu familia.",
  NOT_AUTHOR: "Solo el autor puede modificar este aporte.",
  ARCHIVED: "La película está archivada. Restaurala antes de guardar cambios.",
  NOT_FOUND: "Este contenido ya no está disponible. Conservamos tu borrador.",
  INVALID: "Revisá los datos del formulario e intentá guardar nuevamente.",
};
export function libraryIssueMessage(code: unknown) {
  return typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : "No pudimos completar la operación. Conservamos tu borrador. Intentá de nuevo.";
}
export function workFieldErrors(draft: { title: string; creator: string; year: string; referenceUrl?: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.title.trim() || codePointLength(draft.title.trim()) > 200) errors.title = "Escribí un título de entre 1 y 200 caracteres.";
  if (codePointLength(draft.creator.trim()) > 200) errors.creator = "La dirección admite hasta 200 caracteres.";
  if (draft.year && (!Number.isInteger(Number(draft.year)) || Number(draft.year) < 1 || Number(draft.year) > 9999)) errors.year = "Ingresá un año entero entre 1 y 9999.";
  return errors;
}
export function contributionFieldErrors(draft: { body: string; year: string; month: string; day: string }, today = familyDay()): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.body.trim() || codePointLength(draft.body.trim()) > 5000) errors.body = "Escribí entre 1 y 5.000 caracteres.";
  if (!draft.year && (draft.month || draft.day)) errors.year = "Completá el año antes del mes y el día.";
  else if (draft.year && (!Number.isInteger(Number(draft.year)) || Number(draft.year) < 1 || Number(draft.year) > 9999)) errors.year = "Ingresá un año entero entre 1 y 9999.";
  else if (!draft.month && draft.day) errors.month = "Completá el mes antes del día.";
  else if (draft.month && (!Number.isInteger(Number(draft.month)) || Number(draft.month) < 1 || Number(draft.month) > 12)) errors.month = "Elegí un mes válido.";
  else if (draft.day && (!Number.isInteger(Number(draft.day)) || Number(draft.day) < 1 || Number(draft.day) > 31)) errors.day = "Ingresá un día válido para ese mes.";
  else if (!experienceInput({ year: draft.year ? Number(draft.year) : null, month: draft.month ? Number(draft.month) : null, day: draft.day ? Number(draft.day) : null }, today)) errors[draft.day ? "day" : draft.month ? "month" : "year"] = "Revisá la fecha: debe existir y no puede ser futura.";
  return errors;
}
export function revalidateFieldErrors(previous: FieldErrors, current: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.keys(previous).filter(key => current[key]).map(key => [key, current[key]]));
}
