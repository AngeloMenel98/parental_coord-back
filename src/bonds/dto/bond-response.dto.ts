import { Exclude, Expose, Transform, Type } from 'class-transformer';

@Exclude()
export class BondMemberUserDto {
  @Expose() id!: string;
  @Expose() systemRole!: string;

  @Expose()
  @Transform(({ obj }) => obj.personalData?.firstName?.trim() ?? null)
  firstName!: string | null;

  @Expose()
  @Transform(({ obj }) => obj.personalData?.lastName?.trim() ?? null)
  lastName!: string | null;

  @Expose()
  @Transform(({ obj }) => obj.personalData?.avatarUrl ?? null)
  avatarUrl!: string | null;
}

@Exclude()
export class BondMemberResponseDto {
  @Expose() id!: string;
  @Expose() role!: string;
  @Expose() joinedAt!: Date | null;

  @Type(() => BondMemberUserDto)
  @Expose()
  user!: BondMemberUserDto;
}

@Exclude()
export class BondChildResponseDto {
  @Expose() id!: string;
  @Expose() firstName!: string;
  @Expose() lastName!: string;
  @Expose() dateOfBirth!: string;
}

@Exclude()
export class BondResponseDto {
  @Expose() id!: string;
  @Expose() courtCaseRef!: string | null;
  @Expose() isActive!: boolean;
  @Expose() title!: string;
  @Expose() agreementType!: string;
  @Expose() startDate!: string | null;
  @Expose() endDate!: string | null;

  @Type(() => BondMemberResponseDto)
  @Expose()
  members!: BondMemberResponseDto[];

  @Type(() => BondChildResponseDto)
  @Expose()
  children!: BondChildResponseDto[];
}
