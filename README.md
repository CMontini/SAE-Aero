# Aero Vault — SAE Aero

A private, nine-person workspace for sharing SolidWorks design packages. Supports manual browser uploads and includes source for a SOLIDWORKS Task Pane add-in pilot with automatic saves and editing presence.

**SOLIDWORKS 2026 Student Edition / Windows:** see [the add-in installation and test guide](solidworks/README.md). Native compilation, loading, embedded sign-in, and CAD round-trip testing must still be completed on Windows; no prebuilt installer is included.

## Current workflow

1. The owner signs in with ChatGPT and creates the workspace.
2. An administrator lists up to eight additional teammates by their ChatGPT sign-in email. This does not send email or change the hosting platform's access policy.
3. An editor uploads a Pack and Go ZIP (or a single SLDPRT, SLDASM, or SLDDRW file) into one of five subsystems.
4. An editor opens a package for editing from the SolidWorks panel. The workspace shows the editor automatically; others can open read-only.
5. Saving a linked design queues a Pack and Go snapshot and uploads a revision automatically. Closing the design ends editing presence; stale sessions expire. Previous bytes remain downloadable.
6. Editors mark packages ready for review; administrators can approve them.

The interface includes package history, active editors, an activity log, and team membership. The workspace starts empty; there is no sample CAD data.

## Architecture

- React / TypeScript / Vinext, Cloudflare Worker runtime
- D1: membership, packages, short-lived editing sessions, revisions, activity
- R2: immutable revision files, streamed from upload requests
- Platform-managed ChatGPT sign-in; server-side membership and role checks
- Conditional SQL updates and atomic batches prevent competing edit sessions and stale or concurrent revisions from replacing newer work

The GitHub repository contains source code only. CAD uploads and team records are stored in the app's database and object storage.

## Development

Requires Node 24 for the SQLite-backed integration tests. Use the pnpm version declared by package.json.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm build
node tests/vault.test.cjs
node tests/native-transfer.test.cjs
node tests/upload-worker.test.cjs
pnpm exec tsc --noEmit
```

The source includes the Sites runtime integration. A normal local browser does not get production identity headers. The integration tests provide isolated test identities and storage adapters without exposing a development login in the app.

Schema changes: update db/schema.ts, run `pnpm db:generate`, inspect the new SQL, and deploy it with the corresponding source. Do not edit already-applied migrations.

## Prototype boundaries

- Initially hosted owner-private. Team members must be authorized at both the hosting layer and in the app before team testing.
- Uploads are limited to 50 MB each. The add-in pilot uses SOLIDWORKS Pack and Go and opens downloaded revisions locally. Linked designs upload on Save through the native add-in. There is no general folder sync, server-side assembly dependency parser, simultaneous geometry merge, or browser CAD preview/editing.
- Packages are intentionally independent. Shared parts used by multiple packages require team coordination; filenames alone do not link packages together.
- Revisions preserve old files, but automated backup/export and recovery drills remain pilot-readiness work.
- No automated membership removal or admin transfer UI yet. Complete those before routine team use.
- Real SolidWorks assemblies and two separate hosted user accounts still need to be tested. Integration tests verify route logic using SQLite and an in-memory R2 adapter. The upload regression test also runs the actual upload route in workerd with local D1/R2, checking streamed uploads, retries, and invalid-length cleanup. These tests do not verify the live identity gateway or CAD compatibility.
- Optional WebMCP subsystem navigation is feature-detected; live WebMCP validation has not been performed.

## Hosting and GitHub

Source is synchronized to [CMontini/SAE-Aero](https://github.com/CMontini/SAE-Aero). The prototype is hosted with Sites. GitHub commits do not automatically deploy; the Sites publication workflow is currently separate.
