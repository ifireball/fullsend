import type { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
import { utf8ToBase64 } from "./utf8Base64";

/**
 * Create or update a repository Actions secret (libsodium sealed box; same as org secrets).
 */
export async function putRepoActionsSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  plaintextSecret: string,
): Promise<void> {
  await sodium.ready;
  const value = plaintextSecret.trim();
  if (!value) {
    throw new Error("Secret value is empty.");
  }

  const { data: pub } = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/secrets/public-key",
    { owner, repo },
  );

  const binKey = sodium.from_base64(pub.key, sodium.base64_variants.ORIGINAL);
  const binSecret = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(binSecret, binKey);
  const encrypted_value = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  await octokit.request("PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}", {
    owner,
    repo,
    secret_name: secretName,
    encrypted_value,
    key_id: pub.key_id,
  });
}
