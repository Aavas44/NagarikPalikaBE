import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthUser, UserType } from "../types";

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
    if (!allowed.includes(req.user.userType)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export { JWT_SECRET };
