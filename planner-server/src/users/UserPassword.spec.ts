import * as bcrypt from "bcrypt";
import {
  USER_PASSWORD_DUMMY_HASH,
  USER_PASSWORD_MIN_LENGTH,
  UserPasswordCheckPassword,
  UserPasswordCompareDummy,
  UserPasswordSetPassword,
  UserPasswordValidate,
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

describe("UserPasswordValidate", () => {
  it("should accept a password of exactly the minimum length", () => {
    expect(USER_PASSWORD_MIN_LENGTH).toBe(8);
    expect(UserPasswordValidate("a".repeat(8))).toBeNull();
  });

  it("should reject a password one character below the minimum", () => {
    expect(UserPasswordValidate("a".repeat(7))).toBe(
      "Invalid: Password (minimum 8 characters)",
    );
  });

  it("should reject an empty password", () => {
    expect(UserPasswordValidate("")).toBe(
      "Invalid: Password (minimum 8 characters)",
    );
  });
});

describe("UserPasswordCompareDummy", () => {
  it("should use a cost-10 dummy hash", () => {
    expect(bcrypt.getRounds(USER_PASSWORD_DUMMY_HASH)).toBe(10);
  });

  it("should resolve for any submitted password", async () => {
    await expect(
      UserPasswordCompareDummy("anything"),
    ).resolves.toBeUndefined();
    await expect(UserPasswordCompareDummy("")).resolves.toBeUndefined();
  });
});
