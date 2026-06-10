import { User } from "../model/User";

describe("User model", () => {
  describe("constructor", () => {
    it("should set id and dateCreated", () => {
      const user = new User();
      expect(user.id).toBeDefined();
      expect(user.id.length).toBeGreaterThan(0);
      expect(user.dateCreated).toBeDefined();
      expect(user.role).toBe("user");
      expect(user.passwordEncrypted).toBeUndefined();
    });
  });

  describe("fromJson", () => {
    it("should create a User from valid JSON", () => {
      const user = User.fromJson({
        id: "test-id",
        name: "testuser",
        passwordEncrypted: "hashed-password",
        role: "admin",
      });
      expect(user).not.toBeNull();
      expect(user.id).toBe("test-id");
      expect(user.name).toBe("testuser");
      expect(user.passwordEncrypted).toBe("hashed-password");
      expect(user.role).toBe("admin");
    });

    it("should default role to 'user' when not provided", () => {
      const user = User.fromJson({
        id: "test-id",
        name: "testuser",
        passwordEncrypted: "pw",
      });
      expect(user.role).toBe("user");
    });

    it("should return null for null input", () => {
      expect(User.fromJson(null)).toBeNull();
    });

    it("should keep existing id when not in JSON", () => {
      const user = User.fromJson({ name: "test" });
      expect(user.id).toBeDefined();
    });
  });

  describe("toJson", () => {
    it("should return all fields including passwordEncrypted", () => {
      const user = new User();
      user.name = "testuser";
      user.passwordEncrypted = "secret";
      user.role = "admin";

      const json = user.toJson();
      expect(json.id).toBe(user.id);
      expect(json.name).toBe("testuser");
      expect(json.passwordEncrypted).toBe("secret");
      expect(json.role).toBe("admin");
      expect(json.dateCreated).toBe(user.dateCreated);
    });
  });

  describe("toTransportJson", () => {
    it("should omit passwordEncrypted", () => {
      const user = new User();
      user.name = "testuser";
      user.passwordEncrypted = "secret";

      const json = user.toTransportJson();
      expect(json.id).toBe(user.id);
      expect(json.name).toBe("testuser");
      expect(json.passwordEncrypted).toBeUndefined();
      expect(json.role).toBeDefined();
    });
  });
});
