import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class BondMemberUserDto {
  @Expose() id!: string;
  @Expose() firstName!: string;
  @Expose() lastName!: string;
}

@Exclude()
export class BondMemberResponseDto {
  @Expose() id!: string;
  @Expose() role!: string;
  @Expose() joinedAt!: Date | null;

  @Type(() => BondMemberUserDto)
  @Expose() user!: BondMemberUserDto;
}

@Exclude()
export class BondChildResponseDto {
  @Expose() id!: string;
  @Expose() firstName!: string;
  @Expose() lastName!: string;
}

@Exclude()
export class BondResponseDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() agreementType!: string;
  @Expose() courtCaseRef!: string | null;
  @Expose() startDate!: string | null;
  @Expose() endDate!: string | null;
  @Expose() isActive!: boolean;

  @Type(() => BondMemberResponseDto)
  @Expose() members!: BondMemberResponseDto[];

  @Type(() => BondChildResponseDto)
  @Expose() children!: BondChildResponseDto[];
}
