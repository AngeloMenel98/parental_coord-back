import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

@ValidatorConstraint({ name: 'isIso8601WithOffset', async: false })
export class IsIso8601WithOffsetConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) {
      return false;
    }
    return !Number.isNaN(Date.parse(value));
  }

  defaultMessage(a: ValidationArguments): string {
    return `${a.property} debe ser una fecha-hora ISO-8601 con offset explícito (p. ej. 2026-10-05T10:00:00-03:00 o …Z); sin offset no se puede resolver la zona`;
  }
}

export function IsIso8601WithOffset(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsIso8601WithOffsetConstraint,
    });
  };
}
