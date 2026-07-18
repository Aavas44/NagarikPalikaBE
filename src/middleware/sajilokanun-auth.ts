import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./auth";
import type { SajiloKanunAccountRole } from "../types";
import { SajiloKanunAccount } from "../models/SajiloKanunAccount";
import { Team } from "../models/Team";
import {
  hasRolePermission,
  type RolePermissionKey,
} from "../services/role-policies";

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

export async function requireSajiloKanunAuth(
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

  try {
    const account = await SajiloKanunAccount.findById(user.id).select(
      "username name active teamId role"
    );
    if (!account?.active) {
      res.status(401).json({ error: "Sajilo Kanun account is inactive" });
      return;
    }

    if (account.teamId) {
      const team = await Team.findById(account.teamId).select("active");
      if (!team?.active) {
        res.status(403).json({ error: "Your law firm account is inactive" });
        return;
      }
    }

    req.sajiloKanunUser = {
      id: account._id.toString(),
      username: account.username,
      name: account.name,
      teamId: account.teamId?.toString() ?? null,
      role: account.role ?? null,
    };
    next();
  } catch {
    res.status(500).json({ error: "Failed to validate Sajilo Kanun session" });
  }
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

export function requireSkPermission(permission: RolePermissionKey) {
  return async (
    req: SajiloKanunAuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    const user = req.sajiloKanunUser;
    if (!user) {
      res.status(401).json({ error: "Sajilo Kanun access required" });
      return;
    }
    if (!user.teamId && permission !== "sk.chat.use") {
      res.status(403).json({ error: "No firm assigned" });
      return;
    }

    const roleKey =
      user.role === "admin"
        ? "sk.firm_admin"
        : user.role === "member"
          ? "sk.member"
          : "sk.individual";
    if (!(await hasRolePermission(roleKey, permission))) {
      res.status(403).json({ error: "Permission denied" });
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
