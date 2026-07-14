import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./auth";
import type { SajiloKanunAccountRole } from "../types";

export const SAJILO_KANUN_USER_TYPE = "sajilo_kanun" as const;

export interface SajiloKanunAuthUser {
  id: string;
  username: string;
  name: string;
  teamId: string | null;
  role: SajiloKanunAccountRole | null;
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
      teamId: user.teamId,
      role: user.role,
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
      teamId?: string | null;
      role?: SajiloKanunAccountRole | null;
      userType?: string;
    };
    if (payload.userType !== SAJILO_KANUN_USER_TYPE) return null;
    return {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      teamId: payload.teamId ?? null,
      role: payload.role ?? null,
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

export function requireSkRole(...allowed: SajiloKanunAccountRole[]) {
  return (req: SajiloKanunAuthRequest, res: Response, next: NextFunction) => {
    if (!req.sajiloKanunUser) {
      res.status(401).json({ error: "Sajilo Kanun access required" });
      return;
    }
    if (!req.sajiloKanunUser.role || !allowed.includes(req.sajiloKanunUser.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    if (!req.sajiloKanunUser.teamId) {
      res.status(403).json({ error: "No team assigned" });
      return;
    }
    next();
  };
}

export function requireSkTeamMember(req: SajiloKanunAuthRequest, res: Response, next: NextFunction) {
  if (!req.sajiloKanunUser) {
    res.status(401).json({ error: "Sajilo Kanun access required" });
    return;
  }
  if (!req.sajiloKanunUser.teamId) {
    res.status(403).json({ error: "No team assigned" });
    return;
  }
  next();
}
