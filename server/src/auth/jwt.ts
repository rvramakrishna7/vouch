import jwt from "jsonwebtoken";

export interface TokenPayload {
  sub: string;
  org: string;
  role: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getSecret());
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }
  const { sub, org, role } = decoded as Partial<TokenPayload>;
  if (!sub || !org || !role) {
    throw new Error("Token missing required claims");
  }
  return { sub, org, role };
}
