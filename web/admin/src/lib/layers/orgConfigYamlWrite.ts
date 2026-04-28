import { stringify } from "yaml";
import { expectedAppSlug } from "../actions/agentAppManifest";
import { readStagedAppMeta } from "../orgSetup/setupStorage";
import { DEFAULT_FULLSEND_ORG_AGENT_ROLES, type OrgConfigYaml } from "./orgConfigParse";

const CONFIG_HEADER = `# fullsend organization configuration
# https://github.com/fullsend-ai/fullsend
#
# This file is managed by fullsend. Manual edits may be overwritten.
`;

/** Serialise org config for writing to \`config.yaml\` (parity with Go \`OrgConfig.Marshal\`). */
export function formatOrgConfigYaml(cfg: OrgConfigYaml): string {
  return CONFIG_HEADER + stringify(cfg);
}

/** Build default \`config.yaml\` for greenfield deploy before the repo exists. */
export function newGreenfieldOrgConfigYaml(input: {
  org: string;
  repoNames: string[];
  enabledRepoNames: string[];
  agentRoles: { role: string }[];
  scmHost: string;
  actorLogin: string;
}): OrgConfigYaml {
  const { org, repoNames, enabledRepoNames, agentRoles, scmHost, actorLogin } = input;
  const enabledSet = new Set(enabledRepoNames);
  const repos: NonNullable<OrgConfigYaml["repos"]> = {};
  for (const name of repoNames) {
    repos[name] = { enabled: enabledSet.has(name) };
  }

  const roleRows =
    agentRoles.length > 0 ? agentRoles : DEFAULT_FULLSEND_ORG_AGENT_ROLES.map((r) => ({ role: r }));

  const agents = roleRows.map(({ role }) => {
    const meta = readStagedAppMeta(scmHost, actorLogin, org, role);
    const slug = meta?.slug?.trim() || expectedAppSlug(org, role);
    const displayName = meta?.displayName?.trim() || `${org}-${role}`;
    return { role, name: displayName, slug };
  });

  const defaultsRoles = agents.map((a) => a.role);

  return {
    version: "1",
    dispatch: { platform: "github-actions" },
    defaults: {
      roles: defaultsRoles,
      max_implementation_retries: 2,
      auto_merge: false,
    },
    agents,
    repos,
  };
}
