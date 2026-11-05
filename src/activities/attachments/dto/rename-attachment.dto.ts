import { IsString, MaxLength } from 'class-validator';

export class RenameAttachmentDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;
}
