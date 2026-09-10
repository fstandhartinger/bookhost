---
title: "Moving a self-hosted BookStack to managed hosting: what actually breaks"
description: "A field report from our import tooling: snapshot consistency, schema updates, link rewriting, attachment paths, passwords versus MFA, and the checks that decide whether a move holds."
date: "2026-09-10"
author: "Florian Standhartinger"
tags: ["BookStack", "Migration", "Operations"]
---

Teams that run BookStack themselves usually ask us the same question first: what breaks when we move it to you? This post answers from the tooling we actually use, not from a checklist of intentions. The import procedure is public in our [operations repository](https://github.com/fstandhartinger/bookstack-ops/tree/main/ops/provisioner), as is the import runbook in [IMPORT-BOOKSTACK.md](https://github.com/fstandhartinger/bookstack-ops/blob/main/ops/provisioner/IMPORT-BOOKSTACK.md). What follows is what that code does, in the order it does it, and where its edges are.

## The snapshot has to be one moment, not two

A BookStack move consists of two artifacts: a database dump and an archive of uploaded files. They only describe the same wiki if the source stops writing while both are taken. We therefore ask for a write freeze on the source and a single-database `mariadb-dump --single-transaction --routines --triggers` export, plus a gzip tar of the uploads and attachment directories from that same frozen source. The dump contains users, password hashes, roles, token hashes and settings, so it is handled as confidential material. Changes made after the export are simply not in the import; the old instance keeps serving read-only until acceptance. Our own tooling applies the same discipline from the other side: the destination must contain only the unchanged starter content, and after maintenance mode is enabled the tool checks again, because a user may have written between preflight and import.

## Older schemas get lifted, within qualified limits

Sources arrive on different BookStack versions. After the dump replaces the destination database, the import runs BookStack's own `php artisan migrate --force`, so older schemas are brought forward by the application's migration path. The qualified fixture is BookStack v26.05.4 on the LinuxServer image with MariaDB 11.4. Migration of older schemas is invoked, but very old releases, MySQL-to-MariaDB edge cases, non-UTF-8 dumps and very large dumps are not qualified today — those need review before starting, and we say so rather than finding out mid-import.

## Links still point at the old address

Page HTML, Markdown, book and chapter descriptions, and image URLs often contain the old base URL as absolute links. Given the old address, the import rewrites those occurrences against the live schema, covering both the current `entity_page_data` and `entity_container_data` tables and the separate page, chapter and book tables of older releases. Two limits matter in practice. First, the rewrite deliberately skips host-prefix lookalikes: an address that merely starts with the old host name is left alone. Second, historical revisions, comments, external-attachment links and other settings are not rewritten. Omitting the old URL is also a valid choice and leaves even image URLs untouched. The result is a wiki whose current content points at the new home, while its history still remembers the old one.

## Attachments are rarely where you first look

This is the most common practical stumble. On the tested LinuxServer image, attachment files live in `/config/www/files`, not in `/config/files` where many people look first; standard BookStack keeps them in `storage/uploads/files`. The import accepts archives with `uploads/...` and `files/...` members and normalizes LinuxServer's layout so the runtime path and the backup path agree. After the file install, a verification pass walks every attachment and image row in the database — as the application user, inside the container — and resolves each referenced file. If database entries point at files that are missing or unreadable, the import fails rather than serving a wiki with silently broken downloads. An operator can explicitly override this with a logged flag; the default is to stop.

## Passwords survive; second factors and external sign-in do not automatically

Local accounts carry over because the dump includes BookStack's password hashes: after the import, your existing admin and member passwords are the credentials, not any password we issued for the destination. Two things need separate attention. The source's application key is not copied, so anything encrypted with it — multi-factor settings in particular — may require customer recovery. And external sign-in methods such as LDAP, SAML or OIDC, together with SMTP overrides, S3 storage, plugins and themes, are outside the import entirely. They are reconfigured and tested deliberately before cutover, not discovered afterwards.

## Derived state is rebuilt, not carried

Search index and permission caches are computed state. After the link rewrite, the import runs `bookstack:regenerate-search`, `bookstack:regenerate-permissions` and clears the application and view caches. What you send is content and configuration; what BookStack can recompute, it recomputes on the new home.

## The order of operations is built for the bad day

A dry run reads both inputs completely, checks the destination and prints content counts and the plan without touching anything. The real run first creates an encrypted hot backup of the destination and prints the recovery archive receipt before any mutation. It then enables maintenance, rechecks the starter content, imports the SQL, migrates, installs files, rewrites links, rebuilds search and permissions, verifies the local files and resumes service. If anything fails after the SQL import begins, the tool authenticates and decrypts that backup and restores the destination to its pre-import state. If recovery itself fails, it attempts to stop the application and leaves a quarantine marker for an operator, rather than serving a partial import. We would rather report a failed move than hand back half a wiki.

## The way out is the same procedure in reverse

None of this would be worth much if it only worked inbound. Our export produces the same two artifacts this post started with — a database dump and an archive of uploads and attachments — plus a manifest with content counts and SHA-256 checksums and a short restore guide. Those restore into any BookStack installation. Moving to managed hosting should not mean moving in.

---

*BookHost provides managed BookStack hosting for teams. The migration route described here reflects the current tooling; the boundaries listed above are real and we review edge cases before we start.*
