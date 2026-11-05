/**
 * "La contraparte" de un gasto: el primer miembro activo del vínculo que no es
 * quien lo pidió.
 *
 * Existe como función propia porque la noción la necesitan dos lados distintos:
 * la política (`ExpensePolicyService`) para decidir quién aprueba, y el fan-out
 * de notificaciones (T23) para decidir a quién le llega el aviso. Si cada uno la
 * definiera por su cuenta, un gasto podría ser aprobable por alguien que nunca
 * recibe la notificación.
 *
 * `null` cuando el vínculo tiene un solo miembro: sin contraparte no hay quién
 * apruebe, y la política ya lo trata como "nadie puede aprobar" en vez de
 * permitir una auto-aprobación sin sentido.
 */
export function selectCounterpartId(
  memberIds: readonly string[],
  requesterId: string,
): string | null {
  return memberIds.find((memberId) => memberId !== requesterId) ?? null;
}
