import * as bcrypt from "bcrypt";
import { User } from "../model/User";

export const USER_PASSWORD_MIN_LENGTH = 8;

/**
 * Password policy applied when a password is set or changed. Login is
 * deliberately not validated so existing shorter passwords keep working.
 * Returns an error message, or null when the password is acceptable.
 */
export function UserPasswordValidate(password: string): string | null {
  if (!password || password.length < USER_PASSWORD_MIN_LENGTH) {
    return `Invalid: Password (minimum ${USER_PASSWORD_MIN_LENGTH} characters)`;
  }
  return null;
}

/**
 * Fixed cost-10 hash compared against when the login username does not
 * exist, so a miss costs the same bcrypt work as a wrong password and the
 * response timing cannot reveal which usernames exist.
 */
export const USER_PASSWORD_DUMMY_HASH =
  "$2b$10$Damxp0Nbe/MG55DtyqdbmuRgKv16I.01zaMpbhbnb3PuNd18fSZj.";

export async function UserPasswordCompareDummy(
  password: string,
): Promise<void> {
  await bcrypt.compare(password, USER_PASSWORD_DUMMY_HASH);
}

export async function UserPasswordSetPassword(
  user: User,
  password: string,
): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  user.passwordEncrypted = await bcrypt.hash(password, salt);
}

export async function UserPasswordCheckPassword(
  user: User,
  password: string,
): Promise<boolean> {
  return await bcrypt.compare(password, user.passwordEncrypted);
}
