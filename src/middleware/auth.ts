import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthUser, UserType } from "../types";
import {
  hasRolePermission,
  type RolePermissionKey,
} from "../services/role-policies";

const JWT_SECRET = process.env.JWT_SECRET ?? "nagarik-palika-dev-secret-change-in-production";

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: {
  id: string;
  email: string;
  name: string;
  userType: UserType;
}) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, userType: user.userType },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      email: string;
      name: string;
      userType: UserType;
    };
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      userType: payload.userType,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireUserType(...allowed: UserType[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const type = req.user.userType;
    const ok =
      allowed.includes(type) || (type === "superadmin" && allowed.includes("admin"));
    if (!ok) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/** Platform superadmin only (SK team management). */
export function requireSuperadmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.userType !== "superadmin") {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  next();
}

/** Ward operator portal — document generation only. */
export function requireWardOperator(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.userType !== "wardOperator") {
    res.status(403).json({ error: "Ward operator access required" });
    return;
  }
  next();
}

/** Nagarik Palika admin panel — admin or superadmin. */
export function requireAdminPanel(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.userType !== "admin" && req.user.userType !== "superadmin") {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  next();
}

export function requirePlatformPermission(permission: RolePermissionKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.userType !== "admin" && req.user.userType !== "superadmin") {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    const roleKey =
      req.user.userType === "superadmin"
        ? "platform.superadmin"
        : "platform.admin";
    if (!(await hasRolePermission(roleKey, permission))) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }
    next();
  };
}

export { JWT_SECRET };
