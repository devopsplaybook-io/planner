import {
  UserPasswordSetPassword,
  UserPasswordCheckPassword,
} from "../users/UserPassword";
import { User } from "../model/User";

describe("UserPassword", () => {
  it("should successfully verify a password that was set", async () => {
    const password = "testPassword1234";
    const user = new User();
    await UserPasswordSetPassword(user, password);
    expect(await UserPasswordCheckPassword(user, password)).toBeTruthy();
  });

  it("should fail to verify a different password", async () => {
    const password = "testPassword1234";
    const passwordWrong = "testPassword12345";
    const user = new User();
    await UserPasswordSetPassword(user, password);
    expect(await UserPasswordCheckPassword(user, passwordWrong)).toBeFalsy();
  });
});
