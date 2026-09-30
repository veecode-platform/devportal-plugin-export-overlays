# Vendored schemas

`packages.json` is the JSON Schema the portal applies to `kind: Package` entities. It is
copied unchanged from `workspaces/extensions/json-schema/packages.json` in
[redhat-developer/rhdh-plugins](https://github.com/redhat-developer/rhdh-plugins).

| Field | Value |
| --- | --- |
| Source commit | `5452bba7010ccafba40b1187845d83b7b1d93d02` (2026-09-28, `main`) |
| File last changed upstream | `13a7589` (2026-09-22) |

`scripts/checkCatalogPackages.py` validates every Package entity against this file. The schema
does not cover the entity name rule, so the check applies Backstage's `isValidObjectName`
separately (`packages/catalog-model/src/validation/KubernetesValidatorFunctions.ts` in
[backstage/backstage](https://github.com/backstage/backstage)): 1 to 63 characters matching
`^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$`.

To refresh the copy, take the file from the newer `rhdh-plugins` commit and update the table.
