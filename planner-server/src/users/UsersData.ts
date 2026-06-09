import { User } from "../model/User";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
} from "../utils/DbUtils";

export async function UsersDataGet(id: string): Promise<User> {
  const usersRaw = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_USER_BY_ID[DbUtilsGetType()],
    [id],
  );
  if (usersRaw.length === 0) {
    return null;
  }
  return User.fromJson(usersRaw[0]);
}

export async function UsersDataGetByName(name: string): Promise<User> {
  const usersRaw = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_USER_BY_NAME[DbUtilsGetType()],
    [name],
  );
  if (usersRaw.length === 0) {
    return null;
  }
  return User.fromJson(usersRaw[0]);
}

export async function UsersDataList(): Promise<User[]> {
  const usersRaw = await DbUtilsQuerySQL(
    SQL_QUERIES.LIST_USERS[DbUtilsGetType()],
  );
  return usersRaw.map((raw) => User.fromJson(raw));
}

export async function UsersDataAdd(user: User): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_USER[DbUtilsGetType()], [
    user.id,
    user.name,
    user.passwordEncrypted,
    user.role,
    user.dateCreated,
  ]);
}

export async function UsersDataUpdatePassword(user: User): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_PASSWORD[DbUtilsGetType()], [
    user.passwordEncrypted,
    user.id,
  ]);
}

export async function UsersDataUpdateUser(user: User): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPDATE_USER[DbUtilsGetType()], [
    user.role,
    user.id,
  ]);
}

export async function UsersDataDelete(id: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_USER[DbUtilsGetType()], [id]);
}

const SQL_QUERIES = {
  GET_USER_BY_ID: {
    postgres: 'SELECT * FROM users WHERE "id" = $1',
    sqlite: "SELECT * FROM users WHERE id = ?",
  },
  GET_USER_BY_NAME: {
    postgres: 'SELECT * FROM users WHERE "name" = $1',
    sqlite: "SELECT * FROM users WHERE name = ?",
  },
  LIST_USERS: {
    postgres: "SELECT * FROM users",
    sqlite: "SELECT * FROM users",
  },
  INSERT_USER: {
    postgres:
      'INSERT INTO users ("id", "name", "passwordEncrypted", "role", "dateCreated") VALUES ($1, $2, $3, $4, $5)',
    sqlite:
      "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated) VALUES (?, ?, ?, ?, ?)",
  },
  UPDATE_USER: {
    postgres: 'UPDATE users SET "role" = $1 WHERE "id" = $2',
    sqlite: "UPDATE users SET role = ? WHERE id = ?",
  },
  UPDATE_PASSWORD: {
    postgres: 'UPDATE users SET "passwordEncrypted" = $1 WHERE "id" = $2',
    sqlite: "UPDATE users SET passwordEncrypted = ? WHERE id = ?",
  },
  DELETE_USER: {
    postgres: 'DELETE FROM users WHERE "id" = $1',
    sqlite: "DELETE FROM users WHERE id = ?",
  },
};
