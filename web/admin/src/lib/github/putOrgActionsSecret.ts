import type { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";

/**
 * Create or update an organisation Actions secret (libsodium sealed box, same shape as
 * {@link https://docs.github.com/en/rest/actions/secrets#create-or-update-an-organization-secret}).
 */
export async function putOrgActionsSecret(
  octokit: Octokit,
  org: string,
  secretName: string,
  plaintextSecret: string,
  selectedRepositoryIds: number[],
): Promise<void> {
  await sodium.ready;
  const value = plaintextSecret.trim();
  if (!value) {
    throw new Error("Secret value is empty.");
  }

  const { data: pub } = await octokit.request("GET /orgs/{org}/actions/secrets/public-key", {
    org,
  });

  const binKey = sodium.from_base64(pub.key, sodium.base64_variants.ORIGINAL);
  const binSecret = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binSecret, binKey);
  const encrypted_value = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  await octokit.request("PUT /orgs/{org}/actions/secrets/{secret_name}", {
    org,
    secret_name: secretName,
    encrypted_value,
    key_id: pub.key_id,
    visibility: "selected",
    selected_repository_ids: selectedRepositoryIds,
  });
}
