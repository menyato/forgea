import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, Trim } from './email.js';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_PATTERN,
} from './constants.js';

export class RegisterDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  name?: string;
}

/** The token from an email-verification link. */
export class VerifyEmailDto {
  @IsString()
  @MaxLength(2048)
  token!: string;
}

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  // No minimum here: a wrong password should get the generic "incorrect" answer,
  // not a validation message that reveals the policy was checked.
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

/** "Forgot your password?": where to send the link. */
export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

/** The link's token and the new password. */
export class ResetPasswordDto {
  @IsString()
  @MaxLength(2048)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

/** A signed-in customer changing their password: the current one proves it is them. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your current password' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

/** The account page: the name and phone used for orders and deliveries. */
export class UpdateProfileDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Enter your name' })
  @MaxLength(100)
  name!: string;

  @Trim()
  @Matches(PHONE_PATTERN, { message: 'Enter a valid phone number' })
  phone!: string;
}
