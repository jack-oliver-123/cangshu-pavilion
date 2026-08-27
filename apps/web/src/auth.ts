import { ApiError } from "./api.js";

export type AuthenticationMode = "local" | "authenticated" | "required";

interface AuthenticationApi {
  get(path: string): Promise<unknown>;
}

export async function detectAuthentication(api: AuthenticationApi): Promise<AuthenticationMode> {
  try {
    await api.get("/api/auth/session");
    return "authenticated";
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return "local";
    if (error instanceof ApiError && error.code === "UNAUTHORIZED") return "required";
    throw error;
  }
}
