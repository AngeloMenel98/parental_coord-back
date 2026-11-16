import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { LoginDto, RegisterDto } from './auth.dto';

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
