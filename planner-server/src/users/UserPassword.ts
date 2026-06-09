import * as bcrypt from "bcrypt";
import { User } from "../model/User";

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
