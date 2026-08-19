export type NightCliPolicy = {
  permissions: {
    allow: string[];
    deny: string[];
  };
};

export function nightCliPolicy(): NightCliPolicy {
  // Project-level `.cursor/cli.json` may contain permissions only.
  // The installed Cursor CLI rejects `version` / `editor` on this file.
  return {
    permissions: {
      allow: [
        'Read(src/**)',
        'Read(tests/**)',
        'Read(scripts/**)',
        'Read(**/*.md)',
        'Read(package.json)',
        'Read(tsconfig*.json)',
        'Write(src/**)',
        'Write(tests/**)',
        'Write(scripts/**)',
        'Write(**/*.md)',
      ],
      deny: [
        'Read(.env*)',
        'Write(.env*)',
        'Read(.runtime/**)',
        'Write(.runtime/**)',
        'Read(data/**)',
        'Write(data/**)',
        'Read(**/*.key)',
        'Write(**/*.key)',
        'Read(**/*.pem)',
        'Write(**/*.pem)',
        'Shell(*)',
        'WebFetch(*)',
        'Mcp(*:*)',
      ],
    },
  };
}

export function cliPolicyDenies(policy: NightCliPolicy, rule: string): boolean {
  return policy.permissions.deny.includes(rule);
}

export function assertNightCliPolicy(policy: NightCliPolicy): string[] {
  const required = ['Shell(*)', 'WebFetch(*)', 'Mcp(*:*)', 'Read(.env*)', 'Write(.env*)', 'Read(data/**)', 'Write(data/**)'];
  return required.filter((rule) => !cliPolicyDenies(policy, rule));
}
