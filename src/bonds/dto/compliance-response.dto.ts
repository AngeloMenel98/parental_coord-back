import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class ComplianceMemberDto {
  @Expose() userId!: string;
  @Expose() firstName!: string;
  @Expose() lastName!: string;
  @Expose() completed!: number;
  @Expose() total!: number;
  @Expose() percentage!: number;
}

@Exclude()
export class ComplianceResponseDto {
  @Expose() bondId!: string;
  @Expose() period!: string;
  @Expose() bondActive!: boolean;

  @Type(() => ComplianceMemberDto)
  @Expose() members!: ComplianceMemberDto[];
}
