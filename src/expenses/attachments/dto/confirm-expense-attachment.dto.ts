import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];

export class ConfirmExpenseAttachmentDto {
  @IsString()
  @MaxLength(512)
  path!: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @IsIn(ALLOWED_MIME)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(10485760)
  sizeBytes!: number;
}
