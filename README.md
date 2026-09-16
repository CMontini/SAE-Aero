# Aero Vault — SAE Aero

A private, nine-person workspace for sharing SolidWorks design packages. Built for manual browser uploads first, with a server API that can support a desktop helper later.

## Current workflow

1. The owner signs in with ChatGPT and creates the workspace.
2. An administrator lists up to eight additional teammates by their ChatGPT sign-in email. This does not send email or change the hosting platform's access policy.
3. An editor uploads a Pack and Go ZIP (or a single SLDPRT, SLDASM, or SLDDRW file) into one of five subsystems.
4. An editor checks out a package and downloads the latest revision. Checkout is enforced by the server for uploads, not local editing.
5. A new upload creates a revision and releases the checkout. Previous bytes and notes remain downloadable.
6. Editors mark packages ready for review; administrators can approve them.

The interface includes package history, active checkouts, an activity log, and team membership. The workspace starts empty; there is no sample CAD data.

## Architecture

- React / TypeScript / Vinext, Cloudflare Worker runtime
- D1: membership, packages, checkout tokens, revisions, activity
- R2: immutable revision files, streamed from upload requests
- Platform-managed ChatGPT sign-in; server-side membership and role checks
- Conditional SQL updates and atomic batches prevent competing checkouts and stale or concurrent revisions from replacing newer work

The GitHub repository contains source code only. CAD uploads and team records are stored in the app's database and object storage.

## Development

Requires Node 24 for the SQLite-backed integration tests. Use the pnpm version declared by package.json.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm build
node tests/vault.test.cjs
pnpm exec tsc --noEmit
```

The source includes the Sites runtime integration. A normal local browser does not get production identity headers. The integration tests provide isolated test identities and storage adapters without exposing a development login in the app.

Schema changes: update db/schema.ts, run `pnpm db:generate`, inspect the new SQL, and deploy it with the corresponding source. Do not edit already-applied migrations.

## Prototype boundaries

- Initially hosted owner-private. Team members must be authorized at both the hosting layer and in the app before team testing.
- Browser uploads are limited to 50 MB each. There is no automatic folder sync, SolidWorks add-in, assembly dependency parser, CAD preview, or native CAD editing.
- Packages are intentionally independent. Shared parts used by multiple packages require team coordination; filenames alone do not link packages together.
- Revisions preserve old files, but automated backup/export and recovery drills remain pilot-readiness work.
- No automated membership removal or admin transfer UI yet. Complete those before routine team use.
- Real SolidWorks assemblies and two separate hosted user accounts still need to be tested. Integration tests verify the route logic using actual SQLite and an in-memory R2 adapter; they do not verify the live identity gateway or CAD compatibility.
- Optional WebMCP subsystem navigation is feature-detected; live WebMCP validation has not been performed.

## Hosting and GitHub

The source repository is CMontini/SAE-Aero. A deployment copy is preserved in the Sites source repository. The initial prototype is hosted with Sites. GitHub commits do not automatically deploy; the Sites publication workflow is currently separate.
