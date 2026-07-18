import { RolePolicy, type RoleKey } from "../models/RolePolicy";

export const ROLE_PERMISSION_CATALOG = [
  {
    key: "platform.content.manage",
    label: "Manage site content",
    description: "Create and update terminology, templates, and lawyer listings.",
    roles: ["platform.superadmin", "platform.admin"],
  },
  {
    key: "platform.feedback.manage",
    label: "Manage feedback and demos",
    description: "Review feedback, demo requests, advocates, and consultations.",
    roles: ["platform.superadmin", "platform.admin"],
  },
  {
    key: "platform.firms.manage",
    label: "Manage firms",
    description: "Create, activate, deactivate, and inspect law firms.",
    roles: ["platform.superadmin", "platform.admin"],
  },
  {
    key: "platform.members.manage",
    label: "Manage users",
    description: "Create users and move firm accounts between firms.",
    roles: ["platform.superadmin", "platform.admin"],
  },
  {
    key: "platform.roles.manage",
    label: "Manage roles and permissions",
    description: "Edit role policies. Always retained by superadmins to prevent lockout.",
    roles: ["platform.superadmin"],
    locked: true,
  },
  {
    key: "sk.chat.use",
    label: "Use legal research",
    description: "Use Sajilo Kanun chat, normalization, PDFs, and legal tools.",
    roles: ["sk.firm_admin", "sk.member", "sk.individual"],
  },
  {
    key: "sk.cases.read_all",
    label: "View all firm cases",
    description: "View every case belonging to the assigned firm.",
    roles: ["sk.firm_admin", "sk.member"],
  },
  {
    key: "sk.cases.read_assigned",
    label: "View assigned cases",
    description: "View only cases assigned to the current account.",
    roles: ["sk.firm_admin", "sk.member"],
  },
  {
    key: "sk.cases.manage",
    label: "Manage cases",
    description: "Create, edit, and assign firm cases.",
    roles: ["sk.firm_admin", "sk.member"],
  },
  {
    key: "sk.members.manage",
    label: "Manage firm members",
    description: "Create, activate, deactivate, and update firm members.",
    roles: ["sk.firm_admin", "sk.member"],
  },
  {
    key: "sk.usage.read_team",
    label: "View firm usage",
    description: "View token usage and activity for the whole firm.",
    roles: ["sk.firm_admin", "sk.member"],
  },
  {
    key: "sk.usage.read_self",
    label: "View own usage",
    description: "View token usage for the current account.",
    roles: ["sk.firm_admin", "sk.member", "sk.individual"],
  },
] as const;

export type RolePermissionKey = (typeof ROLE_PERMISSION_CATALOG)[number]["key"];

export const ROLE_DEFINITIONS: Array<{
  key: RoleKey;
  name: string;
  scope: "Platform" | "Sajilo Kanun";
  description: string;
  defaultPermissions: RolePermissionKey[];
}> = [
  {
    key: "platform.superadmin",
    name: "Superadmin",
    scope: "Platform",
    description: "Full Nagarik Palika and Sajilo Kanun administration.",
    defaultPermissions: [
      "platform.content.manage",
      "platform.feedback.manage",
      "platform.firms.manage",
      "platform.members.manage",
      "platform.roles.manage",
    ],
  },
  {
    key: "platform.admin",
    name: "Admin",
    scope: "Platform",
    description: "Nagarik Palika content and community administration.",
    defaultPermissions: [
      "platform.content.manage",
      "platform.feedback.manage",
    ],
  },
  {
    key: "sk.firm_admin",
    name: "Firm admin",
    scope: "Sajilo Kanun",
    description: "Administrative access within one assigned law firm.",
    defaultPermissions: [
      "sk.chat.use",
      "sk.cases.read_all",
      "sk.cases.manage",
      "sk.members.manage",
      "sk.usage.read_team",
    ],
  },
  {
    key: "sk.member",
    name: "Member",
    scope: "Sajilo Kanun",
    description: "Standard legal research and assigned-case access.",
    defaultPermissions: [
      "sk.chat.use",
      "sk.cases.read_assigned",
      "sk.usage.read_self",
    ],
  },
  {
    key: "sk.individual",
    name: "Individual user",
    scope: "Sajilo Kanun",
    description: "Legal research access without an assigned law firm.",
    defaultPermissions: ["sk.chat.use", "sk.usage.read_self"],
  },
];

const validPermissions = new Set<string>(
  ROLE_PERMISSION_CATALOG.map((permission) => permission.key)
);

export function isRoleKey(value: string): value is RoleKey {
  return ROLE_DEFINITIONS.some((role) => role.key === value);
}

export function sanitizeRolePermissions(
  roleKey: RoleKey,
  permissions: unknown
): RolePermissionKey[] {
  const definition = ROLE_DEFINITIONS.find((role) => role.key === roleKey)!;
  const allowedForRole = new Set(
    ROLE_PERMISSION_CATALOG.filter((permission) =>
      (permission.roles as readonly string[]).includes(roleKey)
    ).map((permission) => permission.key)
  );
  const selected: RolePermissionKey[] = Array.isArray(permissions)
    ? permissions.filter(
        (permission): permission is RolePermissionKey =>
          typeof permission === "string" &&
          validPermissions.has(permission) &&
          allowedForRole.has(permission as RolePermissionKey)
      )
    : [...definition.defaultPermissions];

  if (
    roleKey === "platform.superadmin" &&
    !selected.includes("platform.roles.manage")
  ) {
    selected.push("platform.roles.manage");
  }

  return [...new Set(selected)];
}

export async function getRolePermissions(
  roleKey: RoleKey
): Promise<RolePermissionKey[]> {
  const policy = await RolePolicy.findOne({ roleKey }).lean();
  if (policy) return sanitizeRolePermissions(roleKey, policy.permissions);
  return (
    ROLE_DEFINITIONS.find((role) => role.key === roleKey)?.defaultPermissions ?? []
  );
}

export async function hasRolePermission(
  roleKey: RoleKey,
  permission: RolePermissionKey
): Promise<boolean> {
  const permissions = await getRolePermissions(roleKey);
  return permissions.includes(permission);
}

export async function listRolePolicies() {
  const stored = await RolePolicy.find().lean();
  const byRole = new Map(stored.map((policy) => [policy.roleKey, policy]));

  return ROLE_DEFINITIONS.map((definition) => {
    const policy = byRole.get(definition.key);
    return {
      ...definition,
      permissions: policy
        ? sanitizeRolePermissions(definition.key, policy.permissions)
        : definition.defaultPermissions,
      updatedAt: policy?.updatedAt?.toISOString?.() ?? null,
    };
  });
}
