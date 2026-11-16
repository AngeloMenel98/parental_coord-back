import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Los emails se buscaban por igualdad exacta contra la base, así que
 * `Juan@Test.prod` y `juan@test.prod` eran cuentas distintas: la primera
 * devolvía 401 sobre una cuenta que sí existía. Se normaliza en el borde.
 */
const NormalizedEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/**
 * Un espacio invisible al final de la contraseña —lo que agrega el teclado del
 * teléfono— devolvía 401 sin explicación posible para quien lo tipeó.
 * Se recorta en registro y en login, así que ninguna contraseña guardada empieza
 * ni termina con espacios.
 */
const TrimmedPassword = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class RegisterDto {
  @NormalizedEmail()
  @IsEmail()
  email!: string;

  @TrimmedPassword()
  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}

export class LoginDto {
  @NormalizedEmail()
  @IsEmail()
  email!: string;

  @TrimmedPassword()
  @IsString()
  @IsNotEmpty()
  password!: string;
}
