import { DescribeImagesCommand, DescribeRepositoriesCommand, type ImageDetail, type Repository } from "@aws-sdk/client-ecr";
import { ecr } from "../../clients/ecr";

export const repoHref = (name: string) => `/ecr/repository?name=${encodeURIComponent(name)}`;

export const REPO_NAME_RULE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const REPO_NAME_HINT = "Use 2 to 256 lowercase letters, numbers, hyphens, underscores, periods and forward slashes. Start with a letter or number.";

export async function listRepositories(): Promise<Repository[]> {
  const out: Repository[] = [];
  let nextToken: string | undefined;
  do {
    const res = await ecr.send(new DescribeRepositoriesCommand({ nextToken }));
    out.push(...(res.repositories ?? []));
    nextToken = res.nextToken;
  } while (nextToken);
  return out.sort((a, b) => (a.repositoryName ?? "").localeCompare(b.repositoryName ?? ""));
}

/**
 * The images of a repository, one row per digest.
 * AWS returns one entry per image with all its tags. floci returns one entry per tag, so entries with the same digest are joined.
 */
export async function listImages(repositoryName: string): Promise<ImageDetail[]> {
  const byDigest = new Map<string, ImageDetail>();
  let nextToken: string | undefined;
  do {
    const res = await ecr.send(new DescribeImagesCommand({ repositoryName, nextToken }));
    for (const image of res.imageDetails ?? []) {
      const digest = image.imageDigest ?? "";
      const seen = byDigest.get(digest);
      if (seen) seen.imageTags = [...new Set([...(seen.imageTags ?? []), ...(image.imageTags ?? [])])];
      else byDigest.set(digest, { ...image, imageTags: [...(image.imageTags ?? [])] });
    }
    nextToken = res.nextToken;
  } while (nextToken);
  return [...byDigest.values()].sort((a, b) => (b.imagePushedAt?.getTime() ?? 0) - (a.imagePushedAt?.getTime() ?? 0));
}

/** sha256:0123456789ab... becomes sha256:0123456789ab. */
export const shortDigest = (digest?: string) => (digest ? digest.slice(0, 19) : "-");

export const MUTABILITY = [
  { value: "MUTABLE", label: "Mutable", description: "A push can move a tag to a new image." },
  { value: "IMMUTABLE", label: "Immutable", description: "A tag stays on its first image. A push to the same tag fails." },
];
