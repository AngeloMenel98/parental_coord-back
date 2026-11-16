import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';

/**
 * El login comparaba el email por igualdad exacta y la contraseña carácter por
 * carácter, sin recortar. En un teléfono eso se traduce en 401 sobre credenciales
 * correctas: el teclado capitaliza la primera letra o deja un espacio al final.
 */
describe('auth DTO normalization', () => {
  it('lowercases and trims the login email', () => {
    const dto = plainToInstance(LoginDto, {
      email: '  Juan@Test.PROD ',
      password: 'coord-new99',
    });

    expect(dto.email).toBe('juan@test.prod');
  });

  it('trims the login password', () => {
    const dto = plainToInstance(LoginDto, { email: 'juan@test.prod', password: 'coord-new99 ' });

    expect(dto.password).toBe('coord-new99');
  });

  it('applies the same normalization on register, so both sides agree', () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'Maria@Test.Prod',
      password: ' coord-new99 ',
      firstName: 'Maria',
      lastName: 'Test',
    });

    expect(dto.email).toBe('maria@test.prod');
    expect(dto.password).toBe('coord-new99');
  });

  it('leaves an already-clean payload untouched and valid', () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'juan@test.prod',
      password: 'coord-new99',
      firstName: 'Juan',
      lastName: 'Test',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.email).toBe('juan@test.prod');
    expect(dto.password).toBe('coord-new99');
  });

  it('still rejects an email that is invalid after normalization', () => {
    const dto = plainToInstance(LoginDto, { email: '  not-an-email ', password: 'x' });

    expect(validateSync(dto).map((error) => error.property)).toContain('email');
  });
});

/**
 * S2 · política de la contraseña nueva de `POST /auth/change-password`.
 *
 * El borde es el DTO (mismo `ValidationPipe` global que el resto: 400), así que los
 * límites se prueban acá y no en el servicio: 8 caracteres como mínimo, una letra y un
 * dígito, y el recorte de espacios que ya usan login/registro.
 */
describe('ChangePasswordDto', () => {
  const valid = { currentPassword: 'temporal-123', newPassword: 'nuevaClave1' };

  it('accepts a new password of exactly 8 chars with a letter and a digit', () => {
    const dto = plainToInstance(ChangePasswordDto, { currentPassword: 'temporal-123', newPassword: 'abcdefg1' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.newPassword).toBe('abcdefg1');
  });

  it('rejects a new password shorter than 8 characters', () => {
    const dto = plainToInstance(ChangePasswordDto, { ...valid, newPassword: 'abc1234' });

    expect(validateSync(dto).map((error) => error.property)).toContain('newPassword');
  });

  it('rejects a new password without a digit', () => {
    const dto = plainToInstance(ChangePasswordDto, { ...valid, newPassword: 'soloLetras' });

    expect(validateSync(dto).map((error) => error.property)).toContain('newPassword');
  });

  it('rejects a new password without a letter', () => {
    const dto = plainToInstance(ChangePasswordDto, { ...valid, newPassword: '12345678' });

    expect(validateSync(dto).map((error) => error.property)).toContain('newPassword');
  });

  it('requires the current password', () => {
    const dto = plainToInstance(ChangePasswordDto, { newPassword: 'nuevaClave1' });

    expect(validateSync(dto).map((error) => error.property)).toContain('currentPassword');
  });

  it('trims both passwords, like login and register do', () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: ' temporal-123 ',
      newPassword: ' nuevaClave1 ',
    });

    expect(dto.currentPassword).toBe('temporal-123');
    expect(dto.newPassword).toBe('nuevaClave1');
    expect(validateSync(dto)).toHaveLength(0);
  });
});
