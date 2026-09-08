# Active patches

Applied by `override-sources.sh` to the source repo before export
(`patches/*.patch`, sorted, `-p1` because they carry `--- a/` headers).

## 0001-workspaces-exclude-dist-dynamic.patch

Adds `!plugins/**/dist-dynamic/**` to the root `workspaces` glob.

**Do not drop this as "unnecessary upstream divergence."** Without it this
workspace can export exactly one plugin per run. `rhdh-cli plugin export
--embed-package` writes the embedded copy *inside the source tree*, at
`plugins/<p>/backend/dist-dynamic/embedded/<pkg>`, and upstream's bare
`plugins/**` glob matches it. The embedded copy then collides with the real
package and yarn aborts at project setup for every later export:

```
must not have multiple workspaces with the same name
package '@aws/amazon-ecs-plugin-for-backstage-common' has conflicts in the following paths:
    source-repo/plugins/ecs/backend/dist-dynamic/embedded/aws-amazon-ecs-plugin-for-backstage-common
    source-repo/plugins/ecs/common
```

Observed on PR #228 (ADR-011 repoint to awslabs): `plugins/ecs/frontend`
published, then `plugins/ecs/backend`'s embed step poisoned the checkout and the
remaining five exports failed. The retired `veecode-platform` fork carried this
same negation in its root `package.json`, which is why the fork never hit it.

On a clean checkout the negation is a no-op: `yarn workspaces list` returns the
same 32 workspaces with and without it (verified against `awslabs@b492f565` with
`yarn-4.12.0`). It only excludes build artifacts, which were never in
`yarn.lock`.

Applies to `awslabs/backstage-plugins-for-aws` @ `b492f565`. Any `repo-ref` bump
should re-check that the hunk still applies — a failing patch fails the export.
