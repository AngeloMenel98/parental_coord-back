import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/dto/auth-user.dto';
import { ExpensesService } from './expenses.service';
import { ExpenseAttachmentsService } from './attachments/expense-attachments.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { RejectExpenseDto } from './dto/reject-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { PresignExpenseAttachmentDto } from './attachments/dto/presign-expense-attachment.dto';
import { ConfirmExpenseAttachmentDto } from './attachments/dto/confirm-expense-attachment.dto';
import { ConvertExpenseAttachmentDto } from './attachments/dto/convert-expense-attachment.dto';

/**
 * T24 · La API de escritura de gastos.
 *
 * Sólo escritura y detalle: el listado, los filtros y el saldo son T28. El
 * detalle está acá porque T19 (la pantalla de detalle) depende de T24, no de T28.
 *
 * Los errores son los de Nest y siguen una regla: **un no-miembro recibe 404, no
 * 403**, para no confirmarle que el gasto existe. Un miembro que no es la parte
 * que corresponde sí recibe 403.
 */
@ApiTags('expenses')
@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly expenseAttachmentsService: ExpenseAttachmentsService,
  ) {}

  @Get('bond/:bondId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List expenses of a bond',
    description:
      'T28 · lista paginada con filtros. `limit` (1..100, def. 20), `offset` (>=0, def. 0), ' +
      '`status`, `categoryId`, `from`/`to` (YYYY-MM-DD, inclusive sobre `expense_date`). ' +
      'Orden: `created_at DESC, id DESC`.',
  })
  list(
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.listForBond(bondId, user.id, query);
  }

  @Get('bond/:bondId/summary')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Expense summary/balance of a bond',
    description:
      'T28 · `{ saldo, porPagar, porCobrar, counts }` desde la perspectiva de quien consulta. ' +
      'El saldo se computa en el servidor; el cliente nunca lo recalcula.',
  })
  summary(@Param('bondId', ParseUUIDPipe) bondId: string, @CurrentUser() user: AuthUser) {
    return this.expensesService.summaryForBond(bondId, user.id);
  }

  @Post(':bondId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create expense',
    description:
      'FR-8 · nace en `pending` con quien lo pide como solicitante. La categoría es ' +
      'obligatoria (§5.3). El reparto se manda sólo con el porcentaje del solicitante: ' +
      'la otra parte es el complemento, así que un reparto que no sume 100 es imposible.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('bondId', ParseUUIDPipe) bondId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(bondId, dto, user.id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Expense detail',
    description:
      'Incluye la decisión de la política para quien consulta (`canEdit`, `canApprove`, ' +
      '`canMarkPaid`, …), para que la UI no replique FR-11 en el cliente.',
  })
  getDetail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expensesService.getDetail(id, user.id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit expense',
    description:
      'FR-11 · sólo el solicitante, y sólo en `pending`. Un PATCH vacío es 400, no un no-op.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel expense ("Eliminar") — soft delete',
    description:
      'FR-11 · sólo el solicitante, y sólo en `pending`. Escribe `deleted_at` y nada ' +
      'más, igual que el "Eliminar" de una actividad: no hay purga.',
  })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expensesService.cancel(id, user.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve expense',
    description:
      '§5.4 · sólo la otra parte, y sólo en `pending`. 403 si el solicitante intenta ' +
      'aprobar su propio gasto; 409 si el gasto cambió antes de aplicar.',
  })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expensesService.approve(id, user.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reject expense',
    description: '§5.4 · sólo la otra parte, y sólo en `pending`. El motivo es opcional.',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectExpenseDto,
  ) {
    return this.expensesService.reject(id, user.id, dto?.reason);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark expense as paid',
    description:
      '§5.4 · desde `approved`, cualquiera de las dos partes: quien paga marca pagado, ' +
      'quien cobra confirma la recepción.',
  })
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expensesService.pay(id, user.id);
  }

  @Post(':id/attachments/presign')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Presign an expense attachment upload',
    description:
      'T30 · devuelve `uploadUrl`, `path`, `method`, `headers` y `expiresIn` para subir ' +
      'directamente a Supabase Storage. La key está namespaced por gasto: ' +
      '`expenses/{bondId}/{expenseId}/{uuid}.{ext}`.',
  })
  presignAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: PresignExpenseAttachmentDto,
  ) {
    return this.expenseAttachmentsService.presign(id, user, dto);
  }

  @Post(':id/attachments/confirm')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm an uploaded expense attachment',
    description:
      'T30 · crea la fila `expense_attachment` apuntando al objeto ya subido. ' +
      'Rechaza 400 si el objeto no existe en storage.',
  })
  confirmAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmExpenseAttachmentDto,
  ) {
    return this.expenseAttachmentsService.confirm(id, user, dto);
  }

  @Post(':id/attachments/convert')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Convert an activity attachment into an expense attachment',
    description:
      'T30 · R6: una fila `expense_attachment` nueva apunta al MISMO objeto de Storage ' +
      'del adjunto de actividad y se setea `expense.activity_id`. Sólo si la actividad ' +
      'pertenece al mismo vínculo que el gasto.',
  })
  convertAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConvertExpenseAttachmentDto,
  ) {
    return this.expenseAttachmentsService.convert(id, user, dto);
  }
}
