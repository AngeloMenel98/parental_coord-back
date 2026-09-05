import { ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { AgreementType } from '../../bonds/entities/bond.entity';

export class CreateBondDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEnum(AgreementType)
  agreementType!: AgreementType;

  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  userIds!: string[];
}
