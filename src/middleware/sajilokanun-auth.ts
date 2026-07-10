import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./auth";

export const SAJILO_KANUN_USER_TYPE = "sajilo_kanun" as const;

export interface SajiloKanunAuthUser {
  id: string;
  username: string;
  name: string;
}

export interface SajiloKanunAuthRequest extends Request {
  sajiloKanunUser?: SajiloKanunAuthUser;
}

export function signSajiloKanunToken(user: SajiloKanunAuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      name: user.name,
      userType: SAJILO_KANUN_USER_TYPE,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

export function verifySajiloKanunToken(token: string): SajiloKanunAuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      username: string;
      name: string;
      userType?: string;
    };
    if (payload.userType !== SAJILO_KANUN_USER_TYPE) return null;
    return {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

export function requireSajiloKanunAuth(
  req: SajiloKanunAuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Sajilo Kanun access required" });
    return;
  }

  const user = verifySajiloKanunToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired Sajilo Kanun session" });
    return;
  }

  req.sajiloKanunUser = user;
  next();
}
