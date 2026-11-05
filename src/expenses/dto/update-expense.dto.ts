import { PartialType } from '@nestjs/swagger';

import { CreateExpenseDto } from './create-expense.dto';

/**
 * La edición de un gasto (FR-11: sólo el solicitante, y sólo en `pending`).
 *
 * Es el alta con todo opcional: ningún campo suelto, pero mandar un objeto vacío
 * es un 400 del servicio — un PATCH que no cambia nada es un error del cliente,
 * no un no-op silencioso. Lo que NO se puede editar nunca: `status` (lo mueven
 * las transiciones, no un PATCH), `requestedBy` ni el vínculo.
 */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
