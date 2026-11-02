import { IsUUID } from 'class-validator';

export class ConvertExpenseAttachmentDto {
  @IsUUID()
  activityAttachmentId!: string;
}
